import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/api/v1'

export async function runAtlasProvider(payload, options = {}) {
  const env = options.env ?? process.env
  const apiKey = env.ATLASCLOUD_API_KEY || env.ATLAS_PROVIDER_API_KEY || env.REAL_PROVIDER_API_KEY
  if (!apiKey) {
    return {
      status: 'skipped',
      provider: 'atlas',
      endpointConfigured: false,
      reason: 'ATLASCLOUD_API_KEY is not configured.',
    }
  }

  const baseUrl = env.ATLASCLOUD_API_BASE_URL || DEFAULT_BASE_URL
  const outputType = payload.output?.type === 'video' ? 'video' : 'image'
  const prompt = payload.prompt || ''
  const uploadedReferences = await uploadReferences(payload.references ?? [], { apiKey, baseUrl })
  const generationPayload = buildAtlasGenerationPayload(payload, {
    outputType,
    prompt,
    uploadedReferences,
    env,
  })
  const submitPath = outputType === 'video' ? '/model/generateVideo' : '/model/generateImage'
  const submitEndpoint = `${baseUrl}${submitPath}`
  const submitResponse = await fetch(submitEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(generationPayload),
  })
  const submitText = await submitResponse.text()
  const submitBody = parseMaybeJson(submitText)

  if (!submitResponse.ok || submitBody?.code >= 400) {
    return {
      status: 'failed',
      provider: 'atlas',
      endpointConfigured: true,
      endpoint: submitEndpoint,
      httpStatus: submitResponse.status,
      request: generationPayload,
      uploadedReferences,
      body: submitBody,
    }
  }

  const predictionId = submitBody?.data?.id || submitBody?.id
  if (!predictionId) {
    return {
      status: 'failed',
      provider: 'atlas',
      endpointConfigured: true,
      endpoint: submitEndpoint,
      request: generationPayload,
      uploadedReferences,
      body: submitBody,
      error: 'Atlas response did not include a prediction id.',
    }
  }

  const pollResult = await pollPrediction(predictionId, {
    apiKey,
    baseUrl,
    attempts: Number(env.ATLAS_POLL_ATTEMPTS || (outputType === 'video' ? 160 : 100)),
    intervalMs: Number(env.ATLAS_POLL_INTERVAL_MS || 3000),
  })

  return {
    status: pollResult.status,
    provider: 'atlas',
    endpointConfigured: true,
    endpoint: submitEndpoint,
    predictionId,
    request: generationPayload,
    uploadedReferences,
    submit: submitBody,
    poll: pollResult,
    outputs: pollResult.outputs,
    outputUrl: pollResult.outputs?.[0],
  }
}

function buildAtlasGenerationPayload(payload, { outputType, prompt, uploadedReferences, env }) {
  const hasReference = uploadedReferences.length > 0
  const isReferenceImageEdit = outputType === 'image' && hasReference
  const model =
    payload.model ||
    (outputType === 'video'
      ? hasReference
        ? env.ATLASCLOUD_VIDEO_IMAGE_MODEL || 'bytedance/seedance-2.0/reference-to-video'
        : env.ATLASCLOUD_VIDEO_TEXT_MODEL || 'bytedance/seedance-2.0/text-to-video'
      : hasReference
        ? env.ATLASCLOUD_IMAGE_EDIT_MODEL || 'openai/gpt-image-2/edit'
        : env.ATLASCLOUD_IMAGE_TEXT_MODEL || 'openai/gpt-image-2/text-to-image')

  const request = {
    model,
    prompt: isReferenceImageEdit ? buildImageEditPrompt(prompt) : prompt,
  }

  if (outputType === 'video') {
    request.duration = Number(env.ATLASCLOUD_VIDEO_DURATION || 5)
    request.aspect_ratio = env.ATLASCLOUD_VIDEO_ASPECT_RATIO || '16:9'
  } else {
    request.image_size = env.ATLASCLOUD_IMAGE_SIZE || '1024x1024'
  }

  if (hasReference) {
    request.image_url = uploadedReferences[0].download_url
  }

  return request
}

function buildImageEditPrompt(prompt) {
  const trimmedPrompt = String(prompt || '').trim()
  return [
    'Edit the provided source image. Preserve the original subject, identity, pose, composition, and background unless the canvas annotations explicitly ask to change them.',
    'Apply only the requested canvas annotations and user instructions. Do not replace the image with a new unrelated product, web page, scene, or layout.',
    '',
    trimmedPrompt || 'Create a faithful revised version from the selected frame.',
  ].join('\n')
}

async function uploadReferences(references, { apiKey, baseUrl }) {
  const uploaded = []
  for (const reference of references) {
    const localPath = reference.uri
    if (!localPath || /^https?:\/\//.test(localPath)) {
      uploaded.push({
        ...reference,
        download_url: localPath,
        skippedUpload: true,
      })
      continue
    }

    const fileBuffer = await readFile(localPath)
    const fileName = basename(localPath)
    const formData = new FormData()
    formData.append('file', new Blob([fileBuffer]), fileName)
    const response = await fetch(`${baseUrl}/model/uploadMedia`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })
    const text = await response.text()
    const body = parseMaybeJson(text)
    if (!response.ok || body?.code >= 400) {
      throw new Error(`Atlas upload failed: ${response.status} ${text}`)
    }
    uploaded.push({
      ...reference,
      uploadResponse: body,
      download_url: body?.data?.download_url,
      filename: body?.data?.filename,
      size: body?.data?.size,
    })
  }
  return uploaded
}

async function pollPrediction(predictionId, { apiKey, baseUrl, attempts, intervalMs }) {
  let latest = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(intervalMs)
    const endpoint = `${baseUrl}/model/prediction/${predictionId}`
    const response = await fetch(endpoint, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    })
    const text = await response.text()
    const body = parseMaybeJson(text)
    if (!response.ok || body?.code >= 400) {
      return {
        status: 'failed',
        endpoint,
        httpStatus: response.status,
        body,
      }
    }
    const data = body?.data ?? body
    latest = data
    const status = data?.status || 'unknown'
    if (status === 'completed' || status === 'succeeded') {
      return {
        status: 'succeeded',
        endpoint,
        predictionStatus: status,
        body,
        outputs: normalizeOutputs(data),
      }
    }
    if (status === 'failed') {
      return {
        status: 'failed',
        endpoint,
        predictionStatus: status,
        body,
        error: data?.error || 'Atlas generation failed.',
      }
    }
  }

  return {
    status: 'processing',
    predictionStatus: latest?.status || 'unknown',
    body: latest,
    reason: 'Atlas prediction is still processing.',
  }
}

function normalizeOutputs(data) {
  const outputs = data?.outputs ?? data?.output ?? []
  if (Array.isArray(outputs)) return outputs
  return outputs ? [outputs] : []
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

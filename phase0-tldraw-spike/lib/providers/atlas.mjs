import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/api/v1'
const execFileAsync = promisify(execFile)

export async function runAtlasProvider(payload, options = {}) {
  const startedAt = new Date()
  const startedMs = Date.now()
  const timings = {
    startedAt: startedAt.toISOString(),
    uploadStartedAt: undefined,
    uploadCompletedAt: undefined,
    uploadDurationMs: 0,
    submitStartedAt: undefined,
    submitCompletedAt: undefined,
    submitDurationMs: 0,
    pollStartedAt: undefined,
    pollCompletedAt: undefined,
    pollDurationMs: 0,
    pollAttempts: 0,
    completedAt: undefined,
    totalDurationMs: 0,
  }
  const env = options.env ?? process.env
  const apiKey = env.ATLASCLOUD_API_KEY || env.ATLAS_PROVIDER_API_KEY || env.REAL_PROVIDER_API_KEY
  if (!apiKey) {
    finalizeTimings(timings, startedMs)
    return {
      status: 'skipped',
      provider: 'Atlas Cloud',
      endpointConfigured: false,
      timings,
      reason: 'ATLASCLOUD_API_KEY is not configured.',
    }
  }

  const baseUrl = env.ATLASCLOUD_API_BASE_URL || DEFAULT_BASE_URL
  const outputType = payload.output?.type === 'video' ? 'video' : 'image'
  const prompt = payload.prompt || ''
  const uploadStartedMs = Date.now()
  timings.uploadStartedAt = new Date(uploadStartedMs).toISOString()
  const uploadedReferences = await uploadReferences(payload.references ?? [], { apiKey, baseUrl })
  const uploadCompletedMs = Date.now()
  timings.uploadCompletedAt = new Date(uploadCompletedMs).toISOString()
  timings.uploadDurationMs = uploadCompletedMs - uploadStartedMs
  const generationPayload = buildAtlasGenerationPayload(payload, {
    outputType,
    prompt,
    uploadedReferences,
    env,
  })
  const submitPath = outputType === 'video' ? '/model/generateVideo' : '/model/generateImage'
  const submitEndpoint = `${baseUrl}${submitPath}`
  const submitStartedMs = Date.now()
  timings.submitStartedAt = new Date(submitStartedMs).toISOString()
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
  const submitCompletedMs = Date.now()
  timings.submitCompletedAt = new Date(submitCompletedMs).toISOString()
  timings.submitDurationMs = submitCompletedMs - submitStartedMs

  if (!submitResponse.ok || submitBody?.code >= 400) {
    finalizeTimings(timings, startedMs)
    return {
      status: 'failed',
      provider: 'Atlas Cloud',
      endpointConfigured: true,
      endpoint: submitEndpoint,
      httpStatus: submitResponse.status,
      request: generationPayload,
      uploadedReferences,
      timings,
      body: submitBody,
    }
  }

  const predictionId = submitBody?.data?.id || submitBody?.id
  if (!predictionId) {
    finalizeTimings(timings, startedMs)
    return {
      status: 'failed',
      provider: 'Atlas Cloud',
      endpointConfigured: true,
      endpoint: submitEndpoint,
      request: generationPayload,
      uploadedReferences,
      timings,
      body: submitBody,
      error: 'Atlas Cloud response did not include a prediction id.',
    }
  }

  const pollStartedMs = Date.now()
  timings.pollStartedAt = new Date(pollStartedMs).toISOString()
  const pollResult = await pollPrediction(predictionId, {
    apiKey,
    baseUrl,
    outputType,
    attempts: Number(env.ATLAS_POLL_ATTEMPTS || (outputType === 'video' ? 160 : 100)),
    intervalMs: Number(env.ATLAS_POLL_INTERVAL_MS || 2000),
  })
  const pollCompletedMs = Date.now()
  timings.pollCompletedAt = new Date(pollCompletedMs).toISOString()
  timings.pollDurationMs = pollCompletedMs - pollStartedMs
  timings.pollAttempts = pollResult.attempts ?? 0
  finalizeTimings(timings, startedMs)

  return {
    status: pollResult.status,
    provider: 'Atlas Cloud',
    endpointConfigured: true,
    endpoint: submitEndpoint,
    predictionId,
    request: generationPayload,
    uploadedReferences,
    submit: submitBody,
    poll: pollResult,
    timings,
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
    request.resolution = env.ATLASCLOUD_VIDEO_RESOLUTION || '720p'
    request.ratio = resolveAtlasVideoRatio({ payload, prompt, env })
    request.bitrate_mode = env.ATLASCLOUD_VIDEO_BITRATE_MODE || 'standard'
    request.generate_audio = env.ATLASCLOUD_VIDEO_AUDIO !== 'false'
    request.watermark = env.ATLASCLOUD_VIDEO_WATERMARK === 'true'
    request.return_last_frame = env.ATLASCLOUD_VIDEO_RETURN_LAST_FRAME === 'true'
  } else {
    request.size = env.ATLASCLOUD_IMAGE_SIZE || '1024x1024'
  }

  if (hasReference) {
    if (outputType === 'image') {
      request.images = uploadedReferences
        .filter((reference) => reference.type === 'image')
        .map((reference) => reference.download_url)
        .filter(Boolean)
    } else {
      const imageUrls = uploadedReferences
        .filter((reference) => reference.type === 'image')
        .map((reference) => reference.download_url)
        .filter(Boolean)
      const videoUrls = uploadedReferences
        .filter((reference) => reference.type === 'video')
        .map((reference) => reference.download_url)
        .filter(Boolean)
      const audioUrls = uploadedReferences
        .filter((reference) => reference.type === 'audio')
        .map((reference) => reference.download_url)
        .filter(Boolean)

      if (imageUrls.length > 0) request.reference_images = imageUrls
      if (videoUrls.length > 0) request.reference_videos = videoUrls
      if (audioUrls.length > 0) request.reference_audios = audioUrls
    }
  }

  return request
}

function resolveAtlasVideoRatio({ payload, prompt, env }) {
  const promptRatio = ratioFromPrompt(prompt)
  if (promptRatio) return `${promptRatio.w}:${promptRatio.h}`

  return 'adaptive'
}

function ratioFromPrompt(prompt) {
  const text = String(prompt || '').toLowerCase()
  const explicit = text.match(/(?:^|[^\d])(\d{1,2})\s*[:：x×]\s*(\d{1,2})(?:[^\d]|$)/)
  if (explicit) {
    const w = Number(explicit[1])
    const h = Number(explicit[2])
    if (w > 0 && h > 0) return { w, h }
  }

  if (/(竖屏|竖版|portrait|vertical|9\s*[:：x×]\s*16)/i.test(text)) return { w: 9, h: 16 }
  if (/(横屏|横版|landscape|horizontal|16\s*[:：x×]\s*9)/i.test(text)) return { w: 16, h: 9 }
  if (/(正方形|方图|square|1\s*[:：x×]\s*1)/i.test(text)) return { w: 1, h: 1 }

  return undefined
}

function buildImageEditPrompt(prompt) {
  const trimmedPrompt = String(prompt || '').trim()
  return [
    'Use the provided source image as the primary visual reference.',
    'Apply only the requested user instructions and canvas annotations.',
    'Do not render canvas arrows, boxes, notes, selection outlines, or editor UI unless explicitly requested.',
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

    const uploadFile = await prepareReferenceUploadFile(localPath)
    const formData = new FormData()
    formData.append('file', new Blob([uploadFile.buffer], { type: uploadFile.mimeType }), uploadFile.fileName)
    try {
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
        throw new Error(`Atlas Cloud upload failed: ${response.status} ${text}`)
      }
      uploaded.push({
        ...reference,
        uploadResponse: body,
        download_url: body?.data?.download_url,
        filename: body?.data?.filename,
        size: body?.data?.size,
        normalizedReference: uploadFile.normalized,
      })
    } finally {
      await uploadFile.cleanup?.()
    }
  }
  return uploaded
}

async function prepareReferenceUploadFile(localPath) {
  const originalBuffer = await readFile(localPath)
  if (!isAvifBuffer(originalBuffer)) {
    return {
      buffer: originalBuffer,
      fileName: basename(localPath),
      mimeType: mimeTypeFromFileName(localPath),
      normalized: false,
    }
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-reference-'))
  const normalizedPath = join(tempRoot, `${basename(localPath).replace(/[^a-zA-Z0-9_-]+/g, '-')}.png`)
  try {
    await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', localPath, normalizedPath])
    return {
      buffer: await readFile(normalizedPath),
      fileName: `${basename(localPath).replace(/[^a-zA-Z0-9_-]+/g, '-')}.png`,
      mimeType: 'image/png',
      normalized: 'avif-to-png',
      cleanup: async () => {
        await rm(tempRoot, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    throw new Error(`Atlas Cloud reference normalization failed for AVIF input: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function isAvifBuffer(buffer) {
  return buffer.subarray(4, 12).toString('ascii') === 'ftypavif' || buffer.subarray(4, 12).toString('ascii') === 'ftypavis'
}

function mimeTypeFromFileName(fileName) {
  if (/\\.png$/i.test(fileName)) return 'image/png'
  if (/\\.jpe?g$/i.test(fileName)) return 'image/jpeg'
  if (/\\.webp$/i.test(fileName)) return 'image/webp'
  if (/\\.gif$/i.test(fileName)) return 'image/gif'
  if (/\\.avif(\\.bin)?$/i.test(fileName)) return 'image/avif'
  if (/\\.mp4$/i.test(fileName)) return 'video/mp4'
  if (/\\.webm$/i.test(fileName)) return 'video/webm'
  return 'application/octet-stream'
}

async function pollPrediction(predictionId, { apiKey, baseUrl, outputType, attempts, intervalMs }) {
  let latest = null
  const pollPaths = outputType === 'image' ? ['/model/prediction', '/model/result'] : ['/model/prediction']
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(intervalMs)

    let lastFailure = null
    for (const pollPath of pollPaths) {
      const endpoint = `${baseUrl}${pollPath}/${predictionId}`
      const response = await fetch(endpoint, {
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      })
      const text = await response.text()
      const body = parseMaybeJson(text)
      if (!response.ok || body?.code >= 400) {
        lastFailure = {
          status: 'failed',
          endpoint,
          httpStatus: response.status,
          body,
        }
        continue
      }

      const data = body?.data ?? body
      latest = data
      const status = data?.status || 'unknown'
      if (status === 'completed' || status === 'succeeded') {
        return {
          status: 'succeeded',
          attempts: attempt + 1,
          endpoint,
          predictionStatus: status,
          body,
          outputs: normalizeOutputs(data),
        }
      }
      if (status === 'failed') {
        return {
          status: 'failed',
          attempts: attempt + 1,
          endpoint,
          predictionStatus: status,
          body,
          error: data?.error || 'Atlas Cloud generation failed.',
        }
      }
    }

    if (!latest && lastFailure && attempt === attempts - 1) return lastFailure
  }

  return {
    status: 'processing',
    attempts,
    predictionStatus: latest?.status || 'unknown',
    body: latest,
    reason: 'Atlas Cloud prediction is still processing.',
  }
}

function finalizeTimings(timings, startedMs) {
  const completedMs = Date.now()
  timings.completedAt = new Date(completedMs).toISOString()
  timings.totalDurationMs = completedMs - startedMs
  return timings
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

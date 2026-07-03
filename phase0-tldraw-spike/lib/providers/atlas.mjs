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
  if (generationPayload.__coflowValidationError) {
    finalizeTimings(timings, startedMs)
    return {
      status: 'failed',
      provider: 'Atlas Cloud',
      endpointConfigured: true,
      request: generationPayload.request,
      uploadedReferences,
      timings,
      error: generationPayload.__coflowValidationError,
    }
  }
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
    const videoPayload = buildAtlasVideoPayload({
      payload,
      prompt,
      env,
      model,
      uploadedReferences,
    })
    if (videoPayload.error) {
      return {
        request,
        __coflowValidationError: videoPayload.error,
      }
    }
    Object.assign(request, videoPayload.fields)
  } else {
    request.size = env.ATLASCLOUD_IMAGE_SIZE || '1024x1024'
  }

  if (hasReference && outputType === 'image') {
    if (outputType === 'image') {
      request.images = uploadedReferences
        .filter((reference) => reference.type === 'image')
        .map((reference) => reference.download_url)
        .filter(Boolean)
    }
  }

  return request
}

function buildAtlasVideoPayload({ payload, prompt, env, model, uploadedReferences }) {
  const route = atlasVideoRoute(model)
  const fields = {}
  const imageUrls = referenceUrls(uploadedReferences, 'image')
  const videoUrls = referenceUrls(uploadedReferences, 'video')
  const audioUrls = referenceUrls(uploadedReferences, 'audio')
  const videoOptions = resolveAtlasVideoOptions({ payload, prompt, env })

  if (route === 'text-to-video') {
    assignVideoOptions(fields, videoOptions, [
      'duration',
      'resolution',
      'ratio',
      'bitrate_mode',
      'generate_audio',
      'watermark',
      'return_last_frame',
      'web_search',
    ])
    return { fields }
  }

  if (route === 'image-to-video') {
    if (!imageUrls[0]) return { error: `${model} requires an image reference.` }
    if (model === 'xai/grok-imagine-video-v1.5/image-to-video') {
      fields.image_url = imageUrls[0]
      assignVideoOptions(fields, videoOptions, ['aspect_ratio'])
      return { fields }
    }
    fields.image = imageUrls[0]
    assignVideoOptions(fields, videoOptions, [
      'duration',
      'resolution',
      'ratio',
      'bitrate_mode',
      'generate_audio',
      'watermark',
      'return_last_frame',
    ])
    return { fields }
  }

  if (route === 'reference-to-video') {
    if (model.startsWith('alibaba/happyhorse-')) {
      if (imageUrls.length === 0) return { error: `${model} requires one or more image references.` }
      fields.images = imageUrls
      assignVideoOptions(fields, videoOptions, ['duration', 'resolution', 'ratio', 'seed'])
      return { fields }
    }

    if (imageUrls.length === 0) return { error: `${model} requires one or more image references.` }
    fields.reference_images = imageUrls
    if (audioUrls.length > 0) fields.reference_audios = audioUrls
    assignVideoOptions(fields, videoOptions, [
      'duration',
      'resolution',
      'ratio',
      'bitrate_mode',
      'generate_audio',
      'watermark',
      'return_last_frame',
    ])
    return { fields }
  }

  if (route === 'video-edit') {
    if (!videoUrls[0]) return { error: `${model} requires a video reference.` }

    if (model.startsWith('kwaivgi/kling-video-o3-')) {
      fields.video = videoUrls[0]
      fields.images = imageUrls
      fields.keep_original_sound = resolveAtlasVideoBoolean({
        payload,
        prompt,
        env,
        optionNames: ['keep_original_sound', 'keepOriginalSound'],
        envKey: 'ATLASCLOUD_VIDEO_KEEP_ORIGINAL_SOUND',
        defaultValue: true,
        positivePatterns: [/(保留原声|keep\s+original\s+sound|original\s+sound)/i],
        negativePatterns: [/(不要原声|移除原声|no\s+original\s+sound|without\s+original\s+sound)/i],
      })
      if (model.includes('-pro/')) assignVideoOptions(fields, videoOptions, ['duration', 'aspect_ratio'])
      return { fields }
    }

    if (model.startsWith('alibaba/wan-')) {
      fields.video = videoUrls[0]
      if (imageUrls[0]) fields.image = imageUrls[0]
      assignVideoOptions(fields, videoOptions, ['duration', 'resolution', 'ratio', 'prompt_extend', 'seed'])
      return { fields }
    }

    fields.video = videoUrls[0]
    if (imageUrls.length > 0) fields.images = imageUrls
    assignVideoOptions(fields, videoOptions, ['duration', 'resolution', 'ratio'])
    return { fields }
  }

  if (route === 'extend-video' || route === 'edit-video') {
    if (!videoUrls[0]) return { error: `${model} requires a video reference.` }
    fields.video_url = videoUrls[0]
    if (route === 'extend-video') assignVideoOptions(fields, videoOptions, ['duration'])
    return { fields }
  }

  if (imageUrls.length > 0) {
    fields.reference_images = imageUrls
  }
  if (videoUrls.length > 0) {
    fields.video = videoUrls[0]
  }
  assignVideoOptions(fields, videoOptions, ['duration', 'resolution', 'ratio'])
  return { fields }
}

function atlasVideoRoute(model) {
  const text = String(model || '')
  if (text.endsWith('/text-to-video')) return 'text-to-video'
  if (text.endsWith('/image-to-video')) return 'image-to-video'
  if (text.endsWith('/reference-to-video')) return 'reference-to-video'
  if (text.endsWith('/video-edit')) return 'video-edit'
  if (text.endsWith('/extend-video')) return 'extend-video'
  if (text.endsWith('/edit-video')) return 'edit-video'
  return 'unknown'
}

function referenceUrls(uploadedReferences, type) {
  return uploadedReferences
    .filter((reference) => reference.type === type)
    .map((reference) => reference.download_url)
    .filter(Boolean)
}

function resolveAtlasVideoOptions({ payload, prompt, env }) {
  const ratio = resolveAtlasVideoRatio({ payload, prompt, env })
  return {
    duration: resolveAtlasVideoDuration({ payload, prompt, env }),
    resolution: resolveAtlasVideoResolution({ payload, prompt, env }),
    ratio,
    aspect_ratio: ratio === 'adaptive' ? undefined : ratio,
    bitrate_mode: resolveAtlasVideoBitrateMode({ payload, prompt, env }),
    generate_audio: resolveAtlasVideoBoolean({
      payload,
      prompt,
      env,
      optionNames: ['generate_audio', 'generateAudio', 'audio'],
      envKey: 'ATLASCLOUD_VIDEO_AUDIO',
      defaultValue: true,
      positivePatterns: [/(有声音|带声音|生成音频|音频|配音|with\s+audio|audio\s+on|generate\s+audio)/i],
      negativePatterns: [/(无声|静音|不要声音|不生成音频|不带声音|no\s+audio|without\s+audio|mute|muted|silent)/i],
    }),
    watermark: resolveAtlasVideoBoolean({
      payload,
      prompt,
      env,
      optionNames: ['watermark'],
      envKey: 'ATLASCLOUD_VIDEO_WATERMARK',
      defaultValue: false,
      positivePatterns: [/(加水印|带水印|保留水印|with\s+watermark|watermark\s+on)/i],
      negativePatterns: [/(无水印|不要水印|去水印|不带水印|without\s+watermark|no\s+watermark|watermark\s+off)/i],
    }),
    return_last_frame: resolveAtlasVideoBoolean({
      payload,
      prompt,
      env,
      optionNames: ['return_last_frame', 'returnLastFrame', 'lastFrame'],
      envKey: 'ATLASCLOUD_VIDEO_RETURN_LAST_FRAME',
      defaultValue: false,
      positivePatterns: [/(返回最后一帧|输出最后一帧|保留最后一帧|return\s+last\s+frame|last\s+frame)/i],
      negativePatterns: [/(不返回最后一帧|不要最后一帧|不要返回最后一帧|no\s+last\s+frame|without\s+last\s+frame)/i],
    }),
    web_search: booleanFromValue(videoOption(payload, ['web_search', 'webSearch'])),
    prompt_extend: booleanFromValue(videoOption(payload, ['prompt_extend', 'promptExtend'])),
    seed: numberFromValue(videoOption(payload, ['seed'])),
  }
}

function assignVideoOptions(target, options, names) {
  for (const name of names) {
    const value = options[name]
    if (value !== undefined) target[name] = value
  }
}

function resolveAtlasVideoDuration({ payload, prompt, env }) {
  const structured = videoOption(payload, ['duration', 'durationSeconds', 'seconds'])
  const structuredNumber = numberFromValue(structured)
  if (structuredNumber) return structuredNumber

  const promptDuration = durationFromPrompt(prompt)
  if (promptDuration) return promptDuration

  return Number(env.ATLASCLOUD_VIDEO_DURATION || 5)
}

function resolveAtlasVideoResolution({ payload, prompt, env }) {
  const structured = videoOption(payload, ['resolution', 'quality'])
  const structuredResolution = resolutionFromValue(structured)
  if (structuredResolution) return structuredResolution

  const promptResolution = resolutionFromPrompt(prompt)
  if (promptResolution) return promptResolution

  return env.ATLASCLOUD_VIDEO_RESOLUTION || '720p'
}

function resolveAtlasVideoRatio({ payload, prompt, env }) {
  const structured = videoOption(payload, ['ratio', 'aspectRatio', 'aspect_ratio'])
  const structuredRatio = ratioFromValue(structured)
  if (structuredRatio) return structuredRatio

  const promptRatio = ratioFromPrompt(prompt)
  if (promptRatio) return `${promptRatio.w}:${promptRatio.h}`

  return 'adaptive'
}

function resolveAtlasVideoBitrateMode({ payload, prompt, env }) {
  const structured = videoOption(payload, ['bitrate_mode', 'bitrateMode', 'bitrate'])
  const structuredBitrate = bitrateModeFromValue(structured)
  if (structuredBitrate) return structuredBitrate

  const promptBitrate = bitrateModeFromPrompt(prompt)
  if (promptBitrate) return promptBitrate

  return env.ATLASCLOUD_VIDEO_BITRATE_MODE || 'standard'
}

function resolveAtlasVideoBoolean({
  payload,
  prompt,
  env,
  optionNames,
  envKey,
  defaultValue,
  positivePatterns,
  negativePatterns,
}) {
  const structured = videoOption(payload, optionNames)
  const structuredBoolean = booleanFromValue(structured)
  if (structuredBoolean !== undefined) return structuredBoolean

  const text = String(prompt || '')
  for (const pattern of negativePatterns) {
    if (pattern.test(text)) return false
  }
  for (const pattern of positivePatterns) {
    if (pattern.test(text)) return true
  }

  const envBoolean = booleanFromValue(env[envKey])
  return envBoolean === undefined ? defaultValue : envBoolean
}

function videoOption(payload, names) {
  const containers = [payload?.providerOptions, payload?.options, payload?.params, payload]
  for (const container of containers) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue
    for (const name of names) {
      if (container[name] !== undefined) return container[name]
    }
  }
  return undefined
}

function durationFromPrompt(prompt) {
  const text = String(prompt || '')
  const secondMatch = text.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|秒)(?:[^\w]|$)/i)
  if (secondMatch) return Number(secondMatch[1])

  const minuteMatch = text.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|分钟)(?:[^\w]|$)/i)
  if (minuteMatch) return Number(minuteMatch[1]) * 60

  return undefined
}

function resolutionFromPrompt(prompt) {
  const text = String(prompt || '')
  const pMatch = text.match(/\b(480|720|1080|1440|2160)\s*p\b/i)
  if (pMatch) return `${pMatch[1]}p`

  const kMatch = text.match(/\b([248])\s*k\b/i)
  if (kMatch) return `${kMatch[1].toUpperCase()}K`

  return undefined
}

function bitrateModeFromPrompt(prompt) {
  const text = String(prompt || '')
  if (/(高码率|高比特率|高质量|high\s+bitrate|high\s+quality)/i.test(text)) return 'high'
  if (/(低码率|低比特率|low\s+bitrate)/i.test(text)) return 'low'
  if (/(标准码率|标准比特率|standard\s+bitrate)/i.test(text)) return 'standard'
  return undefined
}

function numberFromValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const number = Number(value.trim())
    if (Number.isFinite(number) && number > 0) return number
    return durationFromPrompt(value)
  }
  return undefined
}

function resolutionFromValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return `${value}p`
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (/^\d+p$/i.test(text)) return text.toLowerCase()
  if (/^[248]k$/i.test(text)) return text.toUpperCase()
  return resolutionFromPrompt(text)
}

function ratioFromValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  const ratio = ratioFromPrompt(text)
  return ratio ? `${ratio.w}:${ratio.h}` : undefined
}

function bitrateModeFromValue(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (['low', 'standard', 'high'].includes(text)) return text
  return bitrateModeFromPrompt(text)
}

function booleanFromValue(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on', 'enabled'].includes(text)) return true
  if (['false', '0', 'no', 'n', 'off', 'disabled'].includes(text)) return false
  return undefined
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

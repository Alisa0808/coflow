const COMMON_VIDEO_OPTIONS = [
  'duration',
  'resolution',
  'ratio',
  'bitrate_mode',
  'generate_audio',
  'watermark',
  'return_last_frame',
]

const OPTION_ALIASES = {
  aspectRatio: 'ratio',
  aspect_ratio: 'ratio',
  audio: 'generate_audio',
  bitrate: 'bitrate_mode',
  bitrateMode: 'bitrate_mode',
  durationSeconds: 'duration',
  generateAudio: 'generate_audio',
  keepOriginalSound: 'keep_original_sound',
  lastFrame: 'return_last_frame',
  promptExtend: 'prompt_extend',
  quality: 'resolution',
  returnLastFrame: 'return_last_frame',
  seconds: 'duration',
  webSearch: 'web_search',
}

export const ATLAS_VIDEO_MODEL_CAPABILITIES = [
  textModel('bytedance/seedance-2.0/text-to-video', 'Seedance 2.0 Text-to-Video', 'ByteDance'),
  imageModel('bytedance/seedance-2.0/image-to-video', 'Seedance 2.0 Image-to-Video', 'ByteDance'),
  seedanceReferenceModel('bytedance/seedance-2.0/reference-to-video', 'Seedance 2.0 Reference-to-Video'),
  textModel('bytedance/seedance-2.0-mini/text-to-video', 'Seedance 2.0 Mini Text-to-Video', 'ByteDance'),
  imageModel('bytedance/seedance-2.0-mini/image-to-video', 'Seedance 2.0 Mini Image-to-Video', 'ByteDance'),
  seedanceReferenceModel('bytedance/seedance-2.0-mini/reference-to-video', 'Seedance 2.0 Mini Reference-to-Video'),
  textModel('kwaivgi/kling-v3.0-turbo/text-to-video', 'Kling V3.0 Turbo Text-to-Video', 'Kuaishou'),
  imageModel('kwaivgi/kling-v3.0-turbo/image-to-video', 'Kling V3.0 Turbo Image-to-Video', 'Kuaishou'),
  textModel('kwaivgi/kling-v3.0-std/text-to-video', 'Kling V3.0 Standard Text-to-Video', 'Kuaishou'),
  imageModel('kwaivgi/kling-v3.0-std/image-to-video', 'Kling V3.0 Standard Image-to-Video', 'Kuaishou'),
  textModel('kwaivgi/kling-v3.0-pro/text-to-video', 'Kling V3.0 Pro Text-to-Video', 'Kuaishou'),
  imageModel('kwaivgi/kling-v3.0-pro/image-to-video', 'Kling V3.0 Pro Image-to-Video', 'Kuaishou'),
  textModel('kwaivgi/kling-v3.0-4k/text-to-video', 'Kling V3.0 4K Text-to-Video', 'Kuaishou'),
  imageModel('kwaivgi/kling-v3.0-4k/image-to-video', 'Kling V3.0 4K Image-to-Video', 'Kuaishou'),
  textModel('kwaivgi/kling-video-o3-std/text-to-video', 'Kling O3 Standard Text-to-Video', 'Kuaishou'),
  imageModel('kwaivgi/kling-video-o3-std/image-to-video', 'Kling O3 Standard Image-to-Video', 'Kuaishou'),
  imageReferenceModel('kwaivgi/kling-video-o3-std/reference-to-video', 'Kling O3 Standard Reference-to-Video', 'Kuaishou'),
  textModel('kwaivgi/kling-video-o3-pro/text-to-video', 'Kling O3 Pro Text-to-Video', 'Kuaishou'),
  imageModel('kwaivgi/kling-video-o3-pro/image-to-video', 'Kling O3 Pro Image-to-Video', 'Kuaishou'),
  imageReferenceModel('kwaivgi/kling-video-o3-pro/reference-to-video', 'Kling O3 Pro Reference-to-Video', 'Kuaishou'),
  textModel('kwaivgi/kling-video-o3-4k/text-to-video', 'Kling O3 4K Text-to-Video', 'Kuaishou'),
  imageModel('kwaivgi/kling-video-o3-4k/image-to-video', 'Kling O3 4K Image-to-Video', 'Kuaishou'),
  textModel('alibaba/wan-2.7/text-to-video', 'Wan 2.7 Text-to-Video', 'Alibaba'),
  imageModel('alibaba/wan-2.7/image-to-video', 'Wan 2.7 Image-to-Video', 'Alibaba'),
  imageReferenceModel('alibaba/wan-2.7/reference-to-video', 'Wan 2.7 Reference-to-Video', 'Alibaba'),
  videoEditModel('alibaba/wan-2.7/video-edit', 'Wan 2.7 Video Edit', 'Alibaba', [
    'duration',
    'resolution',
    'ratio',
    'prompt_extend',
    'seed',
  ]),
  textModel('alibaba/happyhorse-1.1/text-to-video', 'HappyHorse 1.1 Text-to-Video', 'Alibaba'),
  imageModel('alibaba/happyhorse-1.1/image-to-video', 'HappyHorse 1.1 Image-to-Video', 'Alibaba'),
  imageReferenceModel('alibaba/happyhorse-1.1/reference-to-video', 'HappyHorse 1.1 Reference-to-Video', 'Alibaba', [
    'duration',
    'resolution',
    'ratio',
    'seed',
  ]),
  textModel('xai/grok-imagine-video/text-to-video', 'Grok Imagine Video Text-to-Video', 'xAI'),
  imageModel('xai/grok-imagine-video-v1.5/image-to-video', 'Grok Imagine Video v1.5 Image-to-Video', 'xAI', ['ratio']),
]

export const ATLAS_VIDEO_MODEL_CATALOG = ATLAS_VIDEO_MODEL_CAPABILITIES.map(({ id, label, provider, mode }) => ({
  id,
  label,
  provider,
  mode,
}))

export function getAtlasVideoModelCapability(model) {
  return ATLAS_VIDEO_MODEL_CAPABILITIES.find((capability) => capability.id === model)
}

export function atlasVideoRouteFromModel(model) {
  const capability = getAtlasVideoModelCapability(model)
  if (capability) return capability.route

  const text = String(model || '')
  if (text.endsWith('/text-to-video')) return 'text-to-video'
  if (text.endsWith('/image-to-video')) return 'image-to-video'
  if (text.endsWith('/reference-to-video')) return 'reference-to-video'
  if (text.endsWith('/video-edit')) return 'video-edit'
  if (text.endsWith('/extend-video')) return 'extend-video'
  if (text.endsWith('/edit-video')) return 'edit-video'
  return 'unknown'
}

export function validateAtlasVideoRequest({ model, references = [], providerOptions } = {}) {
  const capability = getAtlasVideoModelCapability(model)
  if (!capability) {
    return {
      ok: false,
      code: 'unknown_model',
      reason: `Atlas video model "${model || '(missing)'}" is not in CoFlow's verified Atlas video model table.`,
      model,
    }
  }

  const referenceCounts = countReferences(references)
  const referenceValidation = validateReferences(capability, referenceCounts)
  if (!referenceValidation.ok) return referenceValidation

  const optionsValidation = validateProviderOptions(capability, providerOptions)
  if (!optionsValidation.ok) return optionsValidation

  return {
    ok: true,
    model,
    capability,
  }
}

function textModel(id, label, provider) {
  return modelCapability(id, label, provider, 'text_to_video', {
    referenceLimits: {},
    supportedOptions: [...COMMON_VIDEO_OPTIONS, 'web_search'],
  })
}

function imageModel(id, label, provider, supportedOptions = COMMON_VIDEO_OPTIONS) {
  return modelCapability(id, label, provider, 'image_to_video', {
    referenceLimits: {
      image: { min: 1, max: 1 },
    },
    supportedOptions,
  })
}

function seedanceReferenceModel(id, label) {
  return modelCapability(id, label, 'ByteDance', 'reference_to_video', {
    minTotalReferences: 1,
    referenceLimits: {
      image: { min: 0 },
      video: { min: 0 },
      audio: { min: 0 },
    },
    supportedOptions: COMMON_VIDEO_OPTIONS,
  })
}

function imageReferenceModel(id, label, provider, supportedOptions = COMMON_VIDEO_OPTIONS) {
  return modelCapability(id, label, provider, 'reference_to_video', {
    referenceLimits: {
      image: { min: 1 },
    },
    supportedOptions,
  })
}

function videoEditModel(id, label, provider, supportedOptions) {
  return modelCapability(id, label, provider, 'video_edit', {
    referenceLimits: {
      video: { min: 1, max: 1 },
      image: { min: 0 },
    },
    supportedOptions,
  })
}

function modelCapability(id, label, provider, mode, { referenceLimits, supportedOptions, minTotalReferences = 0 }) {
  return {
    id,
    label,
    provider,
    mode,
    route: mode.replaceAll('_', '-'),
    minTotalReferences,
    referenceLimits,
    supportedOptions,
  }
}

function countReferences(references) {
  const counts = {
    image: 0,
    video: 0,
    audio: 0,
    total: 0,
  }
  for (const reference of references) {
    const type = reference?.mediaType || reference?.type || 'image'
    if (type !== 'image' && type !== 'video' && type !== 'audio') continue
    counts[type] += 1
    counts.total += 1
  }
  return counts
}

function validateReferences(capability, counts) {
  const limits = capability.referenceLimits || {}
  if (counts.total < (capability.minTotalReferences || 0)) {
    return validationError(
      'missing_reference',
      `${capability.label} requires at least ${capability.minTotalReferences} reference asset.`
    )
  }

  for (const type of ['image', 'video', 'audio']) {
    const count = counts[type]
    const limit = limits[type]
    if (count > 0 && !limit) {
      return validationError('unsupported_reference', `${capability.label} does not support ${type} references.`)
    }
    if (limit?.min !== undefined && count < limit.min) {
      return validationError('missing_reference', `${capability.label} requires at least ${limit.min} ${type} reference.`)
    }
    if (limit?.max !== undefined && count > limit.max) {
      return validationError('too_many_references', `${capability.label} supports at most ${limit.max} ${type} reference.`)
    }
  }

  return { ok: true }
}

function validateProviderOptions(capability, providerOptions) {
  if (!providerOptions || typeof providerOptions !== 'object' || Array.isArray(providerOptions)) return { ok: true }
  const supported = new Set(capability.supportedOptions || [])
  const unsupported = Object.keys(providerOptions)
    .map((key) => normalizeOptionName(key))
    .filter((key) => !supported.has(key))

  if (unsupported.length === 0) return { ok: true }
  return validationError(
    'unsupported_options',
    `${capability.label} does not support provider option(s): ${[...new Set(unsupported)].join(', ')}.`
  )
}

function normalizeOptionName(name) {
  return OPTION_ALIASES[name] || name
}

function validationError(code, reason) {
  return {
    ok: false,
    code,
    reason,
  }
}

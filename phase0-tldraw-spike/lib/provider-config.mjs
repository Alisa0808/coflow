import { buildOnboardingStatus, normalizeProviderSettings } from './provider-settings.mjs'

const DEFAULT_ATLAS_BASE_URL = 'https://api.atlascloud.ai/api/v1'

export const ATLAS_CLOUD_MODEL_CATALOG = {
  image: [
    {
      id: 'google/nano-banana-2/text-to-image',
      label: 'Nano Banana 2 Text-to-Image',
      provider: 'Google',
      mode: 'text_to_image',
    },
    {
      id: 'google/nano-banana-2/edit',
      label: 'Nano Banana 2 Edit',
      provider: 'Google',
      mode: 'image_edit',
    },
    {
      id: 'google/nano-banana-2-lite/text-to-image',
      label: 'Nano Banana 2 Lite Text-to-Image',
      provider: 'Google',
      mode: 'text_to_image',
    },
    {
      id: 'google/nano-banana-2-lite/edit',
      label: 'Nano Banana 2 Lite Edit',
      provider: 'Google',
      mode: 'image_edit',
    },
    {
      id: 'google/nano-banana-pro/text-to-image',
      label: 'Nano Banana Pro Text-to-Image',
      provider: 'Google',
      mode: 'text_to_image',
    },
    {
      id: 'google/nano-banana-pro/edit',
      label: 'Nano Banana Pro Edit',
      provider: 'Google',
      mode: 'image_edit',
    },
    {
      id: 'bytedance/seedream-v5.0-lite',
      label: 'Seedream 5.0 Lite Text-to-Image',
      provider: 'ByteDance',
      mode: 'text_to_image',
    },
    {
      id: 'bytedance/seedream-v5.0-lite/edit',
      label: 'Seedream 5.0 Lite Edit',
      provider: 'ByteDance',
      mode: 'image_edit',
    },
    {
      id: 'bytedance/seedream-v4.5',
      label: 'Seedream 4.5 Text-to-Image',
      provider: 'ByteDance',
      mode: 'text_to_image',
    },
    {
      id: 'bytedance/seedream-v4.5/edit',
      label: 'Seedream 4.5 Edit',
      provider: 'ByteDance',
      mode: 'image_edit',
    },
    {
      id: 'bytedance/seedream-v4.5/sequential',
      label: 'Seedream 4.5 Sequential',
      provider: 'ByteDance',
      mode: 'text_to_image',
    },
    {
      id: 'bytedance/seedream-v4.5/edit-sequential',
      label: 'Seedream 4.5 Edit Sequential',
      provider: 'ByteDance',
      mode: 'image_edit',
    },
    {
      id: 'xai/grok-imagine-image/text-to-image',
      label: 'Grok Imagine Image Text-to-Image',
      provider: 'xAI',
      mode: 'text_to_image',
    },
    {
      id: 'xai/grok-imagine-image/edit',
      label: 'Grok Imagine Image Edit',
      provider: 'xAI',
      mode: 'image_edit',
    },
    {
      id: 'qwen/qwen-image-2.0/text-to-image',
      label: 'Qwen Image 2.0 Text-to-Image',
      provider: 'Qwen',
      mode: 'text_to_image',
    },
    {
      id: 'qwen/qwen-image-2.0/edit',
      label: 'Qwen Image 2.0 Edit',
      provider: 'Qwen',
      mode: 'image_edit',
    },
    {
      id: 'alibaba/wan-2.7/text-to-image',
      label: 'Wan 2.7 Text-to-Image',
      provider: 'Alibaba',
      mode: 'text_to_image',
    },
    {
      id: 'alibaba/wan-2.7/image-edit',
      label: 'Wan 2.7 Image Edit',
      provider: 'Alibaba',
      mode: 'image_edit',
    },
  ],
  video: [
    {
      id: 'bytedance/seedance-2.0/text-to-video',
      label: 'Seedance 2.0 Text-to-Video',
      provider: 'ByteDance',
      mode: 'text_to_video',
    },
    {
      id: 'bytedance/seedance-2.0/image-to-video',
      label: 'Seedance 2.0 Image-to-Video',
      provider: 'ByteDance',
      mode: 'image_to_video',
    },
    {
      id: 'bytedance/seedance-2.0/reference-to-video',
      label: 'Seedance 2.0 Reference-to-Video',
      provider: 'ByteDance',
      mode: 'reference_to_video',
    },
    {
      id: 'bytedance/seedance-2.0-mini/text-to-video',
      label: 'Seedance 2.0 Mini Text-to-Video',
      provider: 'ByteDance',
      mode: 'text_to_video',
    },
    {
      id: 'bytedance/seedance-2.0-mini/image-to-video',
      label: 'Seedance 2.0 Mini Image-to-Video',
      provider: 'ByteDance',
      mode: 'image_to_video',
    },
    {
      id: 'bytedance/seedance-2.0-mini/reference-to-video',
      label: 'Seedance 2.0 Mini Reference-to-Video',
      provider: 'ByteDance',
      mode: 'reference_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-turbo/text-to-video',
      label: 'Kling V3.0 Turbo Text-to-Video',
      provider: 'Kuaishou',
      mode: 'text_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-turbo/image-to-video',
      label: 'Kling V3.0 Turbo Image-to-Video',
      provider: 'Kuaishou',
      mode: 'image_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-std/text-to-video',
      label: 'Kling V3.0 Standard Text-to-Video',
      provider: 'Kuaishou',
      mode: 'text_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-std/image-to-video',
      label: 'Kling V3.0 Standard Image-to-Video',
      provider: 'Kuaishou',
      mode: 'image_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-pro/text-to-video',
      label: 'Kling V3.0 Pro Text-to-Video',
      provider: 'Kuaishou',
      mode: 'text_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-pro/image-to-video',
      label: 'Kling V3.0 Pro Image-to-Video',
      provider: 'Kuaishou',
      mode: 'image_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-4k/text-to-video',
      label: 'Kling V3.0 4K Text-to-Video',
      provider: 'Kuaishou',
      mode: 'text_to_video',
    },
    {
      id: 'kwaivgi/kling-v3.0-4k/image-to-video',
      label: 'Kling V3.0 4K Image-to-Video',
      provider: 'Kuaishou',
      mode: 'image_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-std/text-to-video',
      label: 'Kling O3 Standard Text-to-Video',
      provider: 'Kuaishou',
      mode: 'text_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-std/image-to-video',
      label: 'Kling O3 Standard Image-to-Video',
      provider: 'Kuaishou',
      mode: 'image_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-std/reference-to-video',
      label: 'Kling O3 Standard Reference-to-Video',
      provider: 'Kuaishou',
      mode: 'reference_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-pro/text-to-video',
      label: 'Kling O3 Pro Text-to-Video',
      provider: 'Kuaishou',
      mode: 'text_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-pro/image-to-video',
      label: 'Kling O3 Pro Image-to-Video',
      provider: 'Kuaishou',
      mode: 'image_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-pro/reference-to-video',
      label: 'Kling O3 Pro Reference-to-Video',
      provider: 'Kuaishou',
      mode: 'reference_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-4k/text-to-video',
      label: 'Kling O3 4K Text-to-Video',
      provider: 'Kuaishou',
      mode: 'text_to_video',
    },
    {
      id: 'kwaivgi/kling-video-o3-4k/image-to-video',
      label: 'Kling O3 4K Image-to-Video',
      provider: 'Kuaishou',
      mode: 'image_to_video',
    },
    {
      id: 'alibaba/wan-2.7/text-to-video',
      label: 'Wan 2.7 Text-to-Video',
      provider: 'Alibaba',
      mode: 'text_to_video',
    },
    {
      id: 'alibaba/wan-2.7/image-to-video',
      label: 'Wan 2.7 Image-to-Video',
      provider: 'Alibaba',
      mode: 'image_to_video',
    },
    {
      id: 'alibaba/wan-2.7/reference-to-video',
      label: 'Wan 2.7 Reference-to-Video',
      provider: 'Alibaba',
      mode: 'reference_to_video',
    },
    {
      id: 'alibaba/wan-2.7/video-edit',
      label: 'Wan 2.7 Video Edit',
      provider: 'Alibaba',
      mode: 'video_edit',
    },
    {
      id: 'alibaba/happyhorse-1.1/text-to-video',
      label: 'HappyHorse 1.1 Text-to-Video',
      provider: 'Alibaba',
      mode: 'text_to_video',
    },
    {
      id: 'alibaba/happyhorse-1.1/image-to-video',
      label: 'HappyHorse 1.1 Image-to-Video',
      provider: 'Alibaba',
      mode: 'image_to_video',
    },
    {
      id: 'alibaba/happyhorse-1.1/reference-to-video',
      label: 'HappyHorse 1.1 Reference-to-Video',
      provider: 'Alibaba',
      mode: 'reference_to_video',
    },
    {
      id: 'xai/grok-imagine-video/text-to-video',
      label: 'Grok Imagine Video Text-to-Video',
      provider: 'xAI',
      mode: 'text_to_video',
    },
    {
      id: 'xai/grok-imagine-video-v1.5/image-to-video',
      label: 'Grok Imagine Video v1.5 Image-to-Video',
      provider: 'xAI',
      mode: 'image_to_video',
    },
  ],
}

export function getProviderStatus(env = process.env, options = {}) {
  const canvasUrl = env.COFLOW_URL || options.canvasUrl || 'http://127.0.0.1:5176'
  const workspaceRoot = options.workspaceRoot
  const atlasConfigured = Boolean(env.ATLASCLOUD_API_KEY || env.ATLAS_PROVIDER_API_KEY || env.REAL_PROVIDER_API_KEY)
  const atlasBaseUrl = env.ATLASCLOUD_API_BASE_URL || DEFAULT_ATLAS_BASE_URL
  const providerSettings = normalizeProviderSettings(options.providerSettings, env)

  const status = {
    ok: true,
    source: 'coflow',
    updatedAt: new Date().toISOString(),
    canvasUrl,
    workspaceRoot,
    defaultProvider: {
      image: 'Codex',
      video: 'Atlas Cloud',
    },
    defaultImageProvider: 'Codex',
    defaultVideoProvider: 'Atlas Cloud',
    providers: {
      codexNative: {
        id: 'codex-native',
        label: 'Codex',
        configured: true,
        requiredEnv: [],
        models: {
          imageText: env.CODEX_IMAGE_TEXT_MODEL || 'gpt-image-2',
          imageEdit: env.CODEX_IMAGE_EDIT_MODEL || 'gpt-image-2',
        },
      },
      atlas: {
        id: 'Atlas Cloud',
        label: 'Atlas Cloud',
        configured: atlasConfigured,
        credentialEnv: configuredEnvName(env, ['ATLASCLOUD_API_KEY', 'ATLAS_PROVIDER_API_KEY', 'REAL_PROVIDER_API_KEY']),
        requiredEnv: ['ATLASCLOUD_API_KEY'],
        baseUrl: atlasBaseUrl,
        models: {
          imageText: env.ATLASCLOUD_IMAGE_TEXT_MODEL || 'openai/gpt-image-2/text-to-image',
          imageEdit: env.ATLASCLOUD_IMAGE_EDIT_MODEL || 'openai/gpt-image-2/edit',
          videoText: env.ATLASCLOUD_VIDEO_TEXT_MODEL || 'bytedance/seedance-2.0/text-to-video',
          videoReference: env.ATLASCLOUD_VIDEO_IMAGE_MODEL || 'bytedance/seedance-2.0/reference-to-video',
        },
        modelCatalog: ATLAS_CLOUD_MODEL_CATALOG,
        imageDefaults: {
          size: env.ATLASCLOUD_IMAGE_SIZE || '1024x1024',
        },
        videoDefaults: {
          duration: numberFromEnv(env.ATLASCLOUD_VIDEO_DURATION, 5),
          resolution: env.ATLASCLOUD_VIDEO_RESOLUTION || '720p',
          ratio: env.ATLASCLOUD_VIDEO_RATIO || 'adaptive',
          bitrateMode: env.ATLASCLOUD_VIDEO_BITRATE_MODE || 'standard',
          generateAudio: env.ATLASCLOUD_VIDEO_AUDIO !== 'false',
          watermark: env.ATLASCLOUD_VIDEO_WATERMARK === 'true',
          returnLastFrame: env.ATLASCLOUD_VIDEO_RETURN_LAST_FRAME === 'true',
        },
      },
      custom: {
        seedance: customProviderStatus(env, {
          endpointEnv: 'SEEDANCE_PROVIDER_ENDPOINT',
          apiKeyEnv: 'SEEDANCE_PROVIDER_API_KEY',
        }),
        kling: customProviderStatus(env, {
          endpointEnv: 'KLING_PROVIDER_ENDPOINT',
          apiKeyEnv: 'KLING_PROVIDER_API_KEY',
        }),
        generic: customProviderStatus(env, {
          endpointEnv: 'REAL_PROVIDER_ENDPOINT',
          apiKeyEnv: 'REAL_PROVIDER_API_KEY',
        }),
      },
    },
    notes: [
      'Secrets are intentionally redacted. User-facing provider setup may show whether an external provider is connected or needs an API key, but never the secret value.',
      'Credential presence is part of onboarding and preflight diagnostics when the default route needs an external provider.',
      'Provider/model choice belongs to Codex skills. The canvas should only show lightweight state and writeback results.',
    ],
  }
  status.onboarding = buildOnboardingStatus({
    providerSettings,
    providerStatus: status,
    settingsPath: options.settingsPath,
  })
  return status
}

function customProviderStatus(env, { endpointEnv, apiKeyEnv }) {
  return {
    configured: Boolean(env[endpointEnv]),
    endpointConfigured: Boolean(env[endpointEnv]),
    credentialConfigured: Boolean(env[apiKeyEnv]),
    endpointEnv,
    credentialEnv: env[apiKeyEnv] ? apiKeyEnv : undefined,
  }
}

function configuredEnvName(env, names) {
  return names.find((name) => Boolean(env[name]))
}

function numberFromEnv(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

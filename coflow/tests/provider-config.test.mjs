import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProviderStatus } from '../lib/provider-config.mjs'

test('getProviderStatus reports Atlas Cloud defaults without exposing credentials', () => {
  const status = getProviderStatus(
    {
      ATLASCLOUD_API_KEY: 'secret-test-key',
      ATLASCLOUD_VIDEO_DURATION: '8',
      ATLASCLOUD_VIDEO_AUDIO: 'false',
    },
    {
      canvasUrl: 'http://127.0.0.1:5176',
      workspaceRoot: '/workspace/project',
    },
  )

  assert.equal(status.ok, true)
  assert.equal(status.canvasUrl, 'http://127.0.0.1:5176')
  assert.equal(status.workspaceRoot, '/workspace/project')
  assert.equal(status.defaultImageProvider, 'Codex')
  assert.equal(status.defaultVideoProvider, 'Atlas Cloud')
  assert.equal(status.providers.codexNative.id, 'codex-native')
  assert.equal(status.providers.codexNative.label, 'Codex')
  assert.equal(status.providers.codexNative.configured, true)
  assert.equal(status.providers.codexNative.models.imageText, 'gpt-image-2')
  assert.equal(status.providers.codexNative.models.imageEdit, 'gpt-image-2')
  assert.equal(status.providers.atlas.id, 'Atlas Cloud')
  assert.equal(status.providers.atlas.label, 'Atlas Cloud')
  assert.equal(status.providers.atlas.configured, true)
  assert.equal(status.providers.atlas.credentialEnv, 'ATLASCLOUD_API_KEY')
  assert.equal(status.providers.atlas.models.imageText, 'openai/gpt-image-2/text-to-image')
  assert.equal(status.providers.atlas.models.imageEdit, 'openai/gpt-image-2/edit')
  assert.equal(status.providers.atlas.models.videoReference, 'bytedance/seedance-2.0/reference-to-video')
  assert.ok(status.providers.atlas.modelCatalog.image.some((model) => model.id === 'google/nano-banana-2/edit'))
  assert.ok(status.providers.atlas.modelCatalog.image.some((model) => model.id === 'google/nano-banana-2-lite/edit'))
  assert.ok(status.providers.atlas.modelCatalog.image.some((model) => model.id === 'bytedance/seedream-v5.0-pro'))
  assert.ok(status.providers.atlas.modelCatalog.image.some((model) => model.id === 'bytedance/seedream-v5.0-pro/edit'))
  assert.ok(status.providers.atlas.modelCatalog.image.some((model) => model.id === 'bytedance/seedream-v4.5/edit'))
  assert.ok(status.providers.atlas.modelCatalog.image.some((model) => model.id === 'alibaba/wan-2.7/text-to-image'))
  assert.ok(status.providers.atlas.modelCatalog.image.some((model) => model.id === 'qwen/qwen-image-2.0/edit'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'kwaivgi/kling-v3.0-turbo/image-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'bytedance/seedance-2.0/text-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'bytedance/seedance-2.0/image-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'bytedance/seedance-2.0/reference-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'bytedance/seedance-2.0-mini/reference-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'alibaba/wan-2.7/reference-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'alibaba/happyhorse-1.1/reference-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'kwaivgi/kling-video-o3-std/reference-to-video'))
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'kwaivgi/kling-video-o3-pro/reference-to-video'))
  assert.equal(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'kwaivgi/kling-video-o3-std/video-edit'), false)
  assert.equal(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'kwaivgi/kling-video-o3-pro/video-edit'), false)
  assert.equal(status.providers.atlas.modelCatalog.image.some((model) => model.id.includes('happyhorse')), false)
  assert.ok(status.providers.atlas.modelCatalog.video.some((model) => model.id === 'xai/grok-imagine-video-v1.5/image-to-video'))
  assert.equal(status.providers.atlas.modelCatalog.image.some((model) => model.id.includes('ultra')), false)
  assert.equal(status.providers.atlas.modelCatalog.video.some((model) => model.id.includes('ultra')), false)
  assert.equal(status.providers.atlas.videoDefaults.duration, 8)
  assert.equal(status.providers.atlas.videoDefaults.generateAudio, false)
  assert.equal(JSON.stringify(status).includes('secret-test-key'), false)
})

test('getProviderStatus reports unconfigured providers with setup env names', () => {
  const status = getProviderStatus({})

  assert.equal(status.providers.atlas.configured, false)
  assert.equal(status.providers.codexNative.configured, true)
  assert.deepEqual(status.providers.atlas.requiredEnv, ['ATLASCLOUD_API_KEY'])
  assert.equal(status.providers.custom.seedance.configured, false)
  assert.equal(status.providers.custom.seedance.endpointEnv, 'SEEDANCE_PROVIDER_ENDPOINT')
  assert.equal(status.providers.custom.kling.credentialEnv, undefined)
  assert.equal(status.onboarding.status, 'not_started')
  assert.equal(status.onboarding.nextAction, 'run_provider_setup')
})

test('getProviderStatus includes provider onboarding defaults without secrets', () => {
  const status = getProviderStatus(
    {
      ATLASCLOUD_API_KEY: 'secret-test-key',
    },
    {
      settingsPath: '/workspace/project/.coflow/metadata/provider-settings.json',
      providerSettings: {
        status: 'configured',
        image: {
          provider: 'atlas',
          modelIntent: 'image_edit',
        },
        video: {
          provider: 'atlas',
          modelIntent: 'reference_to_video',
        },
      },
    },
  )

  assert.equal(status.onboarding.status, 'configured')
  assert.equal(status.onboarding.configured, true)
  assert.equal(status.onboarding.nextAction, 'ready')
  assert.equal(status.onboarding.settingsPath, '/workspace/project/.coflow/metadata/provider-settings.json')
  assert.deepEqual(status.onboarding.imageDefault, {
    provider: 'Atlas Cloud',
    providerLabel: 'Atlas Cloud',
    modelIntent: 'image_edit',
  })
  assert.equal(JSON.stringify(status).includes('secret-test-key'), false)
})

test('provider onboarding configured means defaults are chosen, not credential presence', () => {
  const status = getProviderStatus(
    {},
    {
      providerSettings: {
        status: 'configured',
        image: {
          provider: 'atlas',
          modelIntent: 'image_edit',
        },
        video: {
          provider: 'atlas',
          modelIntent: 'reference_to_video',
        },
      },
    },
  )

  assert.equal(status.onboarding.status, 'configured')
  assert.equal(status.onboarding.configured, true)
  assert.equal(status.onboarding.generationReady, false)
  assert.equal(status.onboarding.nextAction, 'provider_selected_check_runtime_credentials')
})

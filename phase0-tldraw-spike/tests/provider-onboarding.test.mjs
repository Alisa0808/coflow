import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProviderStatus } from '../lib/provider-config.mjs'
import { buildProviderOnboarding } from '../lib/provider-onboarding.mjs'
import { normalizeProviderSettings } from '../lib/provider-settings.mjs'

test('provider onboarding prompts first-run users with default setup actions', () => {
  const settings = normalizeProviderSettings({})
  const status = getProviderStatus({}, { providerSettings: settings, settingsPath: '/workspace/.coflow/metadata/provider-settings.json' })
  const onboarding = buildProviderOnboarding({
    providerSettings: settings,
    providerStatus: status,
    settingsPath: '/workspace/.coflow/metadata/provider-settings.json',
  })

  assert.equal(onboarding.status, 'not_started')
  assert.equal(onboarding.shouldPrompt, true)
  assert.equal(onboarding.configured, false)
  assert.equal(onboarding.imageDefault.provider, 'codex-native')
  assert.equal(onboarding.imageDefault.providerLabel, 'Codex built-in GPT Image 2')
  assert.equal(onboarding.imageDefault.textModel, 'gpt-image-2')
  assert.equal(onboarding.imageDefault.editModel, 'gpt-image-2')
  assert.equal(onboarding.videoDefault.provider, 'Atlas Cloud')
  assert.equal(onboarding.videoDefault.providerLabel, 'Atlas Cloud')
  assert.equal(onboarding.connectionStatus.codexBuiltInImageModel, 'ready')
  assert.equal(onboarding.connectionStatus.atlasCloud, 'needs_api_key')
  assert.match(onboarding.userMessage, /CoFlow is ready to use with these defaults/)
  assert.match(onboarding.userMessage, /Image generation and image editing: Codex built-in GPT Image 2/)
  assert.match(onboarding.userMessage, /Video generation and video editing: Atlas Cloud Seedance 2\.0/)
  assert.ok(onboarding.actions.some((action) => action.id === 'keep_defaults_setup_atlas_cloud'))
  assert.ok(onboarding.actions.some((action) => action.id === 'customize_providers_and_models'))
  assert.ok(onboarding.actions.some((action) => action.id === 'skip_for_now'))
  assert.equal(JSON.stringify(onboarding).includes('ATLASCLOUD_API_KEY'), false)
})

test('provider onboarding exposes rerun path after setup is skipped', () => {
  const settings = normalizeProviderSettings({ status: 'skipped' })
  const status = getProviderStatus({}, { providerSettings: settings })
  const onboarding = buildProviderOnboarding({ providerSettings: settings, providerStatus: status })

  assert.equal(onboarding.status, 'skipped')
  assert.equal(onboarding.shouldPrompt, false)
  assert.equal(onboarding.shouldNudge, true)
  assert.equal(onboarding.userMessage, 'You can use Codex built-in GPT Image 2 for image tasks. Video generation and Atlas Cloud models will require setup later.')
  assert.ok(onboarding.actions.some((action) => action.id === 'rerun_provider_setup'))
  assert.ok(onboarding.actions.some((action) => action.id === 'keep_defaults_setup_atlas_cloud'))
})

test('provider onboarding saves defaults but does not report ready when Atlas Cloud key is missing', () => {
  const settings = normalizeProviderSettings({
    status: 'configured',
    image: { provider: 'atlas', modelIntent: 'image_edit' },
    video: { provider: 'atlas', modelIntent: 'reference_to_video' },
  })
  const status = getProviderStatus({}, { providerSettings: settings })
  const onboarding = buildProviderOnboarding({ providerSettings: settings, providerStatus: status })

  assert.equal(onboarding.status, 'configured')
  assert.equal(onboarding.shouldPrompt, false)
  assert.equal(onboarding.configured, true)
  assert.equal(onboarding.runtimeCredentialCheckRequired, true)
  assert.equal(onboarding.generationReady, false)
  assert.equal(onboarding.connectionStatus.atlasCloud, 'needs_api_key')
  assert.match(onboarding.userMessage, /CoFlow defaults are saved, but Atlas Cloud is not connected yet/)
  assert.match(onboarding.userMessage, /Atlas Cloud: Needs API key/)
  assert.match(onboarding.userMessage, /https:\/\/www\.atlascloud\.ai\/console\/api-keys\?utm_source=coflow&ref=F27PTG/)
  assert.match(onboarding.userMessage, /CoFlow does not currently have an API-key input inside the canvas UI/)
  assert.match(onboarding.userMessage, /ATLASCLOUD_API_KEY/)
  assert.match(onboarding.userMessage, /restart CoFlow/)
  assert.doesNotMatch(onboarding.userMessage, /CoFlow setup flow/)
  assert.doesNotMatch(onboarding.userMessage, /CoFlow page/)
  assert.ok(onboarding.actions.some((action) => action.id === 'customize_providers_and_models'))
  assert.ok(onboarding.actions.some((action) => action.id === 'rerun_provider_setup'))
})

test('provider onboarding reports connected defaults when Atlas Cloud key is configured', () => {
  const settings = normalizeProviderSettings({
    status: 'configured',
    image: { provider: 'codex-native', modelIntent: 'image_edit' },
    video: { provider: 'atlas', modelIntent: 'reference_to_video' },
  })
  const status = getProviderStatus(
    { ATLASCLOUD_API_KEY: 'secret-test-key' },
    { providerSettings: settings }
  )
  const onboarding = buildProviderOnboarding({ providerSettings: settings, providerStatus: status })

  assert.equal(onboarding.status, 'configured')
  assert.equal(onboarding.connectionStatus.codexBuiltInImageModel, 'ready')
  assert.equal(onboarding.connectionStatus.atlasCloud, 'connected')
  assert.equal(onboarding.generationReady, true)
  assert.equal(
    onboarding.userMessage,
    'Atlas Cloud is connected. CoFlow can now generate images with Codex built-in GPT Image 2 and videos with Atlas Cloud Seedance 2.0.'
  )
  assert.equal(JSON.stringify(onboarding).includes('secret-test-key'), false)
})

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
  assert.equal(onboarding.imageDefault.providerLabel, 'Codex')
  assert.equal(onboarding.imageDefault.textModel, 'gpt-image-2')
  assert.equal(onboarding.imageDefault.editModel, 'gpt-image-2')
  assert.equal(onboarding.videoDefault.provider, 'Atlas Cloud')
  assert.equal(onboarding.videoDefault.providerLabel, 'Atlas Cloud')
  assert.ok(onboarding.actions.some((action) => action.id === 'use_default_provider_models'))
  assert.ok(onboarding.actions.some((action) => action.id === 'customize_provider_models'))
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
  assert.ok(onboarding.actions.some((action) => action.id === 'rerun_provider_setup'))
  assert.ok(onboarding.actions.some((action) => action.id === 'use_default_provider_models'))
})

test('provider onboarding treats configured defaults as complete even when runtime credentials need diagnostics', () => {
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
  assert.ok(onboarding.actions.some((action) => action.id === 'customize_provider_models'))
  assert.ok(onboarding.actions.some((action) => action.id === 'rerun_provider_setup'))
})

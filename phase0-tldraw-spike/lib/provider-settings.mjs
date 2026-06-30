export const PROVIDER_SETTINGS_VERSION = 1

export function getDefaultProviderSettings(env = process.env) {
  return {
    version: PROVIDER_SETTINGS_VERSION,
    image: {
      provider: 'codex-native',
      modelIntent: 'image_edit',
      textModel: env.CODEX_IMAGE_TEXT_MODEL || 'gpt-image-2',
      editModel: env.CODEX_IMAGE_EDIT_MODEL || 'gpt-image-2',
    },
    video: {
      provider: 'Atlas Cloud',
      modelIntent: 'reference_to_video',
      textModel: env.ATLASCLOUD_VIDEO_TEXT_MODEL || 'bytedance/seedance-2.0/text-to-video',
      referenceModel: env.ATLASCLOUD_VIDEO_IMAGE_MODEL || 'bytedance/seedance-2.0/reference-to-video',
    },
  }
}

export async function readProviderSettings(readJsonFile, settingsPath, env = process.env) {
  const stored = await readJsonFile(settingsPath, null)
  return normalizeProviderSettings(stored, env)
}

export function normalizeProviderSettings(input, env = process.env) {
  const defaults = getDefaultProviderSettings(env)
  const now = new Date().toISOString()
  const status = normalizeStatus(input?.status)

  return {
    version: PROVIDER_SETTINGS_VERSION,
    status,
    updatedAt: typeof input?.updatedAt === 'string' && input.updatedAt ? input.updatedAt : now,
    skippedAt: typeof input?.skippedAt === 'string' && input.skippedAt ? input.skippedAt : undefined,
    image: {
      ...defaults.image,
      ...normalizeMediaSettings(input?.image),
    },
    video: {
      ...defaults.video,
      ...normalizeMediaSettings(input?.video),
    },
  }
}

export async function writeProviderSettings({ input = {}, readJsonFile, writeJson, settingsPath, env = process.env }) {
  const previous = await readProviderSettings(readJsonFile, settingsPath, env)
  const now = new Date().toISOString()
  const nextStatus = normalizeStatus(input.status ?? previous.status)
  const merged = normalizeProviderSettings(
    {
      ...previous,
      ...pickSettingsRoot(input),
      status: nextStatus,
      updatedAt: now,
      skippedAt: nextStatus === 'skipped' ? now : undefined,
      image: {
        ...previous.image,
        ...normalizeMediaSettings(input.image),
      },
      video: {
        ...previous.video,
        ...normalizeMediaSettings(input.video),
      },
    },
    env,
  )
  await writeJson(settingsPath, merged)
  return merged
}

export function buildOnboardingStatus({ providerSettings, providerStatus, settingsPath }) {
  const status = normalizeStatus(providerSettings?.status)
  const atlasConfigured = Boolean(providerStatus?.providers?.atlas?.configured)
  const configured = status === 'configured'
  const skipped = status === 'skipped'
  const selectedProviders = new Set([providerSettings?.image?.provider, providerSettings?.video?.provider].filter(Boolean))
  const selectedProviderNeedsCredential = [...selectedProviders].some(providerNeedsRuntimeCredential)
  const runtimeCredentialCheckRequired = configured && selectedProviderNeedsCredential && !atlasConfigured

  return {
    status,
    configured,
    skipped,
    needsRestart: runtimeCredentialCheckRequired,
    runtimeCredentialCheckRequired,
    generationReady: !runtimeCredentialCheckRequired,
    settingsPath,
    imageDefault: {
      provider: providerSettings?.image?.provider || 'codex-native',
      providerLabel: providerLabel(providerSettings?.image?.provider || 'codex-native'),
      modelIntent: providerSettings?.image?.modelIntent || 'image_edit',
    },
    videoDefault: {
      provider: canonicalProviderId(providerSettings?.video?.provider || 'Atlas Cloud'),
      providerLabel: providerLabel(providerSettings?.video?.provider || 'Atlas Cloud'),
      modelIntent: providerSettings?.video?.modelIntent || 'reference_to_video',
    },
    nextAction: getNextAction({ status, runtimeCredentialCheckRequired }),
  }
}

function providerLabel(provider) {
  const canonical = canonicalProviderId(provider)
  if (canonical === 'codex-native') return 'Codex'
  if (canonical === 'Atlas Cloud') return 'Atlas Cloud'
  return provider
}

export function getDefaultProviderForMedia(providerSettings, outputMediaType) {
  if (outputMediaType === 'video') return canonicalProviderId(providerSettings?.video?.provider || 'Atlas Cloud')
  return canonicalProviderId(providerSettings?.image?.provider || 'codex-native')
}

function providerNeedsRuntimeCredential(provider) {
  return canonicalProviderId(provider) === 'Atlas Cloud'
}

function getNextAction({ status, runtimeCredentialCheckRequired }) {
  if (status === 'configured' && !runtimeCredentialCheckRequired) return 'ready'
  if (status === 'configured' && runtimeCredentialCheckRequired) return 'provider_selected_check_runtime_credentials'
  if (status === 'skipped') return 'rerun_provider_setup_when_ready'
  return 'run_provider_setup'
}

function normalizeStatus(value) {
  if (value === 'configured' || value === 'skipped' || value === 'not_started') return value
  return 'not_started'
}

function normalizeMediaSettings(value) {
  if (!value || typeof value !== 'object') return {}
  const next = {}
  for (const key of ['provider', 'modelIntent', 'textModel', 'editModel', 'referenceModel']) {
    if (typeof value[key] === 'string' && value[key]) next[key] = key === 'provider' ? canonicalProviderId(value[key]) : value[key]
  }
  return next
}

function canonicalProviderId(provider) {
  if (provider === 'atlas' || provider === 'AtlasCloud' || provider === 'atlas-cloud') return 'Atlas Cloud'
  return provider
}

function pickSettingsRoot(input) {
  const next = {}
  if (typeof input.updatedAt === 'string' && input.updatedAt) next.updatedAt = input.updatedAt
  return next
}

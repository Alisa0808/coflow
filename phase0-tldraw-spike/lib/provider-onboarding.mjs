export function buildProviderOnboarding({ providerSettings, providerStatus, settingsPath }) {
  const status = providerStatus?.onboarding?.status || providerSettings?.status || 'not_started'
  const imageDefault = summarizeImageDefault(providerSettings, providerStatus)
  const videoDefault = summarizeVideoDefault(providerSettings, providerStatus)
  const runtimeCredentialCheckRequired = Boolean(providerStatus?.onboarding?.runtimeCredentialCheckRequired)
  const providerSkillName = PROVIDER_SETUP_SKILL_NAME

  return {
    ok: true,
    version: 1,
    status,
    shouldPrompt: status === 'not_started',
    shouldNudge: status === 'skipped',
    configured: status === 'configured',
    skipped: status === 'skipped',
    generationReady: !runtimeCredentialCheckRequired,
    runtimeCredentialCheckRequired,
    settingsPath,
    imageDefault,
    videoDefault,
    userMessage: buildUserMessage({ status, imageDefault, videoDefault }),
    actions: buildActions({ status, imageDefault, videoDefault, providerSkillName }),
    providerSkillName,
  }
}

const PROVIDER_SETUP_SKILL_NAME = 'coflow-provider-setup'

function summarizeImageDefault(providerSettings, providerStatus) {
  const provider = providerSettings?.image?.provider || providerStatus?.onboarding?.imageDefault?.provider || 'codex-native'
  const modelIntent = providerSettings?.image?.modelIntent || providerStatus?.onboarding?.imageDefault?.modelIntent || 'image_edit'
  const codexModels = providerStatus?.providers?.codexNative?.models || {}
  const atlasModels = providerStatus?.providers?.atlas?.models || {}
  return {
    provider,
    providerLabel: providerLabel(provider),
    modelIntent,
    textModel: providerSettings?.image?.textModel || codexModels.imageText || atlasModels.imageText || 'gpt-image-2',
    editModel: providerSettings?.image?.editModel || codexModels.imageEdit || atlasModels.imageEdit || 'gpt-image-2',
  }
}

function summarizeVideoDefault(providerSettings, providerStatus) {
  const provider = canonicalProviderId(providerSettings?.video?.provider || providerStatus?.onboarding?.videoDefault?.provider || 'Atlas Cloud')
  const modelIntent = providerSettings?.video?.modelIntent || providerStatus?.onboarding?.videoDefault?.modelIntent || 'reference_to_video'
  const atlasModels = providerStatus?.providers?.atlas?.models || {}
  return {
    provider,
    providerLabel: providerLabel(provider),
    modelIntent,
    textModel: providerSettings?.video?.textModel || atlasModels.videoText || 'bytedance/seedance-2.0/text-to-video',
    referenceModel: providerSettings?.video?.referenceModel || atlasModels.videoReference || 'bytedance/seedance-2.0/reference-to-video',
  }
}

function buildActions({ status, imageDefault, videoDefault, providerSkillName }) {
  const configureDefaults = {
    id: 'use_default_provider_models',
    label: 'Use default provider/model settings',
    description: 'Save the current image and video provider/model defaults without storing credentials.',
    toolName: 'canvas.set_provider_settings',
    arguments: {
      status: 'configured',
      image: imageDefault,
      video: videoDefault,
    },
  }
  const customize = {
    id: 'customize_provider_models',
    label: 'Customize provider/model settings',
    description: `Use the ${providerSkillName} skill to choose different image or video defaults.`,
    skillName: providerSkillName,
  }
  const skipForNow = {
    id: 'skip_for_now',
    label: 'Skip for now',
    description: 'Keep the canvas usable and ask again only when the user reruns provider setup.',
    toolName: 'canvas.set_provider_settings',
    arguments: {
      status: 'skipped',
    },
  }
  const rerunSetup = {
    id: 'rerun_provider_setup',
    label: 'Rerun provider setup',
    description: `Use the ${providerSkillName} skill to review or change provider/model defaults.`,
    skillName: providerSkillName,
  }

  if (status === 'configured') return [customize, rerunSetup]
  if (status === 'skipped') return [rerunSetup, configureDefaults]
  return [configureDefaults, customize, skipForNow]
}

function buildUserMessage({ status, imageDefault, videoDefault }) {
  if (status === 'configured') {
    return `Provider/model defaults are configured. Image: ${providerDisplayName(imageDefault)} / ${imageDefault.modelIntent}. Video: ${providerDisplayName(videoDefault)} / ${videoDefault.modelIntent}.`
  }
  if (status === 'skipped') {
    return `Provider/model setup was skipped. You can rerun ${PROVIDER_SETUP_SKILL_NAME} when you want to change defaults.`
  }
  return `Welcome to CoFlow. Choose provider/model defaults now, or skip setup and keep using the canvas. Current defaults are Image: ${providerDisplayName(imageDefault)} / ${imageDefault.modelIntent}; Video: ${providerDisplayName(videoDefault)} / ${videoDefault.modelIntent}.`
}

function providerLabel(provider) {
  const canonical = canonicalProviderId(provider)
  if (canonical === 'codex-native') return 'Codex'
  if (canonical === 'Atlas Cloud') return 'Atlas Cloud'
  return provider
}

function providerDisplayName(defaults) {
  return defaults?.providerLabel || providerLabel(defaults?.provider)
}

function canonicalProviderId(provider) {
  if (provider === 'atlas' || provider === 'AtlasCloud' || provider === 'atlas-cloud') return 'Atlas Cloud'
  return provider
}

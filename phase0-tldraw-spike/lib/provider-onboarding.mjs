export function buildProviderOnboarding({ providerSettings, providerStatus, settingsPath }) {
  const status = providerStatus?.onboarding?.status || providerSettings?.status || 'not_started'
  const imageDefault = summarizeImageDefault(providerSettings, providerStatus)
  const videoDefault = summarizeVideoDefault(providerSettings, providerStatus)
  const runtimeCredentialCheckRequired = Boolean(providerStatus?.onboarding?.runtimeCredentialCheckRequired)
  const atlasConnected = Boolean(providerStatus?.providers?.atlas?.configured)
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
    connectionStatus: {
      codexBuiltInImageModel: 'ready',
      atlasCloud: atlasConnected ? 'connected' : 'needs_api_key',
    },
    settingsPath,
    imageDefault,
    videoDefault,
    userMessage: buildUserMessage({ status, atlasConnected }),
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
  const keepDefaultsAndSetupAtlas = {
    id: 'keep_defaults_setup_atlas_cloud',
    label: 'Keep defaults and set up Atlas Cloud',
    description: 'Use Codex built-in GPT Image 2 for images and Atlas Cloud Seedance 2.0 for videos, then check whether the Atlas Cloud API key is connected.',
    toolName: 'canvas.set_provider_settings',
    nextStep: 'check_atlas_cloud_key',
    requiresProviderCredentialCheck: true,
    arguments: {
      status: 'configured',
      image: imageDefault,
      video: videoDefault,
    },
  }
  const customize = {
    id: 'customize_providers_and_models',
    label: 'Customize providers and models',
    description: `Use the ${providerSkillName} skill to choose CoFlow's configured image/video models or add a custom provider profile.`,
    skillName: providerSkillName,
  }
  const skipForNow = {
    id: 'skip_for_now',
    label: 'Skip for now',
    description: 'Keep the canvas usable. Provider setup can run later when generation needs it.',
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
  if (status === 'skipped') return [rerunSetup, keepDefaultsAndSetupAtlas]
  return [keepDefaultsAndSetupAtlas, customize, skipForNow]
}

function buildUserMessage({ status, atlasConnected }) {
  if (status === 'configured') {
    if (atlasConnected) {
      return 'Atlas Cloud is connected. CoFlow can now generate images with Codex built-in GPT Image 2 and videos with Atlas Cloud Seedance 2.0.'
    }
    return [
      'CoFlow defaults are saved, but Atlas Cloud is not connected yet.',
      '',
      'Current defaults:',
      '- Image generation: Codex built-in GPT Image 2',
      '- Image editing: Codex built-in GPT Image 2',
      '- Text-to-video: Atlas Cloud Seedance 2.0',
      '- Reference/video editing: Atlas Cloud Seedance 2.0',
      '',
      'Connection status:',
      '- Codex built-in image model: Ready',
      '- Atlas Cloud: Needs API key',
      '',
      'Create an Atlas Cloud API key here:',
      'https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG',
      '',
      'CoFlow does not currently have an API-key input inside the canvas UI.',
      'To connect Atlas Cloud, ask Codex to save the key to the local CoFlow environment, or manually add `ATLASCLOUD_API_KEY` to your local CoFlow `.env.local` file and restart CoFlow.',
    ].join('\n')
  }
  if (status === 'skipped') {
    return 'You can use Codex built-in GPT Image 2 for image tasks. Video generation and Atlas Cloud models will require setup later.'
  }
  return [
    'CoFlow is ready to use with these defaults:',
    '',
    '- Image generation and image editing: Codex built-in GPT Image 2',
    '- Video generation and video editing: Atlas Cloud Seedance 2.0',
    '',
    'To use the default video workflow, connect your Atlas Cloud API key.',
  ].join('\n')
}

function providerLabel(provider) {
  const canonical = canonicalProviderId(provider)
  if (canonical === 'codex-native') return 'Codex built-in GPT Image 2'
  if (canonical === 'Atlas Cloud') return 'Atlas Cloud'
  return provider
}

function canonicalProviderId(provider) {
  if (provider === 'atlas' || provider === 'AtlasCloud' || provider === 'atlas-cloud') return 'Atlas Cloud'
  return provider
}

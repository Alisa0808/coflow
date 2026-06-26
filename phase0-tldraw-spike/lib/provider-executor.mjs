import { runAtlasProvider } from './providers/atlas.mjs'

export async function prepareProviderExecution(request, env = process.env) {
  const providerJob = buildProviderJob(request)
  const providerPayloads = buildProviderPayloads(providerJob)
  const providerKey = normalizeProviderKey(request.provider)
  const selectedProviderPayload = providerPayloads[providerKey] ?? providerPayloads.atlas
  const externalExecution = await runExternalProviderIfConfigured(selectedProviderPayload, request.provider, env)

  return {
    providerJob,
    providerPayloads,
    selectedProvider: request.provider || 'mock-provider',
    selectedProviderPayload,
    externalExecution,
  }
}

export function buildProviderJob(request) {
  return {
    provider: request.provider || 'mock-provider',
    requestId: request.id,
    mode: request.generationMode || request.kind || 'generation',
    outputMediaType: request.output?.mediaType === 'video' ? 'video' : 'image',
    prompt: request.instructions?.prompt || '',
    inputs: Array.isArray(request.references)
      ? request.references.map((reference) => ({
          mediaType: reference.mediaType || 'image',
          role: reference.role || 'reference',
          localPath: reference.localPath,
          absolutePath: reference.absolutePath,
        }))
      : [],
    outputLocalPath: request.output?.localPath,
    outputAbsolutePath: request.output?.absolutePath,
  }
}

export function buildProviderPayloads(job) {
  return {
    atlas: {
      task: 'media_generation',
      mode: job.mode,
      prompt: job.prompt,
      output: {
        type: job.outputMediaType,
        localPath: job.outputLocalPath,
      },
      references: job.inputs.map(toProviderReference),
    },
    seedance: {
      model: 'seedance-reference-video',
      mode: job.mode === 'text_to_video' ? 'text_to_video' : 'reference_to_video',
      prompt: job.prompt,
      references: job.inputs.map(toProviderReference),
      output: {
        mediaType: job.outputMediaType,
        localPath: job.outputLocalPath,
      },
    },
    kling: {
      model: 'kling-reference-video',
      task: job.inputs.length > 0 ? 'edit' : 'generate',
      prompt: job.prompt,
      referenceAssets: job.inputs.map(toProviderReference),
      output: {
        mediaType: job.outputMediaType,
        localPath: job.outputLocalPath,
      },
    },
  }
}

export async function runExternalProviderIfConfigured(payload, provider, env = process.env) {
  if (provider === 'atlas') return await runAtlasProvider(payload, { env })

  const endpoint = endpointForProvider(provider, env)
  if (!endpoint) {
    return {
      status: 'skipped',
      provider: provider || 'mock-provider',
      reason: 'No provider endpoint configured.',
      endpointConfigured: false,
    }
  }

  const headers = { 'content-type': 'application/json' }
  const apiKey = apiKeyForProvider(provider, env)
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    return {
      status: response.ok ? 'succeeded' : 'failed',
      provider,
      endpointConfigured: true,
      endpoint,
      httpStatus: response.status,
      body: parseMaybeJson(text),
    }
  } catch (error) {
    return {
      status: 'failed',
      provider,
      endpointConfigured: true,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function normalizeProviderKey(provider) {
  if (provider === 'atlas') return 'atlas'
  if (provider === 'seedance') return 'seedance'
  if (provider === 'kling') return 'kling'
  return 'atlas'
}

function endpointForProvider(provider, env) {
  if (provider === 'atlas') return env.ATLAS_PROVIDER_ENDPOINT || env.REAL_PROVIDER_ENDPOINT
  if (provider === 'seedance') return env.SEEDANCE_PROVIDER_ENDPOINT || env.REAL_PROVIDER_ENDPOINT
  if (provider === 'kling') return env.KLING_PROVIDER_ENDPOINT || env.REAL_PROVIDER_ENDPOINT
  return ''
}

function apiKeyForProvider(provider, env) {
  if (provider === 'atlas') return env.ATLAS_PROVIDER_API_KEY || env.REAL_PROVIDER_API_KEY
  if (provider === 'seedance') return env.SEEDANCE_PROVIDER_API_KEY || env.REAL_PROVIDER_API_KEY
  if (provider === 'kling') return env.KLING_PROVIDER_API_KEY || env.REAL_PROVIDER_API_KEY
  return ''
}

function toProviderReference(input) {
  return {
    type: input.mediaType,
    role: input.role,
    uri: input.absolutePath || input.localPath,
  }
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

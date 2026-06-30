import type { GenerationReference, ProviderReadyGenerationRequest } from './generationContract'

export type ProviderInput = {
  mediaType: GenerationReference['mediaType']
  role: GenerationReference['role']
  localPath: string
  absolutePath?: string
}

export type ProviderJob = {
  provider: ProviderReadyGenerationRequest['provider']
  requestId: string
  mode: ProviderReadyGenerationRequest['generationMode']
  outputMediaType: ProviderReadyGenerationRequest['output']['mediaType']
  prompt: string
  inputs: ProviderInput[]
  outputLocalPath: string
  outputAbsolutePath?: string
}

export type SeedanceReference = {
  type: ProviderInput['mediaType']
  role: ProviderInput['role']
  uri: string
}

export type SeedanceProviderPayload = {
  model: 'seedance-reference-video'
  mode: 'text_to_video' | 'reference_to_video'
  prompt: string
  references: SeedanceReference[]
  output: {
    mediaType: ProviderJob['outputMediaType']
    localPath: string
  }
}

export type KlingProviderPayload = {
  model: 'kling-reference-video'
  task: 'generate' | 'edit'
  prompt: string
  referenceAssets: SeedanceReference[]
  output: {
    mediaType: ProviderJob['outputMediaType']
    localPath: string
  }
}

export type AtlasProviderPayload = {
  task: 'media_generation'
  mode: ProviderJob['mode']
  prompt: string
  output: {
    type: ProviderJob['outputMediaType']
    localPath: string
  }
  references: SeedanceReference[]
}

export function buildProviderJob(request: ProviderReadyGenerationRequest): ProviderJob {
  return {
    provider: request.provider,
    requestId: request.id,
    mode: request.generationMode,
    outputMediaType: request.output.mediaType,
    prompt: request.instructions.prompt,
    inputs: request.references.map((reference) => ({
      mediaType: reference.mediaType,
      role: reference.role,
      localPath: reference.localPath,
      absolutePath: reference.absolutePath,
    })),
    outputLocalPath: request.output.localPath,
    outputAbsolutePath: request.output.absolutePath,
  }
}

export function buildSeedanceProviderPayload(job: ProviderJob): SeedanceProviderPayload {
  return {
    model: 'seedance-reference-video',
    mode: job.mode === 'text_to_video' ? 'text_to_video' : 'reference_to_video',
    prompt: job.prompt,
    references: job.inputs.map(toProviderReference),
    output: {
      mediaType: job.outputMediaType,
      localPath: job.outputLocalPath,
    },
  }
}

export function buildKlingProviderPayload(job: ProviderJob): KlingProviderPayload {
  return {
    model: 'kling-reference-video',
    task: job.inputs.length > 0 ? 'edit' : 'generate',
    prompt: job.prompt,
    referenceAssets: job.inputs.map(toProviderReference),
    output: {
      mediaType: job.outputMediaType,
      localPath: job.outputLocalPath,
    },
  }
}

export function buildAtlasProviderPayload(job: ProviderJob): AtlasProviderPayload {
  return {
    task: 'media_generation',
    mode: job.mode,
    prompt: job.prompt,
    output: {
      type: job.outputMediaType,
      localPath: job.outputLocalPath,
    },
    references: job.inputs.map(toProviderReference),
  }
}

function toProviderReference(input: ProviderInput): SeedanceReference {
  return {
    type: input.mediaType,
    role: input.role,
    uri: input.absolutePath ?? input.localPath,
  }
}

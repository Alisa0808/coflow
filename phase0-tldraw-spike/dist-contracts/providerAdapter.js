export function buildMockProviderJob(request) {
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

export function buildSeedanceProviderPayload(job) {
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

export function buildKlingProviderPayload(job) {
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

export function buildAtlasProviderPayload(job) {
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

function toProviderReference(input) {
  return {
    type: input.mediaType,
    role: input.role,
    uri: input.absolutePath ?? input.localPath,
  }
}

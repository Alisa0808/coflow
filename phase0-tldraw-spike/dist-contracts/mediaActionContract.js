import { createProviderReadyGenerationRequest } from './generationContract.js'

export function createGenerateMediaAction(args) {
  const preferredProvider = args.provider ?? args.providerPolicy?.preferredProvider ?? 'atlas'
  return {
    type: 'generate-media',
    id: `action:generate-media:${args.createdAt ?? Date.now()}`,
    skillName: 'codex-media-generation',
    source: args.source,
    prompt: args.prompt,
    providerPolicy: {
      preferredProvider,
      fallbackProviders: args.providerPolicy?.fallbackProviders ?? (preferredProvider === 'mock-provider' ? [] : ['mock-provider']),
      allowMockFallback: args.providerPolicy?.allowMockFallback ?? true,
    },
    frameContext: args.frameContext,
    outputMediaType: args.outputMediaType,
    generationMode: args.generationMode,
    canvasWriteback: {
      childShapeId: args.childShapeId,
      arrowShapeId: args.arrowShapeId,
    },
    output: {
      localPath: args.outputLocalPath,
      absolutePath: args.outputAbsolutePath,
    },
  }
}

export function createGenerationRequestFromGenerateMediaAction(action) {
  return createProviderReadyGenerationRequest({
    context: {
      frameId: action.frameContext.frame.id,
      frameName: action.frameContext.frame.name,
      bounds: action.frameContext.frame.bounds,
      anchorMedia: action.frameContext.anchorMedia,
      media: action.frameContext.media,
      annotations: action.frameContext.annotations,
    },
    childShapeId: action.canvasWriteback.childShapeId,
    arrowShapeId: action.canvasWriteback.arrowShapeId,
    outputLocalPath: action.output.localPath,
    outputAbsolutePath: action.output.absolutePath,
    outputMediaType: action.outputMediaType,
    generationMode: action.generationMode,
    provider: action.providerPolicy.preferredProvider,
    promptOverride: action.prompt,
  })
}

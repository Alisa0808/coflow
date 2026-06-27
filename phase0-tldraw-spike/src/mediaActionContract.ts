import type { BoundedFrameContextPromptPart } from './agentPromptParts'
import type { GenerationMode, OutputMediaType, ProviderId, ProviderReadyGenerationRequest } from './generationContract'
import { createProviderReadyGenerationRequest } from './generationContract'

export type ProviderPolicy = {
  preferredProvider: ProviderId
  fallbackProviders: ProviderId[]
  allowMockFallback: boolean
}

export type GenerateMediaAction = {
  type: 'generate-media'
  id: string
  skillName: 'codex-media-generation'
  source: 'codex-agent-bridge' | 'canvas-frame-action'
  prompt?: string
  providerPolicy: ProviderPolicy
  frameContext: BoundedFrameContextPromptPart
  outputMediaType?: OutputMediaType
  generationMode?: GenerationMode
  canvasWriteback: {
    childShapeId: string
    arrowShapeId: string
  }
  output: {
    localPath: string
    absolutePath?: string
  }
}

export function createGenerateMediaAction(args: {
  source: GenerateMediaAction['source']
  prompt?: string
  provider?: ProviderId
  providerPolicy?: Partial<ProviderPolicy>
  frameContext: BoundedFrameContextPromptPart
  outputMediaType?: OutputMediaType
  generationMode?: GenerationMode
  childShapeId: string
  arrowShapeId: string
  outputLocalPath: string
  outputAbsolutePath?: string
  createdAt?: number
}): GenerateMediaAction {
  const preferredProvider = args.provider ?? args.providerPolicy?.preferredProvider ?? 'atlas'
  return {
    type: 'generate-media',
    id: `action:generate-media:${args.createdAt ?? Date.now()}`,
    skillName: 'codex-media-generation',
    source: args.source,
    prompt: args.prompt,
    providerPolicy: {
      preferredProvider,
      fallbackProviders: args.providerPolicy?.fallbackProviders ?? [],
      allowMockFallback: args.providerPolicy?.allowMockFallback ?? preferredProvider === 'mock-provider',
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

export function createGenerationRequestFromGenerateMediaAction(action: GenerateMediaAction): ProviderReadyGenerationRequest {
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

import type { BoundedFrameContextPromptPart } from './agentPromptParts'
import type { GenerationMode, OutputMediaType, ProviderId } from './generationContract'
import {
  createGenerateMediaAction,
  createGenerationRequestFromGenerateMediaAction,
  type GenerateMediaAction,
  type ProviderPolicy,
} from './mediaActionContract'

export type GenerateMediaActionInput = {
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
}

export class GenerateMediaActionUtil {
  static create(input: GenerateMediaActionInput): GenerateMediaAction {
    return createGenerateMediaAction(input)
  }

  static toGenerationRequest(action: GenerateMediaAction) {
    return createGenerationRequestFromGenerateMediaAction(action)
  }
}


import { createGenerateMediaAction, createGenerationRequestFromGenerateMediaAction } from './mediaActionContract.js'

export class GenerateMediaActionUtil {
  static create(input) {
    return createGenerateMediaAction(input)
  }

  static toGenerationRequest(action) {
    return createGenerationRequestFromGenerateMediaAction(action)
  }
}


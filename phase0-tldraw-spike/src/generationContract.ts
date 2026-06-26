import type { AnnotationContext, Bounds, FrameContext, MediaContext } from './canvasContracts'

export type OutputMediaType = 'image' | 'video'
export type GenerationKind = 'image_edit' | 'video_edit' | 'image_generate' | 'video_generate'
export type GenerationMode = 'text_to_image' | 'image_edit' | 'text_to_video' | 'reference_to_video'
export type ProviderId = 'mock-provider' | 'atlas' | 'seedance' | 'kling'
export type ReferenceMediaType = 'image' | 'video' | 'audio' | 'model3d' | 'text'
export type ReferenceRole =
  | 'source'
  | 'reference'
  | 'style'
  | 'motion'
  | 'audio'
  | 'geometry'
  | 'mask'
  | 'start_frame'
  | 'end_frame'

export type GenerationReference = {
  shapeId: string
  assetId: string
  mediaType: ReferenceMediaType
  role: ReferenceRole
  localPath: string
  absolutePath?: string
  bounds: Bounds
}

export type ProviderReadyGenerationRequest = {
  id: string
  createdAt: string
  kind: GenerationKind
  generationMode: GenerationMode
  provider: ProviderId
  modelIntent: 'edit_existing_media' | 'generate_from_annotations'
  frame: {
    id: string
    name: string
    bounds: Bounds
  }
  input?: {
    shapeId: string
    shapeType: MediaContext['shapeType']
    assetId: string
    localPath: string
    absolutePath?: string
  }
  references: GenerationReference[]
  instructions: {
    prompt: string
    annotations: AnnotationContext[]
  }
  output: {
    mediaType: OutputMediaType
    localPath: string
    absolutePath?: string
    canvasShapeId: string
  }
  canvasWriteback: {
    parentShapeId?: string
    childShapeId: string
    arrowShapeId: string
  }
}

export function createProviderReadyGenerationRequest(args: {
  context: FrameContext
  childShapeId: string
  arrowShapeId: string
  outputLocalPath: string
  outputAbsolutePath?: string
  outputMediaType?: OutputMediaType
  generationMode?: GenerationMode
  provider?: ProviderId
  promptOverride?: string
  createdAt?: string
}): ProviderReadyGenerationRequest {
  const { context, childShapeId, arrowShapeId, outputLocalPath, outputAbsolutePath } = args
  const anchor = context.anchorMedia
  const outputMediaType = args.outputMediaType ?? inferOutputMediaType(anchor)
  const generationMode = args.generationMode ?? inferGenerationMode(context, outputMediaType)
  const kind = inferGenerationKind(outputMediaType, anchor)
  const prompt = buildPrompt(context, args.promptOverride)
  const references = context.media.map(toGenerationReference)

  return {
    id: `generation:${Date.now()}`,
    createdAt: args.createdAt ?? new Date().toISOString(),
    kind,
    generationMode,
    provider: args.provider ?? 'atlas',
    modelIntent: anchor ? 'edit_existing_media' : 'generate_from_annotations',
    frame: {
      id: context.frameId,
      name: context.frameName,
      bounds: context.bounds,
    },
    input: anchor
      ? {
          shapeId: anchor.shapeId,
          shapeType: anchor.shapeType,
          assetId: anchor.assetId,
          localPath: anchor.localPath,
          absolutePath: anchor.absolutePath,
        }
      : undefined,
    references,
    instructions: {
      prompt,
      annotations: context.annotations,
    },
    output: {
      mediaType: outputMediaType,
      localPath: outputLocalPath,
      absolutePath: outputAbsolutePath,
      canvasShapeId: childShapeId,
    },
    canvasWriteback: {
      parentShapeId: anchor?.shapeId,
      childShapeId,
      arrowShapeId,
    },
  }
}

function inferOutputMediaType(anchor?: MediaContext): OutputMediaType {
  return anchor?.shapeType === 'video' ? 'video' : 'image'
}

function inferGenerationKind(outputMediaType: OutputMediaType, anchor?: MediaContext): GenerationKind {
  if (outputMediaType === 'video') return anchor ? 'video_edit' : 'video_generate'
  return anchor ? 'image_edit' : 'image_generate'
}

function inferGenerationMode(context: FrameContext, outputMediaType: OutputMediaType): GenerationMode {
  const anchor = context.anchorMedia

  if (outputMediaType === 'video') {
    if (!anchor && context.media.length === 0) return 'text_to_video'
    return 'reference_to_video'
  }

  if (!anchor) return 'text_to_image'
  return 'image_edit'
}

function toGenerationReference(media: MediaContext): GenerationReference {
  return {
    shapeId: media.shapeId,
    assetId: media.assetId,
    mediaType: media.shapeType === 'video' ? 'video' : 'image',
    role: 'source',
    localPath: media.localPath,
    absolutePath: media.absolutePath,
    bounds: media.bounds,
  }
}

function buildPrompt(context: FrameContext, promptOverride?: string) {
  const annotationTexts = context.annotations
    .map((annotation) => annotation.text)
    .filter((text): text is string => Boolean(text))

  if (promptOverride && annotationTexts.length > 0) return `${promptOverride}\n\nCanvas annotations:\n${annotationTexts.join('\n')}`
  if (promptOverride) return promptOverride
  if (annotationTexts.length > 0) return annotationTexts.join('\n')
  return `Create a new version from frame "${context.frameName}".`
}

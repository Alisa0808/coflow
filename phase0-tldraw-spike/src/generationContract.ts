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
  const prompt = buildPrompt(context, args.promptOverride, outputMediaType)
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

function buildPrompt(context: FrameContext, promptOverride?: string, outputMediaType: OutputMediaType = 'image') {
  const annotationTexts = context.annotations.map((annotation) => annotationToPromptLine(annotation, context.bounds)).filter(Boolean)
  const sourceEditInstructions = context.anchorMedia
    ? outputMediaType === 'video'
      ? [
          'Use the source media in the selected canvas frame as the primary visual reference.',
          'Preserve the source identity, composition, style, logos, typography, colors, and existing text unless a canvas annotation explicitly asks to change them.',
          'Interpret arrows, boxes, drawn marks, and notes as edit instructions only; do not render those canvas annotations into the output video.',
        ].join(' ')
      : [
          'Edit the provided source image; do not redesign it from scratch.',
          'Preserve the exact original layout, aspect ratio, composition, background, logos, typography style, colors, embedded images, and all existing text unless a canvas annotation explicitly asks to change a specific part.',
          'For poster, UI, slide, or text-replacement tasks, replace only the text or region indicated by the canvas annotations and keep every other title, subtitle, logo, footer, and layout element unchanged.',
          'Interpret arrows, boxes, drawn marks, and notes as edit instructions only; do not render those canvas annotations, red boxes, arrows, selection outlines, or UI chrome into the output image.',
        ].join(' ')
    : ''

  const sections = [sourceEditInstructions, promptOverride, annotationTexts.length > 0 ? `Canvas annotations:\n${annotationTexts.join('\n')}` : ''].filter(
    Boolean,
  )
  if (sections.length > 0) return sections.join('\n\n')
  return `Create a new version from frame "${context.frameName}".`
}

function annotationToPromptLine(annotation: AnnotationContext, frameBounds: Bounds) {
  const text = annotation.text?.trim()
  if (text) return text

  const bounds = annotation.bounds
  const region = describeRelativeRegion(bounds, frameBounds)
  if (annotation.type === 'geo') return `A drawn geometric annotation marks the ${region} target region.`
  if (annotation.type === 'arrow') return `An arrow annotation points toward the ${region} target region.`
  if (annotation.type === 'draw') return `A freehand drawing annotation marks the ${region} target region.`
  return `${annotation.type} annotation at the ${region} target region.`
}

function describeRelativeRegion(bounds: Bounds, frameBounds: Bounds) {
  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2
  const relX = frameBounds.w > 0 ? (centerX - frameBounds.x) / frameBounds.w : 0.5
  const relY = frameBounds.h > 0 ? (centerY - frameBounds.y) / frameBounds.h : 0.5
  const horizontal = relX < 0.33 ? 'left' : relX > 0.66 ? 'right' : 'center'
  const vertical = relY < 0.33 ? 'upper' : relY > 0.66 ? 'lower' : 'middle'
  if (horizontal === 'center' && vertical === 'middle') return 'center'
  return `${vertical} ${horizontal}`
}

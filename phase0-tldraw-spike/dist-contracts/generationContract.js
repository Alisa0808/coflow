export function createProviderReadyGenerationRequest(args) {
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

function inferOutputMediaType(anchor) {
  return anchor?.shapeType === 'video' ? 'video' : 'image'
}

function inferGenerationKind(outputMediaType, anchor) {
  if (outputMediaType === 'video') return anchor ? 'video_edit' : 'video_generate'
  return anchor ? 'image_edit' : 'image_generate'
}

function inferGenerationMode(context, outputMediaType) {
  const anchor = context.anchorMedia

  if (outputMediaType === 'video') {
    if (!anchor && context.media.length === 0) return 'text_to_video'
    return 'reference_to_video'
  }

  if (!anchor) return 'text_to_image'
  return 'image_edit'
}

function toGenerationReference(media) {
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

function buildPrompt(context, promptOverride, outputMediaType = 'image') {
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

function annotationToPromptLine(annotation, frameBounds) {
  const text = annotation.text?.trim()
  if (text) return text

  const bounds = annotation.bounds
  const region = describeRelativeRegion(bounds, frameBounds)
  if (annotation.type === 'geo') return `A drawn geometric annotation marks the ${region} target region.`
  if (annotation.type === 'arrow') return `An arrow annotation points toward the ${region} target region.`
  if (annotation.type === 'draw') return `A freehand drawing annotation marks the ${region} target region.`
  return `${annotation.type} annotation at the ${region} target region.`
}

function describeRelativeRegion(bounds, frameBounds) {
  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2
  const relX = frameBounds.w > 0 ? (centerX - frameBounds.x) / frameBounds.w : 0.5
  const relY = frameBounds.h > 0 ? (centerY - frameBounds.y) / frameBounds.h : 0.5
  const horizontal = relX < 0.33 ? 'left' : relX > 0.66 ? 'right' : 'center'
  const vertical = relY < 0.33 ? 'upper' : relY > 0.66 ? 'lower' : 'middle'
  if (horizontal === 'center' && vertical === 'middle') return 'center'
  return `${vertical} ${horizontal}`
}

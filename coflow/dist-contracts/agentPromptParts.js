export function buildBoundedFrameContextPromptPart(context, source = 'codex-skill') {
  return {
    type: 'bounded_frame_context',
    source,
    frame: {
      id: context.frameId,
      name: context.frameName,
      bounds: context.bounds,
    },
    anchorMedia: context.anchorMedia,
    media: context.media,
    annotations: context.annotations,
    summary: {
      mediaCount: context.media.length,
      annotationCount: context.annotations.length,
      hasAnchorMedia: Boolean(context.anchorMedia),
    },
  }
}

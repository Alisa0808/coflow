import type { FrameContext } from './canvasContracts'

export type AgentPromptPartSource = 'codex-agent-bridge' | 'canvas-frame-action' | 'manual-read'

export type BoundedFrameContextPromptPart = {
  type: 'bounded_frame_context'
  source: AgentPromptPartSource
  frame: FrameContext['frameId'] extends string
    ? {
        id: string
        name: string
        bounds: FrameContext['bounds']
      }
    : never
  anchorMedia?: FrameContext['anchorMedia']
  media: FrameContext['media']
  annotations: FrameContext['annotations']
  summary: {
    mediaCount: number
    annotationCount: number
    hasAnchorMedia: boolean
  }
}

export function buildBoundedFrameContextPromptPart(
  context: FrameContext,
  source: AgentPromptPartSource = 'codex-agent-bridge',
): BoundedFrameContextPromptPart {
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


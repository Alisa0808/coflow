import type { CanvasSelectionSnapshot, FrameContext } from './canvasContracts'

export type CanvasCommand = {
  id: string
  type: 'canvas.create_version' | 'canvas.insert_media' | 'canvas.link_versions'
  requestedTool?: 'canvas.create_version' | 'canvas.insert_media' | 'canvas.link_versions'
  frameId?: string
  sourceShapeId?: string
  targetShapeId?: string
  linkType?: 'version' | 'reference' | 'derivative'
  prompt?: string
  provider?: 'mock-provider' | 'codex-native' | 'Atlas Cloud' | 'atlas' | 'openai' | 'seedance' | 'kling'
  outputMediaType?: 'image' | 'video'
  generationMode?: string
  mediaType?: 'image' | 'video'
  src?: string
  localPath?: string
  absolutePath?: string
  outputWidth?: number
  outputHeight?: number
  generationStartedAt?: string
  generationCompletedAt?: string
  generationDurationMs?: number
  providerTimings?: Record<string, unknown>
  e2eStartedAt?: string
  e2eCompletedAt?: string
  e2eDurationMs?: number
  writebackCompletedAt?: string
  title?: string
  model?: string
  status?: string
  skillName?: string
  minClientVersion?: string
  references?: Array<{
    shapeId?: string
    assetId?: string
    mediaType?: 'image' | 'video' | 'audio' | 'model3d' | 'text'
    role?: string
    localPath?: string
    absolutePath?: string
    src?: string
  }>
}

export type MaterializeAssetInput = {
  shapeId: string
  assetId: string
  name?: string
  mimeType?: string
  src: string
}

export type MaterializedAsset = {
  assetId: string
  shapeId: string
  mimeType: string
  localPath: string
  absolutePath: string
  bytes: number
}

export type CodexFrameRequestInput = {
  frameId: string
  promptPart: Record<string, unknown>
  defaultInstruction: string
  status?: 'awaiting_user_instruction'
  summary?: {
    frameName?: string
    mediaCount: number
    annotationCount: number
    anchorMediaId?: string
    annotationTexts?: string[]
  }
  frameScreenshot?: FrameScreenshot
  recommendedUserPrompt?: string
}

export type CodexFrameRequest = CodexFrameRequestInput & {
  id: string
  at: string
  source: string
  frameInput?: {
    fileName: string
    mimeType: string
    localPath: string
    absolutePath: string
  }
}

export type FrameScreenshot = {
  fileName: string
  mimeType: 'image/png'
  localPath: string
  absolutePath: string
  frameId: string
  frameName?: string
  includedShapeIds?: string[]
  bytes: number
}

export type PersistedCanvasDocument = {
  version: 1
  updatedAt: string
  source: string
  clientVersion?: string
  currentPageId?: string
  camera?: {
    x: number
    y: number
    z: number
  }
  snapshot: unknown
}

export async function loadCanvasDocument(): Promise<PersistedCanvasDocument | null> {
  const response = await fetch('/api/canvas/document')
  const payload = (await response.json()) as { ok: boolean; document?: PersistedCanvasDocument | null }
  return payload.document ?? null
}

export async function saveCanvasDocument(input: {
  clientVersion?: string
  currentPageId?: string
  camera?: PersistedCanvasDocument['camera']
  snapshot: unknown
}) {
  await fetch('/api/canvas/document', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function publishFrameContext(context: FrameContext) {
  await fetch('/api/frame-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(context),
  })
}

export async function publishSelectionSnapshot(selection: CanvasSelectionSnapshot) {
  await fetch('/api/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection),
  })
}

export type SelectionCaptureRequest = {
  id: string
  at: string
  source?: string
}

export async function fetchPendingSelectionCaptureRequests(): Promise<SelectionCaptureRequest[]> {
  const response = await fetch('/api/selection/fresh-capture/pending')
  const payload = (await response.json()) as { ok?: boolean; requests?: SelectionCaptureRequest[] }
  return payload.requests ?? []
}

export async function respondToSelectionCaptureRequest(input: { requestId: string; selection: CanvasSelectionSnapshot }) {
  const response = await fetch('/api/selection/fresh-capture/response', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as { ok?: boolean; error?: string }
  if (!payload.ok) throw new Error(payload.error ?? 'Failed to respond to fresh canvas capture request.')
}

export async function publishCodexFrameRequest(request: CodexFrameRequestInput): Promise<CodexFrameRequest> {
  const response = await fetch('/api/codex/frame-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const payload = (await response.json()) as { ok: boolean; request?: CodexFrameRequest; error?: string }
  if (!payload.ok || !payload.request) throw new Error(payload.error ?? 'Failed to publish Codex frame request.')
  return payload.request
}

export async function saveFrameScreenshot(input: { frameId: string; frameName?: string; includedShapeIds?: string[]; blob: Blob }): Promise<FrameScreenshot> {
  const response = await fetch('/api/codex/frame-screenshots', {
    method: 'POST',
    headers: {
      'content-type': input.blob.type || 'image/png',
      'x-frame-id': input.frameId,
      'x-frame-name': encodeURIComponent(input.frameName ?? ''),
      'x-included-shape-ids': encodeURIComponent(JSON.stringify(input.includedShapeIds ?? [])),
    },
    body: input.blob,
  })
  const payload = (await response.json()) as { ok: boolean; screenshot?: FrameScreenshot; error?: string }
  if (!payload.ok || !payload.screenshot) throw new Error(payload.error ?? 'Failed to save frame screenshot.')
  return payload.screenshot
}

export async function recordOperation(operation: Record<string, unknown>) {
  await fetch('/api/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(operation),
  })
}

export async function fetchPendingCommands(type?: CanvasCommand['type'], clientVersion?: string): Promise<CanvasCommand[]> {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (clientVersion) params.set('clientVersion', clientVersion)
  const query = params.toString()
  const response = await fetch(`/api/commands/pending${query ? `?${query}` : ''}`)
  const payload = (await response.json()) as { commands?: CanvasCommand[] }
  return payload.commands ?? []
}

export async function materializeAsset(input: MaterializeAssetInput): Promise<MaterializedAsset> {
  const response = await fetch('/api/assets/materialize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as { asset: MaterializedAsset }
  return payload.asset
}

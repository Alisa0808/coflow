import type { CanvasSelectionSnapshot, FrameContext } from './canvasContracts'
import type { ProviderReadyGenerationRequest } from './generationContract'

export type CanvasCommand = {
  id: string
  type: 'canvas.create_version' | 'canvas.agent_prompt' | 'canvas.insert_media'
  frameId?: string
  prompt?: string
  provider?: 'mock-provider' | 'atlas' | 'seedance' | 'kling'
  outputMediaType?: 'image' | 'video'
  generationMode?: string
  mediaType?: 'image' | 'video'
  src?: string
  localPath?: string
  absolutePath?: string
  title?: string
  model?: string
  status?: string
  skillName?: string
  minClientVersion?: string
}

export type QueueAgentPromptInput = {
  frameId?: string
  prompt: string
  provider?: CanvasCommand['provider']
  outputMediaType?: CanvasCommand['outputMediaType']
  generationMode?: string
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
  status?: 'awaiting_user_instruction' | 'ready_to_execute'
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

export type ExecutionResult = {
  id: string
  requestId: string
  provider: string
  status: 'succeeded' | 'failed' | 'processing'
  selectedProviderPayload?: Record<string, unknown>
  providerJob?: {
    mode?: string
    outputMediaType?: 'image' | 'video'
    prompt?: string
  }
  externalExecution?: {
    status?: string
    request?: {
      model?: string
    }
  }
  mockFallback?: boolean
  output: {
    mediaType: 'image' | 'video'
    localPath: string
    absolutePath: string
  }
  preview: {
    localPath: string
    absolutePath: string
    src: string
  }
  note?: string
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

export async function publishCodexFrameRequest(request: CodexFrameRequestInput) {
  const response = await fetch('/api/codex/frame-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const payload = (await response.json()) as { ok: boolean; request?: CodexFrameRequest; error?: string }
  if (!payload.ok) throw new Error(payload.error ?? 'Failed to publish Codex frame request.')
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

export async function queueAgentPrompt(input: QueueAgentPromptInput): Promise<CanvasCommand> {
  const response = await fetch('/api/agent/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as { ok: boolean; command?: CanvasCommand; error?: string }
  if (!payload.ok || !payload.command) throw new Error(payload.error ?? 'Failed to queue agent prompt.')
  return payload.command
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

export async function publishGenerationRequest(request: ProviderReadyGenerationRequest) {
  await fetch('/api/generation-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function runLatestGenerationRequest(): Promise<ExecutionResult | null> {
  const response = await fetch('/api/executions/run-latest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  const payload = (await response.json()) as { ok: boolean; result?: ExecutionResult; error?: string }
  if (!payload.ok) throw new Error(payload.error ?? 'Execution failed.')
  return payload.result ?? null
}

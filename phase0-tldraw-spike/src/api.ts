import type { FrameContext } from './canvasContracts'
import type { ProviderReadyGenerationRequest } from './generationContract'

export type CanvasCommand = {
  id: string
  type: 'canvas.create_version' | 'canvas.agent_prompt'
  frameId?: string
  prompt?: string
  provider?: 'mock-provider' | 'atlas' | 'seedance' | 'kling'
  outputMediaType?: 'image' | 'video'
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

export async function recordOperation(operation: Record<string, unknown>) {
  await fetch('/api/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(operation),
  })
}

export async function fetchPendingCommands(): Promise<CanvasCommand[]> {
  const response = await fetch('/api/commands/pending')
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

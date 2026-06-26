import type {
  CanvasRequest,
  CanvasSelection,
  CanvasState,
  MediaAsset,
  MediaType,
  ProviderMode,
  Rect,
  SceneMode,
} from './media'
export { extractVideoFrame, getVideoMetadata } from './video-frame'

const jsonHeaders = { 'Content-Type': 'application/json' }

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export async function getState() {
  return readJson<CanvasState>(await fetch('/api/state'))
}

export async function createAsset(payload: {
  type: MediaType
  fileName: string
  mimeType: string
  dataBase64: string
  width?: number
  height?: number
  durationMs?: number
  timestampMs?: number
  sourceVideoAssetId?: string
  parentAssetId?: string
  prompt?: string
  provider?: string
  model?: string
  params?: Record<string, unknown>
  skillName?: string
  position?: Rect
}) {
  return readJson<MediaAsset>(
    await fetch('/api/assets', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  )
}

export async function updateSelection(selectedAssetIds: string[]) {
  return readJson<CanvasSelection>(
    await fetch('/api/selection', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ selectedAssetIds }),
    }),
  )
}

export async function updatePreferences(payload: {
  providerMode?: ProviderMode
  sceneMode?: SceneMode
  lastUsedModel?: string
}) {
  return readJson<CanvasState>(
    await fetch('/api/preferences', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  )
}

export async function addAnnotation(assetId: string, text: string) {
  return readJson<CanvasState>(
    await fetch(`/api/assets/${encodeURIComponent(assetId)}/annotations`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ text }),
    }),
  )
}

export async function createCanvasRequest(payload: { instruction: string }) {
  return readJson<CanvasRequest>(
    await fetch('/api/requests', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  )
}

export async function moveAsset(assetId: string, position: Rect) {
  return readJson<CanvasState>(
    await fetch(`/api/assets/${encodeURIComponent(assetId)}/position`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ position }),
    }),
  )
}

export async function fileToBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
  return dataUrl.split(',')[1] ?? ''
}

export async function getImageSize(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Unable to read image dimensions'))
      image.src = url
    })
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

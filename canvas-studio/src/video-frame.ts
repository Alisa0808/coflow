export type VideoFrameDeps = {
  createObjectURL: (file: File) => string
  revokeObjectURL: (url: string) => void
  createVideoElement: () => HTMLVideoElement
  createCanvasElement: () => HTMLCanvasElement
}

export type VideoMetadata = {
  width: number
  height: number
  durationMs: number
}

export type ExtractedVideoFrame = {
  dataBase64: string
  width: number
  height: number
  mimeType: 'image/png'
  timestampMs: number
}

export function browserVideoFrameDeps(): VideoFrameDeps {
  return {
    createObjectURL: (file) => URL.createObjectURL(file),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createVideoElement: () => document.createElement('video'),
    createCanvasElement: () => document.createElement('canvas'),
  }
}

export async function getVideoMetadata(file: File, deps = browserVideoFrameDeps()): Promise<VideoMetadata> {
  const url = deps.createObjectURL(file)
  try {
    const video = deps.createVideoElement()
    video.preload = 'metadata'
    await waitForVideoMetadata(video, url, 'Unable to read video metadata')
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs: Math.round(video.duration * 1000),
    }
  } finally {
    deps.revokeObjectURL(url)
  }
}

export async function extractVideoFrame(
  file: File,
  timestampMs = 0,
  deps = browserVideoFrameDeps(),
): Promise<ExtractedVideoFrame> {
  const url = deps.createObjectURL(file)
  try {
    const video = deps.createVideoElement()
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    await waitForVideoMetadata(video, url, 'Unable to load video for frame extraction')
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('Unable to read video dimensions for frame extraction')
    }
    const targetTime = Math.min(Math.max(timestampMs / 1000, 0), Math.max(video.duration - 0.1, 0))
    await seekVideo(video, targetTime)
    const canvas = deps.createCanvasElement()
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    return {
      dataBase64: dataUrl.split(',')[1] ?? '',
      width: canvas.width,
      height: canvas.height,
      mimeType: 'image/png',
      timestampMs,
    }
  } finally {
    deps.revokeObjectURL(url)
  }
}

async function waitForVideoMetadata(video: HTMLVideoElement, url: string, errorMessage: string) {
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error(errorMessage))
    video.src = url
  })
}

async function seekVideo(video: HTMLVideoElement, targetTime: number) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Unable to read video frame data'))
    })
  }
  if (Math.abs(video.currentTime - targetTime) < 0.01) return
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('Unable to seek video for frame extraction'))
    video.currentTime = targetTime
  })
}

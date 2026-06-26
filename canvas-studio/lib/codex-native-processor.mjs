import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const requestSkillNames = {
  'image.edit': 'annotation-edit-workflow',
  'image.generate': 'codex-native-generate',
  'video.frame-reference': 'video-frame-reference-workflow',
  'scene.product-marketing-set': 'product-marketing-set',
  'scene.social-repurpose': 'social-repurpose',
  'scene.video-ad-keyframes': 'video-ad-keyframes',
  'scene.style-exploration': 'style-exploration',
}

export async function processNextCodexNativeRequest(store, options = {}) {
  const request = await store.claimRequest()
  if (!request) return { processed: false, request: null, assets: [] }

  await store.updateRequest(request.requestId, { status: 'processing' })

  try {
    const state = await store.readState()
    const parentAsset = state.assets.find((asset) => asset.assetId === request.selectedAssetIds[0])
    if (!parentAsset) throw new Error('No selected parent asset found for request')

    const outputs = outputsForRequest(request)
    const generatedAssets = []
    const jobDir = join(store.storageRoot, 'jobs', request.requestId)
    await mkdir(jobDir, { recursive: true })

    for (const output of outputs) {
      const { width, height } = dimensionsForAspect(output.aspectRatio, parentAsset)
      const prompt = promptForOutput(request, output)
      const fileName = `${safeFilePart(output.id)}.svg`
      const outputPath = join(jobDir, fileName)
      await writeFile(
        outputPath,
        createSvg({
          title: output.label,
          subtitle: output.purpose,
          prompt,
          width,
          height,
          accent: colorForString(output.id),
        }),
      )
      const asset = await store.addAsset({
        inputPath: outputPath,
        type: 'image',
        fileName,
        mimeType: 'image/svg+xml',
        parentAssetId: parentAsset.assetId,
        references: request.selectedAssetIds,
        prompt,
        provider: 'codex-native',
        model: options.model ?? 'codex-media-canvas-demo',
        skillName: requestSkillNames[request.requestType] ?? 'codex-native',
        jobId: request.requestId,
        params: {
          requestType: request.requestType,
          sceneMode: request.sceneMode,
          outputId: output.id,
          outputLabel: output.label,
          aspectRatio: output.aspectRatio ?? 'source',
          codexNativeProcessor: true,
        },
        width,
        height,
      })
      generatedAssets.push(asset)
    }

    const completed = await store.updateRequest(request.requestId, {
      status: 'completed',
      result: {
        provider: 'codex-native',
        model: options.model ?? 'codex-media-canvas-demo',
        assetIds: generatedAssets.map((asset) => asset.assetId),
        outputPaths: generatedAssets.map((asset) => asset.localPath),
      },
    })

    return { processed: true, request: completed, assets: generatedAssets }
  } catch (error) {
    await store.updateRequest(request.requestId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export function outputsForRequest(request) {
  if (request.requestType?.startsWith('scene.') && request.preset?.outputs?.length) {
    return request.preset.outputs
  }
  if (request.requestType === 'video.frame-reference') {
    return [
      {
        id: 'frame-revision',
        label: 'Frame revision',
        aspectRatio: '16:9',
        purpose: 'Frame-guided visual revision or keyframe concept.',
      },
    ]
  }
  return [
    {
      id: 'new-version',
      label: 'New version',
      purpose: 'Revised version of the selected asset.',
    },
  ]
}

function promptForOutput(request, output) {
  return [request.instruction, output.label, output.purpose]
    .filter(Boolean)
    .join('\n\n')
}

function dimensionsForAspect(aspectRatio, parentAsset) {
  if (!aspectRatio || !aspectRatio.includes(':')) {
    const width = parentAsset.width ?? 1024
    const height = parentAsset.height ?? 768
    return normalizeDimensions(width, height)
  }
  const [w, h] = aspectRatio.split(':').map((part) => Number.parseInt(part, 10))
  if (!w || !h) return normalizeDimensions(parentAsset.width ?? 1024, parentAsset.height ?? 768)
  const width = 1024
  return normalizeDimensions(width, Math.round((width * h) / w))
}

function normalizeDimensions(width, height) {
  const max = 1400
  if (width <= max && height <= max) return { width, height }
  const scale = max / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function createSvg({ title, subtitle, prompt, width, height, accent }) {
  const safeTitle = escapeXml(title)
  const safeSubtitle = escapeXml(subtitle)
  const safePrompt = escapeXml(prompt.slice(0, 180))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#f8fbff"/>
      <stop offset="100%" stop-color="#e7eefc"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.1)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.8)}" rx="28" fill="#ffffff" stroke="#d8e2f2"/>
  <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.24)}" r="${Math.round(Math.min(width, height) * 0.08)}" fill="${accent}" opacity="0.9"/>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.45)}" fill="#172033" font-family="Inter, Arial, sans-serif" font-size="${Math.round(width * 0.055)}" font-weight="700">${safeTitle}</text>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.53)}" fill="#36506f" font-family="Inter, Arial, sans-serif" font-size="${Math.round(width * 0.026)}">${safeSubtitle}</text>
  <foreignObject x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.62)}" width="${Math.round(width * 0.72)}" height="${Math.round(height * 0.18)}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, Arial, sans-serif; color: #61708a; font-size: ${Math.round(width * 0.022)}px; line-height: 1.45;">${safePrompt}</div>
  </foreignObject>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.86)}" fill="#2f6df6" font-family="Inter, Arial, sans-serif" font-size="${Math.round(width * 0.02)}" font-weight="700">Codex native · traceable canvas output</text>
</svg>`
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function colorForString(value) {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return `hsl(${hash} 82% 58%)`
}

function safeFilePart(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()
}

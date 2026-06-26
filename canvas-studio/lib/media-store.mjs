import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { extname, join, resolve } from 'node:path'

function createDefaultState() {
  return {
    projectName: 'Codex Media Canvas',
    version: 1,
    assets: [],
    selection: {
      selectedAssetIds: [],
      assets: [],
      annotations: [],
      providerPreference: 'auto',
      sceneMode: 'none',
      updatedAt: new Date(0).toISOString(),
    },
    requests: [],
    providerMode: 'auto',
    sceneMode: 'none',
  }
}

export const scenePresets = {
  none: {
    id: 'none',
    label: 'No scene preset',
    description: 'Use the selected asset and annotations as direct Codex context.',
    outputCount: 1,
    outputs: [{ id: 'new-version', label: 'New version', purpose: 'Revise the selected asset.' }],
  },
  'product-marketing-set': {
    id: 'product-marketing-set',
    label: 'Product Marketing Set',
    description: 'Generate a coherent set of product marketing/ad/social visuals.',
    outputCount: 4,
    outputs: [
      { id: 'hero', label: 'Hero product visual', aspectRatio: '1:1', purpose: 'Clean product-focused hero image.' },
      { id: 'lifestyle', label: 'Lifestyle/social visual', aspectRatio: '3:4', purpose: 'Social-friendly lifestyle version.' },
      { id: 'benefit-ad', label: 'Benefit-led ad', aspectRatio: '4:5', purpose: 'Ad visual emphasizing a core benefit.' },
      { id: 'launch', label: 'Launch/promo variant', aspectRatio: '16:9', purpose: 'Horizontal campaign or banner variant.' },
    ],
  },
  'social-repurpose': {
    id: 'social-repurpose',
    label: 'Social Repurpose',
    description: 'Adapt one source asset into platform-specific social versions.',
    outputCount: 5,
    outputs: [
      { id: 'xiaohongshu', label: 'Xiaohongshu cover', aspectRatio: '3:4', purpose: 'Portrait cover for Xiaohongshu.' },
      { id: 'instagram-post', label: 'Instagram post', aspectRatio: '1:1', purpose: 'Square or portrait Instagram post.' },
      { id: 'story', label: 'Story/Reels', aspectRatio: '9:16', purpose: 'Vertical story/reels version.' },
      { id: 'youtube-thumbnail', label: 'YouTube thumbnail', aspectRatio: '16:9', purpose: 'Horizontal thumbnail.' },
      { id: 'horizontal-ad', label: 'Horizontal ad', aspectRatio: '16:9', purpose: 'Ad/banner version.' },
    ],
  },
  'video-ad-keyframes': {
    id: 'video-ad-keyframes',
    label: 'Video Ad Keyframes',
    description: 'Create storyboard frames, keyframes, or prompt packages for video ads.',
    outputCount: 4,
    outputs: [
      { id: 'opening', label: 'Opening hook', aspectRatio: '16:9', purpose: 'First-frame hook or scene opener.' },
      { id: 'product-reveal', label: 'Product reveal', aspectRatio: '16:9', purpose: 'Clear product reveal keyframe.' },
      { id: 'benefit-shot', label: 'Benefit shot', aspectRatio: '16:9', purpose: 'Show benefit or use case.' },
      { id: 'cta-frame', label: 'CTA frame', aspectRatio: '16:9', purpose: 'Final call-to-action frame.' },
    ],
  },
  'style-exploration': {
    id: 'style-exploration',
    label: 'Style Exploration',
    description: 'Explore multiple visual directions from selected references.',
    outputCount: 4,
    outputs: [
      { id: 'clean', label: 'Clean/minimal direction', purpose: 'Minimal and polished direction.' },
      { id: 'premium', label: 'Premium/editorial direction', purpose: 'High-end editorial treatment.' },
      { id: 'bold', label: 'Bold/high-contrast direction', purpose: 'High-impact social/ad style.' },
      { id: 'cinematic', label: 'Cinematic direction', purpose: 'Narrative cinematic treatment.' },
    ],
  },
}

export function createStore(options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd())
  const storageRoot = resolve(options.storageRoot ?? join(workspaceRoot, '.codex-media-canvas'))
  const statePath = join(storageRoot, 'metadata', 'state.json')

  async function ensureStorage() {
    await mkdir(join(storageRoot, 'assets', 'images'), { recursive: true })
    await mkdir(join(storageRoot, 'assets', 'videos'), { recursive: true })
    await mkdir(join(storageRoot, 'assets', 'frames'), { recursive: true })
    await mkdir(join(storageRoot, 'assets', 'thumbnails'), { recursive: true })
    await mkdir(join(storageRoot, 'metadata'), { recursive: true })
    await mkdir(join(storageRoot, 'jobs'), { recursive: true })
    await mkdir(join(storageRoot, 'canvases'), { recursive: true })
  }

  async function readState() {
    await ensureStorage()
    try {
      const raw = await readFile(statePath, 'utf8')
      return normalizeState(JSON.parse(raw))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const state = normalizeState(createDefaultState())
      await writeState(state)
      return state
    }
  }

  async function writeState(state) {
    await ensureStorage()
    const normalized = normalizeState(state)
    await writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`)
    return normalized
  }

  async function addAsset(input) {
    const state = await readState()
    const assetId = input.assetId ?? `asset_${randomUUID()}`
    const now = new Date().toISOString()
    const type = input.type ?? inferType(input.mimeType)
    const folder = type === 'video' ? 'videos' : type === 'frame' ? 'frames' : 'images'
    const extension = safeExtension(input.fileName, input.mimeType)
    const fileName = `${assetId}${extension}`
    const absolutePath = join(storageRoot, 'assets', folder, fileName)

    if (input.dataBase64) {
      await writeFile(absolutePath, Buffer.from(input.dataBase64, 'base64'))
    } else if (input.inputPath) {
      await copyFile(input.inputPath, absolutePath)
    } else {
      throw new Error('addAsset requires dataBase64 or inputPath')
    }

    const parent = input.parentAssetId
      ? state.assets.find((asset) => asset.assetId === input.parentAssetId)
      : undefined
    const siblings = input.parentAssetId
      ? state.assets.filter((asset) => asset.parentAssetId === input.parentAssetId)
      : []
    const position =
      input.position ??
      computePlacement(parent?.position, siblings.length, {
        width: input.width,
        height: input.height,
      })
    const version = input.version ?? (parent ? parent.version + siblings.length + 1 : 1)
    const localPath = toWorkspacePath(workspaceRoot, absolutePath)
    const asset = {
      assetId,
      type,
      localPath,
      publicUrl: toPublicUrl(localPath),
      thumbnailPath: input.thumbnailPath,
      thumbnailUrl: input.thumbnailPath ? toPublicUrl(input.thumbnailPath) : undefined,
      fileName: input.fileName ?? fileName,
      mimeType: input.mimeType ?? 'application/octet-stream',
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
      timestampMs: input.timestampMs,
      parentAssetId: input.parentAssetId,
      parentVersionId: input.parentVersionId ?? parent?.assetId,
      sourceVideoAssetId: input.sourceVideoAssetId,
      references: input.references ?? (input.parentAssetId ? [input.parentAssetId] : []),
      annotations: input.annotations ?? [],
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      params: input.params ?? {},
      skillName: input.skillName,
      jobId: input.jobId,
      version,
      createdAt: now,
      position,
    }
    state.assets.push(asset)
    await writeState(updateSelectionInState(state, [assetId]))
    return asset
  }

  async function updateSelection(selectedAssetIds) {
    const state = await readState()
    await writeState(updateSelectionInState(state, selectedAssetIds))
    return state.selection
  }

  async function updatePreferences(input) {
    const state = await readState()
    if (input.providerMode) state.providerMode = input.providerMode
    if (input.sceneMode) state.sceneMode = input.sceneMode
    if (input.lastUsedModel) state.lastUsedModel = input.lastUsedModel
    await writeState(updateSelectionInState(state, state.selection.selectedAssetIds))
    return state
  }

  async function addAnnotation(assetId, text) {
    const state = await readState()
    const asset = state.assets.find((item) => item.assetId === assetId)
    if (!asset) throw new Error(`Asset not found: ${assetId}`)
    const annotation = {
      id: `annotation_${randomUUID()}`,
      text,
      targetAssetId: assetId,
      createdAt: new Date().toISOString(),
    }
    asset.annotations.push(annotation)
    await writeState(updateSelectionInState(state, state.selection.selectedAssetIds))
    return state
  }

  async function createRequest(input) {
    const state = await readState()
    const selectedAssets = state.selection.assets
    const hasFrame = selectedAssets.some((asset) => asset.type === 'frame' || asset.type === 'video')
    const now = new Date().toISOString()
    const request = {
      requestId: input.requestId ?? `request_${randomUUID()}`,
      requestType: input.requestType ?? requestTypeForScene(state.sceneMode, hasFrame),
      status: 'queued',
      selectedAssetIds: state.selection.selectedAssetIds,
      instruction: input.instruction ?? '',
      annotations: state.selection.annotations,
      providerPreference: state.providerMode,
      sceneMode: state.sceneMode,
      preset: scenePresets[state.sceneMode] ?? scenePresets.none,
      createdAt: now,
      updatedAt: now,
    }
    state.requests.unshift(request)
    await writeState(state)
    return request
  }

  async function claimRequest() {
    const state = await readState()
    const request = state.requests.find((item) => item.status === 'queued')
    if (!request) return null
    const now = new Date().toISOString()
    request.status = 'claimed'
    request.claimedAt = now
    request.updatedAt = now
    await writeState(state)
    return request
  }

  async function updateRequest(requestId, patch) {
    const state = await readState()
    const request = state.requests.find((item) => item.requestId === requestId)
    if (!request) throw new Error(`Request not found: ${requestId}`)
    Object.assign(request, patch, { updatedAt: new Date().toISOString() })
    await writeState(state)
    return request
  }

  async function updateAssetPosition(assetId, position) {
    const state = await readState()
    const asset = state.assets.find((item) => item.assetId === assetId)
    if (!asset) throw new Error(`Asset not found: ${assetId}`)
    asset.position = position
    await writeState(updateSelectionInState(state, state.selection.selectedAssetIds))
    return state
  }

  async function updateAssetMetadata(assetId, metadata) {
    const state = await readState()
    const asset = state.assets.find((item) => item.assetId === assetId)
    if (!asset) throw new Error(`Asset not found: ${assetId}`)
    const allowedKeys = [
      'thumbnailPath',
      'thumbnailUrl',
      'parentAssetId',
      'parentVersionId',
      'sourceVideoAssetId',
      'references',
      'annotations',
      'prompt',
      'provider',
      'model',
      'params',
      'skillName',
      'jobId',
      'durationMs',
      'timestampMs',
      'width',
      'height',
    ]
    for (const key of allowedKeys) {
      if (key in metadata) asset[key] = metadata[key]
    }
    await writeState(updateSelectionInState(state, state.selection.selectedAssetIds))
    return asset
  }

  async function getAssetFile(assetId) {
    const state = await readState()
    const asset = state.assets.find((item) => item.assetId === assetId)
    if (!asset) return null
    const absolutePath = resolve(workspaceRoot, asset.localPath)
    await stat(absolutePath)
    return { asset, absolutePath }
  }

  return {
    workspaceRoot,
    storageRoot,
    statePath,
    ensureStorage,
    readState,
    writeState,
    addAsset,
    updateSelection,
    updatePreferences,
    addAnnotation,
    createRequest,
    claimRequest,
    updateRequest,
    updateAssetPosition,
    updateAssetMetadata,
    getAssetFile,
  }
}

export function normalizeState(state) {
  const defaultState = createDefaultState()
  const normalized = {
    ...defaultState,
    ...state,
    selection: { ...defaultState.selection, ...(state.selection ?? {}) },
    assets: Array.isArray(state.assets) ? state.assets : [],
    requests: Array.isArray(state.requests) ? state.requests : [],
  }
  return updateSelectionInState(normalized, normalized.selection.selectedAssetIds ?? [])
}

export function updateSelectionInState(state, selectedAssetIds) {
  const ids = selectedAssetIds.filter((id) => state.assets.some((asset) => asset.assetId === id))
  const assets = state.assets.filter((asset) => ids.includes(asset.assetId))
  const annotations = assets.flatMap((asset) => asset.annotations ?? [])
  state.selection = {
    selectedAssetIds: ids,
    assets,
    annotations,
    providerPreference: state.providerMode ?? 'auto',
    sceneMode: state.sceneMode ?? 'none',
    updatedAt: new Date().toISOString(),
  }
  return state
}

export function computePlacement(parentPosition, siblingIndex = 0, dimensions = {}) {
  const baseWidth = Math.min(Math.max(dimensions.width ?? 360, 220), 420)
  const baseHeight =
    dimensions.width && dimensions.height
      ? Math.round((baseWidth * dimensions.height) / dimensions.width)
      : Math.round(baseWidth * 0.75)
  if (!parentPosition) {
    return { x: 420 + siblingIndex * 36, y: 180 + siblingIndex * 36, w: baseWidth, h: baseHeight }
  }
  const column = siblingIndex % 2
  const row = Math.floor(siblingIndex / 2)
  return {
    x: parentPosition.x + parentPosition.w + 80 + column * (baseWidth + 28),
    y: parentPosition.y + row * (baseHeight + 72),
    w: baseWidth,
    h: baseHeight,
  }
}

export function requestTypeForScene(sceneMode, hasVideoFrame = false) {
  if (sceneMode === 'product-marketing-set') return 'scene.product-marketing-set'
  if (sceneMode === 'social-repurpose') return 'scene.social-repurpose'
  if (sceneMode === 'video-ad-keyframes') return 'scene.video-ad-keyframes'
  if (sceneMode === 'style-exploration') return 'scene.style-exploration'
  return hasVideoFrame ? 'video.frame-reference' : 'image.edit'
}

function inferType(mimeType = '') {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('image/')) return 'image'
  return 'image'
}

function safeExtension(fileName = '', mimeType = '') {
  const fromName = extname(fileName)
  if (fromName) return fromName
  if (mimeType === 'image/svg+xml') return '.svg'
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'video/webm') return '.webm'
  if (mimeType.startsWith('video/')) return '.mp4'
  if (mimeType.startsWith('image/')) return '.jpg'
  return '.bin'
}

function toWorkspacePath(workspaceRoot, absolutePath) {
  const root = `${workspaceRoot}/`
  return absolutePath.startsWith(root) ? absolutePath.slice(root.length) : absolutePath
}

function toPublicUrl(localPath) {
  return `/media/${encodeURIComponent(localPath)}`
}

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addAnnotation,
  createAsset,
  createCanvasRequest,
  extractVideoFrame,
  fileToBase64,
  getImageSize,
  getState,
  getVideoMetadata,
  updatePreferences,
  updateSelection,
} from './api'
import { CanvasAdapter } from './canvas-adapter'
import { DetailsPanel } from './components'
import {
  getRequestTypeForScene,
  providerModeLabels,
  sceneModeLabels,
  scenePresets,
  type CanvasState,
  type MediaAsset,
  type ProviderMode,
  type SceneMode,
} from './media'

const emptyState: CanvasState = {
  projectName: 'Codex Media Canvas',
  version: 1,
  assets: [],
  requests: [],
  providerMode: 'auto',
  sceneMode: 'none',
  selection: {
    selectedAssetIds: [],
    assets: [],
    annotations: [],
    providerPreference: 'auto',
    sceneMode: 'none',
    updatedAt: new Date(0).toISOString(),
  },
}

export default function App() {
  const [state, setState] = useState<CanvasState>(emptyState)
  const [status, setStatus] = useState('Opening workspace...')
  const [instruction, setInstruction] = useState('')
  const [annotationText, setAnnotationText] = useState('')
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const lastVideoFileRef = useRef<File | null>(null)
  const lastVideoAssetRef = useRef<MediaAsset | null>(null)

  const selectedAssetId = state.selection.selectedAssetIds[0]
  const selectedAsset = useMemo(
    () => state.assets.find((asset) => asset.assetId === selectedAssetId),
    [selectedAssetId, state.assets],
  )

  const refresh = useCallback(async () => {
    const nextState = await getState()
    setState(nextState)
    setStatus('Saved locally')
  }, [])

  useEffect(() => {
    refresh().catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)))
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(interval)
  }, [refresh])

  const selectAsset = useCallback(
    async (assetId: string) => {
      const selection = await updateSelection([assetId])
      setState((current) => ({ ...current, selection }))
    },
    [setState],
  )

  const handleImageFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      setStatus('Importing image...')
      const file = files[0]
      const [{ width, height }, dataBase64] = await Promise.all([getImageSize(file), fileToBase64(file)])
      const asset = await createAsset({
        type: 'image',
        fileName: file.name,
        mimeType: file.type || 'image/png',
        dataBase64,
        width,
        height,
      })
      await updateSelection([asset.assetId])
      await refresh()
    },
    [refresh],
  )

  const handleVideoFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      setStatus('Importing video...')
      const file = files[0]
      lastVideoFileRef.current = file
      const [metadata, dataBase64] = await Promise.all([getVideoMetadata(file), fileToBase64(file)])
      const asset = await createAsset({
        type: 'video',
        fileName: file.name,
        mimeType: file.type || 'video/mp4',
        dataBase64,
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
      })
      lastVideoAssetRef.current = asset
      await updateSelection([asset.assetId])
      await refresh()
    },
    [refresh],
  )

  const handleExtractFrame = useCallback(async () => {
    const sourceFile = lastVideoFileRef.current
    const sourceAsset = selectedAsset?.type === 'video' ? selectedAsset : lastVideoAssetRef.current
    if (!sourceFile || !sourceAsset) {
      setStatus('Import a video first, then extract a frame.')
      return
    }
    setStatus('Extracting frame...')
    const frame = await extractVideoFrame(sourceFile, 0)
    const asset = await createAsset({
      type: 'frame',
      fileName: `${sourceAsset.fileName.replace(/\.[^.]+$/, '')}-frame-0.png`,
      mimeType: frame.mimeType,
      dataBase64: frame.dataBase64,
      width: frame.width,
      height: frame.height,
      timestampMs: frame.timestampMs,
      sourceVideoAssetId: sourceAsset.assetId,
      parentAssetId: sourceAsset.assetId,
      position: {
        x: sourceAsset.position.x + sourceAsset.position.w + 80,
        y: sourceAsset.position.y,
        w: Math.min(360, frame.width),
        h: Math.round((Math.min(360, frame.width) * frame.height) / frame.width),
      },
    })
    await updateSelection([asset.assetId])
    await refresh()
  }, [refresh, selectedAsset])

  const handleAnnotation = useCallback(async () => {
    if (!selectedAsset || !annotationText.trim()) return
    await addAnnotation(selectedAsset.assetId, annotationText.trim())
    setAnnotationText('')
    await refresh()
  }, [annotationText, refresh, selectedAsset])

  const handleCreateRequest = useCallback(async () => {
    if (!selectedAsset) {
      setStatus('Select an asset before asking Codex.')
      return
    }
    const hasVideoFrame = selectedAsset.type === 'frame' || selectedAsset.type === 'video'
    const requestType = getRequestTypeForScene(state.sceneMode, hasVideoFrame)
    const fallbackInstruction =
      requestType === 'image.edit'
        ? 'Revise the selected asset according to its annotations and preserve the original.'
        : `Run ${sceneModeLabels[state.sceneMode]} for the selected asset.`
    await createCanvasRequest({ instruction: instruction.trim() || fallbackInstruction })
    setInstruction('')
    await refresh()
  }, [instruction, refresh, selectedAsset, state.sceneMode])

  const handleProviderChange = useCallback(
    async (providerMode: ProviderMode) => {
      const nextState = await updatePreferences({ providerMode })
      setState(nextState)
    },
    [setState],
  )

  const handleSceneChange = useCallback(
    async (sceneMode: SceneMode) => {
      const nextState = await updatePreferences({ sceneMode })
      setState(nextState)
    },
    [setState],
  )

  const selectedCount = state.selection.selectedAssetIds.length

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <strong>Codex Media Canvas</strong>
          <span>Point. Prompt. Generate back.</span>
        </div>
        <div className="topbar-status">{status}</div>
      </header>

      <aside className="left-panel">
        <section>
          <h2>Import</h2>
          <input
            ref={imageInputRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => handleImageFiles(event.target.files)}
          />
          <input
            ref={videoInputRef}
            hidden
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={(event) => handleVideoFiles(event.target.files)}
          />
          <button type="button" onClick={() => imageInputRef.current?.click()}>
            Upload image
          </button>
          <button type="button" onClick={() => videoInputRef.current?.click()}>
            Upload video
          </button>
          <button type="button" onClick={handleExtractFrame}>
            Extract video frame
          </button>
        </section>

        <section>
          <h2>First-run provider</h2>
          <p className="helper">
            Pick a lightweight preference here. Model choice, API keys, and provider routing stay in the Codex
            conversation.
          </p>
          <div className="choice-list">
            <button
              className={state.providerMode === 'codex' ? 'choice-button choice-button-active' : 'choice-button'}
              type="button"
              onClick={() => handleProviderChange('codex')}
            >
              <strong>Use Codex native</strong>
              <span>Zero-config demo path for image and frame workflows.</span>
            </button>
            <button
              className={state.providerMode === 'atlas' ? 'choice-button choice-button-active' : 'choice-button'}
              type="button"
              onClick={() => handleProviderChange('atlas')}
            >
              <strong>Install Atlas Cloud</strong>
              <span>Recommended advanced path through Atlas Skill/MCP/CLI.</span>
            </button>
            <button
              className={state.providerMode === 'custom' ? 'choice-button choice-button-active' : 'choice-button'}
              type="button"
              onClick={() => handleProviderChange('custom')}
            >
              <strong>Use custom provider</strong>
              <span>Expose a Skill, MCP server, or CLI that returns local files.</span>
            </button>
          </div>
        </section>

        <section>
          <h2>Ask Codex</h2>
          <p className="helper">
            Canvas requests are queued for Codex. The canvas does not call provider APIs directly in v1.
          </p>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Describe what Codex should do with the selected asset..."
          />
          <button disabled={!selectedAsset} type="button" onClick={handleCreateRequest}>
            Send selected context to Codex
          </button>
        </section>

        <section>
          <h2>Annotation</h2>
          <textarea
            value={annotationText}
            onChange={(event) => setAnnotationText(event.target.value)}
            placeholder="Add an instruction, e.g. make the background cleaner."
          />
          <button disabled={!selectedAsset || !annotationText.trim()} type="button" onClick={handleAnnotation}>
            Attach annotation
          </button>
        </section>

        <section>
          <h2>Session</h2>
          <div className="small-grid">
            <span>Selected</span>
            <strong>{selectedCount}</strong>
            <span>Assets</span>
            <strong>{state.assets.length}</strong>
            <span>Provider</span>
            <strong>{providerModeLabels[state.providerMode]}</strong>
            <span>Scene</span>
            <strong>{sceneModeLabels[state.sceneMode]}</strong>
            <span>Outputs</span>
            <strong>{scenePresets[state.sceneMode].outputCount}</strong>
          </div>
        </section>
      </aside>

      <CanvasAdapter
        assets={state.assets}
        selectedAssetIds={state.selection.selectedAssetIds}
        onSelectAsset={selectAsset}
      />

      <DetailsPanel
        selectedAsset={selectedAsset}
        requests={state.requests}
        providerMode={state.providerMode}
        sceneMode={state.sceneMode}
        onProviderChange={handleProviderChange}
        onSceneChange={handleSceneChange}
      />
    </div>
  )
}

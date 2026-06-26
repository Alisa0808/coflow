import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import {
  Tldraw,
  createBindingId,
  createShapeId,
  toRichText,
  type Editor,
  type TLAsset,
  type TLAssetStore,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { buildBoundedFrameContextPromptPart } from './agentPromptParts'
import {
  extractFrameContext,
  createVersionPlacement,
  getShapeBounds,
  richTextToPlainText,
  type Bounds,
  type CanvasShapeRecord,
  type FrameContext,
} from './canvasContracts'
import { type GenerationMode, type OutputMediaType, type ProviderId } from './generationContract'
import { GenerateMediaActionUtil } from './generateMediaActionUtil'
import { MEDIA_IMAGE_SHAPE, MediaImageShapeUtil, type MediaImageShape } from './mediaShape'
import {
  fetchPendingCommands,
  materializeAsset,
  publishFrameContext,
  publishGenerationRequest,
  queueAgentPrompt,
  recordOperation,
  runLatestGenerationRequest,
} from './api'

const shapeUtils = [MediaImageShapeUtil]
const MAX_ASSET_SIZE_BYTES = 2 * 1024 * 1024 * 1024
const IMPORTED_MEDIA_INITIAL_DISPLAY_FIT = { w: 1280, h: 720 }
const CHUNKED_UPLOAD_THRESHOLD_BYTES = 32 * 1024 * 1024
const UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024

type FrameActionState = {
  frameId: string
  frameName: string
  left: number
  top: number
} | null

type UploadProgressState = {
  fileName: string
  loaded: number
  total: number
  percent: number
  status: 'uploading' | 'completed'
} | null

type SelectedMediaInfo = {
  title: string
  prompt?: string
  provider?: string
  model?: string
  generationMode?: string
  status?: string
  skillName?: string
  localPath?: string
  requestId?: string
  executionId?: string
} | null

export default function App() {
  const editorRef = useRef<Editor | null>(null)
  const frameActionRafRef = useRef<number | null>(null)
  const [status, setStatus] = useState('')
  const [frameAction, setFrameAction] = useState<FrameActionState>(null)
  const [selectedMediaInfo, setSelectedMediaInfo] = useState<SelectedMediaInfo>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>(null)
  const assetStore = useMemo(() => createLocalAssetStore(setUploadProgress, setStatus), [])

  useEffect(() => {
    let stopped = false

    async function pollPendingCommands() {
      if (stopped) return

      try {
        const commands = await fetchPendingCommands()
        for (const command of commands) {
          if (command.type === 'canvas.create_version' || command.type === 'canvas.agent_prompt') {
            await generateVersion(command.frameId, {
              prompt: command.prompt,
              provider: command.provider,
              outputMediaType: command.outputMediaType,
              generationMode: command.generationMode as GenerationMode | undefined,
            })
          }
        }
      } catch {
        // The local backend may still be starting; keep the canvas usable.
      }
    }

    const interval = window.setInterval(() => {
      void pollPendingCommands()
    }, 1000)
    void pollPendingCommands()

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [])

  function onMount(editor: Editor) {
    editorRef.current = editor
    seedCanvas(editor)
    setFrameAction(getSelectedFrameAction(editor))
    setSelectedMediaInfo(getSelectedMediaInfo(editor))
    const unsubscribe = editor.store.listen(({ changes }) => {
      const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
      if (frameActionRafRef.current !== null) appWindow.cancelAnimationFrame(frameActionRafRef.current)
      frameActionRafRef.current = appWindow.requestAnimationFrame(() => {
        frameActionRafRef.current = null
        setFrameAction(getSelectedFrameAction(editor))
        setSelectedMediaInfo(getSelectedMediaInfo(editor))
      })
      normalizeImportedMediaShapes(editor, Object.values(changes.added))
    })
    editor.disposables.add(unsubscribe)
    setStatus('')
  }

  async function queueFrameGenerate(frameId: string) {
    try {
      const command = await queueAgentPrompt({
        frameId,
        prompt: 'Generate a new version using the selected frame annotations.',
        provider: 'atlas',
      })
      setStatus(`Queued Codex skill command ${command.id}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to queue Codex skill command.')
    }
  }

  async function generateVersion(
    frameId?: string,
    options: { outputMediaType?: OutputMediaType; generationMode?: GenerationMode; prompt?: string; provider?: ProviderId } = {},
  ) {
    const editor = editorRef.current
    if (!editor) return
    const shapes = toCanvasShapeRecords(editor.getCurrentPageShapesSorted())
    const frame = frameId ? shapes.find((shape) => shape.id === frameId && shape.type === 'frame') : findContextFrame(editor, shapes)
    if (!frame) {
      setStatus('No frame found. Select a frame or use the seeded task frame.')
      return
    }

    const context = await extractMaterializedFrameContext(editor, shapes, frame.id)
    if (!context.anchorMedia) {
      setStatus('Frame has no media anchor.')
      return
    }

    const anchorBounds = context.bounds
    const outputSize = {
      w: context.anchorMedia.bounds.w,
      h: context.anchorMedia.bounds.h,
    }
    const occupied = shapes.map(getShapeBounds)
    const placement = createVersionPlacement(anchorBounds, outputSize, occupied)
    const childId = createShapeId()
    const arrowId = createShapeId()
    const parentShapeId = context.anchorMedia.shapeId as TLShapeId
    const generatedAt = Date.now()
    const outputMediaType = options.outputMediaType ?? (context.anchorMedia.shapeType === 'video' ? 'video' : 'image')
    const providerOutputLocalPath =
      outputMediaType === 'video'
        ? `.codex-media-canvas/assets/videos/generated-${generatedAt}.mp4`
        : `.codex-media-canvas/assets/images/generated-${generatedAt}.svg`
    const canvasPreviewLocalPath = `.codex-media-canvas/assets/images/generated-preview-${generatedAt}.svg`
    const promptPart = buildBoundedFrameContextPromptPart(context, options.prompt ? 'codex-agent-bridge' : 'canvas-frame-action')
    const generateMediaAction = GenerateMediaActionUtil.create({
      source: options.prompt ? 'codex-agent-bridge' : 'canvas-frame-action',
      prompt: options.prompt,
      provider: options.provider,
      frameContext: promptPart,
      childShapeId: childId,
      arrowShapeId: arrowId,
      outputLocalPath: providerOutputLocalPath,
      outputMediaType,
      generationMode: options.generationMode,
      createdAt: generatedAt,
    })
    const generationRequest = GenerateMediaActionUtil.toGenerationRequest(generateMediaAction)

    editor.run(() => {
      editor.createShapes([
        {
          id: childId,
          type: MEDIA_IMAGE_SHAPE,
          x: placement.childBounds.x,
          y: placement.childBounds.y,
          props: {
            w: placement.childBounds.w,
            h: placement.childBounds.h,
            assetId: `asset:generated-${generatedAt}`,
            versionId: `version:generated-${generatedAt}`,
            localPath: canvasPreviewLocalPath,
            src: generatingPlaceholderSvg(generationRequest.provider, outputMediaType),
            title: 'Generating preview',
            prompt: generationRequest.instructions.prompt,
            provider: generationRequest.provider,
            model: '',
            generationMode: generationRequest.generationMode,
            requestId: generationRequest.id,
            executionId: '',
            status: 'processing',
            skillName: 'codex-media-generation',
          },
        } satisfies Partial<MediaImageShape>,
        {
          id: arrowId,
          type: 'arrow',
          x: 0,
          y: 0,
          props: {
            start: { x: placement.lineageArrow.start.x, y: placement.lineageArrow.start.y },
            end: { x: placement.lineageArrow.end.x, y: placement.lineageArrow.end.y },
            bend: 0,
            dash: 'draw',
            size: 'm',
            fill: 'none',
            color: 'blue',
            arrowheadStart: 'none',
            arrowheadEnd: 'arrow',
            richText: toRichText(''),
            labelPosition: 0.5,
          },
        },
      ])
      editor.createBindings([
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId,
          toId: parentShapeId,
          props: {
            terminal: 'start',
            normalizedAnchor: { x: 1, y: 0.5 },
            isExact: false,
            isPrecise: true,
          },
        },
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId,
          toId: childId,
          props: {
            terminal: 'end',
            normalizedAnchor: { x: 0, y: 0.5 },
            isExact: false,
            isPrecise: true,
          },
        },
      ])
      editor.select(childId)
    })

    await publishFrameContext(context)
    await publishGenerationRequest(generationRequest)
    const execution = await runLatestGenerationRequest()
    if (execution) {
      const title =
        execution.status === 'processing'
          ? execution.output.mediaType === 'video'
            ? 'Rendering video'
            : 'Generating image'
          : execution.status === 'failed'
            ? 'Generation failed'
            : execution.mockFallback
              ? execution.output.mediaType === 'video'
                ? 'Mock fallback video preview'
                : 'Mock fallback image'
              : execution.output.mediaType === 'video'
                ? 'Generated video output'
                : 'Generated image output'
      const model = execution.externalExecution?.request?.model ?? stringFromUnknown(execution.selectedProviderPayload?.model)
      const generationMode = execution.providerJob?.mode ?? generationRequest.generationMode
      editor.updateShapes([
        {
          id: childId,
          type: MEDIA_IMAGE_SHAPE,
          props: {
            localPath: execution.output.localPath,
            src: execution.preview.src,
            title,
            provider: execution.provider,
            model: model ?? '',
            generationMode,
            requestId: execution.requestId,
            executionId: execution.id,
            status: execution.status,
            skillName: 'codex-media-generation',
          },
        } satisfies TLShapePartial<MediaImageShape>,
      ])
      setSelectedMediaInfo(getSelectedMediaInfo(editor))
    }
    await recordOperation({
      type: 'version.created',
      frameId: context.frameId,
      requestedFrameId: frameId,
      parentShapeId,
      childShapeId: childId,
      arrowShapeId: arrowId,
      promptPart,
      generateMediaAction,
      generationRequestId: generationRequest.id,
      provider: generationRequest.provider,
      executionId: execution?.id,
      skillName: 'codex-media-generation',
      promptSource: options.prompt ? 'codex-agent-bridge' : 'canvas-frame-action',
    })
    setStatus(
      execution?.status === 'processing'
        ? `${generationRequest.provider} is still generating; kept a non-final preview`
        : execution?.status === 'failed'
          ? `${generationRequest.provider} generation failed; kept a failed-state preview`
          : `Executed ${generationRequest.generationMode} request and updated child preview`
    )
  }

  return (
    <div className="app">
      <div className="canvas">
        <Tldraw
          shapeUtils={shapeUtils}
          onMount={onMount}
          assets={assetStore}
          maxAssetSize={MAX_ASSET_SIZE_BYTES}
          maxImageDimension={Infinity}
        />
      </div>
      {status ? (
        <div className="status-pill" aria-live="polite">
          {status}
        </div>
      ) : null}
      {selectedMediaInfo ? <MediaInfoPanel info={selectedMediaInfo} /> : null}
      {uploadProgress ? <UploadProgress progress={uploadProgress} /> : null}
      {frameAction ? <FrameGenerateAction action={frameAction} onGenerate={queueFrameGenerate} /> : null}
    </div>
  )
}

function MediaInfoPanel({ info }: { info: NonNullable<SelectedMediaInfo> }) {
  const rows = [
    ['Prompt', info.prompt],
    ['Model', info.model],
    ['Provider', info.provider],
    ['Mode', info.generationMode],
    ['Status', info.status],
    ['Skill', info.skillName],
    ['Local path', info.localPath],
    ['Request', info.requestId],
    ['Execution', info.executionId],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  return (
    <aside className="media-info-panel" aria-label="Selected media information">
      <div className="media-info-panel__header">
        <span className="media-info-panel__thumb" aria-hidden="true" />
        <div>
          <div className="media-info-panel__title">{info.title || 'Media asset'}</div>
          <div className="media-info-panel__subtitle">Asset details</div>
        </div>
      </div>
      <div className="media-info-panel__rows">
        {rows.map(([label, value]) => (
          <div className="media-info-panel__row" key={label}>
            <span>{label}</span>
            <p>{value}</p>
          </div>
        ))}
      </div>
    </aside>
  )
}

function FrameGenerateAction({ action, onGenerate }: { action: NonNullable<FrameActionState>; onGenerate: (frameId: string) => void }) {
  function keepPrimaryPointerOnButton(event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) {
    if ('button' in event && event.button !== 0) return
    event.stopPropagation()
  }

  return (
    <button
      type="button"
      className="frame-action-button"
      style={{ left: action.left, top: action.top }}
      onPointerDownCapture={keepPrimaryPointerOnButton}
      onPointerUpCapture={keepPrimaryPointerOnButton}
      onMouseDownCapture={keepPrimaryPointerOnButton}
      onContextMenu={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onGenerate(action.frameId)
      }}
      title={`Generate from ${action.frameName}`}
    >
      <span className="frame-action-button__icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" focusable="false">
          <path d="M8.3 1.5 9.8 5l3.7 1.4-3.7 1.5-1.5 3.6-1.5-3.6L3.1 6.4 6.8 5l1.5-3.5Z" />
          <path d="M3.7 10.1 4.4 12l1.9.7-1.9.8-.7 1.8-.8-1.8-1.8-.8 1.8-.7.8-1.9Z" />
        </svg>
      </span>
      <span>Generate</span>
    </button>
  )
}

function UploadProgress({ progress }: { progress: NonNullable<UploadProgressState> }) {
  return (
    <div className="upload-progress" data-status={progress.status}>
      <div className="upload-progress__label">
        <span>{progress.status === 'completed' ? 'Upload complete' : 'Uploading media'}</span>
        <strong>{progress.percent}%</strong>
      </div>
      <div className="upload-progress__file">{progress.fileName}</div>
      <div className="upload-progress__bar">
        <div style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  )
}

function getSelectedFrameAction(editor: Editor): FrameActionState {
  const selectedFrame = editor.getSelectedShapes().find((shape) => shape.type === 'frame')
  if (!selectedFrame) return null

  const frame = selectedFrame as TLShape & { props: { name?: string; w?: number; h?: number } }
  const topLeft = editor.pageToScreen({ x: frame.x, y: frame.y })
  const frameName = frame.props.name || 'Untitled frame'

  return {
    frameId: frame.id,
    frameName,
    left: Math.max(12, topLeft.x + 10),
    top: Math.max(64, topLeft.y - 36),
  }
}

function getSelectedMediaInfo(editor: Editor): SelectedMediaInfo {
  const selectedMedia = editor.getSelectedShapes().find((shape) => shape.type === MEDIA_IMAGE_SHAPE || shape.type === 'image' || shape.type === 'video')
  if (!selectedMedia) return null

  const props = selectedMedia.props as Record<string, unknown>
  return {
    title: stringFromUnknown(props.title) ?? (selectedMedia.type === 'video' ? 'Video asset' : 'Image asset'),
    prompt: stringFromUnknown(props.prompt),
    provider: stringFromUnknown(props.provider),
    model: stringFromUnknown(props.model),
    generationMode: stringFromUnknown(props.generationMode),
    status: stringFromUnknown(props.status),
    skillName: stringFromUnknown(props.skillName),
    localPath: stringFromUnknown(props.localPath) ?? stringFromUnknown(props.assetId),
    requestId: stringFromUnknown(props.requestId),
    executionId: stringFromUnknown(props.executionId),
  }
}

function normalizeImportedMediaShapes(editor: Editor, records: unknown[]) {
  const updates: TLShapePartial[] = []
  const seen = new Set<string>()
  const importedShapes: TLShape[] = []
  const importedShapeIds: TLShapeId[] = []

  for (const record of records) {
    const shape = record as TLShape
    if (shape.typeName !== 'shape') continue
    if (shape.type !== 'image' && shape.type !== 'video') continue
    if (seen.has(shape.id)) continue
    seen.add(shape.id)
    importedShapes.push(shape)
    importedShapeIds.push(shape.id)
  }

  if (importedShapes.length === 0) return

  const occupiedBounds = editor
    .getCurrentPageShapes()
    .filter((shape) => !seen.has(shape.id))
    .map(getNativeShapeBounds)

  for (const shape of importedShapes) {
    const props = shape.props as { w?: number; h?: number }
    const w = typeof props.w === 'number' ? props.w : 0
    const h = typeof props.h === 'number' ? props.h : 0
    const fitted = containSize({ w, h }, IMPORTED_MEDIA_INITIAL_DISPLAY_FIT)
    const initialBounds = {
      x: shape.x,
      y: shape.y,
      w: fitted.w || w,
      h: fitted.h || h,
    }
    const placement = findOpenImportedMediaBounds(initialBounds, occupiedBounds, getViewportBounds(editor))
    const needsResize = fitted.w < w || fitted.h < h
    const needsMove = placement.x !== shape.x || placement.y !== shape.y
    if (!needsResize && !needsMove) {
      occupiedBounds.push(placement)
      continue
    }

    if (shape.type === 'image') {
      updates.push({
        id: shape.id,
        type: 'image',
        x: placement.x,
        y: placement.y,
        props: {
          w: fitted.w,
          h: fitted.h,
        },
      })
    } else {
      updates.push({
        id: shape.id,
        type: 'video',
        x: placement.x,
        y: placement.y,
        props: {
          w: fitted.w,
          h: fitted.h,
        },
      })
    }
    occupiedBounds.push(placement)
  }

  editor.run(() => {
    if (updates.length > 0) editor.updateShapes(updates)
    editor.select(...importedShapeIds)
  })
  focusImportedMedia(editor)
}

function focusImportedMedia(editor: Editor) {
  const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
  appWindow.requestAnimationFrame(() => {
    appWindow.requestAnimationFrame(() => {
      editor.zoomToSelection({ animation: { duration: 180 } })
    })
  })
}

function getNativeShapeBounds(shape: TLShape): Bounds {
  const props = shape.props as { w?: number; h?: number }
  return {
    x: shape.x,
    y: shape.y,
    w: typeof props.w === 'number' && Number.isFinite(props.w) ? props.w : shape.type === 'note' ? 160 : 120,
    h: typeof props.h === 'number' && Number.isFinite(props.h) ? props.h : shape.type === 'note' ? 160 : 90,
  }
}

function getViewportBounds(editor: Editor): Bounds {
  const viewport = editor.getViewportPageBounds()
  return {
    x: viewport.minX,
    y: viewport.minY,
    w: viewport.width,
    h: viewport.height,
  }
}

function findOpenImportedMediaBounds(initial: Bounds, occupied: Bounds[], viewport: Bounds): Bounds {
  const gap = 56
  const horizontalStep = initial.w + gap
  const verticalStep = initial.h + gap
  const candidates: Bounds[] = []

  for (let ring = 0; ring < 8; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (ring !== 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        candidates.push({
          ...initial,
          x: initial.x + dx * horizontalStep,
          y: initial.y + dy * verticalStep,
        })
      }
    }
  }

  const openCandidates = candidates.filter((candidate) => !occupied.some((bounds) => boundsIntersect(candidate, inflateBounds(bounds, 24))))
  const visibleCandidate = openCandidates.find((candidate) => boundsCenterIsInside(candidate, inflateBounds(viewport, -24)))
  return visibleCandidate ?? openCandidates[0] ?? initial
}

function boundsIntersect(a: Bounds, b: Bounds) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function boundsCenterIsInside(bounds: Bounds, container: Bounds) {
  const center = {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  }
  return center.x >= container.x && center.x <= container.x + container.w && center.y >= container.y && center.y <= container.y + container.h
}

function inflateBounds(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  }
}

function containSize(size: { w: number; h: number }, max: { w: number; h: number }) {
  if (size.w <= 0 || size.h <= 0) return size
  const scale = Math.min(1, max.w / size.w, max.h / size.h)
  return {
    w: Math.round(size.w * scale),
    h: Math.round(size.h * scale),
  }
}

function stringFromUnknown(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function findContextFrame(editor: Editor, shapes: CanvasShapeRecord[]) {
  const selected = editor.getSelectedShapes()
  const selectedFrame = selected.find((shape) => shape.type === 'frame')
  if (selectedFrame) return shapes.find((shape) => shape.id === selectedFrame.id)

  const selectedIds = new Set<string>(selected.map((shape) => shape.id))
  const selectedInsideFrame = shapes.find(
    (shape) => shape.type === 'frame' && shapes.some((candidate) => selectedIds.has(candidate.id) && candidate.parentId === shape.id),
  )
  if (selectedInsideFrame) return selectedInsideFrame

  return shapes.find((shape) => shape.type === 'frame')
}

function seedCanvas(editor: Editor) {
  if (editor.getCurrentPageShapes().some((shape) => shape.type === MEDIA_IMAGE_SHAPE)) return

  const frameId = createShapeId('task-frame')
  const mediaId = createShapeId('source-media')
  const boxId = createShapeId('annotation-box')
  const noteId = createShapeId('annotation-note')

  editor.run(() => {
    editor.createShapes([
      {
        id: frameId,
        type: 'frame',
        x: 56,
        y: 80,
        props: {
          w: 640,
          h: 400,
          name: 'Product hero edit task',
          color: 'blue',
        },
      },
      {
        id: mediaId,
        type: MEDIA_IMAGE_SHAPE,
        x: 96,
        y: 140,
        props: {
          w: 360,
          h: 240,
          assetId: 'asset:source-product',
          versionId: 'version:source-product-v1',
          localPath: '.codex-media-canvas/assets/images/source-product.svg',
          src: sourceImageSvg(),
          title: 'Source product image',
          prompt: 'Original product hero image',
          provider: 'imported',
          model: '',
          generationMode: '',
          requestId: '',
          executionId: '',
          status: 'imported',
          skillName: '',
        },
      } satisfies Partial<MediaImageShape>,
      {
        id: boxId,
        type: 'geo',
        x: 320,
        y: 168,
        props: {
          w: 96,
          h: 92,
          geo: 'rectangle',
          color: 'red',
          dash: 'draw',
          size: 'm',
          fill: 'none',
        },
      },
      {
        id: noteId,
        type: 'note',
        x: 462,
        y: 164,
        props: {
          color: 'yellow',
          size: 'm',
          richText: toRichText('Make this area cleaner and more premium.'),
        },
      },
    ])
    editor.select(frameId)
    editor.zoomToSelection()
  })
}

function toCanvasShapeRecords(shapes: TLShape[]): CanvasShapeRecord[] {
  return shapes.map((shape) => ({
    id: shape.id,
    type: shape.type as CanvasShapeRecord['type'],
    x: shape.x,
    y: shape.y,
    parentId: shape.parentId,
    props: normalizeProps(shape),
  }))
}

async function extractMaterializedFrameContext(editor: Editor, shapes: CanvasShapeRecord[], frameId: string): Promise<FrameContext> {
  const context = extractFrameContext(shapes, frameId)
  const materializedAssets = await materializeFrameMedia(editor, context)

  if (materializedAssets.size === 0) return context

  const media = context.media.map((item) => ({
    ...item,
    localPath: materializedAssets.get(item.assetId)?.localPath ?? item.localPath,
    absolutePath: materializedAssets.get(item.assetId)?.absolutePath ?? item.absolutePath,
  }))

  return {
    ...context,
    anchorMedia: context.anchorMedia
      ? {
          ...context.anchorMedia,
          localPath: materializedAssets.get(context.anchorMedia.assetId)?.localPath ?? context.anchorMedia.localPath,
          absolutePath: materializedAssets.get(context.anchorMedia.assetId)?.absolutePath ?? context.anchorMedia.absolutePath,
        }
      : undefined,
    media,
  }
}

async function materializeFrameMedia(editor: Editor, context: FrameContext) {
  const materializedAssets = new Map<string, { localPath: string; absolutePath: string }>()

  for (const media of context.media) {
    const asset = editor.getAsset(media.assetId as TLAsset['id']) as TLAsset | undefined
    const assetMeta = asset?.meta as Record<string, unknown> | undefined
    const assetLocalPath = typeof assetMeta?.localPath === 'string' ? assetMeta.localPath : undefined
    const assetAbsolutePath = typeof assetMeta?.absolutePath === 'string' ? assetMeta.absolutePath : undefined
    if (assetLocalPath && assetAbsolutePath) {
      materializedAssets.set(media.assetId, {
        localPath: assetLocalPath,
        absolutePath: assetAbsolutePath,
      })
      continue
    }

    const props = asset?.props as Record<string, unknown> | undefined
    const shape = editor.getShape(media.shapeId as TLShapeId)
    const shapeProps = shape?.props as Record<string, unknown> | undefined
    const src = typeof props?.src === 'string' ? props.src : typeof shapeProps?.src === 'string' ? shapeProps.src : undefined
    if (!src) continue

    try {
      const dataUrl = await sourceToDataUrl(src)
      const materialized = await materializeAsset({
        shapeId: media.shapeId,
        assetId: media.assetId,
        name: typeof props?.name === 'string' ? props.name : typeof shapeProps?.title === 'string' ? shapeProps.title : media.shapeId,
        mimeType: typeof props?.mimeType === 'string' ? props.mimeType : undefined,
        src: dataUrl,
      })
      materializedAssets.set(media.assetId, {
        localPath: materialized.localPath,
        absolutePath: materialized.absolutePath,
      })
    } catch (error) {
      await recordOperation({
        type: 'asset.materialize_failed',
        shapeId: media.shapeId,
        assetId: media.assetId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return materializedAssets
}

function createLocalAssetStore(onProgress: (progress: UploadProgressState) => void, onStatus: (status: string) => void): TLAssetStore {
  return {
    async upload(asset, file, abortSignal) {
      const shouldShowProgress = file.size > CHUNKED_UPLOAD_THRESHOLD_BYTES
      try {
        if (shouldShowProgress) {
          onProgress(createUploadProgress(file, 0, 'uploading'))
          const result = await uploadAssetInChunks(asset.id, file, onProgress, abortSignal)
          onProgress(createUploadProgress(file, file.size, 'completed'))
          window.setTimeout(() => onProgress(null), 1800)
          onStatus(`Uploaded ${file.name || 'media asset'}`)
          return result
        }

        const payload = await uploadAssetDirect(asset.id, file, abortSignal)
        onStatus(`Uploaded ${file.name || 'media asset'}`)
        return {
          src: payload.asset.src,
          meta: {
            src: payload.asset.src,
            localPath: payload.asset.localPath,
            absolutePath: payload.asset.absolutePath,
            bytes: payload.asset.bytes,
            mimeType: payload.asset.mimeType,
          },
        }
      } catch (error) {
        onProgress(null)
        if (isAbortError(error) || abortSignal?.aborted) {
          onStatus('Upload canceled.')
        } else {
          onStatus(`Upload failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        throw error
      }
    },
    resolve(asset) {
      const meta = asset.meta as { src?: string } | undefined
      return asset.props.src ?? meta?.src ?? null
    },
  }
}

async function uploadAssetDirect(assetId: string, file: File, abortSignal?: AbortSignal) {
  return fetchAssetUploadJson(
    '/api/assets/upload',
    {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-asset-id': assetId,
        'x-file-name': encodeURIComponent(file.name || assetId),
      },
      body: file,
      signal: abortSignal,
    },
    1,
  )
}

async function fetchAssetUploadJson(url: string, init: RequestInit, retries: number) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init)
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Upload request failed with ${response.status}`)
      return payload
    } catch (error) {
      lastError = error
      if (isAbortError(error) || attempt >= retries) break
      await wait(250)
    }
  }
  throw lastError
}

function isAbortError(error: unknown) {
  return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function uploadAssetInChunks(
  assetId: string,
  file: File,
  onProgress: (progress: UploadProgressState) => void,
  abortSignal?: AbortSignal,
) {
  const startResponse = await fetch('/api/assets/uploads/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      assetId,
      name: file.name || assetId,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      chunkSize: UPLOAD_CHUNK_SIZE_BYTES,
    }),
    signal: abortSignal,
  })
  const startPayload = await startResponse.json()
  if (!startResponse.ok || !startPayload.ok) throw new Error(startPayload.error ?? 'Chunked upload start failed.')

  const uploadId = startPayload.upload.uploadId
  let chunkIndex = 0
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_SIZE_BYTES) {
    const chunk = file.slice(offset, offset + UPLOAD_CHUNK_SIZE_BYTES)
    const chunkResponse = await fetch('/api/assets/uploads/chunk', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-upload-id': uploadId,
        'x-chunk-index': String(chunkIndex),
      },
      body: chunk,
      signal: abortSignal,
    })
    const chunkPayload = await chunkResponse.json()
    if (!chunkResponse.ok || !chunkPayload.ok) throw new Error(chunkPayload.error ?? `Chunk ${chunkIndex} upload failed.`)
    chunkIndex += 1
    onProgress(createUploadProgress(file, Math.min(file.size, offset + chunk.size), 'uploading'))
  }

  const completeResponse = await fetch('/api/assets/uploads/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId }),
    signal: abortSignal,
  })
  const completePayload = await completeResponse.json()
  if (!completeResponse.ok || !completePayload.ok) throw new Error(completePayload.error ?? 'Chunked upload complete failed.')

  return {
    src: completePayload.asset.src,
    meta: {
      src: completePayload.asset.src,
      localPath: completePayload.asset.localPath,
      absolutePath: completePayload.asset.absolutePath,
      bytes: completePayload.asset.bytes,
      mimeType: completePayload.asset.mimeType,
      uploadId,
      chunkCount: completePayload.asset.chunkCount,
    },
  }
}

function createUploadProgress(file: File, loaded: number, status: NonNullable<UploadProgressState>['status']): NonNullable<UploadProgressState> {
  const total = Math.max(1, file.size)
  return {
    fileName: file.name || 'media asset',
    loaded,
    total,
    percent: Math.min(100, Math.round((loaded / total) * 100)),
    status,
  }
}

async function sourceToDataUrl(src: string) {
  if (src.startsWith('data:')) return src

  const response = await fetch(src)
  const blob = await response.blob()
  return await blobToDataUrl(blob)
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read asset blob.'))
    reader.readAsDataURL(blob)
  })
}

function normalizeProps(shape: TLShape): Record<string, unknown> {
  const props = { ...shape.props } as Record<string, unknown>
  if (shape.type === 'frame') {
    const shapeWithName = shape as TLShape & { props: { name?: string; w?: number; h?: number } }
    props.name = shapeWithName.props.name
    props.w = shapeWithName.props.w
    props.h = shapeWithName.props.h
  }
  if ((shape.type === 'note' || shape.type === 'text' || shape.type === 'geo' || shape.type === 'arrow') && typeof props.richText === 'object') {
    const plainText = richTextToPlainText(props.richText)
    if (plainText) {
      props.text = plainText
      props.plainText = plainText
    }
  }
  if (shape.type === 'note') {
    props.w = typeof props.w === 'number' ? props.w : 160
    props.h = typeof props.h === 'number' ? props.h : 160
  }
  return props
}

function sourceImageSvg() {
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#0f172a"/>
          <stop offset="1" stop-color="#334155"/>
        </linearGradient>
      </defs>
      <rect width="720" height="480" rx="34" fill="url(#bg)"/>
      <circle cx="204" cy="242" r="118" fill="#93c5fd" opacity=".28"/>
      <rect x="254" y="128" width="192" height="248" rx="42" fill="#f8fafc"/>
      <rect x="286" y="166" width="128" height="172" rx="30" fill="#1d4ed8"/>
      <circle cx="530" cy="144" r="44" fill="#f97316"/>
      <text x="70" y="74" fill="#e2e8f0" font-family="Inter,Arial" font-size="34" font-weight="700">Source product</text>
      <text x="70" y="420" fill="#cbd5e1" font-family="Inter,Arial" font-size="24">Frame + annotations should scope the task</text>
    </svg>
  `)
}

function generatingPlaceholderSvg(provider: string, mediaType: OutputMediaType) {
  void provider
  const outputLabel = mediaType === 'video' ? 'Rendering motion' : 'Composing image'
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">
      <defs>
        <linearGradient id="shimmer" x1="-1" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#f1f5f9"/>
          <stop offset="0.45" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#e5e7eb"/>
          <animate attributeName="x1" values="-1;1" dur="1.35s" repeatCount="indefinite"/>
          <animate attributeName="x2" values="0;2" dur="1.35s" repeatCount="indefinite"/>
        </linearGradient>
      </defs>
      <rect width="720" height="480" rx="28" fill="#ffffff"/>
      <rect x="1" y="1" width="718" height="478" rx="27" fill="none" stroke="#e5e7eb" stroke-width="2"/>
      <rect x="76" y="72" width="568" height="274" rx="26" fill="url(#shimmer)"/>
      <rect x="92" y="366" width="292" height="24" rx="12" fill="#eef2f7"/>
      <rect x="92" y="406" width="190" height="18" rx="9" fill="#f3f4f6"/>
      <circle cx="612" cy="410" r="20" fill="#eef2ff"/>
      <path d="M607 409.5h10m-5-5v10" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
      <text x="92" y="320" fill="#64748b" font-family="Inter,Arial" font-size="18" font-weight="600">${outputLabel}…</text>
    </svg>
  `)
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`
}

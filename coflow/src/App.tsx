import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AssetRecordType,
  DefaultColorStyle,
  StateNode,
  Tldraw,
  createShapeId,
  startEditingShapeWithRichText,
  toRichText,
  useEditor,
  type Editor,
  type TLAsset,
  type TLAssetId,
  type TLAssetStore,
  type TLComponents,
  type TLArrowShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { buildBoundedFrameContextPromptPart } from './agentPromptParts'
import {
  createVersionPlacement,
  extractFrameContext,
  getAnnotationStyle,
  getShapeBounds,
  richTextToPlainText,
  type Bounds,
  type CanvasAssetContext,
  type CanvasItem,
  type CanvasItemKind,
  type CanvasSelectionSnapshot,
  type CanvasShapeRecord,
  type FrameContext,
} from './canvasContracts'
import { MEDIA_IMAGE_SHAPE, MediaImageShapeUtil } from './mediaShape'
import {
  fetchPendingCommands,
  fetchPendingSelectionCaptureRequests,
  loadCanvasDocument,
  materializeAsset,
  publishCodexFrameRequest,
  publishFrameContext,
  publishSelectionSnapshot,
  recordOperation,
  respondToSelectionCaptureRequest,
  saveCanvasDocument,
  saveFrameScreenshot,
  type CanvasCommand,
  type CodexFrameRequest,
  type FrameScreenshot,
} from './api'

const shapeUtils = [MediaImageShapeUtil]
const MAX_ASSET_SIZE_BYTES = 2 * 1024 * 1024 * 1024
const CHUNKED_UPLOAD_THRESHOLD_BYTES = 32 * 1024 * 1024
const UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024
const CANVAS_CLIENT_VERSION = '2026-06-27-native-media-writeback-v1'
const DEFAULT_ARROW_BEND = 20
const FLOATING_ARROW_META_KEY = 'codexFloatingArrow'
const FLOATING_ARROW_MIN_LENGTH = 8
const FLOATING_ARROW_BEND_RATIO = 0.12
const FLOATING_ARROW_MIN_BEND = 12
const FLOATING_ARROW_MAX_BEND = 32
const FLOATING_ARROW_DEFAULT_COLOR = 'red'
const FLOATING_ARROW_LABEL_POSITION = 0
const SELECTION_HEARTBEAT_MS = 1800

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
  shapeId: TLShapeId
  title: string
  mediaType: 'image' | 'video'
  triggerLeft: number
  triggerTop: number
  panelLeft: number
  panelTop: number
  showTrigger: boolean
  previewSrc?: string
  prompt?: string
  provider?: string
  model?: string
  skillName?: string
  absolutePath?: string
  size?: string
  resolution?: string
  quality?: string
  references?: MediaReferenceInfo[]
} | null

type MediaReferenceInfo = {
  mediaType: 'image' | 'video'
  src: string
  shapeId?: string
  assetId?: string
  title?: string
  localPath?: string
  absolutePath?: string
}

function getFloatingOverlaySnapshot(frameAction: FrameActionState, selectedMediaInfo: SelectedMediaInfo) {
  return JSON.stringify({ frameAction, selectedMediaInfo })
}

type FrameScreenshotResult = {
  clipboardCopied: boolean
  screenshot?: FrameScreenshot
  error?: string
}

class FloatingArrowTool extends StateNode {
  static id = 'arrow'
  static initial = 'idle'

  static children() {
    return [FloatingArrowIdle, FloatingArrowPointing]
  }
}

class FloatingArrowIdle extends StateNode {
  static id = 'idle'

  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  onPointerDown(info: unknown) {
    this.parent.transition('pointing', info)
  }

  onCancel() {
    this.editor.setCurrentTool('select')
  }
}

class FloatingArrowPointing extends StateNode {
  static id = 'pointing'

  private arrowId: TLShapeId | null = null
  private markId = ''
  private origin: { x: number; y: number } | null = null

  onEnter() {
    const origin = this.editor.inputs.getOriginPagePoint()
    const arrowId = createShapeId()
    const color = getAnnotationArrowColor(this.editor)
    this.arrowId = arrowId
    this.origin = { x: origin.x, y: origin.y }
    this.markId = this.editor.markHistoryStoppingPoint(`creating_floating_arrow:${arrowId}`)

    this.editor.createShape({
      id: arrowId,
      type: 'arrow',
      parentId: this.editor.getCurrentPageId(),
      x: origin.x,
      y: origin.y,
      meta: {
        [FLOATING_ARROW_META_KEY]: true,
      },
      props: {
        kind: 'arc',
        dash: 'draw',
        size: 'm',
        fill: 'none',
        color,
        labelColor: color,
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        richText: toRichText(''),
        labelPosition: FLOATING_ARROW_LABEL_POSITION,
        font: 'draw',
        scale: this.editor.getResizeScaleFactor(),
      },
    })
  }

  onPointerMove() {
    this.updateArrowEnd()
  }

  onPointerUp() {
    this.complete()
  }

  onCancel() {
    this.cancel()
  }

  onInterrupt() {
    this.cancel()
  }

  private updateArrowEnd() {
    if (!this.arrowId || !this.origin) return

    const point = this.editor.inputs.getCurrentPagePoint()
    this.editor.updateShapes([
      {
        id: this.arrowId,
        type: 'arrow',
        props: {
          end: {
            x: point.x - this.origin.x,
            y: point.y - this.origin.y,
          },
        },
      },
    ])
  }

  private complete() {
    if (!this.arrowId || !this.origin) {
      this.parent.transition('idle')
      return
    }

    this.updateArrowEnd()

    const point = this.editor.inputs.getCurrentPagePoint()
    const dx = point.x - this.origin.x
    const dy = point.y - this.origin.y
    const length = Math.hypot(dx, dy)

    if (length < FLOATING_ARROW_MIN_LENGTH / this.editor.getZoomLevel()) {
      this.editor.bailToMark(this.markId)
      this.parent.transition('idle')
      return
    }

    this.editor.updateShapes([
      {
        id: this.arrowId,
        type: 'arrow',
        props: {
          bend: getFloatingArrowBend(dx, dy, this.editor.getResizeScaleFactor()),
        },
      },
    ])
    startEditingAnnotationArrowLabel(this.editor, this.arrowId)
    this.parent.transition('idle')
  }

  private cancel() {
    if (this.arrowId) this.editor.bailToMark(this.markId)
    this.parent.transition('idle')
  }
}

function getAnnotationArrowColor(editor: Editor) {
  const color = editor.getStyleForNextShape(DefaultColorStyle)
  return color === DefaultColorStyle.defaultValue ? FLOATING_ARROW_DEFAULT_COLOR : color
}

function startEditingAnnotationArrowLabel(editor: Editor, arrowId: TLShapeId) {
  const shape = editor.getShape(arrowId)
  if (!shape || !editor.canEditShape(shape)) {
    editor.select(arrowId)
    return
  }

  editor.select(arrowId)
  startEditingShapeWithRichText(editor, arrowId, { selectAll: true })
  pinAnnotationArrowLabelPosition(editor, arrowId)
}

function pinAnnotationArrowLabelPosition(editor: Editor, arrowId: TLShapeId, attempt = 0) {
  editor.timers.setTimeout(() => {
    const shape = editor.getShape(arrowId)
    if (!shape || shape.type !== 'arrow' || shape.meta?.[FLOATING_ARROW_META_KEY] !== true) return
    if ((shape.props as { labelPosition?: number }).labelPosition !== FLOATING_ARROW_LABEL_POSITION) {
      editor.updateShapes([
        {
          id: arrowId,
          type: 'arrow',
          props: {
            labelPosition: FLOATING_ARROW_LABEL_POSITION,
          },
        },
      ])
    }

    if (attempt < 2 && editor.getEditingShapeId() === arrowId) {
      pinAnnotationArrowLabelPosition(editor, arrowId, attempt + 1)
    }
  }, 16)
}

function getFloatingArrowBend(dx: number, dy: number, scale: number) {
  const length = Math.hypot(dx, dy)
  if (length === 0) return 0

  const bend = Math.min(
    Math.max(length * FLOATING_ARROW_BEND_RATIO, FLOATING_ARROW_MIN_BEND * scale),
    FLOATING_ARROW_MAX_BEND * scale
  )

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? -bend : bend
  }

  return bend
}

export default function App() {
  const editorRef = useRef<Editor | null>(null)
  const frameActionRafRef = useRef<number | null>(null)
  const floatingOverlayRafRef = useRef<number | null>(null)
  const lastFloatingOverlaySnapshotRef = useRef('')
  const statusTimeoutRef = useRef<number | null>(null)
  const selectionPublishTimeoutRef = useRef<number | null>(null)
  const canvasSaveTimeoutRef = useRef<number | null>(null)
  const isRestoringCanvasRef = useRef(false)
  const restoredShapeIdsRef = useRef<Set<string>>(new Set())
  const lastPublishedSelectionRef = useRef('')
  const [status, setStatus] = useState('')
  const [frameAction, setFrameAction] = useState<FrameActionState>(null)
  const [selectedMediaInfo, setSelectedMediaInfo] = useState<SelectedMediaInfo>(null)
  const [mediaInfoOpen, setMediaInfoOpen] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>(null)

  function showStatus(message: string, durationMs = 3200) {
    const appWindow = editorRef.current?.getContainer().ownerDocument.defaultView ?? window
    if (statusTimeoutRef.current !== null) appWindow.clearTimeout(statusTimeoutRef.current)
    setStatus(message)
    if (durationMs > 0) {
      statusTimeoutRef.current = appWindow.setTimeout(() => {
        statusTimeoutRef.current = null
        setStatus('')
      }, durationMs)
    }
  }

  const assetStore = useMemo(() => createLocalAssetStore(setUploadProgress, showStatus), [])
  const tldrawComponents = useMemo<TLComponents>(() => {
    function CodexInFrontOfTheCanvas() {
      return (
        <CanvasFloatingOverlays
          selectedMediaInfo={selectedMediaInfo}
          mediaInfoOpen={mediaInfoOpen}
          frameAction={frameAction}
          onMediaInfoToggle={() => setMediaInfoOpen((value) => !value)}
          onMediaInfoClose={() => setMediaInfoOpen(false)}
          onSend={sendFrameToCodex}
        />
      )
    }

    return {
      InFrontOfTheCanvas: CodexInFrontOfTheCanvas,
    }
  }, [frameAction, mediaInfoOpen, selectedMediaInfo])

  function syncFloatingOverlayState(editor: Editor) {
    const nextFrameAction = getSelectedFrameAction(editor)
    const nextSelectedMediaInfo = getSelectedMediaInfo(editor)
    const nextSnapshot = getFloatingOverlaySnapshot(nextFrameAction, nextSelectedMediaInfo)
    if (nextSnapshot === lastFloatingOverlaySnapshotRef.current) return

    lastFloatingOverlaySnapshotRef.current = nextSnapshot
    setFrameAction(nextFrameAction)
    setSelectedMediaInfo(nextSelectedMediaInfo)
  }

  useEffect(() => {
    setMediaInfoOpen(false)
  }, [selectedMediaInfo?.shapeId])

  useEffect(() => {
    setMediaInfoOpen(false)
  }, [selectedMediaInfo?.shapeId])

  useEffect(() => {
    let stopped = false

    async function pollWritebackCommands() {
      if (stopped) return

      try {
        const commands = await fetchPendingCommands('canvas.create_version', CANVAS_CLIENT_VERSION)
        for (const command of commands) {
          if (command.type === 'canvas.create_version') {
            await placeWritebackCommand(command, () => placeVersionFromCommand(command))
          }
        }
        const linkCommands = await fetchPendingCommands('canvas.link_versions', CANVAS_CLIENT_VERSION)
        for (const command of linkCommands) {
          if (command.type === 'canvas.link_versions') {
            await placeWritebackCommand(command, () => placeVersionLinkFromCommand(command))
          }
        }
      } catch {
        // The local backend may still be starting; keep the canvas usable.
      }
    }

    async function pollFreshSelectionCaptureRequests() {
      if (stopped) return
      const editor = editorRef.current
      if (!editor) return

      try {
        const requests = await fetchPendingSelectionCaptureRequests()
        for (const request of requests) {
          const selection = await buildSelectionSnapshot(editor)
          await respondToSelectionCaptureRequest({ requestId: request.id, selection })
          lastPublishedSelectionRef.current = getSelectionPublicationKey(selection)
        }
      } catch (error) {
        await recordOperation({
          type: 'selection.fresh_capture_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const interval = window.setInterval(() => {
      void pollWritebackCommands()
    }, 1000)
    const freshSelectionInterval = window.setInterval(() => {
      void pollFreshSelectionCaptureRequests()
    }, 500)
    const selectionHeartbeatInterval = window.setInterval(() => {
      const editor = editorRef.current
      if (editor) void publishCurrentSelection(editor)
    }, SELECTION_HEARTBEAT_MS)
    void pollWritebackCommands()
    void pollFreshSelectionCaptureRequests()

    return () => {
      stopped = true
      window.clearInterval(interval)
      window.clearInterval(freshSelectionInterval)
      window.clearInterval(selectionHeartbeatInterval)
      if (statusTimeoutRef.current !== null) window.clearTimeout(statusTimeoutRef.current)
      if (selectionPublishTimeoutRef.current !== null) window.clearTimeout(selectionPublishTimeoutRef.current)
      if (canvasSaveTimeoutRef.current !== null) window.clearTimeout(canvasSaveTimeoutRef.current)
      if (floatingOverlayRafRef.current !== null) window.cancelAnimationFrame(floatingOverlayRafRef.current)
    }
  }, [])

  function onMount(editor: Editor) {
    editorRef.current = editor
    const disposeDefaultArrow = editor.store.sideEffects.registerBeforeCreateHandler('shape', (shape) => {
      if (shape.type !== 'arrow') return shape
      if (shape.meta?.[FLOATING_ARROW_META_KEY] === true) return shape
      const props = shape.props as unknown as { bend?: number }
      if (typeof props.bend === 'number' && props.bend !== 0) return shape
      return {
        ...shape,
        props: {
          ...shape.props,
          kind: 'arc',
          bend: DEFAULT_ARROW_BEND,
        },
      }
    })
    editor.disposables.add(disposeDefaultArrow)
    void restoreCanvasDocument(editor)
    syncFloatingOverlayState(editor)
    const overlayWindow = editor.getContainer().ownerDocument.defaultView ?? window
    if (floatingOverlayRafRef.current !== null) overlayWindow.cancelAnimationFrame(floatingOverlayRafRef.current)
    const syncOverlaysOnFrame = () => {
      syncFloatingOverlayState(editor)
      floatingOverlayRafRef.current = overlayWindow.requestAnimationFrame(syncOverlaysOnFrame)
    }
    floatingOverlayRafRef.current = overlayWindow.requestAnimationFrame(syncOverlaysOnFrame)
    const unsubscribe = editor.store.listen(({ changes }) => {
      const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
      if (frameActionRafRef.current !== null) appWindow.cancelAnimationFrame(frameActionRafRef.current)
      frameActionRafRef.current = appWindow.requestAnimationFrame(() => {
        frameActionRafRef.current = null
        syncFloatingOverlayState(editor)
      })
      scheduleSelectionPublish(editor)
      if (!isRestoringCanvasRef.current) {
        normalizeLegacyDefaultArrowBends(editor, Object.values(changes.added))
        syncAnnotationArrowStyles(editor, Object.values(changes.updated).map(([, next]) => next))
      }
      scheduleCanvasDocumentSave(editor)
    })
    editor.disposables.add(unsubscribe)
    void publishCurrentSelection(editor)
    setStatus('')
  }

  async function restoreCanvasDocument(editor: Editor) {
    isRestoringCanvasRef.current = true
    try {
      const document = await loadCanvasDocument()
      if (!document?.snapshot) return

      const restoredSnapshot = clearVolatileCanvasSnapshotState(document.snapshot)
      restoredShapeIdsRef.current = getSnapshotShapeIds(restoredSnapshot)
      editor.store.loadStoreSnapshot(restoredSnapshot as never)
      if (document.currentPageId) {
        try {
          editor.setCurrentPage(document.currentPageId as never)
        } catch {
          // If the saved page no longer exists after a schema migration, keep tldraw's default page.
        }
      }
      if (document.camera) editor.setCamera(document.camera, { immediate: true })
      normalizeLegacyDefaultArrowBends(editor)
      syncAnnotationArrowStyles(editor)
      await waitForRestoreSideEffects(editor)
      editor.selectNone()
      setFrameAction(getSelectedFrameAction(editor))
      setSelectedMediaInfo(getSelectedMediaInfo(editor))
      showStatus('Restored local canvas.', 1800)
      void publishCurrentSelection(editor)
    } catch (error) {
      await recordOperation({
        type: 'canvas.restore_failed',
        error: error instanceof Error ? error.message : String(error),
      })
      showStatus('Local canvas restore failed; opened a blank board.', 4200)
    } finally {
      isRestoringCanvasRef.current = false
    }
  }

  function waitForRestoreSideEffects(editor: Editor, frameCount = 3) {
    const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
    return new Promise<void>((resolve) => {
      let remaining = frameCount
      const tick = () => {
        remaining -= 1
        if (remaining <= 0) {
          resolve()
          return
        }
        appWindow.requestAnimationFrame(tick)
      }
      appWindow.requestAnimationFrame(tick)
    })
  }

  function scheduleCanvasDocumentSave(editor: Editor) {
    if (isRestoringCanvasRef.current) return
    const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
    if (canvasSaveTimeoutRef.current !== null) appWindow.clearTimeout(canvasSaveTimeoutRef.current)
    canvasSaveTimeoutRef.current = appWindow.setTimeout(() => {
      canvasSaveTimeoutRef.current = null
      void persistCanvasDocument(editor)
    }, 700)
  }

  async function persistCanvasDocument(editor: Editor) {
    try {
      await saveCanvasDocument({
        clientVersion: CANVAS_CLIENT_VERSION,
        currentPageId: editor.getCurrentPageId(),
        camera: editor.getCamera(),
        snapshot: clearVolatileCanvasSnapshotState(editor.store.getStoreSnapshot('all')),
      })
    } catch (error) {
      await recordOperation({
        type: 'canvas.save_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function scheduleSelectionPublish(editor: Editor) {
    const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
    if (selectionPublishTimeoutRef.current !== null) appWindow.clearTimeout(selectionPublishTimeoutRef.current)
    selectionPublishTimeoutRef.current = appWindow.setTimeout(() => {
      selectionPublishTimeoutRef.current = null
      void publishCurrentSelection(editor)
    }, 250)
  }

  async function publishCurrentSelection(editor: Editor) {
    try {
      const selection = await buildSelectionSnapshot(editor)
      const serialized = getSelectionPublicationKey(selection)
      if (serialized === lastPublishedSelectionRef.current) return
      lastPublishedSelectionRef.current = serialized
      await publishSelectionSnapshot(selection)
    } catch (error) {
      await recordOperation({
        type: 'selection.publish_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function publishFrameForCodex(frameId: string): Promise<{ request: CodexFrameRequest; context: FrameContext; screenshotResult: FrameScreenshotResult } | null> {
    const editor = editorRef.current
    if (!editor) return null
    const shapes = toCanvasShapeRecords(editor, editor.getCurrentPageShapesSorted())
    const frame = shapes.find((shape) => shape.id === frameId && shape.type === 'frame') ?? findContextFrame(editor, shapes)
    if (!frame) {
      showStatus('No frame found. Select a frame around the media and annotations first.', 5200)
      return null
    }

    const context = await extractMaterializedFrameContext(editor, shapes, frame.id)
    if (!context.anchorMedia) {
      showStatus('Frame has no media anchor.', 5200)
      return null
    }

    const frameScreenshot = await copyAndSaveFrameScreenshot(editor, shapes, frame.id, context.frameName)

    await publishFrameContext(context)
    const promptPart = buildBoundedFrameContextPromptPart(context, 'canvas-frame-action')
    const request = await publishCodexFrameRequest({
      frameId: context.frameId,
      promptPart,
      status: 'awaiting_user_instruction',
      summary: {
        frameName: context.frameName,
        mediaCount: context.media.length,
        annotationCount: context.annotations.length,
        anchorMediaId: context.anchorMedia.shapeId,
        annotationTexts: context.annotations.map((annotation) => annotation.text).filter((text): text is string => Boolean(text)),
      },
      frameScreenshot: frameScreenshot.screenshot,
      defaultInstruction:
        'Treat this as a pending CoFlow canvas request. Summarize the selected frame context in the Codex conversation first, wait for the user to confirm or add instructions, then choose the right Skill/provider/model and call canvas.insert_media or canvas.create_version to place the result back on the board.',
      recommendedUserPrompt:
        'I have sent this frame to Codex. Please tell me what you want to create or edit from this frame, or say “generate a version from these annotations”.',
    })
    await recordOperation({
      type: 'codex.frame_context_sent',
      frameId: context.frameId,
      promptPart,
      skillName: 'coflow-context',
      promptSource: 'canvas-frame-action',
    })
    return { request, context, screenshotResult: frameScreenshot }
  }

  async function sendFrameToCodex(frameId: string) {
    const published = await publishFrameForCodex(frameId)
    if (!published) return

    showStatus(
      published.screenshotResult.clipboardCopied
        ? 'Sent frame to Codex. Screenshot copied — paste it into the Codex chat.'
        : 'Sent frame to Codex. Screenshot copy was blocked, but Codex can read the Frame Input.',
      6200,
    )
  }

  async function copyAndSaveFrameScreenshot(
    editor: Editor,
    shapes: CanvasShapeRecord[],
    frameId: string,
    frameName: string,
  ): Promise<FrameScreenshotResult> {
    const exportShapeIds = getFrameExportShapeIds(shapes, frameId)
    const blobPromise = editor
      .toImage(exportShapeIds, {
        format: 'png',
        background: true,
        padding: 24,
        scale: 2,
      })
      .then(({ blob }) => (blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' })))

    const clipboardPromise = writePngBlobPromiseToClipboard(editor, blobPromise)
    const savePromise = blobPromise.then((blob) =>
      saveFrameScreenshot({
        frameId,
        frameName,
        includedShapeIds: exportShapeIds,
        blob,
      }),
    )
    const [clipboardResult, saveResult] = await Promise.allSettled([clipboardPromise, savePromise])
    const clipboardCopied = clipboardResult.status === 'fulfilled'
    const screenshot = saveResult.status === 'fulfilled' ? saveResult.value : undefined
    const error =
      clipboardResult.status === 'rejected'
        ? clipboardResult.reason instanceof Error
          ? clipboardResult.reason.message
          : String(clipboardResult.reason)
        : saveResult.status === 'rejected'
          ? saveResult.reason instanceof Error
            ? saveResult.reason.message
            : String(saveResult.reason)
          : undefined

    if (!clipboardCopied || !screenshot) {
      await recordOperation({
        type: 'codex.frame_screenshot.partial_failure',
        frameId,
        exportShapeIds,
        clipboardCopied,
        screenshotSaved: Boolean(screenshot),
        error,
      })
    }

    return { clipboardCopied, screenshot, error }
  }

  async function placeWritebackCommand(command: CanvasCommand, placeCommand: () => Promise<void>) {
    try {
      await placeCommand()
    } catch (error) {
      await recordOperation({
        type: 'codex.command_failed',
        command,
        error: errorToOperationRecord(error),
      }).catch(() => undefined)
      showStatus('Codex writeback failed before it could update the canvas. Check operations log for details.', 6400)
    }
  }

  async function placeVersionFromCommand(command: CanvasCommand) {
    const editor = editorRef.current
    if (!editor) return

    const shapes = toCanvasShapeRecords(editor, editor.getCurrentPageShapesSorted())
    const src = command.src ?? srcFromLocalPath(command.localPath)
    if (!src) {
      await recordOperation({
        type: 'codex.version_place_failed',
        reason: 'missing_browser_readable_src',
        command,
      })
      showStatus('Codex writeback skipped: command has no src or localPath.', 5200)
      return
    }

    if (!commandHasReferenceInput(command)) {
      await placeStandaloneMediaFromCommand(command, shapes, src)
      return
    }

    const sourceShape = command.sourceShapeId ? editor.getShape(command.sourceShapeId as TLShapeId) : undefined
    const frame = command.frameId ? shapes.find((shape) => shape.id === command.frameId && shape.type === 'frame') : findContextFrame(editor, shapes)
    const context = !sourceShape && frame ? await extractMaterializedFrameContext(editor, shapes, frame.id) : undefined
    const frameAnchor = context?.anchorMedia
    const anchor = sourceShape
      ? {
          shapeId: sourceShape.id,
          bounds: getShapePageBoundsRecord(editor, sourceShape),
        }
      : frameAnchor

    if (!anchor) {
      await recordOperation({
        type: 'codex.version_place_failed',
        reason: 'source_anchor_not_found',
        command,
      })
      showStatus('Codex writeback skipped: target source shape or frame media anchor not found.', 5200)
      return
    }

    const childId = createShapeId()
    const arrowId = createShapeId()
    const outputSize = getGeneratedMediaOutputSize(command, anchor.bounds)
    const placement = createVersionPlacement(anchor.bounds, outputSize, getVersionPlacementOccupiedBounds(shapes, anchor.shapeId, command.frameId))
    const parentShapeId = anchor.shapeId as TLShapeId
    const versionId = `version:codex-${Date.now()}`
    const arrowStart = placement.lineageArrow.start
    const arrowEnd = placement.lineageArrow.end
    const writebackCompletedAt = new Date().toISOString()
    const e2eDurationMs = getDurationMs(command.e2eStartedAt, writebackCompletedAt)
    const commandWithWritebackTiming: CanvasCommand = {
      ...command,
      writebackCompletedAt,
      e2eCompletedAt: writebackCompletedAt,
      e2eDurationMs,
    }

    const generated = createNativeGeneratedMediaRecords({
      command: commandWithWritebackTiming,
      childId,
      parentId: editor.getCurrentPageId(),
      bounds: placement.childBounds,
      src,
      versionId,
    })

    editor.run(() => {
      editor.createAssets([generated.asset])
      editor.createShapes([
        generated.shape,
        {
          id: arrowId,
          type: 'arrow',
          x: arrowStart.x,
          y: arrowStart.y,
          props: {
            kind: 'arc',
            start: { x: 0, y: 0 },
            end: { x: arrowEnd.x - arrowStart.x, y: arrowEnd.y - arrowStart.y },
            bend: DEFAULT_ARROW_BEND,
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
          type: 'arrow',
          fromId: arrowId,
          toId: parentShapeId,
          props: {
            terminal: 'start',
            normalizedAnchor: placement.lineageArrow.startAnchor,
            isExact: false,
            isPrecise: true,
          },
        },
        {
          type: 'arrow',
          fromId: arrowId,
          toId: childId,
          props: {
            terminal: 'end',
            normalizedAnchor: placement.lineageArrow.endAnchor,
            isExact: false,
            isPrecise: true,
          },
        },
      ])
      editor.select(childId)
    })

    const createdChild = editor.getShape(childId)
    const createdArrow = editor.getShape(arrowId)
    const createdAsset = editor.getAsset(generated.asset.id)
    if (!createdChild || !createdArrow || !createdAsset) {
      await recordOperation({
        type: 'codex.version_place_failed',
        reason: 'native_records_missing_after_create',
        parentShapeId,
        childShapeId: childId,
        arrowShapeId: arrowId,
        assetId: generated.asset.id,
        hasChild: Boolean(createdChild),
        hasArrow: Boolean(createdArrow),
        hasAsset: Boolean(createdAsset),
        command: commandWithWritebackTiming,
      })
      showStatus('Codex writeback failed: generated native media records were not created.', 6400)
      return
    }

    await recordOperation({
      type: 'codex.version_placed',
      frameId: context?.frameId ?? command.frameId,
      parentShapeId,
      childShapeId: childId,
      arrowShapeId: arrowId,
      command: commandWithWritebackTiming,
    })
    await waitForRestoreSideEffects(editor, 2)
    await persistCanvasDocument(editor)
    await publishCurrentSelection(editor)
    setSelectedMediaInfo(getSelectedMediaInfo(editor))
    showStatus('Placed Codex generated version on canvas.', 3200)
  }

  async function placeStandaloneMediaFromCommand(command: CanvasCommand, shapes: CanvasShapeRecord[], src: string) {
    const editor = editorRef.current
    if (!editor) return

    const childId = createShapeId()
    const outputSize = getStandaloneGeneratedMediaOutputSize(command)
    const bounds = getStandaloneMediaPlacementBounds(editor, shapes, command, outputSize)
    const versionId = `media:codex-${Date.now()}`
    const writebackCompletedAt = new Date().toISOString()
    const e2eDurationMs = getDurationMs(command.e2eStartedAt, writebackCompletedAt)
    const commandWithWritebackTiming: CanvasCommand = {
      ...command,
      writebackCompletedAt,
      e2eCompletedAt: writebackCompletedAt,
      e2eDurationMs,
    }

    const generated = createNativeGeneratedMediaRecords({
      command: commandWithWritebackTiming,
      childId,
      parentId: editor.getCurrentPageId(),
      bounds,
      src,
      versionId,
    })

    editor.run(() => {
      editor.createAssets([generated.asset])
      editor.createShapes([generated.shape])
      editor.select(childId)
    })

    const createdChild = editor.getShape(childId)
    const createdAsset = editor.getAsset(generated.asset.id)
    if (!createdChild || !createdAsset) {
      await recordOperation({
        type: 'codex.media_place_failed',
        reason: 'native_records_missing_after_create',
        childShapeId: childId,
        assetId: generated.asset.id,
        hasChild: Boolean(createdChild),
        hasAsset: Boolean(createdAsset),
        command: commandWithWritebackTiming,
      })
      showStatus('Codex writeback failed: generated native media record was not created.', 6400)
      return
    }

    await recordOperation({
      type: 'codex.media_placed',
      childShapeId: childId,
      command: commandWithWritebackTiming,
    })
    await waitForRestoreSideEffects(editor, 2)
    await persistCanvasDocument(editor)
    await publishCurrentSelection(editor)
    setSelectedMediaInfo(getSelectedMediaInfo(editor))
    showStatus('Placed Codex generated media on canvas.', 3200)
  }

  async function placeVersionLinkFromCommand(command: CanvasCommand) {
    const editor = editorRef.current
    if (!editor) return
    if (!command.sourceShapeId || !command.targetShapeId) {
      showStatus('Codex link skipped: sourceShapeId and targetShapeId are required.', 5200)
      return
    }

    const source = editor.getShape(command.sourceShapeId as TLShapeId)
    const target = editor.getShape(command.targetShapeId as TLShapeId)
    if (!source || !target) {
      showStatus('Codex link skipped: source or target shape not found.', 5200)
      return
    }

    const sourceBounds = getShapePageBoundsRecord(editor, source)
    const targetBounds = getShapePageBoundsRecord(editor, target)
    const sourceCenter = getBoundsCenter(sourceBounds)
    const targetCenter = getBoundsCenter(targetBounds)
    const sourceIsLeft = sourceCenter.x <= targetCenter.x
    const arrowStart = {
      x: sourceIsLeft ? sourceBounds.x + sourceBounds.w + 16 : sourceBounds.x - 16,
      y: sourceCenter.y,
    }
    const arrowEnd = {
      x: sourceIsLeft ? targetBounds.x - 16 : targetBounds.x + targetBounds.w + 16,
      y: targetCenter.y,
    }
    const arrowId = createShapeId()

    editor.run(() => {
      editor.createShapes([
        {
          id: arrowId,
          type: 'arrow',
          x: arrowStart.x,
          y: arrowStart.y,
          props: {
            kind: 'arc',
            start: { x: 0, y: 0 },
            end: { x: arrowEnd.x - arrowStart.x, y: arrowEnd.y - arrowStart.y },
            bend: DEFAULT_ARROW_BEND,
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
          type: 'arrow',
          fromId: arrowId,
          toId: source.id,
          props: {
            terminal: 'start',
            normalizedAnchor: { x: sourceIsLeft ? 1 : 0, y: 0.5 },
            isExact: false,
            isPrecise: true,
          },
        },
        {
          type: 'arrow',
          fromId: arrowId,
          toId: target.id,
          props: {
            terminal: 'end',
            normalizedAnchor: { x: sourceIsLeft ? 0 : 1, y: 0.5 },
            isExact: false,
            isPrecise: true,
          },
        },
      ])
    })

    await recordOperation({
      type: 'codex.version_linked',
      sourceShapeId: command.sourceShapeId,
      targetShapeId: command.targetShapeId,
      arrowShapeId: arrowId,
      linkType: command.linkType ?? 'version',
      command,
    })
    showStatus('Linked canvas versions.', 2400)
  }

  return (
    <div className="app">
      <div className="canvas">
        <Tldraw
          components={tldrawComponents}
          shapeUtils={shapeUtils}
          tools={[FloatingArrowTool]}
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
      {uploadProgress ? <UploadProgress progress={uploadProgress} /> : null}
    </div>
  )
}

function CanvasFloatingOverlays({
  selectedMediaInfo,
  mediaInfoOpen,
  frameAction,
  onMediaInfoToggle,
  onMediaInfoClose,
  onSend,
}: {
  selectedMediaInfo: SelectedMediaInfo
  mediaInfoOpen: boolean
  frameAction: FrameActionState
  onMediaInfoToggle: () => void
  onMediaInfoClose: () => void
  onSend: (frameId: string) => void
}) {
  const editor = useEditor()

  return (
    <>
      {selectedMediaInfo?.showTrigger ? (
        <MediaInfoOverlay
          editor={editor}
          info={selectedMediaInfo}
          isOpen={mediaInfoOpen}
          onToggle={onMediaInfoToggle}
          onClose={onMediaInfoClose}
        />
      ) : null}
      {frameAction ? (
        <FrameCodexAction
          action={frameAction}
          onSend={onSend}
        />
      ) : null}
    </>
  )
}

function MediaInfoOverlay({
  editor,
  info,
  isOpen,
  onToggle,
  onClose,
}: {
  editor: Editor | null
  info: NonNullable<SelectedMediaInfo>
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const isGeneratedAsset = Boolean(info.prompt || info.model || info.provider || info.skillName)
  const mediaLabel = info.mediaType === 'video' ? 'Video' : 'Image'
  const panelTitle = isGeneratedAsset ? `${mediaLabel} Generator` : `${mediaLabel} asset`
  const references = info.references ?? []
  const referenceLabel = getMediaReferenceLabel(references)
  const rows = [
    ['Model', info.model],
    ['Size', info.size],
    ['Resolution', info.resolution],
    ['Quality', info.quality],
    ['Provider', formatProviderLabel(info.provider)],
    ['Skill', info.skillName],
    ['Absolute path', info.absolutePath],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  useEffect(() => {
    if (!editor) return

    const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
    let rafId: number | null = null
    let lastPositionKey = ''

    const syncPosition = () => {
      const shape = editor.getShape(info.shapeId)
      if (!shape) {
        if (triggerRef.current) triggerRef.current.style.display = 'none'
        if (panelRef.current) panelRef.current.style.display = 'none'
        return
      }

      const position = getMediaInfoOverlayPosition(editor, shape)
      const positionKey = `${position.triggerLeft}:${position.triggerTop}:${position.panelLeft}:${position.panelTop}:${position.showTrigger}`
      if (positionKey !== lastPositionKey) {
        lastPositionKey = positionKey
        if (triggerRef.current) {
          triggerRef.current.style.display = position.showTrigger ? 'grid' : 'none'
          triggerRef.current.style.transform = `translate3d(${position.triggerLeft}px, ${position.triggerTop}px, 0)`
        }
        if (panelRef.current) {
          panelRef.current.style.display = isOpen && position.showTrigger ? 'block' : 'none'
          panelRef.current.style.transform = `translate3d(${position.panelLeft}px, ${position.panelTop}px, 0)`
        }
      }

      rafId = appWindow.requestAnimationFrame(syncPosition)
    }

    syncPosition()

    return () => {
      if (rafId !== null) appWindow.cancelAnimationFrame(rafId)
    }
  }, [editor, info.shapeId, isOpen])

  return (
    <div className="media-info-overlay">
      <button
        ref={triggerRef}
        type="button"
        className="media-info-trigger"
        style={{ transform: `translate3d(${info.triggerLeft}px, ${info.triggerTop}px, 0)` }}
        aria-expanded={isOpen}
        aria-label="Show media details"
        onPointerDownCapture={(event) => event.stopPropagation()}
        onMouseDownCapture={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onToggle()
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.15v4.15M8 4.7h.01" />
        </svg>
      </button>
      {isOpen ? (
        <aside
          ref={panelRef}
          className="media-info-panel"
          style={{ transform: `translate3d(${info.panelLeft}px, ${info.panelTop}px, 0)` }}
          aria-label="Selected media information"
        >
          <div className="media-info-panel__header">
            <span className={`media-info-panel__thumb media-info-panel__thumb--${info.mediaType}`} aria-hidden="true">
              {info.previewSrc ? (
                info.mediaType === 'video' ? (
                  <>
                    <video src={info.previewSrc} muted playsInline />
                    <span className="media-info-panel__play-badge" />
                  </>
                ) : (
                  <img src={info.previewSrc} alt="" />
                )
              ) : null}
            </span>
            <div>
              <div className="media-info-panel__title">{panelTitle}</div>
              <div className="media-info-panel__subtitle">Asset details</div>
            </div>
            <button
              type="button"
              className="media-info-panel__close"
              aria-label="Close media details"
              onPointerDownCapture={(event) => event.stopPropagation()}
              onMouseDownCapture={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onClose()
              }}
            >
              ×
            </button>
          </div>
          <div className="media-info-panel__rows">
            {info.prompt ? <MediaInfoRow label="Prompt" value={info.prompt} copyable /> : null}
            {references.length > 0 ? (
              <div className="media-info-panel__row">
                <span>{referenceLabel}</span>
                <div className="media-info-panel__reference-list">
                  {references.map((reference, index) => (
                    <MediaReferenceThumb
                      key={`${reference.src}:${reference.shapeId ?? reference.assetId ?? index}`}
                      reference={reference}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {rows.map(([label, value]) => (
              <MediaInfoRow key={label} label={label} value={value} copyable={label === 'Absolute path'} />
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  )
}

function MediaReferenceThumb({ reference }: { reference: MediaReferenceInfo }) {
  return (
    <div className={`media-info-panel__reference media-info-panel__reference--${reference.mediaType}`} title={reference.title ?? reference.absolutePath ?? reference.localPath}>
      {reference.mediaType === 'video' ? (
        <>
          <video src={reference.src} muted playsInline />
          <span className="media-info-panel__play-badge media-info-panel__play-badge--small" />
        </>
      ) : (
        <img src={reference.src} alt="" />
      )}
    </div>
  )
}

function getMediaReferenceLabel(references: MediaReferenceInfo[]) {
  if (references.length === 0) return 'Reference'
  if (references.every((reference) => reference.mediaType === 'image')) return 'Image reference'
  if (references.every((reference) => reference.mediaType === 'video')) return 'Video reference'
  return 'References'
}

function formatProviderLabel(provider?: string) {
  if (!provider) return undefined
  if (provider === 'atlas' || provider === 'Atlas Cloud') return 'Atlas Cloud'
  if (provider === 'mock-provider') return 'Mock provider'
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'seedance') return 'Seedance'
  if (provider === 'kling') return 'Kling'
  return provider
}
function MediaInfoRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="media-info-panel__row">
      <div className="media-info-panel__row-heading">
        <span>{label}</span>
        {copyable ? (
          <button
            type="button"
            className="media-info-panel__copy"
            aria-label={`Copy ${label}`}
            onPointerDownCapture={(event) => event.stopPropagation()}
            onMouseDownCapture={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void copyTextToClipboard(value, event.currentTarget.ownerDocument.defaultView)
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="5.5" y="3.5" width="7" height="9" rx="1.5" />
              <path d="M3.5 10.5V5A1.5 1.5 0 0 1 5 3.5h5.5" />
            </svg>
          </button>
        ) : null}
      </div>
      <p>{value}</p>
    </div>
  )
}

async function copyTextToClipboard(value: string, targetWindow: Window | null) {
  try {
    await targetWindow?.navigator.clipboard?.writeText(value)
  } catch {
    // Best-effort utility for a non-critical metadata affordance.
  }
}

function FrameCodexAction({
  action,
  onSend,
}: {
  action: NonNullable<FrameActionState>
  onSend: (frameId: string) => void
}) {
  const editor = useEditor()
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const sendTitle = `Send ${action.frameName} context to Codex`

  useEffect(() => {
    const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
    let rafId: number | null = null
    let lastPositionKey = ''

    const syncPosition = () => {
      const toolbar = toolbarRef.current
      const frame = editor.getShape(action.frameId as TLShapeId)
      const bounds = frame ? editor.getShapePageBounds(frame) : undefined

      if (!toolbar || !bounds) {
        if (toolbar) toolbar.style.display = 'none'
        rafId = appWindow.requestAnimationFrame(syncPosition)
        return
      }

      const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y })
      const topRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y })
      const left = Math.max(12, (topLeft.x + topRight.x) / 2)
      const top = Math.max(56, topLeft.y - 10)
      const positionKey = `${left.toFixed(2)}:${top.toFixed(2)}`

      if (positionKey !== lastPositionKey) {
        lastPositionKey = positionKey
        toolbar.style.display = 'flex'
        toolbar.style.transform = `translate3d(${left}px, ${top}px, 0) translate(-50%, -100%)`
      }

      rafId = appWindow.requestAnimationFrame(syncPosition)
    }

    syncPosition()

    return () => {
      if (rafId !== null) appWindow.cancelAnimationFrame(rafId)
    }
  }, [editor, action.frameId])

  return (
    <div
      ref={toolbarRef}
      className="codex-frame-contextual-toolbar"
      role="toolbar"
      aria-label="Frame actions"
      style={{ transform: `translate3d(${action.left}px, ${action.top}px, 0) translate(-50%, -100%)` }}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onMouseDownCapture={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="codex-frame-action-button"
        title={sendTitle}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSend(action.frameId)
        }}
      >
        <ExternalLinkActionIcon />
        <span>Send to Codex</span>
      </button>
    </div>
  )
}

function ExternalLinkActionIcon() {
  return (
    <span className="codex-frame-action-external" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <path d="M7 4.75H4.75v10.5h10.5V13" />
        <path d="M10.25 4.75h5v5" />
        <path d="m9.25 10.75 5.75-5.75" />
      </svg>
    </span>
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
  const frameBounds = getShapePageBoundsRecord(editor, frame)
  const topLeft = editor.pageToScreen({ x: frameBounds.x, y: frameBounds.y })
  const frameName = frame.props.name || 'Untitled frame'

  return {
    frameId: frame.id,
    frameName,
    left: Math.max(12, topLeft.x + 10),
    top: Math.max(64, topLeft.y - 36),
  }
}

function clearVolatileCanvasSnapshotState(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const snapshotRecord = snapshot as { store?: Record<string, unknown> }
  if (!snapshotRecord.store || typeof snapshotRecord.store !== 'object') return snapshot

  const store = Object.fromEntries(
    Object.entries(snapshotRecord.store).map(([id, record]) => {
      if (!record || typeof record !== 'object') return [id, record]
      const typedRecord = record as { typeName?: string }
      if (typedRecord.typeName !== 'instance_page_state') return [id, record]
      return [
        id,
        {
          ...typedRecord,
          editingShapeId: null,
          croppingShapeId: null,
          selectedShapeIds: [],
          hoveredShapeId: null,
          erasingShapeIds: [],
          hintingShapeIds: [],
          focusedGroupId: null,
        },
      ]
    }),
  )

  return {
    ...snapshotRecord,
    store,
  }
}

function getSnapshotShapeIds(snapshot: unknown) {
  const shapeIds = new Set<string>()
  if (!snapshot || typeof snapshot !== 'object') return shapeIds
  const snapshotRecord = snapshot as { store?: Record<string, unknown> }
  if (!snapshotRecord.store || typeof snapshotRecord.store !== 'object') return shapeIds

  for (const record of Object.values(snapshotRecord.store)) {
    if (!record || typeof record !== 'object') continue
    const typedRecord = record as { id?: string; typeName?: string }
    if (typedRecord.typeName === 'shape' && typeof typedRecord.id === 'string') {
      shapeIds.add(typedRecord.id)
    }
  }

  return shapeIds
}

function getSelectedMediaInfo(editor: Editor): SelectedMediaInfo {
  const selectedMedia = editor.getSelectedShapes().find((shape) => shape.type === MEDIA_IMAGE_SHAPE || shape.type === 'image' || shape.type === 'video')
  if (!selectedMedia) return null

  const props = selectedMedia.props as Record<string, unknown>
  const metadata = getMediaMetadata(editor, selectedMedia)
  const assetId = stringFromUnknown(props.assetId)
  const asset = assetId ? (editor.getAsset(assetId as TLAssetId) as TLAsset | undefined) : undefined
  const assetProps = (asset?.props ?? {}) as Record<string, unknown>
  const assetMeta = (asset?.meta ?? {}) as Record<string, unknown>
  const bounds = getShapePageBoundsRecord(editor, selectedMedia)
  const overlayPosition = getMediaInfoOverlayPosition(editor, selectedMedia)

  const mediaType = getSelectedShapeMediaType(selectedMedia, props, assetProps, metadata)
  const previewSrc =
    stringFromUnknown(assetProps.src) ??
    stringFromUnknown(props.src) ??
    stringFromUnknown(metadata.src) ??
    srcFromLocalPath(stringFromUnknown(metadata.localPath) ?? stringFromUnknown(props.localPath))
  const references = getMediaReferencePreviewItems(metadata).filter((reference) => {
    if (reference.src === previewSrc) return false
    if (reference.assetId && reference.assetId === assetId) return false
    if (reference.shapeId && reference.shapeId === selectedMedia.id) return false
    return true
  })
  const intrinsicWidth = numberFromUnknown(metadata.outputWidth) ?? numberFromUnknown(assetProps.w) ?? numberFromUnknown(props.w) ?? bounds.w
  const intrinsicHeight = numberFromUnknown(metadata.outputHeight) ?? numberFromUnknown(assetProps.h) ?? numberFromUnknown(props.h) ?? bounds.h
  const resolution = stringFromUnknown(metadata.resolution) ?? formatPixelResolution(intrinsicWidth, intrinsicHeight)
  const size = stringFromUnknown(metadata.size) ?? stringFromUnknown(metadata.aspectRatio) ?? formatAspectRatio(intrinsicWidth, intrinsicHeight)

  return {
    shapeId: selectedMedia.id,
    title: stringFromUnknown(metadata.title) ?? stringFromUnknown(assetProps.name) ?? stringFromUnknown(props.title) ?? (mediaType === 'video' ? 'Video asset' : 'Image asset'),
    mediaType,
    triggerLeft: overlayPosition.triggerLeft,
    triggerTop: overlayPosition.triggerTop,
    panelLeft: overlayPosition.panelLeft,
    panelTop: overlayPosition.panelTop,
    showTrigger: overlayPosition.showTrigger,
    previewSrc,
    prompt: getDisplayPromptFromMedia(metadata, props),
    provider: stringFromUnknown(metadata.provider) ?? stringFromUnknown(props.provider),
    model: stringFromUnknown(metadata.model) ?? stringFromUnknown(props.model),
    skillName: stringFromUnknown(metadata.skillName) ?? stringFromUnknown(props.skillName),
    absolutePath: stringFromUnknown(metadata.absolutePath) ?? stringFromUnknown(props.absolutePath) ?? stringFromUnknown(assetMeta.absolutePath),
    size,
    resolution,
    quality: stringFromUnknown(metadata.quality) ?? stringFromUnknown(props.quality) ?? stringFromUnknown(assetMeta.quality),
    references: references.length > 0 ? references : undefined,
  }
}

function getMediaInfoOverlayPosition(editor: Editor, shape: TLShape) {
  const bounds = editor.getShapePageBounds(shape.id)
  if (!bounds) {
    return {
      triggerLeft: -9999,
      triggerTop: -9999,
      panelLeft: -9999,
      panelTop: -9999,
      showTrigger: false,
    }
  }

  const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y })
  const topRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y })
  const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h })
  const viewport = editor.getViewportScreenBounds()
  const visualWidth = Math.abs(topRight.x - topLeft.x)
  const visualHeight = Math.abs(bottomRight.y - topRight.y)
  const visualArea = visualWidth * visualHeight
  const viewportArea = Math.max(1, viewport.w * viewport.h)
  const showTrigger =
    visualWidth >= 150 &&
    visualHeight >= 120 &&
    visualArea >= viewportArea * 0.018 &&
    topRight.x >= viewport.x - 64 &&
    topRight.x <= viewport.x + viewport.w + 64 &&
    topRight.y >= viewport.y - 64 &&
    topRight.y <= viewport.y + viewport.h + 64

  return {
    triggerLeft: Math.round(topRight.x - 36),
    triggerTop: Math.round(topRight.y + 10),
    panelLeft: Math.round(topRight.x + 12),
    panelTop: Math.round(topRight.y + 4),
    showTrigger,
  }
}

function getMediaReferencePreviewItems(metadata: Record<string, unknown>): MediaReferenceInfo[] {
  const rawReferences = metadata.references
  if (!Array.isArray(rawReferences)) return []

  return rawReferences
    .map(mediaReferenceFromUnknown)
    .filter((reference): reference is MediaReferenceInfo => Boolean(reference))
    .slice(0, 6)
}

function mediaReferenceFromUnknown(value: unknown): MediaReferenceInfo | undefined {
  const record = recordFromUnknown(value)
  if (!record) return undefined

  const localPath = stringFromUnknown(record.localPath)
  const absolutePath = stringFromUnknown(record.absolutePath)
  const src = stringFromUnknown(record.src) ?? srcFromLocalPath(localPath)
  if (!src) return undefined

  const rawMediaType = stringFromUnknown(record.mediaType)
  const mediaType = rawMediaType === 'video' || looksLikeVideoPath(src) || looksLikeVideoPath(localPath) || looksLikeVideoPath(absolutePath) ? 'video' : 'image'
  if (rawMediaType && rawMediaType !== 'image' && rawMediaType !== 'video') return undefined

  return {
    mediaType,
    src,
    shapeId: stringFromUnknown(record.shapeId),
    assetId: stringFromUnknown(record.assetId),
    title: stringFromUnknown(record.title) ?? stringFromUnknown(record.role) ?? getFileNameFromPath(absolutePath ?? localPath ?? src),
    localPath,
    absolutePath,
  }
}
function getSelectedShapeMediaType(
  shape: TLShape,
  props: Record<string, unknown>,
  assetProps: Record<string, unknown>,
  metadata: Record<string, unknown>,
): 'image' | 'video' {
  if (shape.type === 'video') return 'video'
  if (stringFromUnknown(metadata.mediaType) === 'video' || stringFromUnknown(props.mediaType) === 'video') return 'video'
  if (stringFromUnknown(assetProps.mimeType)?.startsWith('video/') || stringFromUnknown(props.mimeType)?.startsWith('video/')) return 'video'
  if (
    looksLikeVideoPath(stringFromUnknown(assetProps.src)) ||
    looksLikeVideoPath(stringFromUnknown(props.src)) ||
    looksLikeVideoPath(stringFromUnknown(metadata.localPath)) ||
    looksLikeVideoPath(stringFromUnknown(props.localPath))
  ) {
    return 'video'
  }
  return 'image'
}

function getDisplayPromptFromMedia(metadata: Record<string, unknown>, props: Record<string, unknown>) {
  return (
    stringFromUnknown(metadata.displayPrompt) ??
    stringFromUnknown(metadata.userPrompt) ??
    stringFromUnknown(props.displayPrompt) ??
    stringFromUnknown(props.userPrompt) ??
    cleanProviderPromptForDisplay(stringFromUnknown(metadata.prompt) ?? stringFromUnknown(props.prompt))
  )
}

function cleanProviderPromptForDisplay(prompt?: string) {
  if (!prompt) return undefined
  const normalized = prompt.trim()
  const instructionMatch = normalized.match(/Canvas edit instructions:\s*([\s\S]*?)(?:\n\n|$)/i)
  const annotationLines = instructionMatch?.[1]
    ?.split('\n')
    .map((line) => line.replace(/^\s*[-•]\s*/, '').trim())
    .filter(Boolean)
  if (annotationLines && annotationLines.length > 0) return annotationLines.join('\n')

  const cleaned = normalized
    .split('\n')
    .filter((line) => !/^Use selected canvas/i.test(line.trim()))
    .filter((line) => !/^Use the selected canvas/i.test(line.trim()))
    .filter((line) => !/^Do not render canvas annotations/i.test(line.trim()))
    .filter((line) => !/^Spatial guidance:/i.test(line.trim()))
    .join('\n')
    .trim()

  return cleaned.length > 0 ? cleaned : undefined
}

function createNativeGeneratedMediaRecords(input: {
  command: CanvasCommand
  childId: TLShapeId
  parentId: TLShape['parentId']
  bounds: Bounds
  src: string
  versionId: string
}): { asset: TLAsset; shape: TLShapePartial } {
  const { command, childId, parentId, bounds, src, versionId } = input
  const mediaType = getCommandMediaType(command)
  const assetId = AssetRecordType.createId()
  const title = command.title ?? (mediaType === 'video' ? 'Codex generated video' : 'Codex generated image')
  const metadata = compactRecord({
    versionId,
    localPath: command.localPath,
    absolutePath: command.absolutePath,
    src,
    mediaType,
    title,
    prompt: command.prompt,
    displayPrompt: cleanProviderPromptForDisplay(command.prompt),
    provider: command.provider ?? 'codex',
    model: command.model,
    generationMode: command.generationMode,
    references: command.references,
    requestId: command.id,
    status: command.status ?? 'succeeded',
    skillName: command.skillName ?? (mediaType === 'video' ? 'coflow-video' : 'coflow-image'),
    generationStartedAt: command.generationStartedAt,
    generationCompletedAt: command.generationCompletedAt,
    generationDurationMs: command.generationDurationMs,
    generationDuration: formatDurationMs(command.generationDurationMs),
    providerTimings: command.providerTimings,
    e2eStartedAt: command.e2eStartedAt,
    e2eCompletedAt: command.e2eCompletedAt,
    e2eDurationMs: command.e2eDurationMs,
    e2eDuration: formatDurationMs(command.e2eDurationMs),
    writebackCompletedAt: command.writebackCompletedAt,
    outputWidth: command.outputWidth,
    outputHeight: command.outputHeight,
    size: formatAspectRatio(command.outputWidth, command.outputHeight),
    resolution: formatPixelResolution(command.outputWidth, command.outputHeight),
  })
  const name = getFileNameFromPath(command.localPath ?? command.absolutePath ?? src) ?? metadata.title

  const asset = {
    id: assetId,
    typeName: 'asset',
    type: mediaType,
    props: {
      name,
      src,
      w: bounds.w,
      h: bounds.h,
      mimeType: getMimeTypeForMedia(mediaType, command.localPath ?? command.absolutePath ?? src),
      isAnimated: mediaType === 'video',
    },
    meta: {
      coflow: metadata,
    },
  } as TLAsset

  const baseShape = {
    id: childId,
    parentId,
    x: bounds.x,
    y: bounds.y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {
      coflow: metadata,
    },
  }

  const shape = (
    mediaType === 'image'
      ? {
          ...baseShape,
          type: 'image',
          props: {
            assetId,
            w: bounds.w,
            h: bounds.h,
            playing: false,
            url: src,
            altText: title,
            crop: null,
            flipX: false,
            flipY: false,
          },
        }
      : {
          ...baseShape,
          type: 'video',
          props: {
            assetId,
            w: bounds.w,
            h: bounds.h,
            playing: false,
            url: src,
            altText: title,
            time: 0,
            autoplay: false,
          },
        }
  ) as TLShapePartial

  return { asset, shape }
}

function normalizeLegacyDefaultArrowBends(editor: Editor, records: unknown[] = editor.store.allRecords()) {
  const updates: TLShapePartial[] = []
  for (const record of records) {
    const shape = record as TLShape
    if (!shape || shape.typeName !== 'shape' || shape.type !== 'arrow') continue
    const props = shape.props as { bend?: number }
    if (Math.abs(props.bend ?? 0) !== 80) continue
    updates.push({
      id: shape.id,
      type: 'arrow',
      props: {
        bend: Math.sign(props.bend ?? 1) * DEFAULT_ARROW_BEND,
      },
    })
  }

  if (updates.length === 0) return
  editor.run(() => editor.updateShapes(updates), { history: 'ignore' })
}

function syncAnnotationArrowStyles(editor: Editor, records: unknown[] = editor.store.allRecords()) {
  const updates: TLShapePartial[] = []
  let latestColor: TLArrowShape['props']['color'] | undefined
  for (const record of records) {
    const shape = record as TLArrowShape
    if (!shape || shape.typeName !== 'shape' || shape.type !== 'arrow') continue
    if (shape.meta?.[FLOATING_ARROW_META_KEY] !== true) continue

    const props = shape.props
    const nextProps: Partial<TLArrowShape['props']> = {}
    const update: TLShapePartial = {
      id: shape.id,
      type: 'arrow',
    }
    if (props.color && props.labelColor !== props.color) nextProps.labelColor = props.color
    if (props.color) latestColor = props.color
    if (props.labelPosition !== FLOATING_ARROW_LABEL_POSITION) nextProps.labelPosition = FLOATING_ARROW_LABEL_POSITION
    if (Object.keys(nextProps).length > 0) update.props = nextProps
    if (!update.props) continue

    updates.push(update)
  }

  if (latestColor) editor.setStyleForNextShapes(DefaultColorStyle, latestColor)
  if (updates.length === 0) return
  editor.run(() => editor.updateShapes(updates), { history: 'ignore' })
}

function getShapeLocalBoundsRecord(shape: TLShape): Bounds {
  const props = shape.props as { w?: number; h?: number }
  return {
    x: shape.x,
    y: shape.y,
    w: typeof props.w === 'number' && Number.isFinite(props.w) ? props.w : shape.type === 'note' ? 160 : 120,
    h: typeof props.h === 'number' && Number.isFinite(props.h) ? props.h : shape.type === 'note' ? 160 : 90,
  }
}

function getShapePageBoundsRecord(editor: Editor, shape: TLShape): Bounds {
  const pageBounds = editor.getShapePageBounds(shape.id)
  if (!pageBounds) return getShapeLocalBoundsRecord(shape)
  return {
    x: pageBounds.x,
    y: pageBounds.y,
    w: pageBounds.w,
    h: pageBounds.h,
  }
}

function getGeneratedMediaOutputSize(command: CanvasCommand, anchorBounds: Bounds): { w: number; h: number } {
  const mediaType = getCommandMediaType(command)
  const outputDimensions = getCommandOutputDimensions(command)
  if (!outputDimensions) return { w: anchorBounds.w, h: anchorBounds.h }

  const targetWidth = mediaType === 'video' ? clampNumber(Math.max(anchorBounds.w, 520), 360, 720) : anchorBounds.w
  const aspectRatio = outputDimensions.w / outputDimensions.h
  return {
    w: targetWidth,
    h: targetWidth / aspectRatio,
  }
}

function getStandaloneGeneratedMediaOutputSize(command: CanvasCommand): { w: number; h: number } {
  const mediaType = getCommandMediaType(command)
  const outputDimensions = getCommandOutputDimensions(command)
  const defaultAspectRatio = mediaType === 'video' ? 16 / 9 : 1
  const aspectRatio = outputDimensions ? outputDimensions.w / outputDimensions.h : defaultAspectRatio
  const targetWidth = mediaType === 'video' ? 520 : 360
  return {
    w: targetWidth,
    h: targetWidth / aspectRatio,
  }
}

function getStandaloneMediaPlacementBounds(editor: Editor, shapes: CanvasShapeRecord[], command: CanvasCommand, outputSize: { w: number; h: number }): Bounds {
  const frame = command.frameId ? editor.getShape(command.frameId as TLShapeId) : undefined
  if (frame?.type === 'frame') {
    const frameBounds = getShapePageBoundsRecord(editor, frame)
    return createVersionPlacement(frameBounds, outputSize, getVersionPlacementOccupiedBounds(shapes, frame.id, frame.id)).childBounds
  }

  const viewport = editor.getViewportPageBounds()
  const occupied = shapes.filter((shape) => shape.type !== 'frame').map(getShapeBounds)
  const gap = 40
  const initial = {
    x: viewport.x + gap,
    y: viewport.y + gap,
    w: outputSize.w,
    h: outputSize.h,
  }

  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const candidate = {
        ...initial,
        x: initial.x + column * (outputSize.w + gap),
        y: initial.y + row * (outputSize.h + gap),
      }
      if (!occupied.some((bounds) => boundsIntersect(candidate, inflateBoundsRecord(bounds, 24)))) return candidate
    }
  }

  return initial
}

function inflateBoundsRecord(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  }
}

function commandHasReferenceInput(command: CanvasCommand) {
  if (command.sourceShapeId) return true
  return (
    command.references?.some((reference) =>
      Boolean(
        stringFromUnknown(reference.shapeId) ||
          stringFromUnknown((reference as { sourceShapeId?: unknown }).sourceShapeId) ||
          stringFromUnknown(reference.assetId) ||
          stringFromUnknown(reference.localPath) ||
          stringFromUnknown(reference.absolutePath) ||
          stringFromUnknown(reference.src),
      ),
    ) ?? false
  )
}

function getCommandOutputDimensions(command: CanvasCommand): { w: number; h: number } | undefined {
  const w = Number(command.outputWidth)
  const h = Number(command.outputHeight)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined
  return { w, h }
}

function getVersionPlacementOccupiedBounds(shapes: CanvasShapeRecord[], anchorShapeId?: string, frameId?: string): Bounds[] {
  return shapes
    .filter((shape) => shape.id !== anchorShapeId && shape.id !== frameId && shape.type !== 'frame')
    .map(getShapeBounds)
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getBoundsCenter(bounds: Bounds) {
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  }
}

function stringFromUnknown(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function srcFromLocalPath(localPath?: string) {
  if (!localPath) return undefined
  if (localPath.startsWith('/asset-store/')) return localPath
  if (localPath.startsWith('.coflow/')) return `/asset-store/${localPath.slice('.coflow/'.length)}`
  return undefined
}

function formatPixelResolution(width: unknown, height: unknown) {
  const w = numberFromUnknown(width)
  const h = numberFromUnknown(height)
  if (!w || !h) return undefined
  return `${Math.round(w)} × ${Math.round(h)}`
}

function formatAspectRatio(width: unknown, height: unknown) {
  const w = numberFromUnknown(width)
  const h = numberFromUnknown(height)
  if (!w || !h) return undefined
  const ratio = w / h
  const commonRatios: Array<[number, number]> = [
    [1, 1],
    [3, 4],
    [4, 3],
    [9, 16],
    [16, 9],
    [2, 3],
    [3, 2],
    [21, 9],
  ]
  const closeMatch = commonRatios.find(([rw, rh]) => Math.abs(ratio - rw / rh) < 0.035)
  if (closeMatch) return `${closeMatch[0]}:${closeMatch[1]}`
  const roundedW = Math.round(w)
  const roundedH = Math.round(h)
  const divisor = greatestCommonDivisor(roundedW, roundedH)
  if (divisor <= 0) return undefined
  return `${Math.round(roundedW / divisor)}:${Math.round(roundedH / divisor)}`
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y > 0) {
    const next = x % y
    x = y
    y = next
  }
  return x
}

function getCommandMediaType(command: CanvasCommand): 'image' | 'video' {
  if (command.mediaType === 'video' || command.outputMediaType === 'video') return 'video'
  if (looksLikeVideoPath(command.localPath) || looksLikeVideoPath(command.absolutePath) || looksLikeVideoPath(command.src)) return 'video'
  return 'image'
}

function getMimeTypeForMedia(mediaType: 'image' | 'video', path?: string) {
  if (mediaType === 'video') {
    if (/\.webm(\?|#|$)/i.test(path ?? '')) return 'video/webm'
    if (/\.mov(\?|#|$)/i.test(path ?? '')) return 'video/mp4'
    return 'video/mp4'
  }
  if (/\.jpe?g(\?|#|$)/i.test(path ?? '')) return 'image/jpeg'
  if (/\.webp(\?|#|$)/i.test(path ?? '')) return 'image/webp'
  if (/\.gif(\?|#|$)/i.test(path ?? '')) return 'image/gif'
  return 'image/png'
}

function getFileNameFromPath(path?: string) {
  if (!path) return undefined
  const cleanPath = path.split(/[?#]/)[0]
  const fileName = cleanPath.split('/').filter(Boolean).at(-1)
  return fileName && fileName.length > 0 ? fileName : undefined
}

function compactRecord(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') output[key] = value
  }
  return output
}

function errorToOperationRecord(error: unknown) {
  if (error instanceof Error) {
    return compactRecord({
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
  }
  return {
    message: String(error),
  }
}

function getMediaMetadata(editor: Editor, shape: TLShape) {
  const props = shape.props as Record<string, unknown>
  const assetId = stringFromUnknown(props.assetId)
  const asset = assetId ? (editor.getAsset(assetId as TLAssetId) as TLAsset | undefined) : undefined
  const assetMeta = (asset?.meta ?? {}) as Record<string, unknown>
  const shapeMeta = (shape.meta ?? {}) as Record<string, unknown>
  return {
    ...recordFromUnknown(assetMeta.codexMediaCanvas),
    ...recordFromUnknown(shapeMeta.codexMediaCanvas),
    ...recordFromUnknown(assetMeta.coflow),
    ...recordFromUnknown(shapeMeta.coflow),
  }
}

function recordFromUnknown(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
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

function toCanvasShapeRecords(editor: Editor, shapes: TLShape[]): CanvasShapeRecord[] {
  return shapes.map((shape) => {
    const bounds = getShapePageBoundsRecord(editor, shape)
    return {
      id: shape.id,
      type: shape.type as CanvasShapeRecord['type'],
      x: bounds.x,
      y: bounds.y,
      parentId: shape.parentId,
      props: {
        ...normalizeProps(shape),
        w: bounds.w,
        h: bounds.h,
      },
    }
  })
}

async function buildSelectionSnapshot(editor: Editor): Promise<CanvasSelectionSnapshot> {
  const selectedShapes = editor.getSelectedShapes()
  const currentPageShapes = editor.getCurrentPageShapesSorted()
  const shapes = toCanvasShapeRecords(editor, currentPageShapes)
  const activeFrameRecord = findActiveFrameForSelection(editor, shapes)
  const activeFrame = activeFrameRecord ? await extractMaterializedFrameContext(editor, shapes, activeFrameRecord.id) : undefined
  const viewportBounds = editor.getViewportPageBounds()
  const viewport: CanvasSelectionSnapshot['viewport'] = {
    bounds: {
      x: viewportBounds.x,
      y: viewportBounds.y,
      w: viewportBounds.w,
      h: viewportBounds.h,
    },
    camera: editor.getCamera(),
    items: await Promise.all(
      currentPageShapes
        .filter((shape) => shape.type !== 'frame')
        .filter((shape) => boundsIntersect(getShapePageBoundsRecord(editor, shape), viewportBounds))
        .map((shape) => toCanvasItem(editor, shape)),
    ),
  }

  return {
    version: 1,
    selectedIds: selectedShapes.map((shape) => shape.id),
    selectedItems: await Promise.all(selectedShapes.map((shape) => toCanvasItem(editor, shape))),
    activeFrame,
    viewport,
    updatedAt: new Date().toISOString(),
  }
}

function boundsIntersect(a: Bounds, b: Bounds) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function getSelectionPublicationKey(selection: CanvasSelectionSnapshot) {
  return JSON.stringify({
    selectedIds: selection.selectedIds,
    selectedItems: selection.selectedItems.map(selectionItemPublicationKey),
    activeFrameId: selection.activeFrame?.frameId,
    viewport: selection.viewport
      ? {
          bounds: roundedBounds(selection.viewport.bounds),
          camera: selection.viewport.camera
            ? {
                x: roundCanvasNumber(selection.viewport.camera.x),
                y: roundCanvasNumber(selection.viewport.camera.y),
                z: roundCanvasNumber(selection.viewport.camera.z),
              }
            : undefined,
          items: selection.viewport.items.map(selectionItemPublicationKey),
        }
      : undefined,
  })
}

function selectionItemPublicationKey(item: CanvasItem) {
  return {
    id: item.id,
    kind: item.kind,
    canvasType: item.canvasType,
    parentId: item.parentId,
    bounds: roundedBounds(item.bounds),
    text: item.text,
    assetId: item.asset?.assetId,
    localPath: item.asset?.localPath,
  }
}

function roundedBounds(bounds: Bounds) {
  return {
    x: roundCanvasNumber(bounds.x),
    y: roundCanvasNumber(bounds.y),
    w: roundCanvasNumber(bounds.w),
    h: roundCanvasNumber(bounds.h),
    rotation: bounds.rotation === undefined ? undefined : roundCanvasNumber(bounds.rotation),
  }
}

function roundCanvasNumber(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value
}

async function toCanvasItem(editor: Editor, shape: TLShape): Promise<CanvasItem> {
  const props = normalizeProps(shape)
  const bounds = getShapePageBoundsRecord(editor, shape)
  const asset = await getCanvasAssetContext(editor, shape, props)
  const text = getShapePlainText(props)
  const kind = toCanvasItemKind(shape.type, props)
  const style = isAnnotationCanvasItemKind(kind) ? getAnnotationStyle(props) : undefined
  const metadata = pickMetadata(props, [
    'versionId',
    'prompt',
    'provider',
    'model',
    'generationMode',
    'status',
    'skillName',
    'requestId',
    'executionId',
    'title',
    'mediaType',
  ])

  return {
    id: shape.id,
    kind,
    canvasType: shape.type,
    parentId: shape.parentId,
    bounds: {
      ...bounds,
      rotation: typeof shape.rotation === 'number' && Number.isFinite(shape.rotation) ? shape.rotation : undefined,
    },
    text,
    ...(style ? { style } : {}),
    asset,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

function isAnnotationCanvasItemKind(kind: CanvasItemKind) {
  return kind === 'text' || kind === 'note' || kind === 'arrow' || kind === 'shape'
}

async function getCanvasAssetContext(editor: Editor, shape: TLShape, props: Record<string, unknown>): Promise<CanvasAssetContext | undefined> {
  if (shape.type !== MEDIA_IMAGE_SHAPE && shape.type !== 'image' && shape.type !== 'video') return undefined

  const assetId = stringFromUnknown(props.assetId) ?? shape.id
  const asset = editor.getAsset(assetId as TLAsset['id']) as TLAsset | undefined
  const assetProps = (asset?.props ?? {}) as Record<string, unknown>
  const assetMeta = (asset?.meta ?? {}) as Record<string, unknown>
  const src = stringFromUnknown(props.src) ?? stringFromUnknown(assetProps.src) ?? stringFromUnknown(assetMeta.src)
  const mediaType =
    stringFromUnknown(props.mediaType) === 'video' ||
    shape.type === 'video' ||
    looksLikeVideoPath(src) ||
    looksLikeVideoPath(stringFromUnknown(props.localPath)) ||
    looksLikeVideoPath(stringFromUnknown(assetMeta.localPath)) ||
    stringFromUnknown(props.mimeType)?.startsWith('video/') ||
    stringFromUnknown(assetProps.mimeType)?.startsWith('video/') ||
    stringFromUnknown(assetMeta.mimeType)?.startsWith('video/')
      ? 'video'
      : 'image'
  const mimeType =
    stringFromUnknown(props.mimeType) ??
    stringFromUnknown(assetProps.mimeType) ??
    stringFromUnknown(assetMeta.mimeType) ??
    (mediaType === 'video' ? 'video/mp4' : 'image/*')
  let localPath = stringFromUnknown(props.localPath) ?? stringFromUnknown(assetMeta.localPath)
  let absolutePath = stringFromUnknown(props.absolutePath) ?? stringFromUnknown(assetMeta.absolutePath)

  if (!localPath && src?.startsWith('/asset-store/')) {
    localPath = `.coflow/${src.slice('/asset-store/'.length)}`
  }

  if ((!localPath || !absolutePath) && src?.startsWith('data:')) {
    const materialized = await materializeAsset({
      shapeId: shape.id,
      assetId,
      name: stringFromUnknown(assetProps.name) ?? stringFromUnknown(props.title) ?? shape.id,
      mimeType: stringFromUnknown(assetProps.mimeType) ?? stringFromUnknown(assetMeta.mimeType) ?? undefined,
      src,
    })
    localPath = materialized.localPath
    absolutePath = materialized.absolutePath
  }

  const bounds = getShapePageBoundsRecord(editor, shape)
  return {
    assetId,
    mediaType,
    mimeType,
    localPath,
    absolutePath,
    src,
    width: numberFromUnknown(assetProps.w) ?? numberFromUnknown(props.w) ?? bounds.w,
    height: numberFromUnknown(assetProps.h) ?? numberFromUnknown(props.h) ?? bounds.h,
    durationMs: numberFromUnknown(assetProps.durationMs) ?? numberFromUnknown(assetMeta.durationMs),
    fileSize: numberFromUnknown(assetProps.fileSize) ?? numberFromUnknown(assetMeta.fileSize) ?? numberFromUnknown(assetMeta.bytes),
  }
}

function toCanvasItemKind(type: string, props: Record<string, unknown> = {}): CanvasItemKind {
  if (type === MEDIA_IMAGE_SHAPE) return isCustomVideoMedia(props) ? 'video' : 'image'
  if (type === 'image') return 'image'
  if (type === 'video') return 'video'
  if (type === 'frame') return 'frame'
  if (type === 'note') return 'note'
  if (type === 'text') return 'text'
  if (type === 'arrow') return 'arrow'
  return 'shape'
}

function isCustomVideoMedia(props: Record<string, unknown>) {
  return (
    stringFromUnknown(props.mediaType) === 'video' ||
    looksLikeVideoPath(stringFromUnknown(props.src)) ||
    looksLikeVideoPath(stringFromUnknown(props.localPath)) ||
    stringFromUnknown(props.mimeType)?.startsWith('video/')
  )
}

function looksLikeVideoPath(path?: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(path ?? '')
}

function getShapePlainText(props: Record<string, unknown>) {
  return (
    stringFromUnknown(props.text) ??
    stringFromUnknown(props.plainText) ??
    stringFromUnknown(props.name) ??
    richTextToPlainText(props.richText)
  )
}

function pickMetadata(props: Record<string, unknown>, keys: string[]) {
  const metadata: Record<string, unknown> = {}
  for (const key of keys) {
    const value = props[key]
    if (value !== undefined && value !== null && value !== '') metadata[key] = value
  }
  return metadata
}

function numberFromUnknown(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getDurationMs(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return undefined
  const started = new Date(startedAt).getTime()
  const completed = new Date(completedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return undefined
  return completed - started
}

function formatDurationMs(value: unknown) {
  const durationMs = numberFromUnknown(value)
  if (durationMs === undefined) return undefined
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs - minutes * 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function findActiveFrameForSelection(editor: Editor, shapes: CanvasShapeRecord[]) {
  const selected = editor.getSelectedShapes()
  if (selected.length === 0) return undefined

  const selectedFrame = selected.find((shape) => shape.type === 'frame')
  if (selectedFrame) return shapes.find((shape) => shape.id === selectedFrame.id && shape.type === 'frame')

  const selectedIds = new Set<string>(selected.map((shape) => String(shape.id)))
  const parentFrame = shapes.find(
    (shape) => shape.type === 'frame' && shapes.some((candidate) => selectedIds.has(candidate.id) && candidate.parentId === shape.id),
  )
  if (parentFrame) return parentFrame

  const frames = shapes.filter((shape) => shape.type === 'frame')
  const selectedRecords = shapes.filter((shape) => selectedIds.has(shape.id))
  return frames.find((frame) => selectedRecords.some((shape) => shapeCenterIsInsideFrame(shape, frame)))
}

function shapeCenterIsInsideFrame(shape: CanvasShapeRecord, frame: CanvasShapeRecord) {
  const bounds = getShapeBounds(shape)
  const frameBounds = getShapeBounds(frame)
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
  return (
    center.x >= frameBounds.x &&
    center.x <= frameBounds.x + frameBounds.w &&
    center.y >= frameBounds.y &&
    center.y <= frameBounds.y + frameBounds.h
  )
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

function getFrameExportShapeIds(shapes: CanvasShapeRecord[], frameId: string): TLShapeId[] {
  const frame = shapes.find((shape) => shape.id === frameId && shape.type === 'frame')
  if (!frame) return [frameId as TLShapeId]
  const frameBounds = getShapeBounds(frame)
  return shapes
    .filter((shape) => shape.id === frameId || shapeBelongsToFrameByGeometry(shape, frame, frameBounds))
    .map((shape) => shape.id as TLShapeId)
}

function shapeBelongsToFrameByGeometry(shape: CanvasShapeRecord, frame: CanvasShapeRecord, frameBounds: Bounds) {
  if (shape.id === frame.id) return true
  if (shape.parentId === frame.id) return true
  const bounds = getShapeBounds(shape)
  if (
    bounds.x >= frameBounds.x &&
    bounds.y >= frameBounds.y &&
    bounds.x + bounds.w <= frameBounds.x + frameBounds.w &&
    bounds.y + bounds.h <= frameBounds.y + frameBounds.h
  ) {
    return true
  }

  const center = {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  }
  if (
    center.x >= frameBounds.x &&
    center.x <= frameBounds.x + frameBounds.w &&
    center.y >= frameBounds.y &&
    center.y <= frameBounds.y + frameBounds.h
  ) {
    return true
  }

  return overlapArea(bounds, frameBounds) / Math.max(1, bounds.w * bounds.h) >= 0.35
}

function overlapArea(a: Bounds, b: Bounds) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
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

function writePngBlobPromiseToClipboard(editor: Editor, blobPromise: Promise<Blob>) {
  const appWindow = editor.getContainer().ownerDocument.defaultView ?? window
  const ClipboardItemCtor = appWindow.ClipboardItem
  if (!appWindow.navigator.clipboard?.write || !ClipboardItemCtor) {
    return Promise.reject(new Error('Image clipboard write is not supported in this browser.'))
  }

  const clipboardItem = new ClipboardItemCtor({
    'image/png': blobPromise,
  })
  return appWindow.navigator.clipboard.write([clipboardItem])
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

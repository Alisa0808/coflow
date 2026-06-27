import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import {
  AssetRecordType,
  DefaultColorStyle,
  StateNode,
  Tldraw,
  createShapeId,
  startEditingShapeWithRichText,
  toRichText,
  type Editor,
  type TLAsset,
  type TLAssetId,
  type TLAssetStore,
  type TLArrowShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { buildBoundedFrameContextPromptPart } from './agentPromptParts'
import {
  createVersionPlacement,
  extractFrameContext,
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
  loadActiveSkillSession,
  loadCanvasDocument,
  materializeAsset,
  publishCodexFrameRequest,
  publishFrameContext,
  publishSelectionSnapshot,
  recordOperation,
  runActiveSkillFrame,
  saveCanvasDocument,
  saveFrameScreenshot,
  type ActiveSkillSession,
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
  const statusTimeoutRef = useRef<number | null>(null)
  const selectionPublishTimeoutRef = useRef<number | null>(null)
  const canvasSaveTimeoutRef = useRef<number | null>(null)
  const isRestoringCanvasRef = useRef(false)
  const restoredShapeIdsRef = useRef<Set<string>>(new Set())
  const lastPublishedSelectionRef = useRef('')
  const [status, setStatus] = useState('')
  const [frameAction, setFrameAction] = useState<FrameActionState>(null)
  const [activeSkillSession, setActiveSkillSession] = useState<ActiveSkillSession>(null)
  const [selectedMediaInfo, setSelectedMediaInfo] = useState<SelectedMediaInfo>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>(null)
  const [generatingFrameIds, setGeneratingFrameIds] = useState<Set<string>>(() => new Set())

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

  useEffect(() => {
    let stopped = false

    async function pollActiveSkillSession() {
      if (stopped) return
      try {
        setActiveSkillSession(await loadActiveSkillSession())
      } catch {
        // The local backend may still be starting; keep the canvas usable.
      }
    }

    async function pollWritebackCommands() {
      if (stopped) return

      try {
        const commands = await fetchPendingCommands('canvas.create_version', CANVAS_CLIENT_VERSION)
        for (const command of commands) {
          if (command.type === 'canvas.create_version') {
            await placeVersionFromCommand(command)
          }
        }
        const linkCommands = await fetchPendingCommands('canvas.link_versions', CANVAS_CLIENT_VERSION)
        for (const command of linkCommands) {
          if (command.type === 'canvas.link_versions') {
            await placeVersionLinkFromCommand(command)
          }
        }
      } catch {
        // The local backend may still be starting; keep the canvas usable.
      }
    }

    const interval = window.setInterval(() => {
      void pollWritebackCommands()
    }, 1000)
    const activeSkillInterval = window.setInterval(() => {
      void pollActiveSkillSession()
    }, 1600)
    void pollWritebackCommands()
    void pollActiveSkillSession()

    return () => {
      stopped = true
      window.clearInterval(interval)
      window.clearInterval(activeSkillInterval)
      if (statusTimeoutRef.current !== null) window.clearTimeout(statusTimeoutRef.current)
      if (selectionPublishTimeoutRef.current !== null) window.clearTimeout(selectionPublishTimeoutRef.current)
      if (canvasSaveTimeoutRef.current !== null) window.clearTimeout(canvasSaveTimeoutRef.current)
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
      const serialized = JSON.stringify({
        selectedIds: selection.selectedIds,
        selectedItems: selection.selectedItems,
        activeFrameId: selection.activeFrame?.frameId,
      })
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

  async function publishFrameForCodex(
    frameId: string,
    status: 'awaiting_user_instruction' | 'ready_to_execute',
  ): Promise<{ request: CodexFrameRequest; context: FrameContext; screenshotResult: FrameScreenshotResult } | null> {
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
      status,
      summary: {
        frameName: context.frameName,
        mediaCount: context.media.length,
        annotationCount: context.annotations.length,
        anchorMediaId: context.anchorMedia.shapeId,
        annotationTexts: context.annotations.map((annotation) => annotation.text).filter((text): text is string => Boolean(text)),
      },
      frameScreenshot: frameScreenshot.screenshot,
      defaultInstruction:
        status === 'ready_to_execute'
          ? 'This frame belongs to an active Codex media Skill session. Use the structured Frame Input as source of truth, execute the active Skill, then call canvas.insert_media or canvas.create_version to place the result back on the board.'
          : 'Treat this as a pending Codex canvas request. Summarize the selected frame context in the Codex conversation first, wait for the user to confirm or add instructions, then choose the right Skill/provider/model and call canvas.insert_media or canvas.create_version to place the result back on the board.',
      recommendedUserPrompt:
        status === 'ready_to_execute'
          ? 'Generate a version from the media and annotations inside this frame using the active Skill.'
          : 'I have sent this frame to Codex. Please tell me what you want to create or edit from this frame, or say “generate a version from these annotations”.',
    })
    await recordOperation({
      type: status === 'ready_to_execute' ? 'codex.frame_context_ready_to_execute' : 'codex.frame_context_sent',
      frameId: context.frameId,
      promptPart,
      skillName: activeSkillSession?.skillName ?? 'codex-media-generation',
      promptSource: 'canvas-frame-action',
    })
    return { request, context, screenshotResult: frameScreenshot }
  }

  async function sendFrameToCodex(frameId: string) {
    const published = await publishFrameForCodex(frameId, 'awaiting_user_instruction')
    if (!published) return

    showStatus(
      published.screenshotResult.clipboardCopied
        ? 'Sent frame to Codex. Screenshot copied — paste it into the Codex chat.'
        : 'Sent frame to Codex. Screenshot copy was blocked, but Codex can read the Frame Input.',
      6200,
    )
  }

  async function generateFrameVersion(frameId: string) {
    if (!activeSkillSession?.autoRun) {
      void sendFrameToCodex(frameId)
      return
    }

    if (generatingFrameIds.has(frameId)) return
    setGeneratingFrameIds((current) => new Set(current).add(frameId))
    showStatus(`Generating with ${activeSkillSession.displayName}. Keep this canvas open for writeback.`, 0)

    const published = await publishFrameForCodex(frameId, 'ready_to_execute')
    if (!published) {
      setGeneratingFrameIds((current) => {
        const next = new Set(current)
        next.delete(frameId)
        return next
      })
      showStatus('', 1)
      return
    }

    try {
      await runActiveSkillFrame({
        frameId: published.context.frameId,
        frameRequestId: published.request.id,
      })
      showStatus('Generated version is ready. Placing it on canvas…', 3200)
    } catch (error) {
      await recordOperation({
        type: 'active_skill.run_failed',
        frameId: published.context.frameId,
        skillName: activeSkillSession.skillName,
        error: error instanceof Error ? error.message : String(error),
      })
      showStatus(error instanceof Error ? error.message : 'Active Skill run failed.', 6200)
    } finally {
      setGeneratingFrameIds((current) => {
        const next = new Set(current)
        next.delete(frameId)
        return next
      })
    }
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

  async function placeVersionFromCommand(command: CanvasCommand) {
    const editor = editorRef.current
    if (!editor) return

    const shapes = toCanvasShapeRecords(editor, editor.getCurrentPageShapesSorted())
    const frame = command.frameId ? shapes.find((shape) => shape.id === command.frameId && shape.type === 'frame') : findContextFrame(editor, shapes)
    if (!frame) {
      showStatus('Codex writeback skipped: target frame not found.', 5200)
      return
    }

    const context = await extractMaterializedFrameContext(editor, shapes, frame.id)
    const anchor = context.anchorMedia
    if (!anchor) {
      showStatus('Codex writeback skipped: frame has no media anchor.', 5200)
      return
    }

    const src = command.src ?? srcFromLocalPath(command.localPath)
    if (!src) {
      showStatus('Codex writeback skipped: command has no src or localPath.', 5200)
      return
    }

    const childId = createShapeId()
    const arrowId = createShapeId()
    const outputSize = { w: anchor.bounds.w, h: anchor.bounds.h }
    const placement = createVersionPlacement(anchor.bounds, outputSize, shapes.map(getShapeBounds))
    const parentShapeId = anchor.shapeId as TLShapeId
    const versionId = `version:codex-${Date.now()}`
    const arrowStart = {
      x: anchor.bounds.x + anchor.bounds.w + 16,
      y: anchor.bounds.y + anchor.bounds.h / 2,
    }
    const arrowEnd = {
      x: placement.childBounds.x - 16,
      y: placement.childBounds.y + placement.childBounds.h / 2,
    }

    const generated = createNativeGeneratedMediaRecords({
      command,
      childId,
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
            normalizedAnchor: { x: 1, y: 0.5 },
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
            normalizedAnchor: { x: 0, y: 0.5 },
            isExact: false,
            isPrecise: true,
          },
        },
      ])
      editor.select(childId)
    })

    await recordOperation({
      type: 'codex.version_placed',
      frameId: context.frameId,
      parentShapeId,
      childShapeId: childId,
      arrowShapeId: arrowId,
      command,
    })
    setSelectedMediaInfo(getSelectedMediaInfo(editor))
    showStatus('Placed Codex generated version on canvas.', 3200)
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
      {activeSkillSession ? <ActiveSkillPill session={activeSkillSession} /> : null}
      {selectedMediaInfo ? <MediaInfoPanel info={selectedMediaInfo} /> : null}
      {uploadProgress ? <UploadProgress progress={uploadProgress} /> : null}
      {frameAction ? (
        <FrameCodexAction
          action={frameAction}
          activeSkillSession={activeSkillSession}
          isGenerating={generatingFrameIds.has(frameAction.frameId)}
          onGenerate={generateFrameVersion}
          onSend={sendFrameToCodex}
        />
      ) : null}
    </div>
  )
}

function ActiveSkillPill({ session }: { session: NonNullable<ActiveSkillSession> }) {
  return (
    <div className="active-skill-pill" aria-live="polite">
      <span className="active-skill-pill__dot" aria-hidden="true" />
      <span>{session.displayName}</span>
      <em>{session.autoRun ? 'Generate mode' : 'Context mode'}</em>
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

function FrameCodexAction({
  action,
  activeSkillSession,
  isGenerating,
  onGenerate,
  onSend,
}: {
  action: NonNullable<FrameActionState>
  activeSkillSession: ActiveSkillSession
  isGenerating: boolean
  onGenerate: (frameId: string) => void
  onSend: (frameId: string) => void
}) {
  const isGenerateMode = Boolean(activeSkillSession?.autoRun)
  const sendTitle = `Send ${action.frameName} context to Codex`
  const generateTitle = `Generate a new version from ${action.frameName} using ${activeSkillSession?.displayName}`

  function keepPrimaryPointerOnButton(event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) {
    if ('button' in event && event.button !== 0) return
    event.stopPropagation()
  }

  return (
    <div
      className="frame-action-group"
      style={{ left: action.left, top: action.top }}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="frame-action-button"
        data-mode="send"
        onPointerDownCapture={keepPrimaryPointerOnButton}
        onPointerUpCapture={keepPrimaryPointerOnButton}
        onMouseDownCapture={keepPrimaryPointerOnButton}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSend(action.frameId)
        }}
        title={sendTitle}
      >
        <span className="frame-action-button__icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M3 2.75A1.75 1.75 0 0 1 4.75 1h6.5A1.75 1.75 0 0 1 13 2.75v10.5A1.75 1.75 0 0 1 11.25 15h-6.5A1.75 1.75 0 0 1 3 13.25V2.75Zm1.5 0v10.5c0 .14.11.25.25.25h6.5c.14 0 .25-.11.25-.25V2.75a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25Z" />
            <path d="M7.25 4.75h1.5v3.69l1.22-1.22 1.06 1.06L8 11.31 4.97 8.28l1.06-1.06 1.22 1.22V4.75Z" />
          </svg>
        </span>
        <span>Send to Codex</span>
      </button>
      {isGenerateMode ? (
        <button
          type="button"
          className="frame-action-button"
          data-mode="generate"
          onPointerDownCapture={keepPrimaryPointerOnButton}
          onPointerUpCapture={keepPrimaryPointerOnButton}
          onMouseDownCapture={keepPrimaryPointerOnButton}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onGenerate(action.frameId)
          }}
          disabled={isGenerating}
          title={generateTitle}
        >
          <span className="frame-action-button__icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M8.3 1.5 9.8 5l3.7 1.4-3.7 1.5-1.5 3.6-1.5-3.6L3.1 6.4 6.8 5l1.5-3.5Z" />
              <path d="M3.7 10.1 4.4 12l1.9.7-1.9.8-.7 1.8-.8-1.8-1.8-.8 1.8-.7.8-1.9Z" />
            </svg>
          </span>
          <span>{isGenerating ? 'Generating…' : 'Generate version'}</span>
        </button>
      ) : null}
    </div>
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
  return {
    title: stringFromUnknown(metadata.title) ?? stringFromUnknown(props.title) ?? (selectedMedia.type === 'video' ? 'Video asset' : 'Image asset'),
    prompt: stringFromUnknown(metadata.prompt) ?? stringFromUnknown(props.prompt),
    provider: stringFromUnknown(metadata.provider) ?? stringFromUnknown(props.provider),
    model: stringFromUnknown(metadata.model) ?? stringFromUnknown(props.model),
    generationMode: stringFromUnknown(metadata.generationMode) ?? stringFromUnknown(props.generationMode),
    status: stringFromUnknown(metadata.status) ?? stringFromUnknown(props.status),
    skillName: stringFromUnknown(metadata.skillName) ?? stringFromUnknown(props.skillName),
    localPath: stringFromUnknown(metadata.localPath) ?? stringFromUnknown(props.localPath) ?? stringFromUnknown(props.assetId),
    requestId: stringFromUnknown(metadata.requestId) ?? stringFromUnknown(props.requestId),
    executionId: stringFromUnknown(metadata.executionId) ?? stringFromUnknown(props.executionId),
  }
}

function createNativeGeneratedMediaRecords(input: {
  command: CanvasCommand
  childId: TLShapeId
  bounds: Bounds
  src: string
  versionId: string
}): { asset: TLAsset; shape: TLShapePartial } {
  const { command, childId, bounds, src, versionId } = input
  const mediaType = getCommandMediaType(command)
  const assetId = AssetRecordType.createId()
  const metadata = compactRecord({
    versionId,
    localPath: command.localPath,
    absolutePath: command.absolutePath,
    src,
    mediaType,
    title: command.title ?? (mediaType === 'video' ? 'Codex generated video' : 'Codex generated image'),
    prompt: command.prompt,
    provider: command.provider ?? 'codex',
    model: command.model,
    generationMode: command.generationMode,
    requestId: command.id,
    status: command.status ?? 'succeeded',
    skillName: command.skillName ?? (mediaType === 'video' ? 'codex-media-canvas-video' : 'codex-media-canvas-image'),
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
      codexMediaCanvas: metadata,
    },
  } as TLAsset

  const shape = {
    id: childId,
    type: mediaType,
    x: bounds.x,
    y: bounds.y,
    opacity: 1,
    props: {
      assetId,
      w: bounds.w,
      h: bounds.h,
    },
    meta: {
      codexMediaCanvas: metadata,
    },
  } as TLShapePartial

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
  for (const record of records) {
    const shape = record as TLArrowShape
    if (!shape || shape.typeName !== 'shape' || shape.type !== 'arrow') continue
    if (shape.meta?.[FLOATING_ARROW_META_KEY] !== true) continue

    const props = shape.props
    const nextProps: Partial<TLArrowShape['props']> = {}
    if (props.color && props.labelColor !== props.color) nextProps.labelColor = props.color
    if (props.labelPosition !== FLOATING_ARROW_LABEL_POSITION) nextProps.labelPosition = FLOATING_ARROW_LABEL_POSITION
    if (Object.keys(nextProps).length === 0) continue

    updates.push({
      id: shape.id,
      type: 'arrow',
      props: nextProps,
    })
  }

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
  if (localPath.startsWith('.codex-media-canvas/')) return `/asset-store/${localPath.slice('.codex-media-canvas/'.length)}`
  return undefined
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

function getMediaMetadata(editor: Editor, shape: TLShape) {
  const props = shape.props as Record<string, unknown>
  const assetId = stringFromUnknown(props.assetId)
  const asset = assetId ? (editor.getAsset(assetId as TLAssetId) as TLAsset | undefined) : undefined
  const assetMeta = (asset?.meta ?? {}) as Record<string, unknown>
  const shapeMeta = (shape.meta ?? {}) as Record<string, unknown>
  return {
    ...recordFromUnknown(assetMeta.codexMediaCanvas),
    ...recordFromUnknown(shapeMeta.codexMediaCanvas),
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
  const shapes = toCanvasShapeRecords(editor, editor.getCurrentPageShapesSorted())
  const activeFrameRecord = findActiveFrameForSelection(editor, shapes)
  const activeFrame = activeFrameRecord ? await extractMaterializedFrameContext(editor, shapes, activeFrameRecord.id) : undefined

  return {
    version: 1,
    selectedIds: selectedShapes.map((shape) => shape.id),
    selectedItems: await Promise.all(selectedShapes.map((shape) => toCanvasItem(editor, shape))),
    activeFrame,
    updatedAt: new Date().toISOString(),
  }
}

async function toCanvasItem(editor: Editor, shape: TLShape): Promise<CanvasItem> {
  const props = normalizeProps(shape)
  const bounds = getShapePageBoundsRecord(editor, shape)
  const asset = await getCanvasAssetContext(editor, shape, props)
  const text = getShapePlainText(props)
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
    kind: toCanvasItemKind(shape.type, props),
    canvasType: shape.type,
    parentId: shape.parentId,
    bounds: {
      ...bounds,
      rotation: typeof shape.rotation === 'number' && Number.isFinite(shape.rotation) ? shape.rotation : undefined,
    },
    text,
    asset,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
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
    localPath = `.codex-media-canvas/${src.slice('/asset-store/'.length)}`
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

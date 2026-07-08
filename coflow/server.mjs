import { createServer } from 'node:http'
import { cp, mkdir, readFile, stat, writeFile, appendFile, readdir, rm, rename, copyFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getProviderStatus } from './lib/provider-config.mjs'
import { buildProviderOnboarding } from './lib/provider-onboarding.mjs'
import { readProviderSettings, writeProviderSettings } from './lib/provider-settings.mjs'
import { buildCanvasManifest, mergeCanvasDocuments } from './lib/canvas-document-store.mjs'
import { resolveRuntimePaths } from './lib/runtime-paths.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const distRoot = join(root, 'dist')
const runtimePaths = resolveRuntimePaths({ root })
const workspaceRoot = runtimePaths.workspaceRoot
const STORE_DIR = runtimePaths.storeDir
const storeRoot = runtimePaths.storeRoot
const legacyStoreRoot = runtimePaths.legacyStoreRoot
const metadataRoot = join(storeRoot, 'metadata')
const logsRoot = join(storeRoot, 'logs')
const commandsRoot = join(storeRoot, 'commands')
const assetsRoot = join(storeRoot, 'assets')
const executionsRoot = join(storeRoot, 'executions')
const uploadsRoot = join(storeRoot, 'uploads')
const canvasRoot = join(storeRoot, 'canvas')
const canvasPagesRoot = join(canvasRoot, 'pages')
const canvasBackupsRoot = join(canvasRoot, 'backups')
const frameInputsRoot = join(storeRoot, 'frame-inputs')
const frameScreenshotsRoot = join(storeRoot, 'frame-screenshots')
const latestFrameContextPath = join(metadataRoot, 'latest-frame-context.json')
const latestSelectionPath = join(metadataRoot, 'latest-selection.json')
const latestCodexFrameRequestPath = join(metadataRoot, 'latest-codex-frame-request.json')
const latestFrameInputPath = join(metadataRoot, 'latest-frame-input.json')
const latestFrameScreenshotPath = join(metadataRoot, 'latest-frame-screenshot.json')
const latestGenerationRequestPath = join(metadataRoot, 'latest-generation-request.json')
const latestExecutionResultPath = join(metadataRoot, 'latest-execution-result.json')
const providerSettingsPath = join(metadataRoot, 'provider-settings.json')
const selectionCaptureRequestsRoot = join(metadataRoot, 'selection-capture-requests')
const selectionCaptureResponsesRoot = join(metadataRoot, 'selection-capture-responses')
const canvasDocumentPath = join(canvasRoot, 'document.json')
const canvasManifestPath = join(canvasRoot, 'manifest.json')
const canvasViewStatePath = join(canvasRoot, 'view-state.json')
const operationsLogPath = join(logsRoot, 'operations.jsonl')
const pendingCommandsPath = join(commandsRoot, 'pending.jsonl')
const CANVAS_CLIENT_VERSION = '2026-06-27-native-media-writeback-v1'

await loadLocalEnv([join(workspaceRoot, '.env.local'), join(root, '.env.local'), join(workspaceRoot, '.env')])

const port = Number(process.env.PORT || 5176)

await migrateLegacyStore()
await mkdir(metadataRoot, { recursive: true })
await mkdir(logsRoot, { recursive: true })
await mkdir(commandsRoot, { recursive: true })
await mkdir(assetsRoot, { recursive: true })
await mkdir(executionsRoot, { recursive: true })
await mkdir(uploadsRoot, { recursive: true })
await mkdir(canvasRoot, { recursive: true })
await mkdir(canvasPagesRoot, { recursive: true })
await mkdir(canvasBackupsRoot, { recursive: true })
await mkdir(frameInputsRoot, { recursive: true })
await mkdir(frameScreenshotsRoot, { recursive: true })
await mkdir(selectionCaptureRequestsRoot, { recursive: true })
await mkdir(selectionCaptureResponsesRoot, { recursive: true })

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

    if (url.pathname === '/api/runtime' && request.method === 'GET') {
      return sendJson(response, {
        ok: true,
        runtime: getRuntimeInfo(),
      })
    }

    if (url.pathname === '/api/frame-context' && request.method === 'POST') {
      const body = await readJsonBody(request)
      await writeJson(latestFrameContextPath, {
        updatedAt: new Date().toISOString(),
        source: 'coflow',
        context: body,
      })
      await appendOperation({ type: 'frame-context.updated', context: body })
      return sendJson(response, { ok: true })
    }

    if (url.pathname === '/api/frame-context' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestFrameContextPath, null))
    }

    if (url.pathname === '/api/selection' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const selection = normalizeSelectionSnapshot(body)
      await writeJson(latestSelectionPath, {
        updatedAt: new Date().toISOString(),
        source: 'coflow',
        selection,
      })
      await appendOperation({ type: 'selection.updated', selection })
      return sendJson(response, { ok: true })
    }

    if (url.pathname === '/api/selection' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestSelectionPath, null))
    }

    if (url.pathname === '/api/selection/fresh-capture/request' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const captureRequest = {
        id: typeof body?.id === 'string' && body.id ? body.id : `selection-capture:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        at: new Date().toISOString(),
        source: typeof body?.source === 'string' && body.source ? body.source : 'coflow-mcp',
      }
      await writeJson(join(selectionCaptureRequestsRoot, `${sanitizeFilePart(captureRequest.id)}.json`), captureRequest)
      await appendOperation({ type: 'selection.fresh_capture.requested', request: captureRequest })
      return sendJson(response, { ok: true, request: captureRequest })
    }

    if (url.pathname === '/api/selection/fresh-capture/pending' && request.method === 'GET') {
      return sendJson(response, { ok: true, requests: await readPendingSelectionCaptureRequests() })
    }

    if (url.pathname === '/api/selection/fresh-capture/response' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const requestId = typeof body?.requestId === 'string' && body.requestId ? body.requestId : undefined
      if (!requestId) return sendJson(response, { ok: false, error: 'requestId is required.' }, 400)
      const selection = normalizeSelectionSnapshot(body?.selection)
      const captureResponse = {
        id: requestId,
        updatedAt: new Date().toISOString(),
        source: 'coflow',
        selection,
      }
      await writeJson(latestSelectionPath, captureResponse)
      await writeJson(join(selectionCaptureResponsesRoot, `${sanitizeFilePart(requestId)}.json`), captureResponse)
      await rm(join(selectionCaptureRequestsRoot, `${sanitizeFilePart(requestId)}.json`), { force: true })
      await appendOperation({ type: 'selection.fresh_capture.responded', requestId, selection })
      return sendJson(response, { ok: true, response: captureResponse })
    }

    if (url.pathname === '/api/selection/fresh-capture/response' && request.method === 'GET') {
      const requestId = url.searchParams.get('id')
      if (!requestId) return sendJson(response, { ok: false, error: 'id is required.' }, 400)
      return sendJson(response, await readJsonFile(join(selectionCaptureResponsesRoot, `${sanitizeFilePart(requestId)}.json`), null))
    }

    if (url.pathname === '/api/operations' && request.method === 'POST') {
      const body = await readJsonBody(request)
      await appendOperation(body)
      return sendJson(response, { ok: true })
    }

    if ((url.pathname === '/api/canvas/document' || url.pathname === '/api/canvas') && request.method === 'GET') {
      return sendJson(response, {
        ok: true,
        document: await readCanvasDocument(),
      })
    }

    if ((url.pathname === '/api/canvas/document' || url.pathname === '/api/canvas') && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request)
      if (!body?.snapshot || typeof body.snapshot !== 'object') {
        return sendJson(response, { ok: false, error: 'Canvas document snapshot is required.' }, 400)
      }

      const document = {
        version: 1,
        updatedAt: new Date().toISOString(),
        source: 'coflow',
        clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion : undefined,
        currentPageId: typeof body.currentPageId === 'string' ? body.currentPageId : undefined,
        camera: normalizeCamera(body.camera),
        snapshot: body.snapshot,
      }
      await writeCanvasDocument(document)
      await appendOperation({
        type: 'canvas.document.saved',
        currentPageId: document.currentPageId,
        camera: document.camera,
        clientVersion: document.clientVersion,
      })
      return sendJson(response, { ok: true, document })
    }

    if (url.pathname === '/api/canvas/view-state' && request.method === 'GET') {
      return sendJson(response, {
        ok: true,
        viewState: await readJsonFile(canvasViewStatePath, null),
      })
    }

    if (url.pathname === '/api/canvas/view-state' && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request)
      const viewState = {
        version: 1,
        updatedAt: new Date().toISOString(),
        source: 'coflow',
        currentPageId: typeof body.currentPageId === 'string' ? body.currentPageId : undefined,
        camera: normalizeCamera(body.camera),
      }
      await writeJsonAtomic(canvasViewStatePath, viewState)
      await appendOperation({ type: 'canvas.view_state.saved', currentPageId: viewState.currentPageId, camera: viewState.camera })
      return sendJson(response, { ok: true, viewState })
    }

    if (url.pathname === '/api/generation-requests' && request.method === 'POST') {
      const body = await readJsonBody(request)
      await writeJson(latestGenerationRequestPath, {
        updatedAt: new Date().toISOString(),
        source: 'coflow',
        request: body,
      })
      await appendOperation({ type: 'generation.requested', request: body })
      return sendJson(response, { ok: true, request: body })
    }

    if (url.pathname === '/api/generation-requests/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestGenerationRequestPath, null))
    }

    if (url.pathname === '/api/provider/status' && request.method === 'GET') {
      const providerSettings = await readProviderSettings(readJsonFile, providerSettingsPath, process.env)
      return sendJson(
        response,
        getProviderStatus(process.env, {
          workspaceRoot,
          canvasUrl: `http://127.0.0.1:${port}`,
          providerSettings,
          settingsPath: providerSettingsPath,
        }),
      )
    }

    if (url.pathname === '/api/provider/settings' && request.method === 'GET') {
      const settings = await readProviderSettings(readJsonFile, providerSettingsPath, process.env)
      return sendJson(response, {
        ok: true,
        settingsPath: providerSettingsPath,
        settings,
      })
    }

    if (url.pathname === '/api/provider/onboarding' && request.method === 'GET') {
      const settings = await readProviderSettings(readJsonFile, providerSettingsPath, process.env)
      const status = getProviderStatus(process.env, {
        workspaceRoot,
        canvasUrl: `http://127.0.0.1:${port}`,
        providerSettings: settings,
        settingsPath: providerSettingsPath,
      })
      return sendJson(
        response,
        buildProviderOnboarding({
          providerSettings: settings,
          providerStatus: status,
          settingsPath: providerSettingsPath,
        }),
      )
    }

    if (url.pathname === '/api/provider/settings' && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request)
      const settings = await writeProviderSettings({
        input: body,
        readJsonFile,
        writeJson,
        settingsPath: providerSettingsPath,
        env: process.env,
      })
      await appendOperation({ type: 'provider.settings.updated', settings })
      return sendJson(response, {
        ok: true,
        settingsPath: providerSettingsPath,
        settings,
      })
    }

    if (url.pathname === '/api/codex/frame-requests' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const at = new Date().toISOString()
      const frameRequest = {
        id: body.id || `frame-request:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        at,
        source: body.source || 'canvas-frame-action',
        status: body.status || 'awaiting_user_instruction',
        frameId: body.frameId,
        summary: body.summary,
        promptPart: body.promptPart,
        recommendedUserPrompt:
          body.recommendedUserPrompt ||
          'Review this frame context in Codex, add any missing intent, then ask Codex to generate or edit and write the result back to the canvas.',
        defaultInstruction:
          body.defaultInstruction ||
          'Treat this as a pending Codex canvas request. Summarize the selected frame context in the Codex conversation first, wait for the user to confirm or add instructions, then choose the right Skill/provider/model and call canvas.insert_media or canvas.create_version to place the result back.',
      }
      const frameInput = await writeFrameInputArtifact(frameRequest)
      frameRequest.frameInput = frameInput
      await writeJson(latestCodexFrameRequestPath, {
        updatedAt: at,
        source: 'coflow',
        request: frameRequest,
      })
      await writeJson(latestFrameInputPath, {
        updatedAt: at,
        source: 'coflow',
        frameInput,
      })
      await appendOperation({ type: 'codex.frame_request.created', request: frameRequest })
      return sendJson(response, { ok: true, request: frameRequest })
    }

    if (url.pathname === '/api/codex/frame-requests/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestCodexFrameRequestPath, null))
    }

    if (url.pathname === '/api/codex/frame-input/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestFrameInputPath, null))
    }

    if (url.pathname === '/api/codex/frame-screenshots' && request.method === 'POST') {
      const screenshot = await saveFrameScreenshot(request)
      await writeJson(latestFrameScreenshotPath, {
        updatedAt: new Date().toISOString(),
        source: 'coflow',
        screenshot,
      })
      await appendOperation({ type: 'codex.frame_screenshot.saved', screenshot })
      return sendJson(response, { ok: true, screenshot })
    }

    if (url.pathname === '/api/codex/frame-screenshots/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestFrameScreenshotPath, null))
    }

    if (url.pathname === '/api/executions/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestExecutionResultPath, null))
    }

    if (url.pathname === '/api/commands' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const command = createCommand(body)
      await appendCommand(command)
      await appendOperation({ type: 'command.enqueued', command })
      return sendJson(response, { ok: true, command })
    }

    if (url.pathname === '/api/commands/pending' && request.method === 'GET') {
      const commands = await claimPendingCommands(url.searchParams.get('type'), url.searchParams.get('clientVersion'))
      return sendJson(response, { ok: true, commands })
    }

    if (url.pathname === '/api/assets/materialize' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const materialized = await materializeAsset(body)
      await appendOperation({ type: 'asset.materialized', asset: materialized })
      return sendJson(response, { ok: true, asset: materialized })
    }

    if (url.pathname === '/api/assets/upload' && request.method === 'POST') {
      const uploaded = await uploadAsset(request)
      await appendOperation({ type: 'asset.uploaded', asset: uploaded })
      return sendJson(response, { ok: true, asset: uploaded })
    }

    if (url.pathname === '/api/assets/uploads/start' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const upload = await startChunkedUpload(body)
      await appendOperation({ type: 'asset.upload.started', upload })
      return sendJson(response, { ok: true, upload })
    }

    if (url.pathname === '/api/assets/uploads/chunk' && request.method === 'POST') {
      const chunk = await uploadAssetChunk(request)
      return sendJson(response, { ok: true, chunk })
    }

    if (url.pathname === '/api/assets/uploads/complete' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const uploaded = await completeChunkedUpload(body)
      await appendOperation({ type: 'asset.upload.completed', asset: uploaded })
      return sendJson(response, { ok: true, asset: uploaded })
    }

    if (url.pathname.startsWith('/asset-store/')) {
      return serveStoreAsset(response, url.pathname)
    }

    await serveStatic(response, url.pathname)
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port 127.0.0.1:${port} is already in use.`)
    console.error(`Stop the old server first: lsof -nP -iTCP:${port} -sTCP:LISTEN`)
    console.error(`Or start this server on another port: PORT=5177 npm run serve`)
    process.exit(1)
  }

  if (error?.code === 'EPERM') {
    console.error(`This process is not allowed to listen on 127.0.0.1:${port}.`)
    console.error('Run the server from your local terminal, or grant the Codex sandbox permission to bind local ports.')
    process.exit(1)
  }

  console.error(error)
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`CoFlow local server listening on http://127.0.0.1:${port}/`)
  console.log(`Workspace store: ${storeRoot}`)
  console.log(
    process.env.ATLASCLOUD_API_KEY || process.env.ATLAS_PROVIDER_API_KEY || process.env.REAL_PROVIDER_API_KEY
      ? 'Atlas Cloud provider key: configured'
      : 'Atlas Cloud provider key: missing. Add ATLASCLOUD_API_KEY to .env.local or export it before npm run serve.',
  )
})

async function loadLocalEnv(paths) {
  for (const path of paths) {
    let raw = ''
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      continue
    }

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key] !== undefined) continue
      process.env[key] = parseEnvValue(rawValue)
    }

    console.log(`Loaded local environment from ${path}`)
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  const commentIndex = value.indexOf(' #')
  return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value
}

async function serveStatic(response, pathname) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const candidate = join(distRoot, safePath === '/' ? 'index.html' : safePath)
  const filePath = (await exists(candidate)) ? candidate : join(distRoot, 'index.html')
  const content = await readFile(filePath)
  response.writeHead(200, { 'content-type': contentType(filePath) })
  response.end(content)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function migrateLegacyStore() {
  if (await exists(storeRoot)) return
  if (!(await exists(legacyStoreRoot))) return
  await cp(legacyStoreRoot, storeRoot, { recursive: true, force: false, errorOnExist: false })
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(path, data) {
  await writeJsonAtomic(path, data)
}

async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`)
  await rename(tempPath, path)
}

async function readCanvasDocument() {
  const documents = []
  const legacyDocument = await readJsonFile(canvasDocumentPath, null)
  if (legacyDocument?.snapshot) documents.push(legacyDocument)

  for (const pageDocument of await readCanvasPageDocuments()) {
    if (pageDocument?.snapshot) documents.push(pageDocument)
  }

  return mergeCanvasDocuments(documents)
}

async function writeCanvasDocument(document) {
  const activePageId = sanitizeFilePart(document.currentPageId || 'page')
  const pageDocumentPath = getCanvasPageDocumentPath(activePageId)
  const existingManifest = await readJsonFile(canvasManifestPath, null)
  const manifest = buildCanvasManifest(document, existingManifest)

  await backupCanvasFileIfPresent(pageDocumentPath, activePageId)
  await writeJsonAtomic(pageDocumentPath, document)
  await writeJsonAtomic(canvasDocumentPath, document)
  await writeJsonAtomic(canvasManifestPath, manifest)
  if (document.camera || document.currentPageId) {
    await writeJsonAtomic(canvasViewStatePath, {
      version: 1,
      updatedAt: document.updatedAt,
      source: document.source,
      currentPageId: document.currentPageId,
      camera: document.camera,
    })
  }
}

async function readCanvasPageDocuments() {
  let entries
  try {
    entries = await readdir(canvasPagesRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const documents = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const document = await readJsonFile(join(canvasPagesRoot, entry.name, 'canvas.json'), null)
    if (document?.snapshot) documents.push(document)
  }
  return documents
}

function getCanvasPageDocumentPath(pageId) {
  return join(canvasPagesRoot, sanitizeFilePart(pageId), 'canvas.json')
}

async function backupCanvasFileIfPresent(path, pageId) {
  try {
    await stat(path)
  } catch {
    return
  }

  const backupName = `${sanitizeFilePart(pageId)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  await mkdir(canvasBackupsRoot, { recursive: true })
  await copyFile(path, join(canvasBackupsRoot, backupName))
}

async function appendOperation(operation) {
  await appendFile(
    operationsLogPath,
    `${JSON.stringify({
      at: new Date().toISOString(),
      ...operation,
    })}\n`,
  )
}

async function appendCommand(command) {
  await appendFile(pendingCommandsPath, `${JSON.stringify(command)}\n`)
}

async function readPendingSelectionCaptureRequests() {
  let names = []
  try {
    names = await readdir(selectionCaptureRequestsRoot)
  } catch {
    return []
  }

  const requests = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const request = await readJsonFile(join(selectionCaptureRequestsRoot, name), null)
    if (request?.id) requests.push(request)
  }
  return requests.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
}

async function writeFrameInputArtifact(frameRequest) {
  const fileName = `${sanitizeFilePart(frameRequest.id || `frame-request-${Date.now()}`)}.json`
  const absolutePath = join(frameInputsRoot, fileName)
  const localPath = `.coflow/frame-inputs/${fileName}`
  const frameInput = {
    kind: 'coflow.frame-input',
    version: 1,
    fileName,
    mimeType: 'application/json',
    localPath,
    absolutePath,
    createdAt: frameRequest.at,
    requestId: frameRequest.id,
    source: frameRequest.source,
    status: frameRequest.status,
    frameId: frameRequest.frameId,
    summary: frameRequest.summary,
    frameScreenshot: frameRequest.frameScreenshot,
    defaultInstruction: frameRequest.defaultInstruction,
    recommendedUserPrompt: frameRequest.recommendedUserPrompt,
    promptPart: frameRequest.promptPart,
  }
  await writeJson(absolutePath, frameInput)
  return {
    fileName,
    mimeType: frameInput.mimeType,
    localPath,
    absolutePath,
  }
}

async function saveFrameScreenshot(request) {
  const frameId = String(request.headers['x-frame-id'] || 'frame')
  const frameName = safeDecodeURIComponent(request.headers['x-frame-name'] || '')
  const includedShapeIds = parseJsonHeader(request.headers['x-included-shape-ids'], [])
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const buffer = Buffer.concat(chunks)
  if (buffer.length === 0) throw new Error('Frame screenshot upload is empty.')

  const fileName = `${sanitizeFilePart(`${frameId}-${Date.now()}`)}.png`
  const absolutePath = join(frameScreenshotsRoot, fileName)
  const localPath = `.coflow/frame-screenshots/${fileName}`
  await writeFile(absolutePath, buffer)

  return {
    fileName,
    mimeType: 'image/png',
    localPath,
    absolutePath,
    frameId,
    frameName,
    includedShapeIds,
    bytes: buffer.length,
  }
}

function parseJsonHeader(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(safeDecodeURIComponent(value))
  } catch {
    return fallback
  }
}

async function claimPendingCommands(type, clientVersion) {
  let raw = ''
  try {
    raw = await readFile(pendingCommandsPath, 'utf8')
  } catch {
    return []
  }

  const commands = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const canClaim = (command) => {
    if (type && command.type !== type) return false
    if (command.minClientVersion && command.minClientVersion !== clientVersion) return false
    return true
  }

  const claimed = commands.filter(canClaim)
  const remaining = commands.filter((command) => !canClaim(command))
  await writeFile(pendingCommandsPath, remaining.map((command) => JSON.stringify(command)).join('\n') + (remaining.length > 0 ? '\n' : ''))
  return claimed
}

function createCommand(input) {
  return {
    id: input.id || `command:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    source: input.source || 'browser-api',
    type: input.type,
    requestedTool: input.requestedTool,
    frameId: input.frameId,
    sourceShapeId: input.sourceShapeId,
    targetShapeId: input.targetShapeId,
    linkType: input.linkType,
    prompt: input.prompt,
    provider: input.provider,
    outputMediaType: input.outputMediaType,
    generationMode: input.generationMode,
    references: Array.isArray(input.references) ? input.references : undefined,
    mediaType: input.mediaType,
    src: input.src,
    localPath: input.localPath,
    absolutePath: input.absolutePath,
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight,
    generationStartedAt: input.generationStartedAt,
    generationCompletedAt: input.generationCompletedAt,
    generationDurationMs: input.generationDurationMs,
    providerTimings: input.providerTimings,
    e2eStartedAt: input.e2eStartedAt,
    e2eCompletedAt: input.e2eCompletedAt,
    e2eDurationMs: input.e2eDurationMs,
    writebackCompletedAt: input.writebackCompletedAt,
    title: input.title,
    model: input.model,
    status: input.status,
    skillName: input.skillName,
    minClientVersion: input.minClientVersion,
  }
}

function getRuntimeInfo() {
  return {
    version: 1,
    root,
    workspaceRoot,
    storeDir: STORE_DIR,
    storageSource: runtimePaths.storageSource,
    storeRoot,
    legacyStoreRoot,
    metadataRoot,
    assetsRoot,
    commandsRoot,
    pendingCommandsPath,
    canvasRoot,
    canvasPagesRoot,
    canvasDocumentPath,
    clientVersion: CANVAS_CLIENT_VERSION,
    port,
  }
}

function normalizeSelectionSnapshot(input) {
  const selectedIds = Array.isArray(input?.selectedIds) ? input.selectedIds.filter((id) => typeof id === 'string') : []
  const selectedItems = Array.isArray(input?.selectedItems)
    ? input.selectedItems.filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    : []

  return {
    version: 1,
    selectedIds,
    selectedItems,
    activeFrame: input?.activeFrame && typeof input.activeFrame === 'object' ? input.activeFrame : undefined,
    viewport: normalizeViewportSnapshot(input?.viewport),
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  }
}

function normalizeViewportSnapshot(input) {
  if (!input || typeof input !== 'object') return undefined
  const bounds = normalizeBounds(input.bounds)
  const items = Array.isArray(input.items)
    ? input.items.filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    : []
  if (!bounds && items.length === 0) return undefined
  return {
    bounds: bounds || { x: 0, y: 0, w: 1, h: 1 },
    camera: normalizeCamera(input.camera),
    items,
  }
}

function normalizeBounds(input) {
  if (!input || typeof input !== 'object') return undefined
  const x = Number(input.x)
  const y = Number(input.y)
  const w = Number(input.w)
  const h = Number(input.h)
  if (![x, y, w, h].every(Number.isFinite)) return undefined
  return { x, y, w, h }
}

function normalizeCamera(input) {
  if (!input || typeof input !== 'object') return undefined
  const x = Number(input.x)
  const y = Number(input.y)
  const z = Number(input.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined
  return { x, y, z }
}

async function materializeAsset(input) {
  const mimeType = typeof input.mimeType === 'string' && input.mimeType ? input.mimeType : mimeTypeFromDataUrl(input.src)
  const extension = extensionFromMimeType(mimeType)
  const group = mimeType.startsWith('video/') ? 'videos' : 'images'
  const assetId = sanitizeFilePart(input.assetId || `asset-${Date.now()}`)
  const name = sanitizeFilePart(stripKnownExtension(input.name || assetId, extension))
  const filename = `${assetId}-${name}.${extension}`
  const absolutePath = join(assetsRoot, group, filename)
  const localPath = `.coflow/assets/${group}/${filename}`
  const bytes = bytesFromDataUrl(input.src)

  await mkdir(join(assetsRoot, group), { recursive: true })
  await writeFile(absolutePath, bytes)

  return {
    assetId: input.assetId,
    shapeId: input.shapeId,
    mimeType,
    localPath,
    absolutePath,
    bytes: bytes.length,
  }
}

async function uploadAsset(request) {
  const mimeType =
    typeof request.headers['content-type'] === 'string' && request.headers['content-type']
      ? request.headers['content-type'].split(';')[0]
      : 'application/octet-stream'
  const extension = extensionFromMimeType(mimeType)
  const group = mimeType.startsWith('video/') ? 'videos' : 'images'
  const assetId = sanitizeFilePart(request.headers['x-asset-id'] || `asset-${Date.now()}`)
  const encodedName = typeof request.headers['x-file-name'] === 'string' ? request.headers['x-file-name'] : assetId
  const decodedName = safeDecodeURIComponent(encodedName)
  const name = sanitizeFilePart(stripKnownExtension(decodedName || assetId, extension))
  const filename = `${assetId}-${Date.now()}-${name}.${extension}`
  const absolutePath = join(assetsRoot, group, filename)
  const localPath = `.coflow/assets/${group}/${filename}`
  const src = `/asset-store/assets/${group}/${filename}`
  const bytes = await readRawBody(request)

  await mkdir(join(assetsRoot, group), { recursive: true })
  await writeFile(absolutePath, bytes)

  return {
    assetId,
    mimeType,
    src,
    localPath,
    absolutePath,
    bytes: bytes.length,
  }
}

async function startChunkedUpload(input) {
  const mimeType = typeof input.mimeType === 'string' && input.mimeType ? input.mimeType : 'application/octet-stream'
  const extension = extensionFromMimeType(mimeType)
  const group = mimeType.startsWith('video/') ? 'videos' : 'images'
  const assetId = sanitizeFilePart(input.assetId || `asset-${Date.now()}`)
  const name = sanitizeFilePart(stripKnownExtension(input.name || assetId, extension))
  const uploadId = sanitizeFilePart(`upload-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const filename = `${assetId}-${Date.now()}-${name}.${extension}`
  const uploadRoot = join(uploadsRoot, uploadId)
  const manifest = {
    uploadId,
    assetId,
    mimeType,
    group,
    filename,
    expectedBytes: Number(input.size || 0),
    chunkSize: Number(input.chunkSize || 0),
    createdAt: new Date().toISOString(),
  }

  await mkdir(uploadRoot, { recursive: true })
  await writeJson(join(uploadRoot, 'manifest.json'), manifest)

  return manifest
}

async function uploadAssetChunk(request) {
  const uploadId = sanitizeFilePart(request.headers['x-upload-id'])
  const chunkIndex = Number(request.headers['x-chunk-index'])
  if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error('Invalid upload chunk headers.')
  }
  const uploadRoot = join(uploadsRoot, uploadId)
  const manifest = await readJsonFile(join(uploadRoot, 'manifest.json'), null)
  if (!manifest) throw new Error(`Upload not found: ${uploadId}`)
  const bytes = await readRawBody(request)
  const chunkPath = join(uploadRoot, `${String(chunkIndex).padStart(8, '0')}.part`)
  await writeFile(chunkPath, bytes)
  return {
    uploadId,
    chunkIndex,
    bytes: bytes.length,
  }
}

async function completeChunkedUpload(input) {
  const uploadId = sanitizeFilePart(input.uploadId)
  const uploadRoot = join(uploadsRoot, uploadId)
  const manifest = await readJsonFile(join(uploadRoot, 'manifest.json'), null)
  if (!manifest) throw new Error(`Upload not found: ${uploadId}`)

  const absolutePath = join(assetsRoot, manifest.group, manifest.filename)
  const localPath = `.coflow/assets/${manifest.group}/${manifest.filename}`
  const src = `/asset-store/assets/${manifest.group}/${manifest.filename}`
  await mkdir(join(assetsRoot, manifest.group), { recursive: true })

  const chunks = (await readdir(uploadRoot))
    .filter((name) => name.endsWith('.part'))
    .sort()
  if (chunks.length === 0) throw new Error(`No chunks found for upload: ${uploadId}`)

  await writeFile(absolutePath, '')
  let bytes = 0
  for (const chunkName of chunks) {
    const chunk = await readFile(join(uploadRoot, chunkName))
    bytes += chunk.length
    await appendFile(absolutePath, chunk)
  }
  await rm(uploadRoot, { recursive: true, force: true })

  return {
    assetId: manifest.assetId,
    mimeType: manifest.mimeType,
    src,
    localPath,
    absolutePath,
    bytes,
    uploadId,
    chunkCount: chunks.length,
  }
}

async function serveStoreAsset(response, pathname) {
  const relative = normalize(pathname.replace(/^\/asset-store\//, '')).replace(/^(\.\.[/\\])+/, '')
  if (!relative.startsWith('assets/')) {
    response.writeHead(404)
    response.end('Not found')
    return
  }
  const filePath = join(storeRoot, relative)
  const content = await readFile(filePath)
  response.writeHead(200, { 'content-type': contentType(filePath) })
  response.end(content)
}

async function readRawBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function bytesFromDataUrl(src) {
  if (typeof src !== 'string' || !src.startsWith('data:')) {
    throw new Error('Asset materialization requires a data URL payload.')
  }
  const comma = src.indexOf(',')
  if (comma < 0) throw new Error('Invalid data URL payload.')
  const metadata = src.slice(0, comma)
  const payload = src.slice(comma + 1)
  return metadata.endsWith(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
}

function mimeTypeFromDataUrl(src) {
  if (typeof src !== 'string') return 'application/octet-stream'
  const match = src.match(/^data:([^;,]+)/)
  return match?.[1] || 'application/octet-stream'
}

function extensionFromMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/svg+xml') return 'svg'
  if (mimeType === 'video/mp4') return 'mp4'
  if (mimeType === 'video/webm') return 'webm'
  if (mimeType === 'video/quicktime') return 'mov'
  return 'bin'
}

function sanitizeFilePart(value) {
  return basename(String(value))
    .replace(/^asset:/, '')
    .replace(/^shape:/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function stripKnownExtension(value, extension) {
  const text = String(value)
  const suffix = `.${extension}`
  return text.toLowerCase().endsWith(suffix.toLowerCase()) ? text.slice(0, -suffix.length) : text
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
}

function sendJson(response, data, statusCode = 200) {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify(data, null, 2))
}

function contentType(path) {
  const ext = extname(path)
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  return 'application/octet-stream'
}

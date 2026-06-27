import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile, appendFile, readdir, rm, rename, copyFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { prepareProviderExecution } from './lib/provider-executor.mjs'

const execFileAsync = promisify(execFile)

const root = fileURLToPath(new URL('.', import.meta.url))
const distRoot = join(root, 'dist')
const workspaceRoot = process.env.WORKSPACE_ROOT || join(root, '..')
const storeRoot = join(workspaceRoot, '.codex-media-canvas')
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
const latestAgentPromptPath = join(metadataRoot, 'latest-agent-prompt.json')
const latestCodexFrameRequestPath = join(metadataRoot, 'latest-codex-frame-request.json')
const latestFrameInputPath = join(metadataRoot, 'latest-frame-input.json')
const latestFrameScreenshotPath = join(metadataRoot, 'latest-frame-screenshot.json')
const latestGenerationRequestPath = join(metadataRoot, 'latest-generation-request.json')
const latestExecutionResultPath = join(metadataRoot, 'latest-execution-result.json')
const activeSkillSessionPath = join(metadataRoot, 'active-skill-session.json')
const canvasDocumentPath = join(canvasRoot, 'document.json')
const canvasManifestPath = join(canvasRoot, 'manifest.json')
const canvasViewStatePath = join(canvasRoot, 'view-state.json')
const operationsLogPath = join(logsRoot, 'operations.jsonl')
const pendingCommandsPath = join(commandsRoot, 'pending.jsonl')
const CANVAS_CLIENT_VERSION = '2026-06-27-native-media-writeback-v1'

await loadLocalEnv([join(workspaceRoot, '.env.local'), join(root, '.env.local'), join(workspaceRoot, '.env')])

const port = Number(process.env.PORT || 5176)

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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

    if (url.pathname === '/api/frame-context' && request.method === 'POST') {
      const body = await readJsonBody(request)
      await writeJson(latestFrameContextPath, {
        updatedAt: new Date().toISOString(),
        source: 'phase0-tldraw-spike',
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
        source: 'phase0-tldraw-spike',
        selection,
      })
      await appendOperation({ type: 'selection.updated', selection })
      return sendJson(response, { ok: true })
    }

    if (url.pathname === '/api/selection' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestSelectionPath, null))
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
        source: 'phase0-tldraw-spike',
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
        source: 'phase0-tldraw-spike',
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
        source: 'phase0-tldraw-spike',
        request: body,
      })
      await appendOperation({ type: 'generation.requested', request: body })
      return sendJson(response, { ok: true, request: body })
    }

    if (url.pathname === '/api/generation-requests/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestGenerationRequestPath, null))
    }

    if (url.pathname === '/api/agent/prompt' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const command = createCommand({
        ...body,
        type: 'canvas.agent_prompt',
        source: body.source || 'codex-agent-bridge',
        prompt: body.prompt || body.message,
      })
      await writeJson(latestAgentPromptPath, {
        updatedAt: new Date().toISOString(),
        source: command.source,
        command,
      })
      await appendCommand(command)
      await appendOperation({ type: 'agent.prompt.enqueued', command })
      return sendJson(response, {
        ok: true,
        command,
        note: 'Queued a Codex-style agent prompt for the external Codex/Skill runtime. The canvas no longer auto-executes provider calls from this queue.',
      })
    }

    if (url.pathname === '/api/agent/prompt/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestAgentPromptPath, null))
    }

    if (url.pathname === '/api/active-skill/session' && request.method === 'GET') {
      return sendJson(response, { ok: true, session: await readActiveSkillSession() })
    }

    if (url.pathname === '/api/active-skill/session' && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request)
      const session = await writeActiveSkillSession(body)
      await appendOperation({ type: 'active_skill.session_started', session })
      return sendJson(response, { ok: true, session })
    }

    if (url.pathname === '/api/active-skill/session' && request.method === 'DELETE') {
      await clearActiveSkillSession()
      await appendOperation({ type: 'active_skill.session_cleared' })
      return sendJson(response, { ok: true, session: null })
    }

    if (url.pathname === '/api/active-skill/run-frame' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const result = await runActiveSkillFrame(body)
      await appendOperation({ type: 'active_skill.frame_executed', result })
      return sendJson(response, { ok: true, ...result })
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
        source: 'phase0-tldraw-spike',
        request: frameRequest,
      })
      await writeJson(latestFrameInputPath, {
        updatedAt: at,
        source: 'phase0-tldraw-spike',
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
        source: 'phase0-tldraw-spike',
        screenshot,
      })
      await appendOperation({ type: 'codex.frame_screenshot.saved', screenshot })
      return sendJson(response, { ok: true, screenshot })
    }

    if (url.pathname === '/api/codex/frame-screenshots/latest' && request.method === 'GET') {
      return sendJson(response, await readJsonFile(latestFrameScreenshotPath, null))
    }

    if (url.pathname === '/api/executions/run-latest' && request.method === 'POST') {
      const latest = await readJsonFile(latestGenerationRequestPath, null)
      if (!latest?.request) return sendJson(response, { ok: false, error: 'No latest generation request found.' })
      const result = await runGenerationExecutor(latest.request)
      await writeJson(latestExecutionResultPath, {
        updatedAt: new Date().toISOString(),
        source: 'phase0-tldraw-spike',
        result,
      })
      await appendOperation({ type: 'generation.executed', result })
      return sendJson(response, { ok: true, result })
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
  console.log(`Codex Media Canvas local server listening on http://127.0.0.1:${port}/`)
  console.log(`Workspace store: ${storeRoot}`)
  console.log(
    process.env.ATLASCLOUD_API_KEY || process.env.ATLAS_PROVIDER_API_KEY || process.env.REAL_PROVIDER_API_KEY
      ? 'Atlas provider key: configured'
      : 'Atlas provider key: missing. Add ATLASCLOUD_API_KEY to .env.local or export it before npm run serve.',
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
  const manifest = await readJsonFile(canvasManifestPath, null)
  const activePageId = typeof manifest?.activePageId === 'string' ? manifest.activePageId : undefined
  if (activePageId) {
    const pageDocument = await readJsonFile(getCanvasPageDocumentPath(activePageId), null)
    if (pageDocument?.snapshot) return pageDocument
  }

  return readJsonFile(canvasDocumentPath, null)
}

async function writeCanvasDocument(document) {
  const activePageId = sanitizeFilePart(document.currentPageId || 'page')
  const pageDocumentPath = getCanvasPageDocumentPath(activePageId)
  const manifest = {
    version: 1,
    updatedAt: document.updatedAt,
    source: document.source,
    activePageId,
    pages: [
      {
        id: activePageId,
        localPath: `.codex-media-canvas/canvas/pages/${activePageId}/canvas.json`,
        updatedAt: document.updatedAt,
      },
    ],
    legacyDocumentPath: '.codex-media-canvas/canvas/document.json',
    storageMode: 'page-snapshot-v1',
  }

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

async function writeFrameInputArtifact(frameRequest) {
  const fileName = `${sanitizeFilePart(frameRequest.id || `frame-request-${Date.now()}`)}.json`
  const absolutePath = join(frameInputsRoot, fileName)
  const localPath = `.codex-media-canvas/frame-inputs/${fileName}`
  const frameInput = {
    kind: 'codex-media-canvas.frame-input',
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
  const localPath = `.codex-media-canvas/frame-screenshots/${fileName}`
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
    frameId: input.frameId,
    prompt: input.prompt,
    provider: input.provider,
    outputMediaType: input.outputMediaType,
    generationMode: input.generationMode,
    mediaType: input.mediaType,
    src: input.src,
    localPath: input.localPath,
    absolutePath: input.absolutePath,
    title: input.title,
    model: input.model,
    status: input.status,
    skillName: input.skillName,
    minClientVersion: input.minClientVersion,
  }
}

async function readActiveSkillSession() {
  return readJsonFile(activeSkillSessionPath, null)
}

async function writeActiveSkillSession(input = {}) {
  const now = new Date().toISOString()
  const previous = await readActiveSkillSession()
  const skillName = typeof input.skillName === 'string' && input.skillName ? input.skillName : 'codex-media-canvas-image'
  const displayName = typeof input.displayName === 'string' && input.displayName ? input.displayName : 'Canvas Image Skill'
  const outputMediaType = input.outputMediaType === 'video' ? 'video' : 'image'
  const provider = typeof input.provider === 'string' && input.provider ? input.provider : 'atlas'
  const session = {
    id: previous?.id || `active-skill:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    status: 'active',
    skillName,
    displayName,
    outputMediaType,
    provider,
    autoRun: input.autoRun !== false,
    startedAt: previous?.startedAt || now,
    updatedAt: now,
  }
  await writeJson(activeSkillSessionPath, session)
  return session
}

async function clearActiveSkillSession() {
  await rm(activeSkillSessionPath, { force: true })
}

async function runActiveSkillFrame(input = {}) {
  const session = await readActiveSkillSession()
  if (!session?.status) throw new Error('No active media Skill session. Activate a Skill from Codex first.')

  const latestFrameInputMeta = await readJsonFile(latestFrameInputPath, null)
  const latestFrameRequest = await readJsonFile(latestCodexFrameRequestPath, null)
  const frameInput = latestFrameInputMeta?.frameInput?.absolutePath
    ? await readJsonFile(latestFrameInputMeta.frameInput.absolutePath, null)
    : null
  const frameId = input.frameId || frameInput?.frameId || latestFrameRequest?.request?.frameId
  if (!frameId) throw new Error('No frameId found. Click Send to Codex or Generate version on a frame first.')

  if (input.frameRequestId && frameInput?.requestId && input.frameRequestId !== frameInput.requestId) {
    throw new Error(`Latest Frame Input belongs to ${frameInput.requestId}, not ${input.frameRequestId}.`)
  }

  const command = await createRealSkillVersionCommand(session, frameInput, frameId)
  await appendCommand(command)
  return {
    session,
    command,
    frameInput: latestFrameInputMeta?.frameInput,
  }
}

async function createRealSkillVersionCommand(session, frameInput, frameId) {
  const outputMediaType = session.outputMediaType === 'video' ? 'video' : 'image'
  const prompt = extractFramePromptText(frameInput, outputMediaType)
  const references = extractFrameReferences(frameInput)
  const generationMode = inferSkillGenerationMode(outputMediaType, references)
  const extension = outputMediaType === 'video' ? 'mp4' : 'png'
  const group = outputMediaType === 'video' ? 'videos' : 'images'
  const requestId = `active-skill-generation:${Date.now()}`
  const outputLocalPath = `.codex-media-canvas/assets/${group}/${sanitizeFilePart(requestId)}.${extension}`
  const provider = normalizeActiveSkillProvider(session.provider)
  const request = {
    id: requestId,
    provider,
    generationMode,
    kind: generationMode,
    output: {
      mediaType: outputMediaType,
      localPath: outputLocalPath,
    },
    instructions: {
      prompt,
    },
    references,
  }
  const execution = await runStrictProviderExecution(request)
  const finalOutput = execution.providerOutput?.materialized ? execution.providerOutput : execution.output

  return createCommand({
    source: 'active-skill-session',
    type: 'canvas.create_version',
    frameId,
    prompt,
    provider,
    mediaType: outputMediaType,
    outputMediaType,
    generationMode,
    localPath: finalOutput.localPath,
    absolutePath: finalOutput.absolutePath,
    title: `${session.displayName} version`,
    model: execution.externalExecution?.request?.model || execution.selectedProviderPayload?.model || execution.selectedProvider,
    status: 'succeeded',
    skillName: session.skillName,
    minClientVersion: CANVAS_CLIENT_VERSION,
  })
}

async function runStrictProviderExecution(request) {
  const providerExecution = await prepareProviderExecution(request)
  const { selectedProvider, selectedProviderPayload, externalExecution } = providerExecution
  if (externalExecution?.status === 'skipped') {
    throw new Error(`${selectedProvider} is not configured. Add ATLASCLOUD_API_KEY to .env.local before generating.`)
  }
  if (externalExecution?.status === 'processing') {
    throw new Error(`${selectedProvider} is still processing. Background polling is not implemented for active canvas Skills yet.`)
  }
  if (externalExecution?.status !== 'succeeded') {
    throw new Error(`${selectedProvider} generation failed: ${externalExecution?.error || JSON.stringify(externalExecution?.body ?? externalExecution)}`)
  }

  const outputMediaType = request.output?.mediaType === 'video' ? 'video' : 'image'
  const fallbackLocalPath = request.output.localPath
  const fallbackAbsolutePath = resolveStoreLocalPath(fallbackLocalPath)
  const previewLocalPath = `.codex-media-canvas/assets/images/${sanitizeFilePart(request.id)}-preview.svg`
  const previewAbsolutePath = resolveStoreLocalPath(previewLocalPath)
  const previewSvg = providerStatePreviewSvg(request, 'processing')
  await mkdir(join(assetsRoot, outputMediaType === 'video' ? 'videos' : 'images'), { recursive: true })
  await mkdir(join(assetsRoot, 'images'), { recursive: true })
  await writeFile(previewAbsolutePath, previewSvg)

  const materialized = await materializeProviderOutputIfAvailable({
    externalExecution,
    outputMediaType,
    fallbackLocalPath,
    fallbackAbsolutePath,
    fallbackPreviewLocalPath: previewLocalPath,
    fallbackPreviewAbsolutePath: previewAbsolutePath,
    fallbackPreviewSrc: svgDataUrl(previewSvg),
  })
  if (!materialized.providerOutput?.materialized) {
    throw new Error(`${selectedProvider} succeeded but the output could not be materialized locally.`)
  }

  const result = {
    id: `execution:${Date.now()}`,
    requestId: request.id,
    provider: request.provider,
    status: 'succeeded',
    selectedProvider,
    selectedProviderPayload,
    externalExecution,
    providerOutput: materialized.providerOutput,
    output: materialized.output,
    preview: materialized.preview,
    note: 'Active canvas Skill executed a real provider and materialized the output locally.',
  }
  await writeJson(join(executionsRoot, `${sanitizeFilePart(result.id)}.json`), result)
  await writeJson(latestExecutionResultPath, {
    updatedAt: new Date().toISOString(),
    source: 'active-skill-session',
    result,
  })
  return result
}

function normalizeActiveSkillProvider(provider) {
  if (provider === 'seedance' || provider === 'kling') return provider
  return 'atlas'
}

function inferSkillGenerationMode(outputMediaType, references) {
  if (outputMediaType === 'video') return references.length > 0 ? 'reference_to_video' : 'text_to_video'
  return references.length > 0 ? 'image_edit' : 'text_to_image'
}

function extractFrameReferences(frameInput) {
  const media = Array.isArray(frameInput?.promptPart?.media) ? frameInput.promptPart.media : []
  return media
    .map((item) => ({
      mediaType: item.shapeType === 'video' ? 'video' : 'image',
      role: item.shapeId === frameInput?.summary?.anchorMediaId ? 'source' : 'reference',
      localPath: item.localPath,
      absolutePath: item.absolutePath,
    }))
    .filter((item) => item.localPath || item.absolutePath)
}

function extractFramePromptText(frameInput, outputMediaType = 'image') {
  const annotations = Array.isArray(frameInput?.promptPart?.annotations) ? frameInput.promptPart.annotations : []
  const texts = Array.isArray(frameInput?.summary?.annotationTexts) ? frameInput.summary.annotationTexts : []
  const annotationTexts = annotations.map((annotation) => annotation?.text).filter(Boolean)
  const textDirectives = (texts.length > 0 ? texts : annotationTexts).map((text) => String(text).trim()).filter(Boolean)
  const hasSourceMedia =
    Boolean(frameInput?.promptPart?.anchorMedia) ||
    (Array.isArray(frameInput?.promptPart?.media) && frameInput.promptPart.media.length > 0)
  const hasSpatialAnnotations = annotations.some((annotation) => annotation && !annotation.text)

  if (!hasSourceMedia && textDirectives.length === 0) {
    return `Generate a new version from frame "${frameInput?.summary?.frameName || frameInput?.frameId || 'Untitled frame'}".`
  }

  const promptSections = []

  if (hasSourceMedia) {
    if (outputMediaType === 'video') {
      promptSections.push(
        [
          'Use the source media in the selected canvas frame as the primary visual reference.',
          'Preserve the source identity, composition, style, logos, typography, colors, and existing text unless a canvas annotation explicitly asks to change them.',
          'Interpret arrows, boxes, drawn marks, and notes as edit instructions only; do not render those canvas annotations into the output video.',
        ].join(' '),
      )
    } else {
      promptSections.push(
        [
          'Edit the provided source image; do not redesign it from scratch.',
          'Preserve the exact original layout, aspect ratio, composition, background, logos, typography style, colors, embedded images, and all existing text unless a canvas annotation explicitly asks to change a specific part.',
          'For poster, UI, slide, or text-replacement tasks, replace only the text or region indicated by the canvas annotations and keep every other title, subtitle, logo, footer, and layout element unchanged.',
          'Interpret arrows, boxes, drawn marks, and notes as edit instructions only; do not render those canvas annotations, red boxes, arrows, selection outlines, or UI chrome into the output image.',
        ].join(' '),
      )
    }
  }

  if (textDirectives.length > 0) {
    promptSections.push(`Canvas edit instructions:\n${textDirectives.map((text) => `- ${text}`).join('\n')}`)
  }

  if (hasSpatialAnnotations) {
    promptSections.push(
      'Spatial guidance: use non-text annotations such as arrows, boxes, and drawn marks to identify the target regions. Apply the requested edits to those indicated regions only.',
    )
  }

  return promptSections.join('\n\n')
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
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  }
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
  const localPath = `.codex-media-canvas/assets/${group}/${filename}`
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
  const localPath = `.codex-media-canvas/assets/${group}/${filename}`
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
  const localPath = `.codex-media-canvas/assets/${manifest.group}/${manifest.filename}`
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

async function runGenerationExecutor(request) {
  const providerExecution = await prepareProviderExecution(request)
  const { providerJob, providerPayloads, selectedProvider, selectedProviderPayload, externalExecution } = providerExecution
  const outputMediaType = request.output?.mediaType === 'video' ? 'video' : 'image'
  const outputLocalPath =
    typeof request.output?.localPath === 'string'
      ? request.output.localPath
      : outputMediaType === 'video'
        ? `.codex-media-canvas/assets/videos/${request.id}.mp4`
        : `.codex-media-canvas/assets/images/${request.id}.svg`
  const outputAbsolutePath = resolveStoreLocalPath(outputLocalPath)
  const previewSvg = mockPreviewSvg(request)
  const previewLocalPath = `.codex-media-canvas/assets/images/${sanitizeFilePart(request.id)}-preview.svg`
  const previewAbsolutePath = resolveStoreLocalPath(previewLocalPath)
  const processingPreviewSvg = providerStatePreviewSvg(request, 'processing')
  const processingPreviewLocalPath = `.codex-media-canvas/assets/images/${sanitizeFilePart(request.id)}-processing.svg`
  const processingPreviewAbsolutePath = resolveStoreLocalPath(processingPreviewLocalPath)
  const failedPreviewSvg = providerStatePreviewSvg(request, 'failed')
  const failedPreviewLocalPath = `.codex-media-canvas/assets/images/${sanitizeFilePart(request.id)}-failed.svg`
  const failedPreviewAbsolutePath = resolveStoreLocalPath(failedPreviewLocalPath)

  await mkdir(join(assetsRoot, outputMediaType === 'video' ? 'videos' : 'images'), { recursive: true })
  await mkdir(join(assetsRoot, 'images'), { recursive: true })

  if (outputMediaType === 'video') {
    await writeMockVideo(outputAbsolutePath)
  } else {
    await writeFile(outputAbsolutePath, previewSvg)
  }
  await writeFile(previewAbsolutePath, previewSvg)
  await writeFile(processingPreviewAbsolutePath, processingPreviewSvg)
  await writeFile(failedPreviewAbsolutePath, failedPreviewSvg)

  const materializedProviderOutput = await materializeProviderOutputIfAvailable({
    externalExecution,
    outputMediaType,
    fallbackLocalPath: outputLocalPath,
    fallbackAbsolutePath: outputAbsolutePath,
    fallbackPreviewLocalPath: previewLocalPath,
    fallbackPreviewAbsolutePath: previewAbsolutePath,
    fallbackPreviewSrc: svgDataUrl(previewSvg),
  })
  const providerWasSkipped = externalExecution?.status === 'skipped'
  const providerStillProcessing = externalExecution?.status === 'processing'
  const providerFailed = externalExecution?.status === 'failed'
  const providerDownloadFailed = materializedProviderOutput.providerOutput?.materialized === false
  const usedMockFallback = !materializedProviderOutput.providerOutput && providerWasSkipped
  const executionStatus =
    providerStillProcessing ? 'processing' : providerFailed || providerDownloadFailed ? 'failed' : 'succeeded'
  const preview =
    providerStillProcessing
      ? {
          localPath: processingPreviewLocalPath,
          absolutePath: processingPreviewAbsolutePath,
          src: svgDataUrl(processingPreviewSvg),
        }
      : providerFailed || providerDownloadFailed
        ? {
            localPath: failedPreviewLocalPath,
            absolutePath: failedPreviewAbsolutePath,
            src: svgDataUrl(failedPreviewSvg),
          }
        : materializedProviderOutput.preview
  const executionNote = materializedProviderOutput.providerOutput?.materialized
    ? 'Provider output was materialized into the local canvas asset store.'
    : providerStillProcessing
      ? `${selectedProvider} is still processing; keeping a non-final generation placeholder instead of writing mock output.`
      : providerFailed
        ? `${selectedProvider} failed before producing an output; keeping a failed-state preview instead of writing mock output.`
        : providerDownloadFailed
          ? `${selectedProvider} produced an output URL but local materialization failed.`
          : providerWasSkipped
            ? `${selectedProvider} was skipped because it is not configured; wrote a local mock fallback.`
            : outputMediaType === 'video'
              ? 'Generation executor wrote a short local mock fallback MP4 plus SVG preview.'
              : 'Generation executor wrote a local mock fallback SVG output.'

  const result = {
    id: `execution:${Date.now()}`,
    requestId: request.id,
    provider: request.provider || 'mock-provider',
    status: executionStatus,
    selectedProvider,
    providerJob,
    providerPayloads,
    selectedProviderPayload,
    externalExecution,
    mockFallback: usedMockFallback,
    output: {
      mediaType: outputMediaType,
      localPath: materializedProviderOutput.output.localPath,
      absolutePath: materializedProviderOutput.output.absolutePath,
    },
    preview: {
      localPath: preview.localPath,
      absolutePath: preview.absolutePath,
      src: preview.src,
    },
    providerOutput: materializedProviderOutput.providerOutput,
    note: executionNote,
  }

  await writeJson(join(executionsRoot, `${sanitizeFilePart(result.id)}.json`), result)
  return result
}

async function materializeProviderOutputIfAvailable(args) {
  const outputUrl = args.externalExecution?.outputUrl || args.externalExecution?.outputs?.[0]
  if (!outputUrl || args.externalExecution?.status !== 'succeeded') {
    return {
      output: {
        localPath: args.fallbackLocalPath,
        absolutePath: args.fallbackAbsolutePath,
      },
      preview: {
        localPath: args.fallbackPreviewLocalPath,
        absolutePath: args.fallbackPreviewAbsolutePath,
        src: args.fallbackPreviewSrc,
      },
      providerOutput: null,
    }
  }

  const response = await fetch(outputUrl)
  if (!response.ok) {
    return {
      output: {
        localPath: args.fallbackLocalPath,
        absolutePath: args.fallbackAbsolutePath,
      },
      preview: {
        localPath: args.fallbackPreviewLocalPath,
        absolutePath: args.fallbackPreviewAbsolutePath,
        src: args.fallbackPreviewSrc,
      },
      providerOutput: {
        url: outputUrl,
        materialized: false,
        error: `Download failed with HTTP ${response.status}`,
      },
    }
  }

  const contentTypeHeader = response.headers.get('content-type') || ''
  const extension = extensionFromContentTypeOrUrl(contentTypeHeader, outputUrl, args.outputMediaType)
  const group = args.outputMediaType === 'video' ? 'videos' : 'images'
  const fileName = `atlas-output-${Date.now()}.${extension}`
  const localPath = `.codex-media-canvas/assets/${group}/${fileName}`
  const absolutePath = join(assetsRoot, group, fileName)
  const bytes = Buffer.from(await response.arrayBuffer())

  await mkdir(join(assetsRoot, group), { recursive: true })
  await writeFile(absolutePath, bytes)

  const preview =
    args.outputMediaType === 'image'
      ? {
          localPath,
          absolutePath,
          src: `/asset-store/assets/${group}/${fileName}`,
        }
      : {
          localPath: args.fallbackPreviewLocalPath,
          absolutePath: args.fallbackPreviewAbsolutePath,
          src: args.fallbackPreviewSrc,
        }

  return {
    output: {
      localPath,
      absolutePath,
    },
    preview,
    providerOutput: {
      url: outputUrl,
      materialized: true,
      localPath,
      absolutePath,
      contentType: contentTypeHeader,
      bytes: bytes.length,
    },
  }
}

async function writeMockVideo(outputAbsolutePath) {
  try {
    await execFileAsync('/opt/homebrew/bin/ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x111827:s=1280x720:d=3:r=24',
      '-pix_fmt',
      'yuv420p',
      outputAbsolutePath,
    ])
  } catch (error) {
    await writeFile(`${outputAbsolutePath}.mock.txt`, `Mock video generation failed: ${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  }
}

function resolveStoreLocalPath(localPath) {
  if (typeof localPath !== 'string' || !localPath.startsWith('.codex-media-canvas/')) {
    throw new Error(`Unsafe local output path: ${localPath}`)
  }
  const relative = localPath.replace(/^\.codex-media-canvas\//, '')
  return join(storeRoot, relative)
}

function mockPreviewSvg(request) {
  const title = request.output?.mediaType === 'video' ? 'Mock video output' : 'Mock image output'
  const mode = request.generationMode || request.kind || 'generation'
  const prompt = request.instructions?.prompt || 'No prompt'
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#0f172a"/>
          <stop offset="1" stop-color="#312e81"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" rx="48" fill="url(#bg)"/>
      <text x="72" y="116" fill="#f8fafc" font-family="Inter, Arial" font-size="54" font-weight="700">${escapeXml(title)}</text>
      <text x="72" y="184" fill="#93c5fd" font-family="Inter, Arial" font-size="28">mode: ${escapeXml(mode)}</text>
      <text x="72" y="640" fill="#dbeafe" font-family="Inter, Arial" font-size="24">${escapeXml(prompt).slice(0, 140)}</text>
    </svg>
  `.trim()
}

function providerStatePreviewSvg(request, state) {
  const isFailed = state === 'failed'
  const mediaType = request.output?.mediaType === 'video' ? 'video' : 'image'
  const title = isFailed ? 'Generation needs attention' : mediaType === 'video' ? 'Rendering motion' : 'Composing image'
  const subtitle = isFailed ? 'The provider did not return a usable result.' : 'Waiting for the provider result.'
  const accent = isFailed ? '#ef4444' : '#2563eb'
  return `
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
      ${
        isFailed
          ? `<circle cx="360" cy="190" r="48" fill="#fef2f2"/>
             <path d="M360 158v42" stroke="${accent}" stroke-width="10" stroke-linecap="round"/>
             <circle cx="360" cy="226" r="6" fill="${accent}"/>`
          : `<rect x="76" y="72" width="568" height="274" rx="26" fill="url(#shimmer)"/>
             <rect x="92" y="366" width="292" height="24" rx="12" fill="#eef2f7"/>
             <rect x="92" y="406" width="190" height="18" rx="9" fill="#f3f4f6"/>
             <circle cx="612" cy="410" r="20" fill="#eef2ff"/>
             <path d="M607 409.5h10m-5-5v10" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`
      }
      <text x="360" y="${isFailed ? 304 : 320}" fill="#111827" font-family="Inter,Arial" font-size="24" font-weight="650" text-anchor="middle">${escapeXml(title)}</text>
      <text x="360" y="${isFailed ? 340 : 354}" fill="#64748b" font-family="Inter,Arial" font-size="16" text-anchor="middle">${escapeXml(subtitle)}</text>
    </svg>
  `.trim()
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => {
    if (char === '<') return '&lt;'
    if (char === '>') return '&gt;'
    if (char === '&') return '&amp;'
    if (char === '"') return '&quot;'
    return '&apos;'
  })
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

function extensionFromContentTypeOrUrl(contentTypeHeader, url, outputMediaType) {
  const contentTypeExtension = extensionFromMimeType(contentTypeHeader.split(';')[0])
  if (contentTypeExtension !== 'bin') return contentTypeExtension

  const pathname = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return String(url)
    }
  })()
  const extension = extname(pathname).replace(/^\./, '').toLowerCase()
  if (extension) return extension
  return outputMediaType === 'video' ? 'mp4' : 'png'
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

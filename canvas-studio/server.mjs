import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { createStore } from './lib/media-store.mjs'

const portArg = process.argv.find((arg) => arg.startsWith('--port='))?.slice('--port='.length)
const port = Number.parseInt(process.env.PORT ?? portArg ?? '5174', 10)
const workspaceRoot = resolve(process.env.WORKSPACE_ROOT ?? process.cwd())
const store = createStore({ workspaceRoot })

await store.ensureStorage()

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }
    if (url.pathname.startsWith('/media/')) {
      await handleMedia(response, decodeURIComponent(url.pathname.slice('/media/'.length)))
      return
    }
    await handleStatic(response, url.pathname)
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Codex Media Canvas server listening on http://127.0.0.1:${port}`)
})

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/state') {
    sendJson(response, await store.readState())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/assets') {
    sendJson(response, await store.addAsset(await readBody(request)))
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/selection') {
    const body = await readBody(request)
    sendJson(response, await store.updateSelection(body.selectedAssetIds ?? []))
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/selection') {
    const state = await store.readState()
    sendJson(response, state.selection)
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/preferences') {
    sendJson(response, await store.updatePreferences(await readBody(request)))
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/requests') {
    sendJson(response, await store.createRequest(await readBody(request)))
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/requests') {
    if (url.searchParams.get('claim') === 'true') {
      sendJson(response, { request: await store.claimRequest() })
      return
    }
    const state = await store.readState()
    sendJson(response, { requests: state.requests })
    return
  }
  const annotationMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/annotations$/)
  if (request.method === 'POST' && annotationMatch) {
    const body = await readBody(request)
    sendJson(response, await store.addAnnotation(decodeURIComponent(annotationMatch[1]), body.text ?? ''))
    return
  }
  const positionMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/position$/)
  if (request.method === 'POST' && positionMatch) {
    const body = await readBody(request)
    sendJson(response, await store.updateAssetPosition(decodeURIComponent(positionMatch[1]), body.position))
    return
  }
  const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/)
  if ((request.method === 'PATCH' || request.method === 'POST') && requestMatch) {
    sendJson(response, await store.updateRequest(decodeURIComponent(requestMatch[1]), await readBody(request)))
    return
  }
  sendJson(response, { error: 'Not found' }, 404)
}

async function handleMedia(response, localPath) {
  const absolutePath = resolve(workspaceRoot, localPath)
  if (!absolutePath.startsWith(workspaceRoot)) {
    sendJson(response, { error: 'Invalid media path' }, 400)
    return
  }
  response.writeHead(200, { 'Content-Type': mimeTypeForPath(absolutePath) })
  createReadStream(absolutePath).pipe(response)
}

async function handleStatic(response, pathname) {
  const filePath = pathname === '/' ? 'dist/index.html' : join('dist', pathname)
  const absolutePath = resolve(process.cwd(), filePath)
  if (!absolutePath.startsWith(resolve(process.cwd(), 'dist'))) {
    sendJson(response, { error: 'Invalid path' }, 400)
    return
  }
  try {
    response.writeHead(200, { 'Content-Type': mimeTypeForPath(absolutePath) })
    response.end(await readFile(absolutePath))
  } catch {
    sendJson(response, {
      projectName: 'Codex Media Canvas',
      message: 'Static build not found. Run npm run build, or use npm run dev for the Vite app.',
    })
  }
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function mimeTypeForPath(filePath) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.png') return 'image/png'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.mp4') return 'video/mp4'
  if (extension === '.webm') return 'video/webm'
  return 'application/octet-stream'
}

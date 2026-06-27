import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function createMcpClient(workspaceRoot) {
  const child = spawn('node', ['mcp-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      WORKSPACE_ROOT: workspaceRoot,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pending = new Map()
  let nextId = 1
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
    const lines = stdout.split('\n')
    stdout = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line)
      const deferred = pending.get(message.id)
      if (!deferred) continue
      pending.delete(message.id)
      deferred.resolve(message)
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  return {
    call(method, params = {}) {
      const id = nextId++
      const payload = { jsonrpc: '2.0', id, method, params }
      child.stdin.write(`${JSON.stringify(payload)}\n`)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr}`))
        }, 1000)
        pending.set(id, {
          resolve: (message) => {
            clearTimeout(timeout)
            resolve(message)
          },
        })
      })
    },
    async close() {
      child.kill()
    },
  }
}

test('MCP lists capture_selection and link_versions tools', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'codex-media-canvas-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/list')
    const toolNames = response.result.tools.map((tool) => tool.name)
    assert.ok(toolNames.includes('canvas.capture_selection'))
    assert.ok(toolNames.includes('canvas.link_versions'))
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('capture_selection returns a structured empty-selection capture', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'codex-media-canvas-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.capture_selection',
      arguments: {
        includeFrameInput: false,
        includeScreenshot: false,
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.captureType, 'selection')
    assert.deepEqual(payload.selection.selectedIds, [])
    assert.match(payload.warning, /No selected canvas objects/)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('link_versions queues a browser writeback command', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'codex-media-canvas-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.link_versions',
      arguments: {
        sourceShapeId: 'shape:source',
        targetShapeId: 'shape:target',
        linkType: 'reference',
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.command.type, 'canvas.link_versions')
    assert.equal(payload.command.sourceShapeId, 'shape:source')
    assert.equal(payload.command.targetShapeId, 'shape:target')
    assert.equal(payload.command.linkType, 'reference')

    const pending = await readFile(join(workspaceRoot, '.codex-media-canvas', 'commands', 'pending.jsonl'), 'utf8')
    assert.ok(pending.includes('canvas.link_versions'))
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

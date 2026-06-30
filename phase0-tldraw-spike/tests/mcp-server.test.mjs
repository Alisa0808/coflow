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
      ATLASCLOUD_API_KEY: '',
      ATLAS_PROVIDER_API_KEY: '',
      REAL_PROVIDER_API_KEY: '',
      COFLOW_URL: 'http://127.0.0.1:1',
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

test('MCP lists capture_selection, provider tools, link_versions, and active skill tools', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/list')
    const toolNames = response.result.tools.map((tool) => tool.name)
    assert.ok(toolNames.includes('canvas.capture_selection'))
    assert.ok(toolNames.includes('canvas.get_provider_status'))
    assert.ok(toolNames.includes('canvas.get_provider_settings'))
    assert.ok(toolNames.includes('canvas.get_provider_onboarding'))
    assert.ok(toolNames.includes('canvas.set_provider_settings'))
    assert.ok(toolNames.includes('canvas.run_provider'))
    assert.equal(toolNames.includes('canvas.generate_image'), false)
    assert.equal(toolNames.includes('canvas.generate_video'), false)
    assert.equal(toolNames.includes('canvas.agent_prompt'), false)
    assert.ok(toolNames.includes('canvas.link_versions'))
    assert.ok(toolNames.includes('canvas.activate_skill_session'))
    assert.ok(toolNames.includes('canvas.get_active_skill_session'))
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('generate_image and generate_video are not exposed MCP tools', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const imageResponse = await client.call('tools/call', {
      name: 'canvas.generate_image',
      arguments: {},
    })
    assert.equal(imageResponse.error.code, -32602)
    assert.match(imageResponse.error.message, /Unknown tool: canvas\.generate_image/)

    const videoResponse = await client.call('tools/call', {
      name: 'canvas.generate_video',
      arguments: {},
    })
    assert.equal(videoResponse.error.code, -32602)
    assert.match(videoResponse.error.message, /Unknown tool: canvas\.generate_video/)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('agent_prompt is not exposed as a user-facing MCP tool', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.agent_prompt',
      arguments: {
        prompt: 'Generate from this canvas frame.',
      },
    })
    assert.equal(response.error.code, -32602)
    assert.match(response.error.message, /Unknown tool: canvas\.agent_prompt/)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('provider status reports redacted setup over MCP', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.get_provider_status',
      arguments: {},
    })
    const text = response.result.content[0].text
    const payload = JSON.parse(text)
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.defaultProvider, { image: 'Codex', video: 'Atlas Cloud' })
    assert.equal(payload.defaultImageProvider, 'Codex')
    assert.equal(payload.defaultVideoProvider, 'Atlas Cloud')
    assert.equal(payload.onboarding.status, 'not_started')
    assert.equal(payload.providers.codexNative.models.imageText, 'gpt-image-2')
    assert.equal(payload.providers.atlas.models.videoReference, 'bytedance/seedance-2.0/reference-to-video')
    assert.equal(text.includes(process.env.ATLASCLOUD_API_KEY || 'unlikely-secret-value'), false)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('provider onboarding can be read over MCP without exposing secrets', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.get_provider_onboarding',
      arguments: {},
    })
    const text = response.result.content[0].text
    const payload = JSON.parse(text)
    assert.equal(payload.ok, true)
    assert.equal(payload.status, 'not_started')
    assert.equal(payload.shouldPrompt, true)
    assert.equal(payload.imageDefault.provider, 'codex-native')
    assert.equal(payload.imageDefault.providerLabel, 'Codex')
    assert.equal(payload.videoDefault.provider, 'Atlas Cloud')
    assert.equal(payload.videoDefault.providerLabel, 'Atlas Cloud')
    assert.ok(payload.actions.some((action) => action.id === 'use_default_provider_models'))
    assert.ok(payload.actions.some((action) => action.id === 'skip_for_now'))
    assert.equal(text.includes(process.env.ATLASCLOUD_API_KEY || 'unlikely-secret-value'), false)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('provider settings can be read and updated over MCP without storing secrets', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const updated = await client.call('tools/call', {
      name: 'canvas.set_provider_settings',
      arguments: {
        status: 'configured',
        image: {
          provider: 'atlas',
          modelIntent: 'image_edit',
        },
        video: {
          provider: 'atlas',
          modelIntent: 'reference_to_video',
        },
      },
    })
    const updatePayload = JSON.parse(updated.result.content[0].text)
    assert.equal(updatePayload.ok, true)
    assert.equal(updatePayload.settings.status, 'configured')
    assert.equal(updatePayload.settings.image.provider, 'Atlas Cloud')
    assert.equal(JSON.stringify(updatePayload).includes(process.env.ATLASCLOUD_API_KEY || 'unlikely-secret-value'), false)

    const current = await client.call('tools/call', {
      name: 'canvas.get_provider_settings',
      arguments: {},
    })
    const currentPayload = JSON.parse(current.result.content[0].text)
    assert.equal(currentPayload.settings.status, 'configured')
    assert.equal(currentPayload.settings.video.modelIntent, 'reference_to_video')

    const status = await client.call('tools/call', {
      name: 'canvas.get_provider_status',
      arguments: {},
    })
    const statusPayload = JSON.parse(status.result.content[0].text)
    assert.equal(statusPayload.onboarding.status, 'configured')
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('active skill session can be activated and cleared over MCP', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const activated = await client.call('tools/call', {
      name: 'canvas.activate_skill_session',
      arguments: {
        skillName: 'coflow-image',
        displayName: 'CoFlow Image',
        outputMediaType: 'image',
        provider: 'atlas',
        autoRun: true,
      },
    })
    const activatePayload = JSON.parse(activated.result.content[0].text)
    assert.equal(activatePayload.ok, true)
    assert.equal(activatePayload.session.status, 'active')
    assert.equal(activatePayload.session.skillName, 'coflow-image')
    assert.equal(activatePayload.session.provider, 'Atlas Cloud')
    assert.equal(activatePayload.session.autoRun, true)

    const current = await client.call('tools/call', {
      name: 'canvas.get_active_skill_session',
      arguments: {},
    })
    const currentPayload = JSON.parse(current.result.content[0].text)
    assert.equal(currentPayload.session.displayName, 'CoFlow Image')

    const cleared = await client.call('tools/call', {
      name: 'canvas.clear_active_skill_session',
      arguments: {},
    })
    const clearedPayload = JSON.parse(cleared.result.content[0].text)
    assert.equal(clearedPayload.ok, true)
    assert.equal(clearedPayload.session, null)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('run_provider reports missing Atlas Cloud credentials without queuing canvas writeback', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.run_provider',
      arguments: {
        mediaType: 'image',
        provider: 'Atlas Cloud',
        generationMode: 'image_edit',
        prompt: 'Make the horse green.',
        references: [],
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, false)
    assert.equal(payload.status, 'provider_not_configured')
    assert.equal(payload.provider, 'Atlas Cloud')
    assert.match(payload.reason, /ATLASCLOUD_API_KEY/)

    await assert.rejects(
      readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8'),
      /ENOENT/
    )
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('run_provider rejects prompt-only Codex native image generation as runtime-only', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.run_provider',
      arguments: {
        mediaType: 'image',
        prompt: 'A tiny cloud mascot holding a paint brush.',
        references: [],
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, false)
    assert.equal(payload.status, 'requires_codex_native')
    assert.equal(payload.provider, 'codex-native')
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('insert_media rejects writeback without generated media path', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.insert_media',
      arguments: {
        mediaType: 'image',
        prompt: 'Make the cat orange and white.',
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /requires generated media src\/localPath\/absolutePath/)

    await assert.rejects(
      readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8'),
      /ENOENT/
    )
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('insert_media normalizes canvas.run_provider result before writeback', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.insert_media',
      arguments: {
        result: {
          mediaType: 'image',
          provider: 'atlas',
          model: 'openai/gpt-image-2',
          prompt: 'Make the cat orange and white.',
          localPath: '.coflow/assets/images/generated-cat.png',
          absolutePath: join(workspaceRoot, '.coflow', 'assets', 'images', 'generated-cat.png'),
          outputWidth: 1024,
          outputHeight: 768,
        },
        skillName: 'coflow-image',
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.command.type, 'canvas.create_version')
    assert.equal(payload.command.mediaType, 'image')
    assert.equal(payload.command.provider, 'Atlas Cloud')
    assert.equal(payload.command.model, 'openai/gpt-image-2')
    assert.equal(payload.command.localPath, '.coflow/assets/images/generated-cat.png')
    assert.equal(payload.command.src, '/asset-store/assets/images/generated-cat.png')
    assert.equal(payload.command.skillName, 'coflow-image')

    const pending = await readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8')
    assert.match(pending, /generated-cat\.png/)
    assert.equal(pending.includes('.codex-media-canvas'), false)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('create_version derives media path fields from a .coflow absolute path', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.create_version',
      arguments: {
        absolutePath: join(workspaceRoot, '.coflow', 'assets', 'videos', 'generated-horse.mp4'),
        provider: 'Atlas Cloud',
        model: 'bytedance/seedance-2.0/reference-to-video',
        prompt: 'Make the girl ride a horse.',
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.command.mediaType, 'video')
    assert.equal(payload.command.localPath, '.coflow/assets/videos/generated-horse.mp4')
    assert.equal(payload.command.src, '/asset-store/assets/videos/generated-horse.mp4')
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('active skill session uses configured media provider default when provider is omitted', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    await client.call('tools/call', {
      name: 'canvas.set_provider_settings',
      arguments: {
        status: 'configured',
        image: {
          provider: 'custom-image',
          modelIntent: 'image_edit',
        },
        video: {
          provider: 'custom-video',
          modelIntent: 'reference_to_video',
        },
      },
    })
    const activated = await client.call('tools/call', {
      name: 'canvas.activate_skill_session',
      arguments: {
        skillName: 'coflow-video',
        displayName: 'CoFlow Video',
        outputMediaType: 'video',
        autoRun: true,
      },
    })
    const activatePayload = JSON.parse(activated.result.content[0].text)
    assert.equal(activatePayload.session.provider, 'custom-video')
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('capture_selection returns a structured empty-selection capture', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
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
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
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

    const pending = await readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8')
    assert.ok(pending.includes('canvas.link_versions'))
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

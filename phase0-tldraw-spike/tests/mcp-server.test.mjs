import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('MCP lists capture_selection, provider tools, and link_versions without direct generation/session tools', async () => {
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
    assert.equal(toolNames.includes('canvas.activate_skill_session'), false)
    assert.equal(toolNames.includes('canvas.get_active_skill_session'), false)
    assert.equal(toolNames.includes('canvas.clear_active_skill_session'), false)
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
    assert.equal(payload.imageDefault.providerLabel, 'Codex built-in GPT Image 2')
    assert.equal(payload.videoDefault.provider, 'Atlas Cloud')
    assert.equal(payload.videoDefault.providerLabel, 'Atlas Cloud')
    assert.equal(payload.connectionStatus.codexBuiltInImageModel, 'ready')
    assert.equal(payload.connectionStatus.atlasCloud, 'needs_api_key')
    assert.match(payload.userMessage, /CoFlow is ready to use with these defaults/)
    assert.ok(payload.actions.some((action) => action.id === 'keep_defaults_setup_atlas_cloud'))
    assert.ok(payload.actions.some((action) => action.id === 'customize_providers_and_models'))
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
        customProviders: {
          'my-provider': {
            label: 'My Provider',
            mediaTypes: ['image', 'video'],
            modes: ['image_edit', 'reference_to_video'],
            models: ['my-image-edit', 'my-video-ref'],
            baseUrl: 'https://provider.example.test',
            authEnv: 'MY_PROVIDER_API_KEY',
            docsUrl: 'https://provider.example.test/docs',
            submitEndpoint: '/v1/generate',
            responseOutputPath: 'data.output_url',
          },
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
    assert.equal(currentPayload.settings.customProviders['my-provider'].label, 'My Provider')
    assert.equal(currentPayload.settings.customProviders['my-provider'].authEnv, 'MY_PROVIDER_API_KEY')
    assert.equal(currentPayload.settings.customProviders['my-provider'].docsUrl, 'https://provider.example.test/docs')
    assert.equal(currentPayload.settings.customProviders['my-provider'].models[1], 'my-video-ref')

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

test('run_provider redirects Codex native image reference tasks to a reference-capable provider', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const imageDir = join(workspaceRoot, '.coflow', 'assets', 'images')
  const sourceLocalPath = '.coflow/assets/images/source.png'
  await mkdir(imageDir, { recursive: true })
  await writeFile(join(imageDir, 'source.png'), Buffer.from('fake png fixture'))

  const client = createMcpClient(workspaceRoot)
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.run_provider',
      arguments: {
        mediaType: 'image',
        provider: 'codex-native',
        generationMode: 'image_edit',
        prompt: 'Make the horse green.',
        references: [
          {
            mediaType: 'image',
            role: 'source',
            localPath: sourceLocalPath,
          },
        ],
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, false)
    assert.equal(payload.status, 'provider_not_configured')
    assert.equal(payload.provider, 'Atlas Cloud')
    assert.equal(payload.request.provider, 'Atlas Cloud')
    assert.equal(payload.request.providerRedirect.from, 'codex-native')
    assert.equal(payload.request.providerRedirect.to, 'Atlas Cloud')
    assert.match(payload.request.providerRedirect.reason, /cannot execute Codex built-in/)

    await assert.rejects(
      readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8'),
      /ENOENT/
    )
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

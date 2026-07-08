import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function createMcpClient(workspaceRoot, env = {}) {
  const child = spawn('node', ['mcp-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      WORKSPACE_ROOT: workspaceRoot,
      ATLASCLOUD_API_KEY: '',
      ATLAS_PROVIDER_API_KEY: '',
      REAL_PROVIDER_API_KEY: '',
      COFLOW_URL: 'http://127.0.0.1:1',
      COFLOW_RUNTIME_TIMEOUT_MS: '100',
      ...env,
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

function pngHeaderWithDimensions(width, height) {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 4, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

async function writeFakeFfprobe(binRoot, payload) {
  await mkdir(binRoot, { recursive: true })
  const ffprobePath = join(binRoot, 'ffprobe')
  await writeFile(
    ffprobePath,
    `#!/bin/sh
cat <<'JSON'
${JSON.stringify(payload)}
JSON
`
  )
  await chmod(ffprobePath, 0o755)
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

test('run_provider resolves references from the active canvas runtime when store roots differ', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const canvasWorkspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-canvas-'))
  const canvasStoreRoot = join(canvasWorkspaceRoot, '.coflow')
  const sourceLocalPath = '.coflow/assets/images/source.png'
  const sourceAbsolutePath = join(canvasStoreRoot, 'assets', 'images', 'source.png')
  await mkdir(join(canvasStoreRoot, 'assets', 'images'), { recursive: true })
  await mkdir(join(canvasStoreRoot, 'metadata'), { recursive: true })
  await writeFile(sourceAbsolutePath, Buffer.from('active runtime image fixture'))
  await writeFile(
    join(canvasStoreRoot, 'metadata', 'provider-settings.json'),
    `${JSON.stringify(
      {
        version: 1,
        status: 'configured',
        video: {
          provider: 'Atlas Cloud',
          modelIntent: 'reference_to_video',
          textModel: 'bytedance/seedance-2.0-mini/text-to-video',
          referenceModel: 'bytedance/seedance-2.0-mini/reference-to-video',
        },
      },
      null,
      2
    )}\n`
  )

  const client = createMcpClient(workspaceRoot, {
    COFLOW_RUNTIME_JSON: JSON.stringify({
      source: 'env',
      version: 1,
      workspaceRoot: canvasWorkspaceRoot,
      storeRoot: canvasStoreRoot,
      assetsRoot: join(canvasStoreRoot, 'assets'),
      metadataRoot: join(canvasStoreRoot, 'metadata'),
      commandsRoot: join(canvasStoreRoot, 'commands'),
      pendingCommandsPath: join(canvasStoreRoot, 'commands', 'pending.jsonl'),
      clientVersion: '2026-06-27-native-media-writeback-v1',
    }),
  })
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.run_provider',
      arguments: {
        mediaType: 'video',
        provider: 'Atlas Cloud',
        generationMode: 'reference_to_video',
        prompt: 'Animate the source image.',
        references: [
          {
            mediaType: 'image',
            role: 'source',
            shapeId: 'shape:source',
            localPath: sourceLocalPath,
            absolutePath: sourceAbsolutePath,
          },
        ],
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, false)
    assert.equal(payload.status, 'provider_not_configured')
    assert.equal(payload.request.references.length, 1)
    assert.equal(payload.request.references[0].shapeId, 'shape:source')
    assert.equal(payload.request.references[0].localPath, sourceLocalPath)
    assert.equal(payload.request.references[0].absolutePath, sourceAbsolutePath)
    assert.equal(payload.request.model, 'bytedance/seedance-2.0-mini/reference-to-video')
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(canvasWorkspaceRoot, { recursive: true, force: true })
  }
})

test('run_provider rejects unsupported Atlas video model inputs before provider execution', async () => {
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
        mediaType: 'video',
        provider: 'Atlas Cloud',
        model: 'bytedance/seedance-2.0/text-to-video',
        generationMode: 'reference_to_video',
        prompt: 'Animate this image.',
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
    assert.equal(payload.status, 'model_preflight_failed')
    assert.equal(payload.validation.code, 'unsupported_reference')
    assert.match(payload.reason, /does not support image references/)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('get_asset reads assets from the active canvas runtime when store roots differ', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const canvasWorkspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-canvas-'))
  const canvasStoreRoot = join(canvasWorkspaceRoot, '.coflow')
  const sourceLocalPath = '.coflow/assets/images/source.png'
  const sourceAbsolutePath = join(canvasStoreRoot, 'assets', 'images', 'source.png')
  await mkdir(join(canvasStoreRoot, 'assets', 'images'), { recursive: true })
  await writeFile(sourceAbsolutePath, Buffer.from('active runtime image fixture'))

  const client = createMcpClient(workspaceRoot, {
    COFLOW_RUNTIME_JSON: JSON.stringify({
      source: 'env',
      version: 1,
      workspaceRoot: canvasWorkspaceRoot,
      storeRoot: canvasStoreRoot,
      assetsRoot: join(canvasStoreRoot, 'assets'),
      metadataRoot: join(canvasStoreRoot, 'metadata'),
      commandsRoot: join(canvasStoreRoot, 'commands'),
      pendingCommandsPath: join(canvasStoreRoot, 'commands', 'pending.jsonl'),
      clientVersion: '2026-06-27-native-media-writeback-v1',
    }),
  })
  try {
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.get_asset',
      arguments: {
        localPath: sourceLocalPath,
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.localPath, sourceLocalPath)
    assert.equal(payload.absolutePath, sourceAbsolutePath)
    assert.equal(payload.runtime.storeRoot, canvasStoreRoot)
    assert.equal(payload.bytes, 28)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(canvasWorkspaceRoot, { recursive: true, force: true })
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

test('insert_media infers image dimensions from generated file when provider result omits them', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const generatedPath = join(workspaceRoot, '.coflow', 'assets', 'images', 'generated-portrait.png')
  const client = createMcpClient(workspaceRoot)
  try {
    await mkdir(join(workspaceRoot, '.coflow', 'assets', 'images'), { recursive: true })
    await writeFile(generatedPath, pngHeaderWithDimensions(576, 1024))
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.insert_media',
      arguments: {
        providerResult: {
          mediaType: 'image',
          provider: 'Atlas Cloud',
          model: 'openai/gpt-image-2/text-to-image',
          prompt: 'Create a vertical poster.',
          localPath: '.coflow/assets/images/generated-portrait.png',
          absolutePath: generatedPath,
        },
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.command.outputWidth, 576)
    assert.equal(payload.command.outputHeight, 1024)

    const pending = JSON.parse(await readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8'))
    assert.equal(pending.outputWidth, 576)
    assert.equal(pending.outputHeight, 1024)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('insert_media infers video dimensions from generated file when provider result omits them', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const binRoot = await mkdtemp(join(tmpdir(), 'coflow-ffprobe-'))
  const generatedPath = join(workspaceRoot, '.coflow', 'assets', 'videos', 'generated-vertical.mp4')
  const client = createMcpClient(workspaceRoot, {
    PATH: `${binRoot}:${process.env.PATH || ''}`,
  })
  try {
    await writeFakeFfprobe(binRoot, {
      streams: [
        {
          codec_type: 'video',
          width: 720,
          height: 1280,
        },
      ],
    })
    await mkdir(join(workspaceRoot, '.coflow', 'assets', 'videos'), { recursive: true })
    await writeFile(generatedPath, 'fake-video')
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.insert_media',
      arguments: {
        providerResult: {
          mediaType: 'video',
          provider: 'Atlas Cloud',
          model: 'bytedance/seedance-2-0-mini/txt2video',
          prompt: 'Create a vertical product teaser.',
          localPath: '.coflow/assets/videos/generated-vertical.mp4',
          absolutePath: generatedPath,
        },
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.command.outputWidth, 720)
    assert.equal(payload.command.outputHeight, 1280)

    const pending = JSON.parse(await readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8'))
    assert.equal(pending.outputWidth, 720)
    assert.equal(pending.outputHeight, 1280)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(binRoot, { recursive: true, force: true })
  }
})

test('insert_media materializes external Codex image output before writeback', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const generatedRoot = await mkdtemp(join(tmpdir(), 'coflow-generated-'))
  const generatedPath = join(generatedRoot, 'ig-sample.png')
  const client = createMcpClient(workspaceRoot)
  try {
    await writeFile(generatedPath, 'fake-png')
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.insert_media',
      arguments: {
        mediaType: 'image',
        src: generatedPath,
        absolutePath: generatedPath,
        provider: 'codex-native',
        model: 'GPT image 2',
        prompt: 'Make the cat open its mouth.',
        outputWidth: 1086,
        outputHeight: 1448,
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.command.mediaType, 'image')
    assert.match(payload.command.localPath, /^\.coflow\/assets\/images\/ig-sample-\d+\.png$/)
    assert.equal(payload.command.src, `/asset-store/${payload.command.localPath.slice('.coflow/'.length)}`)
    assert.notEqual(payload.command.absolutePath, generatedPath)
    assert.equal(await readFile(payload.command.absolutePath, 'utf8'), 'fake-png')

    const pending = await readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8')
    assert.match(pending, /\/asset-store\/assets\/images\/ig-sample-/)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(generatedRoot, { recursive: true, force: true })
  }
})

test('insert_media prompt-only writeback does not infer the selected media as a source', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const client = createMcpClient(workspaceRoot)
  try {
    const metadataRoot = join(workspaceRoot, '.coflow', 'metadata')
    await mkdir(metadataRoot, { recursive: true })
    await writeFile(
      join(metadataRoot, 'latest-selection.json'),
      JSON.stringify({
        updatedAt: '2026-07-07T00:00:00.000Z',
        source: 'test',
        selection: {
          version: 1,
          selectedIds: ['shape:cat'],
          selectedItems: [
            {
              id: 'shape:cat',
              kind: 'media',
              asset: {
                mediaType: 'image',
              },
            },
          ],
          updatedAt: '2026-07-07T00:00:00.000Z',
        },
      }),
    )

    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.insert_media',
      arguments: {
        mediaType: 'image',
        localPath: '.coflow/assets/images/generated-prompt-only.png',
        provider: 'Atlas Cloud',
        model: 'openai/gpt-image-2/text-to-image',
        prompt: 'Create a standalone fashion portrait.',
        references: [],
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.command.type, 'canvas.create_version')
    assert.equal(payload.command.requestedTool, 'canvas.insert_media')
    assert.equal(payload.command.sourceShapeId, undefined)
    assert.equal(payload.command.frameId, undefined)
    assert.deepEqual(payload.command.references, [])
    assert.match(payload.note, /standalone canvas writeback/)

    const pending = await readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8')
    assert.equal(pending.includes('shape:cat'), false)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('insert_media writes back through the active canvas server runtime when store roots differ', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-mcp-'))
  const canvasWorkspaceRoot = await mkdtemp(join(tmpdir(), 'coflow-canvas-'))
  const generatedRoot = await mkdtemp(join(tmpdir(), 'coflow-generated-'))
  const generatedPath = join(generatedRoot, 'ig-runtime.png')
  const canvasStoreRoot = join(canvasWorkspaceRoot, '.coflow')
  const client = createMcpClient(workspaceRoot, {
    COFLOW_RUNTIME_JSON: JSON.stringify({
      source: 'env',
      version: 1,
      workspaceRoot: canvasWorkspaceRoot,
      storeRoot: canvasStoreRoot,
      assetsRoot: join(canvasStoreRoot, 'assets'),
      commandsRoot: join(canvasStoreRoot, 'commands'),
      pendingCommandsPath: join(canvasStoreRoot, 'commands', 'pending.jsonl'),
      clientVersion: '2026-06-27-native-media-writeback-v1',
    }),
  })
  try {
    await writeFile(generatedPath, 'runtime-png')
    await client.call('initialize')
    const response = await client.call('tools/call', {
      name: 'canvas.insert_media',
      arguments: {
        mediaType: 'image',
        src: generatedPath,
        absolutePath: generatedPath,
        provider: 'codex-native',
        model: 'GPT image 2',
        prompt: 'Put this generated image back on the board.',
        sourceShapeId: 'shape:source',
      },
    })
    const payload = JSON.parse(response.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.queuedVia, 'runtime-file')
    assert.equal(payload.runtime.storeRoot, canvasStoreRoot)
    assert.equal(payload.command.sourceShapeId, 'shape:source')
    assert.match(payload.command.localPath, /^\.coflow\/assets\/images\/ig-runtime-\d+\.png$/)
    assert.equal(await readFile(payload.command.absolutePath, 'utf8'), 'runtime-png')

    await assert.rejects(
      readFile(join(workspaceRoot, '.coflow', 'commands', 'pending.jsonl'), 'utf8'),
      /ENOENT/
    )
    const pending = await readFile(join(canvasStoreRoot, 'commands', 'pending.jsonl'), 'utf8')
    assert.match(pending, /ig-runtime-\d+\.png/)
    assert.match(pending, /shape:source/)
  } finally {
    await client.close()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(canvasWorkspaceRoot, { recursive: true, force: true })
    await rm(generatedRoot, { recursive: true, force: true })
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

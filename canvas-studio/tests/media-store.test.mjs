import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createStore } from '../lib/media-store.mjs'
import { processNextCodexNativeRequest } from '../lib/codex-native-processor.mjs'

async function createTempStore() {
  const root = await mkdtemp(join(tmpdir(), 'cmc-test-'))
  const store = createStore({ workspaceRoot: root })
  await store.ensureStorage()
  return { root, store }
}

test('image upload creates a local asset and metadata record without embedding file bytes in state', async () => {
  const { store } = await createTempStore()
  const asset = await store.addAsset({
    type: 'image',
    fileName: 'product.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('fake-image').toString('base64'),
    width: 1024,
    height: 768,
  })
  const state = await store.readState()

  assert.equal(state.assets.length, 1)
  assert.equal(asset.type, 'image')
  assert.equal(state.assets[0].dataBase64, undefined)
  assert.equal(state.assets[0].localPath.includes('.codex-media-canvas/assets/images/'), true)
  assert.equal(state.assets[0].width, 1024)
})

test('selection context returns selected asset and annotations', async () => {
  const { store } = await createTempStore()
  const asset = await store.addAsset({
    type: 'image',
    fileName: 'source.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('source').toString('base64'),
  })
  await store.addAnnotation(asset.assetId, 'make the background cleaner')
  const selection = await store.updateSelection([asset.assetId])

  assert.deepEqual(selection.selectedAssetIds, [asset.assetId])
  assert.equal(selection.assets[0].assetId, asset.assetId)
  assert.equal(selection.annotations[0].text, 'make the background cleaner')
})

test('inserted version is placed to the right of the parent and preserves lineage metadata', async () => {
  const { store } = await createTempStore()
  const parent = await store.addAsset({
    type: 'image',
    fileName: 'source.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('source').toString('base64'),
    width: 400,
    height: 300,
  })
  const child = await store.addAsset({
    type: 'image',
    fileName: 'generated.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('generated').toString('base64'),
    parentAssetId: parent.assetId,
    provider: 'codex-native',
    model: 'codex-image',
    prompt: 'make the background cleaner',
    width: 400,
    height: 300,
  })

  assert.equal(child.parentAssetId, parent.assetId)
  assert.equal(child.parentVersionId, parent.assetId)
  assert.equal(child.provider, 'codex-native')
  assert.equal(child.position.x > parent.position.x + parent.position.w, true)
  assert.equal(child.version, 2)
})

test('metadata survives store reload', async () => {
  const { root, store } = await createTempStore()
  const asset = await store.addAsset({
    type: 'image',
    fileName: 'persist.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('persist').toString('base64'),
  })
  const reloaded = createStore({ workspaceRoot: root })
  const state = await reloaded.readState()

  assert.equal(state.assets[0].assetId, asset.assetId)
  assert.deepEqual(state.selection.selectedAssetIds, [asset.assetId])
})

test('canvas requests are queued for Codex and claimable without direct provider execution', async () => {
  const { store } = await createTempStore()
  const asset = await store.addAsset({
    type: 'image',
    fileName: 'source.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('source').toString('base64'),
  })
  await store.updatePreferences({ providerMode: 'atlas', sceneMode: 'product-marketing-set' })
  await store.updateSelection([asset.assetId])
  const request = await store.createRequest({ instruction: 'make four product marketing variants' })
  const claimed = await store.claimRequest()

  assert.equal(request.requestType, 'scene.product-marketing-set')
  assert.equal(request.providerPreference, 'atlas')
  assert.equal(request.preset.outputCount, 4)
  assert.equal(request.preset.outputs[0].id, 'hero')
  assert.equal(claimed.requestId, request.requestId)
  assert.equal(claimed.status, 'claimed')
})

test('social repurpose request includes platform output contract', async () => {
  const { store } = await createTempStore()
  const asset = await store.addAsset({
    type: 'image',
    fileName: 'social-source.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('source').toString('base64'),
  })
  await store.updateSelection([asset.assetId])
  await store.updatePreferences({ sceneMode: 'social-repurpose' })
  const request = await store.createRequest({ instruction: 'adapt this for social platforms' })

  assert.equal(request.requestType, 'scene.social-repurpose')
  assert.equal(request.preset.outputCount, 5)
  assert.deepEqual(
    request.preset.outputs.map((output) => output.id),
    ['xiaohongshu', 'instagram-post', 'story', 'youtube-thumbnail', 'horizontal-ad'],
  )
})

test('video frame assets preserve source video and timestamp in selection context', async () => {
  const { store } = await createTempStore()
  const video = await store.addAsset({
    type: 'video',
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    dataBase64: Buffer.from('video').toString('base64'),
    durationMs: 5000,
  })
  const frame = await store.addAsset({
    type: 'frame',
    fileName: 'clip-frame.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('frame').toString('base64'),
    parentAssetId: video.assetId,
    sourceVideoAssetId: video.assetId,
    timestampMs: 1000,
  })
  const selection = await store.updateSelection([frame.assetId])
  const request = await store.createRequest({ instruction: 'make this shot more cinematic' })

  assert.equal(selection.assets[0].sourceVideoAssetId, video.assetId)
  assert.equal(selection.assets[0].timestampMs, 1000)
  assert.equal(request.requestType, 'video.frame-reference')
})

test('mcp-style insert from local path stores a copied local asset', async () => {
  const { root, store } = await createTempStore()
  const inputPath = join(root, 'generated.png')
  await writeFile(inputPath, 'generated-file')
  const asset = await store.addAsset({
    inputPath,
    type: 'image',
    fileName: 'generated.png',
    mimeType: 'image/png',
    provider: 'custom',
  })
  const copied = await readFile(join(root, asset.localPath), 'utf8')

  assert.equal(copied, 'generated-file')
  assert.equal(asset.provider, 'custom')
})

test('request status can be updated after Codex processing', async () => {
  const { store } = await createTempStore()
  const asset = await store.addAsset({
    type: 'image',
    fileName: 'source.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('source').toString('base64'),
  })
  await store.updateSelection([asset.assetId])
  const request = await store.createRequest({ instruction: 'revise this' })
  const updated = await store.updateRequest(request.requestId, {
    status: 'completed',
    result: { assetIds: ['asset_generated'] },
  })

  assert.equal(updated.status, 'completed')
  assert.deepEqual(updated.result, { assetIds: ['asset_generated'] })
})

test('codex native processor completes a queued annotation edit without Atlas setup', async () => {
  const { root, store } = await createTempStore()
  const parent = await store.addAsset({
    type: 'image',
    fileName: 'source.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('source').toString('base64'),
    width: 1200,
    height: 900,
  })
  await store.addAnnotation(parent.assetId, 'make the background cleaner')
  await store.updateSelection([parent.assetId])
  const request = await store.createRequest({ instruction: 'revise this based on the annotation' })
  const result = await processNextCodexNativeRequest(store)
  const state = await store.readState()
  const outputAsset = result.assets[0]

  assert.equal(result.processed, true)
  assert.equal(result.request.requestId, request.requestId)
  assert.equal(result.request.status, 'completed')
  assert.equal(result.request.result.provider, 'codex-native')
  assert.equal(result.request.result.model, 'codex-media-canvas-demo')
  assert.deepEqual(result.request.result.assetIds, [outputAsset.assetId])
  assert.equal(result.assets.length, 1)
  assert.equal(outputAsset.parentAssetId, parent.assetId)
  assert.equal(outputAsset.parentVersionId, parent.assetId)
  assert.deepEqual(outputAsset.references, [parent.assetId])
  assert.equal(outputAsset.jobId, request.requestId)
  assert.equal(outputAsset.provider, 'codex-native')
  assert.equal(outputAsset.model, 'codex-media-canvas-demo')
  assert.equal(outputAsset.skillName, 'annotation-edit-workflow')
  assert.equal(outputAsset.prompt.includes('revise this based on the annotation'), true)
  assert.equal(outputAsset.position.x > parent.position.x + parent.position.w, true)
  await access(join(root, outputAsset.localPath))
  assert.equal(state.assets.some((asset) => asset.assetId === outputAsset.assetId), true)
})

test('codex native processor expands product marketing request into a traceable grid', async () => {
  const { root, store } = await createTempStore()
  const parent = await store.addAsset({
    type: 'image',
    fileName: 'product.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('product').toString('base64'),
    width: 1024,
    height: 1024,
  })
  await store.updateSelection([parent.assetId])
  await store.updatePreferences({ providerMode: 'codex', sceneMode: 'product-marketing-set' })
  const request = await store.createRequest({ instruction: 'create a launch asset set' })
  const result = await processNextCodexNativeRequest(store)

  assert.equal(request.requestType, 'scene.product-marketing-set')
  assert.equal(request.providerPreference, 'codex')
  assert.equal(result.request.status, 'completed')
  assert.equal(result.assets.length, 4)
  assert.deepEqual(
    result.assets.map((asset) => asset.params.outputId),
    ['hero', 'lifestyle', 'benefit-ad', 'launch'],
  )
  assert.deepEqual(result.request.result.assetIds, result.assets.map((asset) => asset.assetId))
  for (const asset of result.assets) {
    assert.equal(asset.parentAssetId, parent.assetId)
    assert.equal(asset.parentVersionId, parent.assetId)
    assert.equal(asset.jobId, request.requestId)
    assert.equal(asset.provider, 'codex-native')
    assert.equal(asset.skillName, 'product-marketing-set')
    assert.equal(asset.params.codexNativeProcessor, true)
    assert.equal(asset.position.x > parent.position.x + parent.position.w, true)
    await access(join(root, asset.localPath))
  }
})

test('codex native processor keeps video frame request lineage and timestamp source intact', async () => {
  const { store } = await createTempStore()
  const video = await store.addAsset({
    type: 'video',
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    dataBase64: Buffer.from('video').toString('base64'),
    durationMs: 6000,
  })
  const frame = await store.addAsset({
    type: 'frame',
    fileName: 'clip-frame.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('frame').toString('base64'),
    parentAssetId: video.assetId,
    sourceVideoAssetId: video.assetId,
    timestampMs: 1800,
    width: 1280,
    height: 720,
  })
  await store.updateSelection([frame.assetId])
  const request = await store.createRequest({ instruction: 'make this frame more cinematic' })
  const result = await processNextCodexNativeRequest(store)
  const outputAsset = result.assets[0]

  assert.equal(request.requestType, 'video.frame-reference')
  assert.equal(result.request.status, 'completed')
  assert.equal(result.assets.length, 1)
  assert.equal(outputAsset.parentAssetId, frame.assetId)
  assert.equal(outputAsset.parentVersionId, frame.assetId)
  assert.equal(outputAsset.jobId, request.requestId)
  assert.deepEqual(outputAsset.references, [frame.assetId])
  assert.equal(outputAsset.provider, 'codex-native')
  assert.equal(outputAsset.skillName, 'video-frame-reference-workflow')
  assert.equal(outputAsset.params.aspectRatio, '16:9')
  assert.equal(frame.sourceVideoAssetId, video.assetId)
  assert.equal(frame.timestampMs, 1800)
})

test('asset metadata can be updated through the v0 MCP contract', async () => {
  const { store } = await createTempStore()
  const asset = await store.addAsset({
    type: 'image',
    fileName: 'source.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('source').toString('base64'),
  })
  const updated = await store.updateAssetMetadata(asset.assetId, {
    provider: 'atlas-cloud',
    model: 'bytedance/seedream',
    prompt: 'updated prompt',
    params: { aspectRatio: '3:4' },
  })

  assert.equal(updated.provider, 'atlas-cloud')
  assert.equal(updated.model, 'bytedance/seedream')
  assert.equal(updated.prompt, 'updated prompt')
  assert.deepEqual(updated.params, { aspectRatio: '3:4' })
})

test('plugin metadata and v1 scene skills are present', async () => {
  const plugin = JSON.parse(await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'))
  assert.equal(plugin.name, 'codex-media-canvas')
  assert.equal(plugin.skills, './skills/')
  assert.equal(plugin.interface.defaultPrompt.includes('Continue processing Codex Media Canvas requests.'), true)
  await access(new URL('../.mcp.json', import.meta.url))
  await access(new URL('../skills/codex-media-canvas/SKILL.md', import.meta.url))
  await access(new URL('../skills/product-marketing-set/SKILL.md', import.meta.url))
  await access(new URL('../skills/social-repurpose/SKILL.md', import.meta.url))
  await access(new URL('../skills/video-ad-keyframes/SKILL.md', import.meta.url))
  await access(new URL('../skills/style-exploration/SKILL.md', import.meta.url))
})

test('canvas implementation is isolated behind the canvas adapter boundary', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const adapterSource = await readFile(new URL('../src/canvas-adapter.tsx', import.meta.url), 'utf8')

  assert.equal(appSource.includes("from 'tldraw'"), false)
  assert.equal(appSource.includes("from './canvas-adapter'"), true)
  assert.equal(adapterSource.includes("from 'tldraw'"), true)
  assert.equal(adapterSource.includes('persistenceKey="codex-media-canvas-whiteboard"'), true)
})

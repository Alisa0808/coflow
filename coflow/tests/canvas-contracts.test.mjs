import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBoundedFrameContextPromptPart } from '../dist-contracts/agentPromptParts.js'
import {
  createGenerationContextFromSelection,
  extractFrameContext,
  createVersionPlacement,
  richTextToPlainText,
} from '../dist-contracts/canvasContracts.js'
import { createProviderReadyGenerationRequest } from '../dist-contracts/generationContract.js'
import { GenerateMediaActionUtil } from '../dist-contracts/generateMediaActionUtil.js'
import { createGenerateMediaAction, createGenerationRequestFromGenerateMediaAction } from '../dist-contracts/mediaActionContract.js'
import { buildAtlasProviderPayload, buildKlingProviderPayload, buildProviderJob, buildSeedanceProviderPayload } from '../dist-contracts/providerAdapter.js'

test('extractFrameContext returns only shapes inside the task frame', () => {
  const context = extractFrameContext(
    [
      { id: 'frame:task', type: 'frame', x: 0, y: 0, props: { w: 500, h: 300, name: 'Hero task' } },
      {
        id: 'shape:source',
        type: 'media-image',
        x: 24,
        y: 48,
        props: {
          w: 240,
          h: 180,
          assetId: 'asset:source',
          versionId: 'version:source-v1',
          localPath: '.coflow/assets/images/source.png',
          provider: 'imported',
        },
      },
      { id: 'shape:box', type: 'geo', x: 120, y: 88, props: { w: 80, h: 60, text: 'clean this', color: 'light-red', fill: 'none', dash: 'draw', size: 'm' } },
      { id: 'shape:outside', type: 'note', x: 640, y: 40, props: { w: 160, h: 160, text: 'ignore me' } },
    ],
    'frame:task',
  )

  assert.equal(context.frameName, 'Hero task')
  assert.equal(context.media.length, 1)
  assert.equal(context.annotations.length, 1)
  assert.equal(context.anchorMedia?.assetId, 'asset:source')
  assert.equal(context.annotations[0].text, 'clean this')
  assert.deepEqual(context.annotations[0].style, { color: 'light-red', fill: 'none', dash: 'draw', size: 'm' })
})

test('extractFrameContext treats native tldraw image shapes as media anchors', () => {
  const context = extractFrameContext(
    [
      { id: 'frame:native', type: 'frame', x: 0, y: 0, props: { w: 600, h: 500, name: 'Native image task' } },
      {
        id: 'shape:native-image',
        type: 'image',
        x: 80,
        y: 80,
        props: {
          w: 320,
          h: 420,
          assetId: 'asset:native-image',
        },
      },
      { id: 'shape:arrow', type: 'arrow', x: 420, y: 120, props: { w: 120, h: 90, text: 'make hair black' } },
    ],
    'frame:native',
  )

  assert.equal(context.media.length, 1)
  assert.equal(context.anchorMedia?.shapeType, 'image')
  assert.equal(context.anchorMedia?.assetId, 'asset:native-image')
  assert.equal(context.anchorMedia?.localPath, 'asset:native-image')
  assert.equal(context.annotations.length, 1)
})

test('richTextToPlainText extracts real native note text instead of seeded fallback copy', () => {
  const text = richTextToPlainText({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'make her hair pink' }],
      },
    ],
  })

  assert.equal(text, 'make her hair pink')
})

test('extractFrameContext treats native text richText as frame annotation prompt', () => {
  const context = extractFrameContext(
    [
      { id: 'frame:text-task', type: 'frame', x: 0, y: 0, props: { w: 600, h: 500, name: 'Text annotation task' } },
      {
        id: 'shape:native-image',
        type: 'image',
        x: 80,
        y: 80,
        props: {
          w: 320,
          h: 360,
          assetId: 'asset:native-image',
        },
      },
      {
        id: 'shape:text',
        type: 'text',
        x: 420,
        y: 120,
        props: {
          w: 160,
          h: 48,
          richText: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'only make her hair pink' }],
              },
            ],
          },
        },
      },
    ],
    'frame:text-task',
  )

  assert.equal(context.annotations.length, 1)
  assert.equal(context.annotations[0].type, 'text')
  assert.equal(context.annotations[0].text, 'only make her hair pink')

  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-06-26T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/images/output.svg',
    context,
  })

  assert.match(request.instructions.prompt, /only make her hair pink/)
  assert.match(request.instructions.prompt, /Use the selected canvas image/)
  assert.match(request.instructions.prompt, /Do not render canvas annotations/)
})

test('createGenerationContextFromSelection uses selected objects when no frame is active', () => {
  const context = createGenerationContextFromSelection({
    version: 1,
    selectedIds: ['shape:image', 'shape:note'],
    selectedItems: [
      {
        id: 'shape:image',
        kind: 'image',
        canvasType: 'image',
        bounds: { x: 100, y: 120, w: 320, h: 240 },
        asset: {
          assetId: 'asset:image',
          mediaType: 'image',
          mimeType: 'image/png',
          localPath: '.coflow/assets/images/source.png',
          absolutePath: '/tmp/source.png',
        },
      },
      {
        id: 'shape:note',
        kind: 'note',
        canvasType: 'note',
        bounds: { x: 460, y: 150, w: 160, h: 120 },
        text: 'make the right eye green',
      },
    ],
    updatedAt: '2026-06-28T00:00:00.000Z',
  })

  assert.equal(context.scope, 'selection')
  assert.equal(context.frameId, 'selection:current')
  assert.deepEqual(context.sourceItemIds, ['shape:image', 'shape:note'])
  assert.equal(context.anchorMedia?.shapeId, 'shape:image')
  assert.equal(context.anchorMedia?.localPath, '.coflow/assets/images/source.png')
  assert.equal(context.annotations[0].text, 'make the right eye green')
  assert.deepEqual(context.bounds, { x: 100, y: 120, w: 520, h: 240 })

  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-06-28T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/images/output.png',
    context,
  })

  assert.equal(request.kind, 'image_edit')
  assert.match(request.instructions.prompt, /make the right eye green/)
})

test('createGenerationContextFromSelection preserves selected draw annotation style', () => {
  const context = createGenerationContextFromSelection({
    version: 1,
    selectedIds: ['shape:image', 'shape:draw'],
    selectedItems: [
      {
        id: 'shape:image',
        kind: 'image',
        canvasType: 'image',
        bounds: { x: 100, y: 120, w: 320, h: 240 },
        asset: {
          assetId: 'asset:image',
          mediaType: 'image',
          mimeType: 'image/png',
          localPath: '.coflow/assets/images/source.png',
        },
      },
      {
        id: 'shape:draw',
        kind: 'shape',
        canvasType: 'draw',
        bounds: { x: 180, y: 180, w: 80, h: 60 },
        style: { color: 'light-red', dash: 'draw', size: 'm' },
      },
    ],
    updatedAt: '2026-07-10T00:00:00.000Z',
  })

  assert.equal(context.annotations[0].type, 'draw')
  assert.deepEqual(context.annotations[0].style, { color: 'light-red', dash: 'draw', size: 'm' })

  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-07-10T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/images/output.png',
    context,
  })

  assert.match(request.instructions.prompt, /light-red stroke/)
  assert.match(request.instructions.prompt, /freehand drawing annotation/)
})

test('createGenerationContextFromSelection falls back to visible viewport items', () => {
  const context = createGenerationContextFromSelection({
    version: 1,
    selectedIds: [],
    selectedItems: [],
    viewport: {
      bounds: { x: 0, y: 0, w: 1000, h: 700 },
      camera: { x: 0, y: 0, z: 1 },
      items: [
        {
          id: 'shape:visible-image',
          kind: 'image',
          canvasType: 'image',
          bounds: { x: 100, y: 100, w: 200, h: 200 },
          asset: {
            assetId: 'asset:visible-image',
            mediaType: 'image',
            mimeType: 'image/png',
            localPath: '.coflow/assets/images/visible.png',
          },
        },
      ],
    },
    updatedAt: '2026-06-28T00:00:00.000Z',
  })

  assert.equal(context.scope, 'viewport')
  assert.equal(context.frameId, 'viewport:current')
  assert.equal(context.anchorMedia?.assetId, 'asset:visible-image')
  assert.deepEqual(context.bounds, { x: 100, y: 100, w: 200, h: 200 })
})

test('extractFrameContext includes annotations whose center is inside the frame even if bounds cross the edge', () => {
  const context = extractFrameContext(
    [
      { id: 'frame:edge-task', type: 'frame', x: 0, y: 0, props: { w: 600, h: 500, name: 'Edge annotation task' } },
      {
        id: 'shape:native-image',
        type: 'image',
        x: 80,
        y: 80,
        props: {
          w: 320,
          h: 360,
          assetId: 'asset:native-image',
        },
      },
      {
        id: 'shape:text-edge',
        type: 'text',
        x: 460,
        y: 220,
        props: {
          w: 220,
          h: 48,
          text: 'make her hair pink',
        },
      },
    ],
    'frame:edge-task',
  )

  assert.equal(context.annotations.length, 1)
  assert.equal(context.annotations[0].text, 'make her hair pink')
})

test('createProviderReadyGenerationRequest summarizes non-text geometric annotations', () => {
  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-06-26T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/images/output.svg',
    context: {
      frameId: 'shape:frame',
      frameName: 'Box-only frame',
      bounds: { x: 0, y: 0, w: 600, h: 500 },
      anchorMedia: {
        shapeId: 'shape:image',
        shapeType: 'image',
        assetId: 'asset:image',
        versionId: 'shape:image:v1',
        localPath: '.coflow/assets/images/source.png',
        bounds: { x: 80, y: 80, w: 320, h: 360 },
      },
      media: [],
      annotations: [{ shapeId: 'shape:box', type: 'geo', style: { color: 'light-red', fill: 'none', dash: 'dashed', size: 'm' }, bounds: { x: 160, y: 140, w: 280, h: 180 } }],
    },
  })

  assert.match(request.instructions.prompt, /drawn geometric annotation/)
  assert.match(request.instructions.prompt, /light-red stroke/)
  assert.match(request.instructions.prompt, /dashed stroke style/)
  assert.match(request.instructions.prompt, /target region/)
})

test('createVersionPlacement puts child to the right and points lineage arrow toward it', () => {
  const placement = createVersionPlacement({ x: 10, y: 20, w: 300, h: 200 }, { w: 320, h: 180 })

  assert.equal(placement.childBounds.x, 406)
  assert.equal(placement.childBounds.y, 20)
  assert.equal(placement.lineageArrow.start.x, 326)
  assert.equal(placement.lineageArrow.end.x, 390)
  assert.deepEqual(placement.lineageArrow.startAnchor, { x: 1, y: 0.5 })
  assert.deepEqual(placement.lineageArrow.endAnchor, { x: 0, y: 0.5 })
})

test('createVersionPlacement avoids occupied objects to the right of the frame', () => {
  const placement = createVersionPlacement(
    { x: 10, y: 20, w: 300, h: 200 },
    { w: 320, h: 180 },
    [{ x: 390, y: 0, w: 380, h: 260 }],
  )

  assert.equal(placement.childBounds.x, 10)
  assert.equal(placement.childBounds.y, 316)
  assert.deepEqual(placement.lineageArrow.start, { x: 160, y: 236 })
  assert.deepEqual(placement.lineageArrow.end, { x: 170, y: 300 })
  assert.deepEqual(placement.lineageArrow.startAnchor, { x: 0.5, y: 1 })
  assert.deepEqual(placement.lineageArrow.endAnchor, { x: 0.5, y: 0 })
})

test('createProviderReadyGenerationRequest creates reference-to-video requests for video anchors', () => {
  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-06-26T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/videos/output.mp4',
    context: {
      frameId: 'shape:frame',
      frameName: 'Video edit frame',
      bounds: { x: 0, y: 0, w: 1280, h: 720 },
      anchorMedia: {
        shapeId: 'shape:video',
        shapeType: 'video',
        assetId: 'asset:video',
        versionId: 'shape:video:v1',
        localPath: '.coflow/assets/videos/source.mp4',
        absolutePath: '/tmp/source.mp4',
        bounds: { x: 0, y: 0, w: 1280, h: 720 },
      },
      media: [
        {
          shapeId: 'shape:video',
          shapeType: 'video',
          assetId: 'asset:video',
          versionId: 'shape:video:v1',
          localPath: '.coflow/assets/videos/source.mp4',
          absolutePath: '/tmp/source.mp4',
          bounds: { x: 0, y: 0, w: 1280, h: 720 },
        },
      ],
      annotations: [{ shapeId: 'shape:note', type: 'note', text: 'Make it cinematic.', bounds: { x: 20, y: 20, w: 160, h: 120 } }],
    },
  })

  assert.equal(request.kind, 'video_edit')
  assert.equal(request.generationMode, 'reference_to_video')
  assert.equal(request.output.mediaType, 'video')
  assert.equal(request.input?.absolutePath, '/tmp/source.mp4')
  assert.equal(request.references.length, 1)
  assert.equal(request.references[0].mediaType, 'video')
  assert.match(request.instructions.prompt, /Make it cinematic\./)
  assert.match(request.instructions.prompt, /Use the selected canvas media/)
  assert.match(request.instructions.prompt, /Do not render canvas annotations/)
})

test('createProviderReadyGenerationRequest treats image to video as reference-to-video', () => {
  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-06-26T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/videos/output.mp4',
    outputMediaType: 'video',
    context: {
      frameId: 'shape:frame',
      frameName: 'Image to video frame',
      bounds: { x: 0, y: 0, w: 1024, h: 768 },
      anchorMedia: {
        shapeId: 'shape:image',
        shapeType: 'image',
        assetId: 'asset:image',
        versionId: 'shape:image:v1',
        localPath: '.coflow/assets/images/source.png',
        absolutePath: '/tmp/source.png',
        bounds: { x: 0, y: 0, w: 1024, h: 768 },
      },
      media: [
        {
          shapeId: 'shape:image',
          shapeType: 'image',
          assetId: 'asset:image',
          versionId: 'shape:image:v1',
          localPath: '.coflow/assets/images/source.png',
          absolutePath: '/tmp/source.png',
          bounds: { x: 0, y: 0, w: 1024, h: 768 },
        },
      ],
      annotations: [],
    },
  })

  assert.equal(request.kind, 'video_edit')
  assert.equal(request.generationMode, 'reference_to_video')
  assert.equal(request.output.mediaType, 'video')
  assert.equal(request.input?.shapeType, 'image')
  assert.equal(request.references[0].mediaType, 'image')
})

test('createProviderReadyGenerationRequest preserves Codex prompt while keeping canvas annotations', () => {
  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-06-26T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/images/output.svg',
    promptOverride: 'Make this suitable for a premium launch hero.',
    context: {
      frameId: 'shape:frame',
      frameName: 'Codex prompt frame',
      bounds: { x: 0, y: 0, w: 1024, h: 768 },
      anchorMedia: {
        shapeId: 'shape:image',
        shapeType: 'image',
        assetId: 'asset:image',
        versionId: 'shape:image:v1',
        localPath: '.coflow/assets/images/source.png',
        bounds: { x: 0, y: 0, w: 1024, h: 768 },
      },
      media: [],
      annotations: [
        {
          shapeId: 'shape:note',
          type: 'note',
          text: 'Clean up the orange badge.',
          bounds: { x: 40, y: 40, w: 160, h: 120 },
        },
      ],
    },
  })

  assert.match(request.instructions.prompt, /Make this suitable for a premium launch hero/)
  assert.match(request.instructions.prompt, /Canvas annotations/)
  assert.match(request.instructions.prompt, /Clean up the orange badge/)
})

test('generate-media action converts bounded frame prompt part into provider-ready request', () => {
  const frameContext = {
    frameId: 'shape:frame',
    frameName: 'Agent action frame',
    bounds: { x: 0, y: 0, w: 1024, h: 768 },
    anchorMedia: {
      shapeId: 'shape:image',
      shapeType: 'image',
      assetId: 'asset:image',
      versionId: 'shape:image:v1',
      localPath: '.coflow/assets/images/source.png',
      absolutePath: '/tmp/source.png',
      bounds: { x: 0, y: 0, w: 1024, h: 768 },
    },
    media: [
      {
        shapeId: 'shape:image',
        shapeType: 'image',
        assetId: 'asset:image',
        versionId: 'shape:image:v1',
        localPath: '.coflow/assets/images/source.png',
        absolutePath: '/tmp/source.png',
        bounds: { x: 0, y: 0, w: 1024, h: 768 },
      },
    ],
    annotations: [{ shapeId: 'shape:note', type: 'note', text: 'Make the edge cleaner.', bounds: { x: 40, y: 40, w: 160, h: 120 } }],
  }
  const promptPart = buildBoundedFrameContextPromptPart(frameContext, 'codex-skill')
  const action = createGenerateMediaAction({
    createdAt: 1782452071363,
    source: 'codex-skill',
    prompt: 'Create a polished product version.',
    frameContext: promptPart,
    outputMediaType: 'image',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/images/output.svg',
  })
  const request = createGenerationRequestFromGenerateMediaAction(action)

  assert.equal(promptPart.type, 'bounded_frame_context')
  assert.equal(promptPart.summary.mediaCount, 1)
  assert.equal(action.type, 'generate-media')
  assert.equal(action.id, 'action:generate-media:1782452071363')
  assert.equal(action.skillName, 'coflow-generation')
  assert.equal(action.providerPolicy.preferredProvider, 'codex-native')
  assert.deepEqual(action.providerPolicy.fallbackProviders, [])
  assert.equal(action.providerPolicy.allowMockFallback, false)
  assert.equal(request.kind, 'image_edit')
  assert.equal(request.provider, 'codex-native')
  assert.equal(request.canvasWriteback.childShapeId, 'shape:child')
  assert.match(request.instructions.prompt, /Create a polished product version/)
  assert.match(request.instructions.prompt, /Make the edge cleaner/)
})

test('generate-media action util applies provider policy to provider-ready request', () => {
  const frameContext = {
    frameId: 'shape:frame',
    frameName: 'Atlas Cloud action frame',
    bounds: { x: 0, y: 0, w: 1024, h: 768 },
    anchorMedia: undefined,
    media: [],
    annotations: [{ shapeId: 'shape:note', type: 'note', text: 'Generate a cinematic clip.', bounds: { x: 40, y: 40, w: 160, h: 120 } }],
  }
  const promptPart = buildBoundedFrameContextPromptPart(frameContext, 'codex-skill')
  const action = GenerateMediaActionUtil.create({
    createdAt: 1782452071999,
    source: 'codex-skill',
    provider: 'atlas',
    prompt: 'Create a short product launch video.',
    frameContext: promptPart,
    outputMediaType: 'video',
    generationMode: 'text_to_video',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/videos/output.mp4',
  })
  const request = GenerateMediaActionUtil.toGenerationRequest(action)

  assert.equal(action.providerPolicy.preferredProvider, 'Atlas Cloud')
  assert.deepEqual(action.providerPolicy.fallbackProviders, [])
  assert.equal(action.providerPolicy.allowMockFallback, false)
  assert.equal(request.provider, 'Atlas Cloud')
  assert.equal(request.kind, 'video_generate')
  assert.equal(request.generationMode, 'text_to_video')
  assert.equal(request.output.mediaType, 'video')
})

test('buildProviderJob maps references into provider inputs', () => {
  const request = createProviderReadyGenerationRequest({
    createdAt: '2026-06-26T00:00:00.000Z',
    childShapeId: 'shape:child',
    arrowShapeId: 'shape:arrow',
    outputLocalPath: '.coflow/assets/videos/output.mp4',
    outputMediaType: 'video',
    context: {
      frameId: 'shape:frame',
      frameName: 'Reference video job',
      bounds: { x: 0, y: 0, w: 1024, h: 768 },
      anchorMedia: {
        shapeId: 'shape:image',
        shapeType: 'image',
        assetId: 'asset:image',
        versionId: 'shape:image:v1',
        localPath: '.coflow/assets/images/source.png',
        absolutePath: '/tmp/source.png',
        bounds: { x: 0, y: 0, w: 1024, h: 768 },
      },
      media: [
        {
          shapeId: 'shape:image',
          shapeType: 'image',
          assetId: 'asset:image',
          versionId: 'shape:image:v1',
          localPath: '.coflow/assets/images/source.png',
          absolutePath: '/tmp/source.png',
          bounds: { x: 0, y: 0, w: 1024, h: 768 },
        },
      ],
      annotations: [{ shapeId: 'shape:note', type: 'note', text: 'Animate gently.', bounds: { x: 40, y: 40, w: 160, h: 120 } }],
    },
  })

  const job = buildProviderJob(request)

  assert.equal(job.mode, 'reference_to_video')
  assert.equal(job.outputMediaType, 'video')
  assert.match(job.prompt, /Animate gently\./)
  assert.match(job.prompt, /Use the selected canvas media/)
  assert.deepEqual(job.inputs, [
    {
      mediaType: 'image',
      role: 'source',
      localPath: '.coflow/assets/images/source.png',
      absolutePath: '/tmp/source.png',
    },
  ])

  const seedancePayload = buildSeedanceProviderPayload(job)
  assert.equal(seedancePayload.mode, 'reference_to_video')
  assert.equal(seedancePayload.references[0].uri, '/tmp/source.png')

  const klingPayload = buildKlingProviderPayload(job)
  assert.equal(klingPayload.task, 'edit')
  assert.equal(klingPayload.referenceAssets[0].role, 'source')

  const atlasPayload = buildAtlasProviderPayload(job)
  assert.equal(atlasPayload.task, 'media_generation')
  assert.equal(atlasPayload.references[0].uri, '/tmp/source.png')
})

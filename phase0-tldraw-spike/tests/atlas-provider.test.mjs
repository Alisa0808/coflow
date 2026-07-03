import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runAtlasProvider } from '../lib/providers/atlas.mjs'

test('runAtlasProvider skips when ATLASCLOUD_API_KEY is missing', async () => {
  const result = await runAtlasProvider(
    {
      output: { type: 'image' },
      prompt: 'A clean product image.',
      references: [],
    },
    { env: {} },
  )

  assert.equal(result.status, 'skipped')
  assert.equal(result.provider, 'Atlas Cloud')
  assert.equal(result.endpointConfigured, false)
  assert.match(result.reason, /ATLASCLOUD_API_KEY/)
})

test('runAtlasProvider uploads local reference, submits image task, and polls output', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-provider-test-'))
  const imagePath = join(tempRoot, 'source.png')
  await writeFile(imagePath, Buffer.from('fake-image'))
  const calls = []
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body })

    if (String(url).endsWith('/model/uploadMedia')) {
      return jsonResponse({
        code: 200,
        data: {
          download_url: 'https://atlas.example.test/uploaded/source.png',
          filename: 'source.png',
          size: 10,
        },
      })
    }

    if (String(url).endsWith('/model/generateImage')) {
      const body = JSON.parse(init.body)
      assert.equal(body.model, 'openai/gpt-image-2/edit')
      assert.deepEqual(body.images, ['https://atlas.example.test/uploaded/source.png'])
      assert.equal(body.image, undefined)
      assert.equal(body.image_size, undefined)
      assert.equal(body.size, '1024x1024')
      assert.equal(body.image_url, undefined)
      assert.match(body.prompt, /Use the provided source image as the primary visual reference/)
      assert.match(body.prompt, /Do not render canvas arrows/)
      assert.match(body.prompt, /A clean product image/)
      return jsonResponse({
        code: 200,
        data: {
          id: 'prediction-123',
          status: 'starting',
        },
      })
    }

    if (String(url).endsWith('/model/prediction/prediction-123')) {
      return jsonResponse({
        code: 200,
        data: {
          id: 'prediction-123',
          status: 'completed',
          outputs: ['https://atlas.example.test/generated/output.png'],
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    const result = await runAtlasProvider(
      {
        output: { type: 'image' },
        prompt: 'A clean product image.',
        references: [{ type: 'image', role: 'source', uri: imagePath }],
      },
      {
        env: {
          ATLASCLOUD_API_KEY: 'test-key',
          ATLAS_POLL_INTERVAL_MS: '1',
          ATLAS_POLL_ATTEMPTS: '1',
        },
      },
    )

    assert.equal(result.status, 'succeeded')
    assert.equal(result.predictionId, 'prediction-123')
    assert.equal(result.outputUrl, 'https://atlas.example.test/generated/output.png')
    assert.equal(result.uploadedReferences[0].download_url, 'https://atlas.example.test/uploaded/source.png')
    assert.equal(calls.some((call) => call.url.endsWith('/model/uploadMedia')), true)
    assert.equal(calls.some((call) => call.url.endsWith('/model/generateImage')), true)
  } finally {
    globalThis.fetch = previousFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runAtlasProvider falls back to Atlas Cloud image result endpoint when prediction endpoint is unavailable', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-image-result-fallback-test-'))
  const imagePath = join(tempRoot, 'source.png')
  await writeFile(imagePath, Buffer.from('fake-image'))
  const previousFetch = globalThis.fetch
  const pollUrls = []

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/model/uploadMedia')) {
      return jsonResponse({
        code: 200,
        data: {
          download_url: 'https://atlas.example.test/uploaded/source.png',
          filename: 'source.png',
          size: 10,
        },
      })
    }

    if (String(url).endsWith('/model/generateImage')) {
      return jsonResponse({
        code: 200,
        data: {
          id: 'image-result-123',
          status: 'starting',
        },
      })
    }

    if (String(url).endsWith('/model/prediction/image-result-123')) {
      pollUrls.push(String(url))
      return jsonResponse({ code: 404, message: 'not found' }, 404)
    }

    if (String(url).endsWith('/model/result/image-result-123')) {
      pollUrls.push(String(url))
      return jsonResponse({
        code: 200,
        data: {
          id: 'image-result-123',
          status: 'completed',
          output: 'https://atlas.example.test/generated/output.png',
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    const result = await runAtlasProvider(
      {
        output: { type: 'image' },
        prompt: 'A clean product image.',
        references: [{ type: 'image', role: 'source', uri: imagePath }],
      },
      {
        env: {
          ATLASCLOUD_API_KEY: 'test-key',
          ATLAS_POLL_INTERVAL_MS: '1',
          ATLAS_POLL_ATTEMPTS: '1',
        },
      },
    )

    assert.equal(result.status, 'succeeded')
    assert.equal(result.poll.endpoint.endsWith('/model/result/image-result-123'), true)
    assert.equal(result.outputUrl, 'https://atlas.example.test/generated/output.png')
    assert.deepEqual(
      pollUrls.map((url) => url.replace('https://api.atlascloud.ai/api/v1', '')),
      ['/model/prediction/image-result-123', '/model/result/image-result-123'],
    )
  } finally {
    globalThis.fetch = previousFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runAtlasProvider submits video with audio enabled and all uploaded image references', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-video-provider-test-'))
  const sourcePath = join(tempRoot, 'source.png')
  const referencePath = join(tempRoot, 'horse.jpg')
  await writeFile(sourcePath, Buffer.from('fake-source-image'))
  await writeFile(referencePath, Buffer.from('fake-reference-image'))
  const previousFetch = globalThis.fetch
  const submittedBodies = []
  let uploadIndex = 0

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/model/uploadMedia')) {
      uploadIndex += 1
      return jsonResponse({
        code: 200,
        data: {
          download_url: `https://atlas.example.test/uploaded/reference-${uploadIndex}.png`,
          filename: `reference-${uploadIndex}.png`,
          size: 10,
        },
      })
    }

    if (String(url).endsWith('/model/generateVideo')) {
      const body = JSON.parse(init.body)
      submittedBodies.push(body)
      assert.equal(body.model, 'bytedance/seedance-2.0/reference-to-video')
      assert.deepEqual(body.reference_images, [
        'https://atlas.example.test/uploaded/reference-1.png',
        'https://atlas.example.test/uploaded/reference-2.png',
      ])
      assert.equal(body.ratio, 'adaptive')
      assert.equal(body.resolution, '720p')
      assert.equal(body.bitrate_mode, 'standard')
      assert.equal(body.generate_audio, true)
      assert.equal(body.watermark, false)
      assert.equal(body.return_last_frame, false)
      assert.equal(body.image_url, undefined)
      assert.equal(body.image_urls, undefined)
      assert.equal(body.audio, undefined)
      assert.equal(body.fps, undefined)
      assert.equal(body.width, undefined)
      assert.equal(body.height, undefined)
      assert.equal(body.aspect_ratio, undefined)
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-prediction-123',
          status: 'starting',
        },
      })
    }

    if (String(url).endsWith('/model/prediction/video-prediction-123')) {
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-prediction-123',
          status: 'completed',
          outputs: ['https://atlas.example.test/generated/output.mp4'],
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    const result = await runAtlasProvider(
      {
        output: { type: 'video' },
        prompt: 'Make the girl ride the horse in a grassland.',
        references: [
          { type: 'image', role: 'source', uri: sourcePath, bounds: { x: 0, y: 0, w: 720, h: 1280 } },
          { type: 'image', role: 'reference', uri: referencePath },
        ],
      },
      {
        env: {
          ATLASCLOUD_API_KEY: 'test-key',
          ATLAS_POLL_INTERVAL_MS: '1',
          ATLAS_POLL_ATTEMPTS: '1',
        },
      },
    )

    assert.equal(result.status, 'succeeded')
    assert.equal(result.uploadedReferences.length, 2)
    assert.equal(submittedBodies.length, 1)
  } finally {
    globalThis.fetch = previousFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runAtlasProvider lets explicit video ratio in prompt override source ratio', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-video-ratio-test-'))
  const sourcePath = join(tempRoot, 'source.png')
  await writeFile(sourcePath, Buffer.from('fake-source-image'))
  const previousFetch = globalThis.fetch
  const submittedBodies = []

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/model/uploadMedia')) {
      return jsonResponse({
        code: 200,
        data: {
          download_url: 'https://atlas.example.test/uploaded/source.png',
          filename: 'source.png',
          size: 10,
        },
      })
    }

    if (String(url).endsWith('/model/generateVideo')) {
      const body = JSON.parse(init.body)
      submittedBodies.push(body)
      assert.equal(body.ratio, '16:9')
      assert.equal(body.width, undefined)
      assert.equal(body.height, undefined)
      assert.equal(body.fps, undefined)
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-ratio-prediction-123',
          status: 'starting',
        },
      })
    }

    if (String(url).endsWith('/model/prediction/video-ratio-prediction-123')) {
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-ratio-prediction-123',
          status: 'completed',
          outputs: ['https://atlas.example.test/generated/output.mp4'],
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    await runAtlasProvider(
      {
        output: { type: 'video' },
        prompt: 'Generate a 16:9 landscape video.',
        references: [{ type: 'image', role: 'source', uri: sourcePath, bounds: { x: 0, y: 0, w: 720, h: 1280 } }],
      },
      {
        env: {
          ATLASCLOUD_API_KEY: 'test-key',
          ATLAS_POLL_INTERVAL_MS: '1',
          ATLAS_POLL_ATTEMPTS: '1',
        },
      },
    )

    assert.equal(submittedBodies.length, 1)
  } finally {
    globalThis.fetch = previousFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runAtlasProvider derives Atlas Cloud video params from prompt text', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-video-prompt-params-test-'))
  const sourcePath = join(tempRoot, 'source.png')
  await writeFile(sourcePath, Buffer.from('fake-source-image'))
  const previousFetch = globalThis.fetch
  const submittedBodies = []

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/model/uploadMedia')) {
      return jsonResponse({
        code: 200,
        data: {
          download_url: 'https://atlas.example.test/uploaded/source.png',
          filename: 'source.png',
          size: 10,
        },
      })
    }

    if (String(url).endsWith('/model/generateVideo')) {
      const body = JSON.parse(init.body)
      submittedBodies.push(body)
      assert.equal(body.ratio, '16:9')
      assert.equal(body.duration, 6)
      assert.equal(body.resolution, '1080p')
      assert.equal(body.bitrate_mode, 'high')
      assert.equal(body.generate_audio, false)
      assert.equal(body.watermark, false)
      assert.equal(body.return_last_frame, true)
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-prompt-params-prediction-123',
          status: 'starting',
        },
      })
    }

    if (String(url).endsWith('/model/prediction/video-prompt-params-prediction-123')) {
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-prompt-params-prediction-123',
          status: 'completed',
          outputs: ['https://atlas.example.test/generated/output.mp4'],
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    await runAtlasProvider(
      {
        output: { type: 'video' },
        prompt: 'Create a 16:9, 6s, 1080P video, high bitrate, no watermark, return last frame, mute.',
        references: [{ type: 'image', role: 'source', uri: sourcePath }],
      },
      {
        env: {
          ATLASCLOUD_API_KEY: 'test-key',
          ATLAS_POLL_INTERVAL_MS: '1',
          ATLAS_POLL_ATTEMPTS: '1',
        },
      },
    )

    assert.equal(submittedBodies.length, 1)
  } finally {
    globalThis.fetch = previousFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runAtlasProvider maps Grok Imagine Video v1.5 image-to-video fields', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-grok-video-payload-test-'))
  const sourcePath = join(tempRoot, 'source.png')
  await writeFile(sourcePath, Buffer.from('fake-source-image'))
  const previousFetch = globalThis.fetch
  const submittedBodies = []

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/model/uploadMedia')) {
      return jsonResponse({
        code: 200,
        data: {
          download_url: 'https://atlas.example.test/uploaded/source.png',
          filename: 'source.png',
          size: 10,
        },
      })
    }

    if (String(url).endsWith('/model/generateVideo')) {
      const body = JSON.parse(init.body)
      submittedBodies.push(body)
      assert.equal(body.model, 'xai/grok-imagine-video-v1.5/image-to-video')
      assert.equal(body.image_url, 'https://atlas.example.test/uploaded/source.png')
      assert.equal(body.aspect_ratio, '16:9')
      assert.equal(body.image, undefined)
      assert.equal(body.reference_images, undefined)
      assert.equal(body.ratio, undefined)
      assert.equal(body.duration, undefined)
      assert.equal(body.resolution, undefined)
      assert.equal(body.bitrate_mode, undefined)
      assert.equal(body.generate_audio, undefined)
      assert.equal(body.watermark, undefined)
      assert.equal(body.return_last_frame, undefined)
      return jsonResponse({
        code: 200,
        data: {
          id: 'grok-video-prediction-123',
          status: 'starting',
        },
      })
    }

    if (String(url).endsWith('/model/prediction/grok-video-prediction-123')) {
      return jsonResponse({
        code: 200,
        data: {
          id: 'grok-video-prediction-123',
          status: 'completed',
          outputs: ['https://atlas.example.test/generated/output.mp4'],
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    await runAtlasProvider(
      {
        output: { type: 'video' },
        prompt: 'Create a 16:9 video from this image.',
        references: [{ type: 'image', role: 'source', uri: sourcePath }],
      },
      {
        env: {
          ATLASCLOUD_API_KEY: 'test-key',
          ATLASCLOUD_VIDEO_IMAGE_MODEL: 'xai/grok-imagine-video-v1.5/image-to-video',
          ATLAS_POLL_INTERVAL_MS: '1',
          ATLAS_POLL_ATTEMPTS: '1',
        },
      },
    )

    assert.equal(submittedBodies.length, 1)
  } finally {
    globalThis.fetch = previousFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runAtlasProvider lets structured providerOptions override prompt and env defaults', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'atlas-video-provider-options-test-'))
  const sourcePath = join(tempRoot, 'source.png')
  await writeFile(sourcePath, Buffer.from('fake-source-image'))
  const previousFetch = globalThis.fetch
  const submittedBodies = []

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/model/uploadMedia')) {
      return jsonResponse({
        code: 200,
        data: {
          download_url: 'https://atlas.example.test/uploaded/source.png',
          filename: 'source.png',
          size: 10,
        },
      })
    }

    if (String(url).endsWith('/model/generateVideo')) {
      const body = JSON.parse(init.body)
      submittedBodies.push(body)
      assert.equal(body.ratio, '9:16')
      assert.equal(body.duration, 8)
      assert.equal(body.resolution, '720p')
      assert.equal(body.bitrate_mode, 'standard')
      assert.equal(body.generate_audio, true)
      assert.equal(body.watermark, true)
      assert.equal(body.return_last_frame, false)
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-provider-options-prediction-123',
          status: 'starting',
        },
      })
    }

    if (String(url).endsWith('/model/prediction/video-provider-options-prediction-123')) {
      return jsonResponse({
        code: 200,
        data: {
          id: 'video-provider-options-prediction-123',
          status: 'completed',
          outputs: ['https://atlas.example.test/generated/output.mp4'],
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    await runAtlasProvider(
      {
        output: { type: 'video' },
        prompt: 'Create a 16:9, 6s, 1080P video, high bitrate, no watermark, return last frame, mute.',
        providerOptions: {
          ratio: '9:16',
          duration: 8,
          resolution: '720p',
          bitrate_mode: 'standard',
          generate_audio: true,
          watermark: true,
          return_last_frame: false,
        },
        references: [{ type: 'image', role: 'source', uri: sourcePath }],
      },
      {
        env: {
          ATLASCLOUD_API_KEY: 'test-key',
          ATLASCLOUD_VIDEO_DURATION: '5',
          ATLASCLOUD_VIDEO_RESOLUTION: '480p',
          ATLASCLOUD_VIDEO_BITRATE_MODE: 'low',
          ATLASCLOUD_VIDEO_AUDIO: 'false',
          ATLASCLOUD_VIDEO_WATERMARK: 'false',
          ATLASCLOUD_VIDEO_RETURN_LAST_FRAME: 'true',
          ATLAS_POLL_INTERVAL_MS: '1',
          ATLAS_POLL_ATTEMPTS: '1',
        },
      },
    )

    assert.equal(submittedBodies.length, 1)
  } finally {
    globalThis.fetch = previousFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body)
    },
  }
}

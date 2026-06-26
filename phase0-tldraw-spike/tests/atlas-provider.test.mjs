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
  assert.equal(result.provider, 'atlas')
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
      assert.equal(body.image_url, 'https://atlas.example.test/uploaded/source.png')
      assert.match(body.prompt, /Edit the provided source image/)
      assert.match(body.prompt, /Do not replace the image with a new unrelated product/)
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

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body)
    },
  }
}

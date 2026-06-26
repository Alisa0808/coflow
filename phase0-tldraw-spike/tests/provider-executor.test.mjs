import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareProviderExecution } from '../lib/provider-executor.mjs'

test('prepareProviderExecution selects atlas payload and reports skipped without endpoint', async () => {
  const execution = await prepareProviderExecution(
    {
      id: 'generation:test',
      provider: 'atlas',
      generationMode: 'image_edit',
      output: {
        mediaType: 'image',
        localPath: '.codex-media-canvas/assets/images/output.svg',
      },
      instructions: {
        prompt: 'Make it premium.',
      },
      references: [
        {
          mediaType: 'image',
          role: 'source',
          localPath: '.codex-media-canvas/assets/images/source.png',
          absolutePath: '/tmp/source.png',
        },
      ],
    },
    {},
  )

  assert.equal(execution.selectedProvider, 'atlas')
  assert.equal(execution.providerJob.provider, 'atlas')
  assert.equal(execution.selectedProviderPayload.task, 'media_generation')
  assert.equal(execution.selectedProviderPayload.references[0].uri, '/tmp/source.png')
  assert.equal(execution.externalExecution.status, 'skipped')
  assert.equal(execution.externalExecution.endpointConfigured, false)
})

test('prepareProviderExecution selects seedance endpoint when configured', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (_endpoint, init) => {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          received: JSON.parse(init.body),
        })
      },
    }
  }

  try {
    const execution = await prepareProviderExecution(
      {
        id: 'generation:test-video',
        provider: 'seedance',
        generationMode: 'reference_to_video',
        output: {
          mediaType: 'video',
          localPath: '.codex-media-canvas/assets/videos/output.mp4',
        },
        instructions: {
          prompt: 'Animate gently.',
        },
        references: [
          {
            mediaType: 'image',
            role: 'source',
            localPath: '.codex-media-canvas/assets/images/source.png',
            absolutePath: '/tmp/source.png',
          },
        ],
      },
      {
        SEEDANCE_PROVIDER_ENDPOINT: 'https://seedance.example.test/generate',
        SEEDANCE_PROVIDER_API_KEY: 'test-key',
      },
    )

    assert.equal(execution.selectedProvider, 'seedance')
    assert.equal(execution.selectedProviderPayload.model, 'seedance-reference-video')
    assert.equal(execution.externalExecution.status, 'succeeded')
    assert.equal(execution.externalExecution.endpointConfigured, true)
    assert.equal(execution.externalExecution.endpoint, 'https://seedance.example.test/generate')
    assert.equal(execution.externalExecution.body.received.prompt, 'Animate gently.')
  } finally {
    globalThis.fetch = previousFetch
  }
})


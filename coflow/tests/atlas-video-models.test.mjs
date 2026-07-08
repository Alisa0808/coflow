import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ATLAS_VIDEO_MODEL_CATALOG,
  atlasVideoRouteFromModel,
  getAtlasVideoModelCapability,
  validateAtlasVideoRequest,
} from '../lib/atlas-video-models.mjs'

test('Atlas video model table exposes catalog entries from executable capabilities', () => {
  assert.ok(ATLAS_VIDEO_MODEL_CATALOG.some((model) => model.id === 'bytedance/seedance-2.0-mini/reference-to-video'))
  assert.ok(getAtlasVideoModelCapability('kwaivgi/kling-video-o3-pro/reference-to-video'))
  assert.equal(atlasVideoRouteFromModel('xai/grok-imagine-video-v1.5/image-to-video'), 'image-to-video')
})

test('Atlas video preflight accepts Seedance reference video with image and video references', () => {
  const result = validateAtlasVideoRequest({
    model: 'bytedance/seedance-2.0-mini/reference-to-video',
    references: [
      { mediaType: 'image', absolutePath: '/tmp/source.png' },
      { mediaType: 'video', absolutePath: '/tmp/motion.mp4' },
    ],
    providerOptions: {
      duration: 6,
      resolution: '1080p',
      ratio: '16:9',
      generate_audio: true,
    },
  })

  assert.equal(result.ok, true)
})

test('Atlas video preflight rejects text-to-video models with references', () => {
  const result = validateAtlasVideoRequest({
    model: 'bytedance/seedance-2.0/text-to-video',
    references: [{ mediaType: 'image', absolutePath: '/tmp/source.png' }],
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'unsupported_reference')
  assert.match(result.reason, /does not support image references/)
})

test('Atlas video preflight rejects unsupported provider options for narrow models', () => {
  const result = validateAtlasVideoRequest({
    model: 'xai/grok-imagine-video-v1.5/image-to-video',
    references: [{ mediaType: 'image', absolutePath: '/tmp/source.png' }],
    providerOptions: {
      duration: 8,
      ratio: '16:9',
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'unsupported_options')
  assert.match(result.reason, /duration/)
})

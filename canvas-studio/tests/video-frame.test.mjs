import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import ts from 'typescript'

async function importVideoFrameModule() {
  const source = await readFile(new URL('../src/video-frame.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const directory = await mkdtemp(join(tmpdir(), 'cmc-video-frame-module-'))
  const modulePath = join(directory, 'video-frame.mjs')
  await writeFile(modulePath, compiled)
  return import(modulePath)
}

function createFakeDeps(options = {}) {
  const calls = {
    objectUrls: [],
    revokedUrls: [],
    drawImage: [],
    seekTargets: [],
  }
  const video = {
    videoWidth: options.width ?? 160,
    videoHeight: options.height ?? 90,
    duration: options.duration ?? 1,
    readyState: options.readyState ?? 2,
    currentTime: options.currentTime ?? 0,
    muted: false,
    playsInline: false,
    preload: '',
    onloadedmetadata: null,
    onloadeddata: null,
    onseeked: null,
    onerror: null,
    set src(value) {
      this._src = value
      queueMicrotask(() => this.onloadedmetadata?.())
    },
    get src() {
      return this._src
    },
  }
  Object.defineProperty(video, 'currentTime', {
    get() {
      return this._currentTime ?? 0
    },
    set(value) {
      this._currentTime = value
      calls.seekTargets.push(value)
      queueMicrotask(() => this.onseeked?.())
    },
  })
  video.currentTime = options.currentTime ?? 0
  calls.seekTargets = []

  const canvas = {
    width: 0,
    height: 0,
    getContext(type) {
      if (type !== '2d' || options.noContext) return null
      return {
        drawImage: (...args) => calls.drawImage.push(args),
      }
    },
    toDataURL(type) {
      assert.equal(type, 'image/png')
      return 'data:image/png;base64,ZmFrZS1mcmFtZQ=='
    },
  }

  return {
    calls,
    video,
    deps: {
      createObjectURL(file) {
        const url = `blob:fake/${file?.name ?? 'video'}`
        calls.objectUrls.push(url)
        return url
      },
      revokeObjectURL(url) {
        calls.revokedUrls.push(url)
      },
      createVideoElement() {
        return video
      },
      createCanvasElement() {
        return canvas
      },
    },
  }
}

test('video frame metadata reads dimensions and duration through injectable browser deps', async () => {
  const { getVideoMetadata } = await importVideoFrameModule()
  const { calls, deps } = createFakeDeps({ width: 320, height: 180, duration: 2.4 })
  const metadata = await getVideoMetadata({ name: 'clip.webm' }, deps)

  assert.deepEqual(metadata, { width: 320, height: 180, durationMs: 2400 })
  assert.deepEqual(calls.objectUrls, ['blob:fake/clip.webm'])
  assert.deepEqual(calls.revokedUrls, ['blob:fake/clip.webm'])
})

test('video frame extraction returns a png frame without seeking when already at timestamp zero', async () => {
  globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 }
  const { extractVideoFrame } = await importVideoFrameModule()
  const { calls, deps } = createFakeDeps({ width: 160, height: 90, duration: 1, currentTime: 0, readyState: 2 })
  const frame = await extractVideoFrame({ name: 'clip.webm' }, 0, deps)

  assert.equal(frame.mimeType, 'image/png')
  assert.equal(frame.dataBase64, 'ZmFrZS1mcmFtZQ==')
  assert.equal(frame.width, 160)
  assert.equal(frame.height, 90)
  assert.equal(frame.timestampMs, 0)
  assert.deepEqual(calls.seekTargets, [])
  assert.equal(calls.drawImage.length, 1)
  assert.deepEqual(calls.revokedUrls, ['blob:fake/clip.webm'])
})

test('video frame extraction seeks to the requested timestamp and rejects unreadable dimensions', async () => {
  globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 }
  const { extractVideoFrame } = await importVideoFrameModule()
  const seekable = createFakeDeps({ width: 640, height: 360, duration: 3, currentTime: 0, readyState: 2 })
  const frame = await extractVideoFrame({ name: 'clip.webm' }, 1200, seekable.deps)

  assert.equal(frame.width, 640)
  assert.deepEqual(seekable.calls.seekTargets, [1.2])

  const unreadable = createFakeDeps({ width: 0, height: 0, duration: 3, readyState: 2 })
  await assert.rejects(
    () => extractVideoFrame({ name: 'broken.webm' }, 0, unreadable.deps),
    /Unable to read video dimensions/,
  )
  assert.deepEqual(unreadable.calls.revokedUrls, ['blob:fake/broken.webm'])
})

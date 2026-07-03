#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ATLAS_CLOUD_MODEL_CATALOG } from '../lib/provider-config.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..', '..')
const appRoot = resolve(__dirname, '..')
const baseUrl = process.env.ATLASCLOUD_API_BASE_URL || 'https://api.atlascloud.ai/api/v1'
const httpStatusMarker = '\n__HTTP_STATUS__:'

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
    return [key, value]
  }),
)

const concurrency = Math.max(1, Number(args.get('concurrency') || 6))
const includeImages = args.get('images') !== 'false'
const includeVideos = args.get('videos') !== 'false'
const poll = args.get('poll') === 'true'
const modelFilter = new Set(
  String(args.get('models') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const diagnosticsDir = join(projectRoot, '.coflow', 'diagnostics')
const runDir = join(diagnosticsDir, `atlas-curl-smoke-${timestamp}`)

await loadLocalEnv()

const apiKey = process.env.ATLASCLOUD_API_KEY || process.env.ATLAS_PROVIDER_API_KEY || process.env.REAL_PROVIDER_API_KEY
if (!apiKey) {
  throw new Error('ATLASCLOUD_API_KEY is not configured. Add it to .env.local before running the smoke test.')
}

await mkdir(runDir, { recursive: true })
const imageFixturePath = await createImageFixture()
const videoFixturePath = await createVideoFixture()

const imageUpload = await uploadMedia(imageFixturePath, 'image/png')
const videoUpload = videoFixturePath ? await uploadMedia(videoFixturePath, 'video/mp4') : undefined
const imageUrl = imageUpload.body?.data?.download_url
const videoUrl = videoUpload?.body?.data?.download_url

if (!imageUrl) {
  throw new Error(`Image fixture upload failed: ${summarizeBody(imageUpload.body)}`)
}

const tasks = []
if (includeImages) {
  for (const model of ATLAS_CLOUD_MODEL_CATALOG.image) {
    if (!shouldIncludeModel(model)) continue
    tasks.push({
      mediaType: 'image',
      endpoint: '/model/generateImage',
      model,
      payload: buildImagePayload(model, imageUrl),
    })
  }
}
if (includeVideos) {
  for (const model of ATLAS_CLOUD_MODEL_CATALOG.video) {
    if (!shouldIncludeModel(model)) continue
    const payload = buildVideoPayload(model, { imageUrl, videoUrl })
    if (!payload) {
      tasks.push({
        mediaType: 'video',
        endpoint: '/model/generateVideo',
        model,
        skipped: true,
        reason: 'Video reference fixture could not be created; skipped video-edit/extend-video model.',
      })
      continue
    }
    tasks.push({
      mediaType: 'video',
      endpoint: '/model/generateVideo',
      model,
      payload,
    })
  }
}

console.log(`CoFlow Atlas Cloud catalog smoke test`)
console.log(`Models: ${tasks.length}; concurrency: ${concurrency}; poll: ${poll ? 'on' : 'off'}`)
if (modelFilter.size > 0) console.log(`Model filter: ${[...modelFilter].join(', ')}`)
console.log(`Diagnostics: ${runDir}`)

const results = await runPool(tasks, concurrency, runTask)
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  concurrency,
  poll,
  fixtureUploads: {
    image: sanitizeUpload(imageUpload),
    video: videoUpload ? sanitizeUpload(videoUpload) : undefined,
  },
  summary: summarizeResults(results),
  results,
}

const reportPath = join(runDir, 'report.json')
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
printSummary(report.summary, results, reportPath)

async function loadLocalEnv() {
  const candidates = [join(projectRoot, '.env.local'), join(appRoot, '.env.local')]
  for (const envPath of candidates) {
    try {
      const content = await readFile(envPath, 'utf8')
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
        if (!match) continue
        const [, key, rawValue] = match
        if (process.env[key] !== undefined) continue
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
      }
    } catch {
      // Ignore missing local env files.
    }
  }
}

async function createImageFixture() {
  const filePath = join(runDir, 'reference.png')
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAnUlEQVR4nO3XwQnAIBAAwXb/pd2kYKs9Eg0EwRzIO+lwYzi2zQF8n7M7gNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgNwGgPwC9h8CPK6dTZkAAAAASUVORK5CYII='
  await writeFile(filePath, Buffer.from(pngBase64, 'base64'))
  return filePath
}

async function createVideoFixture() {
  const filePath = join(runDir, 'reference.mp4')
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:d=1',
      '-pix_fmt',
      'yuv420p',
      filePath,
    ])
    return filePath
  } catch {
    return undefined
  }
}

function buildImagePayload(model, imageUrl) {
  const isEdit = model.mode === 'image_edit' || /edit/i.test(model.id)
  const payload = {
    model: model.id,
    prompt: isEdit
      ? 'Minimal smoke test. Use the reference image and change the main object color to blue.'
      : 'Minimal smoke test. Generate one simple blue sphere on a plain white background.',
    size: '512x512',
  }
  if (isEdit) payload.images = [imageUrl]
  return payload
}

function buildVideoPayload(model, { imageUrl, videoUrl }) {
  if (model.id === 'xai/grok-imagine-video-v1.5/image-to-video') {
    return {
      model: model.id,
      prompt: 'Minimal smoke test. A simple blue object moves slowly. Keep the scene minimal.',
      image_url: imageUrl,
      aspect_ratio: '1:1',
    }
  }

  const payload = {
    model: model.id,
    prompt: 'Minimal smoke test. A simple blue object moves slowly. Keep the scene minimal.',
    duration: 5,
    resolution: '480p',
    ratio: '1:1',
    bitrate_mode: 'low',
    generate_audio: false,
    watermark: false,
    return_last_frame: false,
  }
  if (model.mode === 'image_to_video') {
    payload.image = imageUrl
  }
  if (model.mode === 'reference_to_video') {
    payload.reference_images = [imageUrl]
  }
  if (model.mode === 'video_edit') {
    if (!videoUrl) return undefined
    payload.reference_videos = [videoUrl]
  }
  return payload
}

function shouldIncludeModel(model) {
  return modelFilter.size === 0 || modelFilter.has(model.id)
}

async function uploadMedia(filePath, mimeType) {
  const result = await curl([
    '-X',
    'POST',
    `${baseUrl}/model/uploadMedia`,
    '-H',
    `Authorization: Bearer ${apiKey}`,
    '-F',
    `file=@${filePath};type=${mimeType}`,
  ])
  return {
    fileName: filePath.split('/').pop(),
    httpStatus: result.httpStatus,
    ok: result.httpStatus >= 200 && result.httpStatus < 300 && !isApiError(result.body),
    body: result.body,
  }
}

async function runTask(task, index) {
  if (task.skipped) {
    return {
      index,
      status: 'skipped',
      mediaType: task.mediaType,
      model: task.model,
      reason: task.reason,
    }
  }

  const payloadPath = join(runDir, `payload-${String(index).padStart(2, '0')}.json`)
  await writeFile(payloadPath, `${JSON.stringify(task.payload, null, 2)}\n`)
  const startedAt = Date.now()
  const result = await curl([
    '-X',
    'POST',
    `${baseUrl}${task.endpoint}`,
    '-H',
    `Authorization: Bearer ${apiKey}`,
    '-H',
    'Content-Type: application/json',
    '--data-binary',
    `@${payloadPath}`,
  ])
  const submitDurationMs = Date.now() - startedAt
  const predictionId = getPredictionId(result.body)
  const ok = result.httpStatus >= 200 && result.httpStatus < 300 && !isApiError(result.body) && Boolean(predictionId)
  const pollResult = ok && poll ? await pollPrediction(predictionId, task.mediaType) : undefined
  const status = ok ? (pollResult?.status || 'accepted') : 'failed'
  const row = {
    index,
    status,
    mediaType: task.mediaType,
    mode: task.model.mode,
    label: task.model.label,
    modelId: task.model.id,
    httpStatus: result.httpStatus,
    predictionId,
    submitDurationMs,
    payload: task.payload,
    body: result.body,
    poll: pollResult,
  }
  console.log(`${status.padEnd(10)} ${String(result.httpStatus).padEnd(4)} ${task.mediaType.padEnd(5)} ${task.model.id}`)
  return row
}

async function pollPrediction(predictionId, mediaType) {
  const endpoint = `${baseUrl}/model/prediction/${predictionId}`
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 2000))
    const result = await curl(['-X', 'GET', endpoint, '-H', `Authorization: Bearer ${apiKey}`])
    const status = result.body?.data?.status || result.body?.status || 'unknown'
    if (['completed', 'succeeded', 'failed'].includes(status)) {
      return {
        attempts: attempt,
        status: status === 'failed' ? 'failed' : 'succeeded',
        mediaType,
        httpStatus: result.httpStatus,
        body: result.body,
      }
    }
  }
  return {
    attempts: 3,
    status: 'processing',
  }
}

async function curl(args) {
  const { stdout, stderr } = await execFileAsync('curl', [
    '-sS',
    '--max-time',
    '180',
    ...args,
    '-w',
    `${httpStatusMarker}%{http_code}`,
  ], {
    maxBuffer: 1024 * 1024 * 20,
  })
  if (stderr) process.stderr.write(stderr)
  const markerIndex = stdout.lastIndexOf(httpStatusMarker)
  const bodyText = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout
  const httpStatus = markerIndex >= 0 ? Number(stdout.slice(markerIndex + httpStatusMarker.length).trim()) : 0
  return {
    httpStatus,
    body: parseMaybeJson(bodyText),
  }
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        results[index] = {
          index,
          status: 'failed',
          mediaType: items[index]?.mediaType,
          mode: items[index]?.model?.mode,
          label: items[index]?.model?.label,
          modelId: items[index]?.model?.id,
          error: error instanceof Error ? error.message : String(error),
        }
        console.log(`failed     ---- ${items[index]?.mediaType || 'n/a'} ${items[index]?.model?.id || 'unknown'}`)
      }
    }
  })
  await Promise.all(runners)
  return results
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getPredictionId(body) {
  return body?.data?.id || body?.id || body?.prediction_id || body?.predictionId
}

function isApiError(body) {
  return typeof body?.code === 'number' && body.code >= 400
}

function sanitizeUpload(upload) {
  return {
    fileName: upload.fileName,
    ok: upload.ok,
    httpStatus: upload.httpStatus,
    downloadUrlPresent: Boolean(upload.body?.data?.download_url),
    body: upload.body,
  }
}

function summarizeBody(body) {
  if (typeof body === 'string') return body.slice(0, 300)
  return JSON.stringify(body).slice(0, 300)
}

function summarizeResults(results) {
  const summary = {
    total: results.length,
    accepted: 0,
    failed: 0,
    skipped: 0,
    byMediaType: {},
  }
  for (const result of results) {
    if (!summary.byMediaType[result.mediaType]) {
      summary.byMediaType[result.mediaType] = { total: 0, accepted: 0, failed: 0, skipped: 0 }
    }
    summary.byMediaType[result.mediaType].total += 1
    if (result.status === 'accepted' || result.status === 'processing' || result.status === 'succeeded') {
      summary.accepted += 1
      summary.byMediaType[result.mediaType].accepted += 1
    } else if (result.status === 'skipped') {
      summary.skipped += 1
      summary.byMediaType[result.mediaType].skipped += 1
    } else {
      summary.failed += 1
      summary.byMediaType[result.mediaType].failed += 1
    }
  }
  return summary
}

function printSummary(summary, results, reportPath) {
  console.log('')
  console.log(`Summary: accepted=${summary.accepted}, failed=${summary.failed}, skipped=${summary.skipped}, total=${summary.total}`)
  for (const [mediaType, item] of Object.entries(summary.byMediaType)) {
    console.log(`- ${mediaType}: accepted=${item.accepted}, failed=${item.failed}, skipped=${item.skipped}, total=${item.total}`)
  }
  const failures = results.filter((result) => result.status === 'failed')
  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of failures) {
      const message = failure.error || failure.body?.message || failure.body?.error || failure.body?.msg || summarizeBody(failure.body || '')
      console.log(`- ${failure.modelId}: ${failure.httpStatus || '----'} ${message}`)
    }
  }
  console.log('')
  console.log(`Report saved: ${reportPath}`)
}

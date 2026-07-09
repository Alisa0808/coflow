import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { appendFile, copyFile, cp, link, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { getProviderStatus } from './lib/provider-config.mjs'
import { prepareProviderExecution } from './lib/provider-executor.mjs'
import { buildProviderOnboarding } from './lib/provider-onboarding.mjs'
import { getDefaultProviderForMedia, readProviderSettings, writeProviderSettings } from './lib/provider-settings.mjs'
import { validateAtlasVideoRequest } from './lib/atlas-video-models.mjs'
import { resolveLocalEnvPaths, resolveRuntimePaths } from './lib/runtime-paths.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const execFileAsync = promisify(execFile)
const runtimePaths = resolveRuntimePaths({ root })
const workspaceRoot = runtimePaths.workspaceRoot
const STORE_DIR = runtimePaths.storeDir
const LEGACY_STORE_DIR = runtimePaths.legacyStoreDir
const storeRoot = runtimePaths.storeRoot
const legacyStoreRoot = runtimePaths.legacyStoreRoot
const latestSelectionPath = join(storeRoot, 'metadata', 'latest-selection.json')
const latestFrameContextPath = join(storeRoot, 'metadata', 'latest-frame-context.json')
const latestCodexFrameRequestPath = join(storeRoot, 'metadata', 'latest-codex-frame-request.json')
const latestFrameInputPath = join(storeRoot, 'metadata', 'latest-frame-input.json')
const latestFrameScreenshotPath = join(storeRoot, 'metadata', 'latest-frame-screenshot.json')
const providerSettingsPath = join(storeRoot, 'metadata', 'provider-settings.json')
const metadataRoot = join(storeRoot, 'metadata')
const assetsRoot = join(storeRoot, 'assets')
const executionsRoot = join(storeRoot, 'executions')
const commandsRoot = join(storeRoot, 'commands')
const pendingCommandsPath = join(commandsRoot, 'pending.jsonl')
const latestExecutionResultPath = join(metadataRoot, 'latest-execution-result.json')
const CANVAS_CLIENT_VERSION = '2026-06-27-native-media-writeback-v1'
const CANVAS_SERVER_URL = process.env.COFLOW_URL || 'http://127.0.0.1:5176'
const CANVAS_RUNTIME_TIMEOUT_MS = Number(process.env.COFLOW_RUNTIME_TIMEOUT_MS || 500)
const FRESH_SELECTION_TIMEOUT_MS = 4500
const FRESH_SELECTION_POLL_MS = 180

await loadLocalEnv(resolveLocalEnvPaths({ root, workspaceRoot }))
await migrateLegacyStore()

const tools = [
  {
    name: 'canvas.get_selection',
    description:
      'Read the latest real canvas context published by the browser, including selected ids, normalized item bounds, text, asset metadata, active frame context, and visible viewport context when available.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.capture_selection',
    description:
      'Return the latest real canvas selection as a Codex-consumable capture. Use active frame first, selected objects second, and visible viewport as fallback. If the selection is inside a frame, optionally include the latest Frame Input and frame screenshot artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        includeFrameInput: {
          type: 'boolean',
          description: 'When true, include the latest Frame Input JSON content when it matches the active frame. Defaults to true.',
        },
        includeScreenshot: {
          type: 'boolean',
          description: 'When true, include latest frame screenshot metadata when it matches the active frame. Defaults to true.',
        },
        includeBase64: {
          type: 'boolean',
          description: 'When true, include screenshot base64 PNG bytes. Defaults to false.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_frame_context',
    description: 'Read the latest bounded frame context published by the canvas browser.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_frame_request',
    description: 'Read the latest user-triggered Codex frame request from the canvas browser.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_frame_input',
    description:
      'Read the latest hidden Frame Input JSON artifact created by Send to Codex. This is the primary structured input for Codex/Skills.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_frame_screenshot',
    description:
      'Read the latest frame screenshot artifact metadata created by Send to Codex. The screenshot is auxiliary visual evidence; use Frame Input as the source of truth.',
    inputSchema: {
      type: 'object',
      properties: {
        includeBase64: {
          type: 'boolean',
          description: 'When true, include base64 PNG bytes. Defaults to false so responses stay compact.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.capture_frame',
    description:
      'Return the latest saved frame screenshot artifact. In Phase 0.5, capture is produced by the browser when the user clicks Send to Codex.',
    inputSchema: {
      type: 'object',
      properties: {
        includeBase64: {
          type: 'boolean',
          description: 'When true, include base64 PNG bytes. Defaults to false.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_asset',
    description:
      'Read local metadata for a canvas asset by absolutePath or .coflow localPath. This helps Codex/Skills verify references before generation.',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: {
          type: 'string',
          description: 'A path such as .coflow/assets/images/foo.png.',
        },
        absolutePath: {
          type: 'string',
          description: 'An absolute local filesystem path inside the workspace canvas store.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_provider_status',
    description:
      'Read available provider/model status for CoFlow. Use credential fields only as redacted runtime diagnostics; never expose secrets.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_provider_settings',
    description:
      'Read user-facing CoFlow provider/model defaults and onboarding state. This never includes API keys.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_provider_onboarding',
    description:
      'Read the first-run provider/model onboarding payload for CoFlow, including whether to prompt and the supported setup actions. This never includes API keys.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.set_provider_settings',
    description:
      'Update CoFlow provider defaults and onboarding state. Store only provider/model choices and setup status, never credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['not_started', 'skipped', 'configured'],
        },
        image: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            modelIntent: { type: 'string' },
            textModel: { type: 'string' },
            editModel: { type: 'string' },
          },
          additionalProperties: false,
        },
        video: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            modelIntent: { type: 'string' },
            textModel: { type: 'string' },
            referenceModel: { type: 'string' },
          },
          additionalProperties: false,
        },
        customProviders: {
          type: 'object',
          description: 'Non-secret custom provider profiles keyed by stable provider id.',
          additionalProperties: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              mediaTypes: { type: 'array', items: { type: 'string' } },
              modes: { type: 'array', items: { type: 'string' } },
              models: { type: 'array', items: { type: 'string' } },
              baseUrl: { type: 'string' },
              docsUrl: { type: 'string' },
              apiKeyUrl: { type: 'string' },
              authEnv: { type: 'string' },
              submitEndpoint: { type: 'string' },
              uploadEndpoint: { type: 'string' },
              statusEndpoint: { type: 'string' },
              resultEndpoint: { type: 'string' },
              responseOutputPath: { type: 'string' },
              responseJobIdPath: { type: 'string' },
              responseStatusPath: { type: 'string' },
              responseErrorPath: { type: 'string' },
              requiredFields: { type: 'array', items: { type: 'string' } },
              optionalFields: { type: 'array', items: { type: 'string' } },
              terminalSuccessStates: { type: 'array', items: { type: 'string' } },
              terminalFailureStates: { type: 'array', items: { type: 'string' } },
              referenceRequirements: { type: 'object', additionalProperties: true },
              async: { type: 'object', additionalProperties: true },
              defaults: { type: 'object', additionalProperties: true },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.run_provider',
    description:
      'Run the selected media provider with a Codex-normalized prompt and explicit local references from the current bounded canvas task, then materialize the provider output into .coflow. When a user invokes a CoFlow image/video skill, that invocation is the product-level permission to use the bounded references for that task; do not ask a second assistant-level confirmation before calling this tool. This tool does not read canvas context and does not write back to the canvas. After success, pass this tool result object directly to canvas.insert_media as providerResult or result.',
    inputSchema: {
      type: 'object',
      properties: {
        mediaType: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'Requested output media type.',
        },
        prompt: {
          type: 'string',
          description: 'User-visible prompt built from the user request and canvas annotations.',
        },
        provider: {
          type: 'string',
          description: 'Provider to execute, e.g. Atlas Cloud. For canvas reference/edit tasks, pass a provider that can accept the bounded local references selected by Codex/Skill.',
        },
        model: {
          type: 'string',
          description: 'Optional concrete provider model id.',
        },
        generationMode: {
          type: 'string',
          description: 'Provider mode such as text_to_image, image_edit, text_to_video, reference_to_video.',
        },
        references: {
          type: 'array',
          description: 'Explicit local canvas references selected by Codex/Skill.',
          items: {
            type: 'object',
            properties: {
              mediaType: { type: 'string' },
              role: { type: 'string' },
              localPath: { type: 'string' },
              absolutePath: { type: 'string' },
              bounds: { type: 'object' },
            },
            additionalProperties: true,
          },
        },
        providerOptions: {
          type: 'object',
          description:
            'Optional provider-specific generation parameters normalized by Codex from the user prompt or canvas annotations. For Atlas Cloud video this may include duration, resolution, ratio, bitrate_mode, generate_audio, watermark, and return_last_frame. These options override prompt/env defaults.',
          additionalProperties: true,
        },
        outputLocalPath: {
          type: 'string',
          description: 'Optional desired output local path under .coflow.',
        },
      },
      required: ['mediaType', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.create_version',
    description:
      'Write a Codex-generated media result back to the canvas as a child version of the bounded frame. This does not ask the browser to call a model or provider.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'string',
          description: 'Optional frame id. Defaults to the latest published frame context when available.',
        },
        sourceShapeId: {
          type: 'string',
          description:
            'Optional source canvas shape id to anchor the generated media beside a selected image/object group when no frame is used.',
        },
        mediaType: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'The output media type to place on the canvas.',
        },
        src: {
          type: 'string',
          description: 'Data URL or browser-accessible URL for the generated media.',
        },
        localPath: {
          type: 'string',
          description: 'Optional local path inside .coflow, e.g. .coflow/assets/images/output.png.',
        },
        absolutePath: {
          type: 'string',
          description: 'Optional absolute filesystem path for provenance metadata.',
        },
        title: {
          type: 'string',
          description: 'Optional visible/provenance title for the generated child media.',
        },
        prompt: {
          type: 'string',
          description: 'Prompt or instruction used by Codex/Skill to generate this version.',
        },
        provider: {
          type: 'string',
          description: 'Provider used by Codex/Skill, e.g. codex-native, Atlas Cloud, openai, kling.',
        },
        model: {
          type: 'string',
          description: 'Model used by Codex/Skill.',
        },
        outputWidth: {
          type: 'number',
          description: 'Optional generated media width in pixels for native tldraw asset sizing.',
        },
        outputHeight: {
          type: 'number',
          description: 'Optional generated media height in pixels for native tldraw asset sizing.',
        },
        generationStartedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when provider generation started.',
        },
        generationCompletedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when provider generation completed.',
        },
        generationDurationMs: {
          type: 'number',
          description: 'Optional total provider/runtime generation duration in milliseconds.',
        },
        providerTimings: {
          type: 'object',
          description: 'Optional provider timing breakdown for internal diagnostics.',
        },
        e2eStartedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when the user-visible generation workflow started.',
        },
        e2eCompletedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when the user-visible generation workflow completed.',
        },
        e2eDurationMs: {
          type: 'number',
          description: 'Optional user-visible end-to-end duration in milliseconds.',
        },
        writebackCompletedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when canvas writeback completed.',
        },
        status: {
          type: 'string',
          description: 'Writeback status, normally succeeded.',
        },
        result: {
          type: 'object',
          description:
            'Optional generated media result object returned by canvas.run_provider. If provided, src/localPath/absolutePath/mediaType are normalized from it.',
          additionalProperties: true,
        },
        output: {
          type: 'object',
          description:
            'Optional generated media output object. Use this only to carry src/localPath/absolutePath/mediaType from a provider result.',
          additionalProperties: true,
        },
        media: {
          type: 'object',
          description:
            'Optional generated media object. Use this only to carry src/localPath/absolutePath/mediaType from a provider result.',
          additionalProperties: true,
        },
        asset: {
          type: 'object',
          description:
            'Optional generated asset object. Use this only to carry src/localPath/absolutePath/mediaType from a provider result.',
          additionalProperties: true,
        },
        providerResult: {
          type: 'object',
          description:
            'Optional full provider result object returned by canvas.run_provider. The writeback command will normalize its media output fields.',
          additionalProperties: true,
        },
      },
      required: ['mediaType'],
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.insert_media',
    description:
      'Insert a generated local media asset back onto the canvas. This only queues canvas writeback; provider/model execution must already be complete. Pass the full successful canvas.run_provider result as providerResult/result, or pass mediaType plus src/localPath/absolutePath explicitly.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'string',
          description:
            'Optional frame id. Defaults to the active frame from the latest selection. If sourceShapeId is present, the source shape is used as the placement anchor instead.',
        },
        sourceShapeId: {
          type: 'string',
          description:
            'Optional source canvas shape id. Use this for selected-image/object-group workflows so writeback is placed beside the selected source instead of falling back to an old frame.',
        },
        mediaType: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'The output media type to place on the canvas.',
        },
        src: {
          type: 'string',
          description: 'Data URL or browser-accessible URL for the generated media.',
        },
        localPath: {
          type: 'string',
          description: 'Optional local path inside .coflow, e.g. .coflow/assets/images/output.png.',
        },
        absolutePath: {
          type: 'string',
          description: 'Optional absolute filesystem path for provenance metadata.',
        },
        title: {
          type: 'string',
          description: 'Optional provenance title for the generated media.',
        },
        prompt: {
          type: 'string',
          description: 'Prompt or instruction used by Codex/Skill to generate this media.',
        },
        provider: {
          type: 'string',
          description: 'Provider used by Codex/Skill, e.g. codex-native, Atlas Cloud, openai, kling.',
        },
        model: {
          type: 'string',
          description: 'Model used by Codex/Skill.',
        },
        outputWidth: {
          type: 'number',
          description: 'Optional generated media width in pixels for native tldraw asset sizing.',
        },
        outputHeight: {
          type: 'number',
          description: 'Optional generated media height in pixels for native tldraw asset sizing.',
        },
        generationStartedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when provider generation started.',
        },
        generationCompletedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when provider generation completed.',
        },
        generationDurationMs: {
          type: 'number',
          description: 'Optional total provider/runtime generation duration in milliseconds.',
        },
        providerTimings: {
          type: 'object',
          description: 'Optional provider timing breakdown for internal diagnostics.',
        },
        e2eStartedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when the user-visible generation workflow started.',
        },
        e2eCompletedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when the user-visible generation workflow completed.',
        },
        e2eDurationMs: {
          type: 'number',
          description: 'Optional user-visible end-to-end duration in milliseconds.',
        },
        writebackCompletedAt: {
          type: 'string',
          description: 'Optional ISO timestamp when canvas writeback completed.',
        },
        status: {
          type: 'string',
          description: 'Writeback status, normally succeeded.',
        },
        result: {
          type: 'object',
          description:
            'Optional generated media result object returned by canvas.run_provider. If provided, src/localPath/absolutePath/mediaType are normalized from it.',
          additionalProperties: true,
        },
        output: {
          type: 'object',
          description:
            'Optional generated media output object. Use this only to carry src/localPath/absolutePath/mediaType from a provider result.',
          additionalProperties: true,
        },
        media: {
          type: 'object',
          description:
            'Optional generated media object. Use this only to carry src/localPath/absolutePath/mediaType from a provider result.',
          additionalProperties: true,
        },
        asset: {
          type: 'object',
          description:
            'Optional generated asset object. Use this only to carry src/localPath/absolutePath/mediaType from a provider result.',
          additionalProperties: true,
        },
        providerResult: {
          type: 'object',
          description:
            'Optional full provider result object returned by canvas.run_provider. The writeback command will normalize its media output fields.',
          additionalProperties: true,
        },
      },
      required: ['mediaType'],
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.link_versions',
    description:
      'Create a visible lineage/reference arrow between two existing canvas shapes. This is a writeback-only command; it does not call a provider.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceShapeId: {
          type: 'string',
          description: 'Source shape id, usually the original media, frame, or prior version.',
        },
        targetShapeId: {
          type: 'string',
          description: 'Target shape id, usually the generated version or derivative media.',
        },
        frameId: {
          type: 'string',
          description: 'Optional related frame id for provenance.',
        },
        linkType: {
          type: 'string',
          enum: ['version', 'reference', 'derivative'],
          description: 'Relationship type. Defaults to version.',
        },
      },
      required: ['sourceShapeId', 'targetShapeId'],
      additionalProperties: false,
    },
  },
]

process.stdin.setEncoding('utf8')
let buffer = ''

process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newlineIndex
  while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim()
    buffer = buffer.slice(newlineIndex + 1)
    if (line) handleLine(line).catch((error) => respond(null, { code: -32603, message: error.message }))
  }
})

async function handleLine(line) {
  const message = JSON.parse(line)
  const { id, method, params } = message

  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'coflow', version: '0.0.1' },
    })
  }

  if (method === 'tools/list') {
    return respond(id, { tools })
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    if (toolName === 'canvas.get_selection') {
      const payload = await readFreshSelectionOrLatest()
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.capture_selection') {
      const payload = await captureLatestSelection(params?.arguments ?? {})
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_frame_context') {
      const payload = await readLatestFrameContext()
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_frame_request') {
      const payload = await readLatestCodexFrameRequest()
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_frame_input') {
      const payload = await readLatestFrameInput()
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_frame_screenshot' || toolName === 'canvas.capture_frame') {
      const payload = await readLatestFrameScreenshot(Boolean(params?.arguments?.includeBase64))
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_asset') {
      const payload = await readCanvasAsset(params?.arguments ?? {})
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_provider_status') {
      const providerSettings = await readProviderSettings(readJsonFile, providerSettingsPath, process.env)
      const payload = getProviderStatus(process.env, {
        canvasUrl: CANVAS_SERVER_URL,
        workspaceRoot,
        providerSettings,
        settingsPath: providerSettingsPath,
      })
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_provider_settings') {
      const settings = await readProviderSettings(readJsonFile, providerSettingsPath, process.env)
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, settingsPath: providerSettingsPath, settings }, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.get_provider_onboarding') {
      const settings = await readProviderSettings(readJsonFile, providerSettingsPath, process.env)
      const status = getProviderStatus(process.env, {
        canvasUrl: CANVAS_SERVER_URL,
        workspaceRoot,
        providerSettings: settings,
        settingsPath: providerSettingsPath,
      })
      const onboarding = buildProviderOnboarding({
        providerSettings: settings,
        providerStatus: status,
        settingsPath: providerSettingsPath,
      })
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(onboarding, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.set_provider_settings') {
      const settings = await writeProviderSettings({
        input: params?.arguments ?? {},
        readJsonFile,
        writeJson,
        settingsPath: providerSettingsPath,
        env: process.env,
      })
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, settingsPath: providerSettingsPath, settings }, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.run_provider') {
      const payload = await runProviderForMedia(params?.arguments ?? {})
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    if (toolName === 'canvas.create_version' || toolName === 'canvas.insert_media' || toolName === 'canvas.link_versions') {
      const payload = await enqueueCanvasCommand(params?.arguments ?? {}, toolName)
      return respond(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      })
    }

    return respond(id, null, { code: -32602, message: `Unknown tool: ${toolName}` })
  }

  return respond(id, null, { code: -32601, message: `Unknown method: ${method}` })
}

async function loadLocalEnv(paths) {
  for (const envPath of paths) {
    let content
    try {
      content = await readFile(envPath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue

      const [, key, rawValue] = match
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue
      process.env[key] = stripEnvQuotes(rawValue.trim())
    }

  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function sanitizeFilePart(value) {
  return String(value || 'generation')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

async function readLatestSelection() {
  try {
    return JSON.parse(await readFile(latestSelectionPath, 'utf8'))
  } catch {
    return {
      updatedAt: null,
      source: 'coflow',
      selection: {
        version: 1,
        selectedIds: [],
        selectedItems: [],
        viewport: undefined,
        updatedAt: null,
      },
      warning: 'No selection has been published yet. Open the canvas and select a shape or frame.',
    }
  }
}

async function readFreshSelectionOrLatest(options = {}) {
  const fresh = await requestFreshSelectionCapture(options).catch((error) => ({
    freshCapture: false,
    warning: `Fresh canvas capture failed; using latest cached selection. ${error instanceof Error ? error.message : String(error)}`,
  }))
  if (fresh?.freshCapture) return fresh

  const latest = await readLatestSelection()
  return {
    ...latest,
    freshCapture: false,
    warning: fresh?.warning || 'Fresh canvas capture was not available; using latest cached selection.',
  }
}

async function requestFreshSelectionCapture(options = {}) {
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : FRESH_SELECTION_TIMEOUT_MS
  const requestId = `mcp-selection-capture:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const requestResponse = await fetch(`${CANVAS_SERVER_URL}/api/selection/fresh-capture/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: requestId, source: 'coflow-mcp' }),
  })
  if (!requestResponse.ok) {
    throw new Error(`request failed with HTTP ${requestResponse.status}`)
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(FRESH_SELECTION_POLL_MS)
    const response = await fetch(`${CANVAS_SERVER_URL}/api/selection/fresh-capture/response?id=${encodeURIComponent(requestId)}`)
    if (!response.ok) continue
    const payload = await response.json()
    if (payload?.selection) {
      return {
        ...payload,
        freshCapture: true,
      }
    }
  }
  throw new Error('browser did not respond to fresh capture request in time')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function captureLatestSelection(args) {
  const includeFrameInput = args.includeFrameInput !== false
  const includeScreenshot = args.includeScreenshot !== false
  const includeBase64 = Boolean(args.includeBase64)
  const latestSelection = await readFreshSelectionOrLatest()
  const activeFrameId = latestSelection.selection?.activeFrame?.frameId
  const capture = {
    ok: true,
    updatedAt: new Date().toISOString(),
    source: 'coflow',
    captureType: 'selection',
    selection: latestSelection.selection,
  }

  if (!latestSelection.selection?.selectedIds?.length) {
    capture.warning = latestSelection.selection?.viewport?.items?.length
      ? 'No selected canvas objects were published. Use selection.viewport as visible-canvas fallback, or select/frame specific objects for a bounded edit.'
      : 'No selected canvas objects were published. Select a shape or frame in the canvas first.'
    return capture
  }

  if (includeFrameInput) {
    const frameInput = await readLatestFrameInput()
    const frameInputFrameId = frameInput.content?.context?.frameId ?? frameInput.content?.frameId
    capture.frameInput =
      activeFrameId && frameInputFrameId && frameInputFrameId !== activeFrameId
        ? {
            stale: true,
            warning: `Latest Frame Input belongs to ${frameInputFrameId}, but active selection frame is ${activeFrameId}. Click Send to Codex on the active frame to refresh it.`,
            frameInput: frameInput.frameInput ?? null,
          }
        : frameInput
  }

  if (includeScreenshot) {
    const screenshot = await readLatestFrameScreenshot(includeBase64)
    const screenshotFrameId = screenshot.screenshot?.frameId
    capture.frameScreenshot =
      activeFrameId && screenshotFrameId && screenshotFrameId !== activeFrameId
        ? {
            stale: true,
            warning: `Latest frame screenshot belongs to ${screenshotFrameId}, but active selection frame is ${activeFrameId}. Click Send to Codex on the active frame to refresh it.`,
            screenshot: screenshot.screenshot ?? null,
          }
        : screenshot
  }

  return capture
}

async function readLatestFrameContext() {
  try {
    return JSON.parse(await readFile(latestFrameContextPath, 'utf8'))
  } catch {
    return {
      updatedAt: null,
      source: 'coflow',
      context: null,
      warning: 'No frame context has been published yet. Select a frame and click Send to Codex in the canvas first.',
    }
  }
}

async function readLatestCodexFrameRequest() {
  try {
    return JSON.parse(await readFile(latestCodexFrameRequestPath, 'utf8'))
  } catch {
    return {
      updatedAt: null,
      source: 'coflow',
      request: null,
      warning: 'No Codex frame request has been published yet. Select a frame and click Send to Codex in the canvas.',
    }
  }
}

async function readLatestFrameInput() {
  try {
    const latest = JSON.parse(await readFile(latestFrameInputPath, 'utf8'))
    const absolutePath = latest?.frameInput?.absolutePath
    const content = absolutePath ? JSON.parse(await readFile(absolutePath, 'utf8')) : undefined
    return {
      ...latest,
      content,
    }
  } catch {
    return {
      updatedAt: null,
      source: 'coflow',
      frameInput: null,
      warning: 'No Frame Input artifact has been published yet. Select a frame and click Send to Codex in the canvas.',
    }
  }
}

async function readLatestFrameScreenshot(includeBase64 = false) {
  try {
    const latest = JSON.parse(await readFile(latestFrameScreenshotPath, 'utf8'))
    const screenshot = latest?.screenshot
    if (!includeBase64 || !screenshot?.absolutePath) return latest
    const bytes = await readFile(screenshot.absolutePath)
    return {
      ...latest,
      screenshot: {
        ...screenshot,
        base64: bytes.toString('base64'),
      },
    }
  } catch {
    return {
      updatedAt: null,
      source: 'coflow',
      screenshot: null,
      warning: 'No frame screenshot has been saved yet. Select a frame and click Send to Codex in the canvas.',
    }
  }
}

async function readCanvasAsset(args) {
  const activeRuntime = await readActiveCanvasRuntime()
  const targetRuntime = activeRuntime || createLocalCanvasRuntime()
  const asset = await resolveReadableCanvasAsset(args.absolutePath, args.localPath, targetRuntime)
  if (!asset?.absolutePath) {
    return {
      ok: false,
      error: 'Provide absolutePath or .coflow localPath.',
    }
  }

  try {
    const info = await stat(asset.absolutePath)
    return {
      ok: true,
      absolutePath: asset.absolutePath,
      localPath: asset.localPath,
      runtime: runtimeDebugInfo(asset.runtime),
      bytes: info.size,
      updatedAt: info.mtime.toISOString(),
    }
  } catch (error) {
    return {
      ok: false,
      absolutePath: asset.absolutePath,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`)
}

async function runProviderForMedia(args = {}) {
  const mediaType = args.mediaType === 'video' ? 'video' : 'image'
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt) {
    return {
      ok: false,
      error: 'canvas.run_provider requires a prompt built from the user request and canvas context.',
    }
  }

  const activeRuntime = await readActiveCanvasRuntime()
  const targetRuntime = activeRuntime || createLocalCanvasRuntime()
  const references = await normalizeProviderReferences(args.references, targetRuntime)
  const providerSettings = await readProviderSettings(readJsonFile, runtimeProviderSettingsPath(targetRuntime), process.env)
  const generationMode =
    typeof args.generationMode === 'string' && args.generationMode
      ? args.generationMode
      : inferProviderGenerationMode(mediaType, references)
  const requestedProvider = canonicalProviderId(
    args.provider || getDefaultProviderForMedia(providerSettings, mediaType) || defaultProviderForProviderRun(mediaType, references)
  )
  const providerRedirect = providerRunRedirectForReferences({
    mediaType,
    provider: requestedProvider,
    references,
  })
  const provider = providerRedirect?.to || requestedProvider
  const model =
    typeof args.model === 'string' && args.model
      ? args.model
      : defaultModelForProviderRun({
          mediaType,
          generationMode,
          provider,
          providerSettings,
        })
  const request = {
    id: `provider-request:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    provider,
    providerRedirect,
    model,
    providerOptions: normalizeProviderOptions(args.providerOptions),
    generationMode,
    instructions: {
      prompt,
    },
    references,
    output: {
      mediaType,
      localPath:
        typeof args.outputLocalPath === 'string' && args.outputLocalPath.startsWith('.coflow/')
          ? args.outputLocalPath
          : `.coflow/assets/${mediaType === 'video' ? 'videos' : 'images'}/generated-${Date.now()}.${mediaType === 'video' ? 'mp4' : 'png'}`,
    },
  }

  const preflight = validateProviderRunRequest(request)
  if (!preflight.ok) {
    return {
      ok: false,
      status: 'model_preflight_failed',
      provider,
      request,
      reason: preflight.reason,
      validation: preflight,
    }
  }

  const execution = await prepareProviderExecution(request, process.env)
  const { selectedProvider, selectedProviderPayload, externalExecution } = execution

  if (externalExecution?.status === 'requires_codex_native') {
    return {
      ok: false,
      status: 'requires_codex_native',
      provider: selectedProvider,
      request,
      reason:
        externalExecution.reason ||
        'Codex native generation must be performed by the Codex runtime. Use canvas.run_provider only for providers that can accept local references.',
    }
  }

  if (externalExecution?.status === 'skipped') {
    return {
      ok: false,
      status: 'provider_not_configured',
      provider: selectedProvider,
      request,
      reason: `${selectedProvider} is not configured. Add ATLASCLOUD_API_KEY to .env.local before generating.`,
      providerExecution: redactProviderExecution(externalExecution),
    }
  }

  if (externalExecution?.status === 'processing') {
    return {
      ok: false,
      status: 'provider_processing',
      provider: selectedProvider,
      request,
      reason: `${selectedProvider} is still processing. Increase provider polling or retry later.`,
      providerExecution: redactProviderExecution(externalExecution),
    }
  }

  if (externalExecution?.status !== 'succeeded') {
    return {
      ok: false,
      status: 'provider_failed',
      provider: selectedProvider,
      request,
      reason: `${selectedProvider} generation failed.`,
      providerExecution: redactProviderExecution(externalExecution),
    }
  }

  const materialized = await materializeProviderOutput({
    externalExecution,
    mediaType,
    runtime: targetRuntime,
  })
  if (!materialized.ok) {
    return {
      ok: false,
      status: 'materialize_failed',
      provider: selectedProvider,
      request,
      reason: materialized.error,
      providerExecution: redactProviderExecution(externalExecution),
    }
  }

  const result = {
    ok: true,
    id: `execution:${Date.now()}`,
    requestId: request.id,
    status: 'succeeded',
    mediaType,
    provider: selectedProvider,
    model: selectedProviderPayload?.model || request.model,
    prompt,
    references,
    localPath: materialized.localPath,
    absolutePath: materialized.absolutePath,
    src: materialized.src,
    outputWidth: materialized.width,
    outputHeight: materialized.height,
    generationStartedAt: externalExecution?.timings?.startedAt,
    generationCompletedAt: externalExecution?.timings?.completedAt,
    generationDurationMs: externalExecution?.timings?.totalDurationMs,
    providerTimings: externalExecution?.timings,
    providerExecution: redactProviderExecution(externalExecution),
    runtime: runtimeDebugInfo(targetRuntime),
  }

  const targetMetadataRoot = runtimeMetadataRoot(targetRuntime)
  const targetExecutionsRoot = runtimeExecutionsRoot(targetRuntime)
  await writeJson(join(targetExecutionsRoot, `${sanitizeFilePart(result.id)}.json`), result)
  await writeJson(join(targetMetadataRoot, 'latest-execution-result.json'), {
    updatedAt: new Date().toISOString(),
    source: 'mcp.canvas.run_provider',
    result,
  })

  return result
}

async function normalizeProviderReferences(references, runtime = createLocalCanvasRuntime()) {
  if (!Array.isArray(references)) return []
  const normalized = []
  for (const reference of references) {
    if (!reference || typeof reference !== 'object') continue
    const asset = await resolveReadableCanvasAsset(reference.absolutePath, reference.localPath, runtime)
    if (!asset?.absolutePath) continue
    normalized.push({
      mediaType: reference.mediaType === 'video' ? 'video' : reference.mediaType === 'audio' ? 'audio' : 'image',
      role: typeof reference.role === 'string' && reference.role ? reference.role : 'reference',
      shapeId: firstString(reference.shapeId, reference.sourceShapeId),
      assetId: firstString(reference.assetId),
      localPath: asset.localPath,
      absolutePath: asset.absolutePath,
      bounds: reference.bounds,
    })
  }
  return normalized
}

function normalizeProviderOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined
  const normalized = {}
  for (const [key, value] of Object.entries(options)) {
    if (!key || typeof key !== 'string') continue
    if (value === undefined) continue
    if (typeof value === 'function' || typeof value === 'symbol') continue
    normalized[key] = value
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function defaultProviderForProviderRun(mediaType, references) {
  if (mediaType === 'video') return 'Atlas Cloud'
  return references.length > 0 ? 'Atlas Cloud' : 'codex-native'
}

function defaultModelForProviderRun({ mediaType, generationMode, provider, providerSettings }) {
  if (!providerSettings || !provider) return undefined

  const mediaSettings = mediaType === 'video' ? providerSettings.video : providerSettings.image
  if (canonicalProviderId(mediaSettings?.provider) !== canonicalProviderId(provider)) return undefined

  if (mediaType === 'video') {
    if (generationMode === 'text_to_video') return mediaSettings.textModel
    return mediaSettings.referenceModel || mediaSettings.textModel
  }

  if (generationMode === 'text_to_image') return mediaSettings.textModel
  return mediaSettings.editModel || mediaSettings.textModel
}

function validateProviderRunRequest(request) {
  const mediaType = request?.output?.mediaType === 'video' ? 'video' : 'image'
  if (canonicalProviderId(request?.provider) !== 'Atlas Cloud' || mediaType !== 'video') {
    return { ok: true }
  }

  return validateAtlasVideoRequest({
    model: request.model,
    references: request.references,
    providerOptions: request.providerOptions,
  })
}

function providerRunRedirectForReferences({ mediaType, provider, references }) {
  if (mediaType !== 'image') return undefined
  if (!references.length) return undefined
  if (provider !== 'codex-native') return undefined

  return {
    from: 'codex-native',
    to: 'Atlas Cloud',
    reason:
      'canvas.run_provider cannot execute Codex built-in image generation. Image edit/reference tasks with local canvas assets require a provider route that can receive local references.',
  }
}

function inferProviderGenerationMode(mediaType, references) {
  if (mediaType === 'video') return references.length > 0 ? 'reference_to_video' : 'text_to_video'
  return references.length > 0 ? 'image_edit' : 'text_to_image'
}

async function materializeProviderOutput({ externalExecution, mediaType, runtime = createLocalCanvasRuntime() }) {
  const outputUrl = externalExecution?.outputUrl || externalExecution?.outputs?.[0]
  if (!outputUrl) {
    return {
      ok: false,
      error: 'Provider succeeded but did not return an output URL.',
    }
  }

  const response = await fetch(outputUrl)
  if (!response.ok) {
    return {
      ok: false,
      error: `Provider output download failed with HTTP ${response.status}.`,
    }
  }

  const contentTypeHeader = response.headers.get('content-type') || ''
  const extension = extensionFromContentTypeOrUrl(contentTypeHeader, outputUrl, mediaType)
  const group = mediaType === 'video' ? 'videos' : 'images'
  const fileName = `provider-output-${Date.now()}.${extension}`
  const localPath = `.coflow/assets/${group}/${fileName}`
  const targetAssetsRoot = runtimeAssetsRoot(runtime)
  const absolutePath = join(targetAssetsRoot, group, fileName)
  const bytes = Buffer.from(await response.arrayBuffer())
  const byteDimensions = inferMediaDimensionsFromBytes(bytes, mediaType, outputUrl)

  await mkdir(join(targetAssetsRoot, group), { recursive: true })
  await writeFile(absolutePath, bytes)
  const dimensions = byteDimensions || (await inferMediaDimensionsFromFile(absolutePath, mediaType))

  return {
    ok: true,
    localPath,
    absolutePath,
    src: `/asset-store/assets/${group}/${fileName}`,
    contentType: contentTypeHeader,
    bytes: bytes.length,
    width: dimensions?.width,
    height: dimensions?.height,
  }
}

function extensionFromContentTypeOrUrl(contentTypeHeader, url, mediaType) {
  const contentTypeExtension = extensionFromMimeType(contentTypeHeader.split(';')[0])
  if (contentTypeExtension !== 'bin') return contentTypeExtension

  const pathname = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return String(url)
    }
  })()
  const extension = extname(pathname).replace(/^\./, '').toLowerCase()
  if (extension) return extension
  return mediaType === 'video' ? 'mp4' : 'png'
}

function extensionFromMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/svg+xml') return 'svg'
  if (mimeType === 'video/mp4') return 'mp4'
  if (mimeType === 'video/webm') return 'webm'
  if (mimeType === 'video/quicktime') return 'mov'
  return 'bin'
}

function canonicalProviderId(provider) {
  if (provider === 'atlas' || provider === 'AtlasCloud' || provider === 'atlas-cloud') return 'Atlas Cloud'
  return provider
}

function redactProviderExecution(execution) {
  if (!execution || typeof execution !== 'object') return execution
  return {
    ...execution,
    request: execution.request,
    uploadedReferences: execution.uploadedReferences,
    timings: execution.timings,
  }
}

function createLocalCanvasRuntime() {
  return {
    source: 'local-mcp',
    root,
    workspaceRoot: normalize(workspaceRoot),
    storeDir: STORE_DIR,
    storageSource: runtimePaths.storageSource,
    storeRoot: normalize(storeRoot),
    legacyStoreRoot: normalize(legacyStoreRoot),
    metadataRoot: normalize(metadataRoot),
    assetsRoot: normalize(assetsRoot),
    commandsRoot: normalize(commandsRoot),
    pendingCommandsPath: normalize(pendingCommandsPath),
    clientVersion: CANVAS_CLIENT_VERSION,
  }
}

function runtimeMetadataRoot(runtime = createLocalCanvasRuntime()) {
  return runtime?.metadataRoot || join(runtime?.storeRoot || storeRoot, 'metadata')
}

function runtimeProviderSettingsPath(runtime = createLocalCanvasRuntime()) {
  return join(runtimeMetadataRoot(runtime), 'provider-settings.json')
}

function runtimeAssetsRoot(runtime = createLocalCanvasRuntime()) {
  return runtime?.assetsRoot || join(runtime?.storeRoot || storeRoot, 'assets')
}

function runtimeExecutionsRoot(runtime = createLocalCanvasRuntime()) {
  return join(runtime?.storeRoot || storeRoot, 'executions')
}

function runtimeDebugInfo(runtime = createLocalCanvasRuntime()) {
  return {
    source: runtime?.source || 'local-mcp',
    storeRoot: runtime?.storeRoot || storeRoot,
    assetsRoot: runtimeAssetsRoot(runtime),
    metadataRoot: runtimeMetadataRoot(runtime),
  }
}

function isPathInside(childPath, parentPath) {
  if (typeof childPath !== 'string' || typeof parentPath !== 'string' || !childPath || !parentPath) return false
  const child = normalize(childPath)
  const parent = normalize(parentPath)
  return child === parent || child.startsWith(`${parent}/`)
}

function absolutePathFromCanvasLocalPath(localPath, runtime = createLocalCanvasRuntime()) {
  if (typeof localPath !== 'string' || localPath.length === 0) return undefined
  if (localPath.startsWith(`${STORE_DIR}/`)) return normalize(join(runtime.storeRoot, localPath.slice(`${STORE_DIR}/`.length)))
  if (localPath.startsWith(`${LEGACY_STORE_DIR}/`)) {
    const targetLegacyRoot = runtime.legacyStoreRoot || legacyStoreRoot
    return normalize(join(targetLegacyRoot, localPath.slice(`${LEGACY_STORE_DIR}/`.length)))
  }
  return undefined
}

async function resolveReadableCanvasAsset(absolutePath, localPath, runtime = createLocalCanvasRuntime()) {
  const candidateRuntimes = canvasAssetCandidateRuntimes(runtime)
  const normalizedAbsolute = typeof absolutePath === 'string' && absolutePath.length > 0 ? normalize(absolutePath) : undefined

  for (const candidateRuntime of candidateRuntimes) {
    const absoluteAsset = await resolveAbsoluteCanvasAsset(normalizedAbsolute, candidateRuntime)
    if (absoluteAsset) return absoluteAsset

    const localAsset = await resolveLocalCanvasAsset(localPath, candidateRuntime)
    if (localAsset) return localAsset
  }

  return undefined
}

function canvasAssetCandidateRuntimes(runtime = createLocalCanvasRuntime()) {
  const candidates = []
  const seen = new Set()
  for (const candidate of [runtime, createLocalCanvasRuntime()]) {
    if (!candidate?.storeRoot) continue
    const key = `${normalize(candidate.storeRoot)}::${normalize(candidate.legacyStoreRoot || '')}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(candidate)
  }
  return candidates
}

async function resolveAbsoluteCanvasAsset(normalizedAbsolute, runtime) {
  if (!normalizedAbsolute) return undefined
  if (!isPathInside(normalizedAbsolute, runtime.storeRoot) && !isPathInside(normalizedAbsolute, runtime.legacyStoreRoot || legacyStoreRoot)) {
    return undefined
  }
  if (!(await exists(normalizedAbsolute))) return undefined
  return {
    absolutePath: normalizedAbsolute,
    localPath: toCanvasLocalPath(normalizedAbsolute, runtime),
    runtime,
  }
}

async function resolveLocalCanvasAsset(localPath, runtime) {
  const absolutePath = absolutePathFromCanvasLocalPath(localPath, runtime)
  if (!absolutePath || !(await exists(absolutePath))) return undefined
  return {
    absolutePath,
    localPath: toCanvasLocalPath(absolutePath, runtime),
    runtime,
  }
}

function toCanvasLocalPath(absolutePath, runtime = createLocalCanvasRuntime()) {
  if (typeof absolutePath !== 'string' || absolutePath.length === 0) return undefined
  const normalized = normalize(absolutePath)
  if (isPathInside(normalized, runtime.storeRoot)) return `${STORE_DIR}${normalized.slice(runtime.storeRoot.length)}`
  const targetLegacyRoot = runtime.legacyStoreRoot || legacyStoreRoot
  if (isPathInside(normalized, targetLegacyRoot)) return `${STORE_DIR}${normalized.slice(targetLegacyRoot.length)}`
  return undefined
}

function srcFromCanvasLocalPath(localPath) {
  if (typeof localPath !== 'string' || localPath.length === 0) return undefined
  if (localPath.startsWith('/asset-store/')) return localPath
  if (localPath.startsWith(`${STORE_DIR}/`)) return `/asset-store/${localPath.slice(`${STORE_DIR}/`.length)}`
  return undefined
}

function localPathFromCanvasSrc(src) {
  if (typeof src !== 'string' || !src.startsWith('/asset-store/')) return undefined
  return `${STORE_DIR}/${src.slice('/asset-store/'.length)}`
}

function inferMediaTypeFromPath(value) {
  if (typeof value !== 'string') return undefined
  const extension = extname(value).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'].includes(extension)) return 'image'
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(extension)) return 'video'
  return undefined
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value))
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0)
}

function firstNumber(...values) {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value))
}

function normalizeWritebackArgs(args = {}) {
  const nested = firstObject(args.result, args.output, args.media, args.asset, args.providerResult)
  const output = firstObject(nested?.output, nested?.media, nested?.asset)
  const source = output ? { ...nested, ...output } : nested
  const merged = source ? { ...source, ...args } : { ...args }
  let src = firstString(merged.src, merged.url, merged.uri, merged.outputUrl, merged.output_url)
  let localPath = firstString(merged.localPath, merged.local_path, merged.outputLocalPath)
  const absolutePath = firstString(merged.absolutePath, merged.absolute_path, merged.path, merged.outputPath)

  if (!localPath && absolutePath) localPath = toCanvasLocalPath(absolutePath)
  if (!localPath && src) localPath = localPathFromCanvasSrc(src)
  if (!src && localPath) src = srcFromCanvasLocalPath(localPath)

  const mediaType =
    merged.mediaType ||
    merged.outputMediaType ||
    inferMediaTypeFromPath(src) ||
    inferMediaTypeFromPath(localPath) ||
    inferMediaTypeFromPath(absolutePath)

  return {
    ...merged,
    mediaType,
    outputMediaType: merged.outputMediaType || mediaType,
    src,
    localPath,
    absolutePath,
    provider: canonicalProviderId(merged.provider),
    outputWidth: firstNumber(merged.outputWidth, merged.width, merged.w),
    outputHeight: firstNumber(merged.outputHeight, merged.height, merged.h),
  }
}

function validateWritebackCommandArgs(args, toolName, runtime = createLocalCanvasRuntime()) {
  if (toolName !== 'canvas.create_version' && toolName !== 'canvas.insert_media') return undefined
  if (!args.mediaType) {
    return {
      ok: false,
      error: `${toolName} requires a generated media type. Pass mediaType or the full result returned by canvas.run_provider.`,
    }
  }
  if (!args.src && !args.localPath && !args.absolutePath) {
    return {
      ok: false,
      error: `${toolName} requires generated media src/localPath/absolutePath. Pass the top-level result returned by canvas.run_provider, or pass its src/localPath fields explicitly.`,
    }
  }
  if (!srcIsBrowserReadable(args.src) && !srcFromCanvasLocalPath(args.localPath) && !toCanvasLocalPath(args.absolutePath, runtime)) {
    return {
      ok: false,
      error: `${toolName} could not convert the generated media path into a browser-readable .coflow asset URL.`,
    }
  }
  return undefined
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function migrateLegacyStore() {
  if (await exists(storeRoot)) return
  if (!(await exists(legacyStoreRoot))) return
  await cp(legacyStoreRoot, storeRoot, { recursive: true, force: false, errorOnExist: false })
}

async function materializeExternalWritebackAsset(args, runtime = createLocalCanvasRuntime()) {
  const existingLocalPath = firstString(toCanvasLocalPath(args.absolutePath, runtime), args.localPath, localPathFromCanvasSrc(args.src))
  const existingAbsolutePath = existingLocalPath ? absolutePathFromCanvasLocalPath(existingLocalPath, runtime) : undefined
  if (existingLocalPath && existingAbsolutePath && (await exists(existingAbsolutePath))) {
    const mediaType = args.mediaType || inferMediaTypeFromPath(existingAbsolutePath)
    const dimensions = await inferMediaDimensionsFromFile(existingAbsolutePath, mediaType)
    return {
      ...args,
      mediaType,
      outputMediaType: args.outputMediaType || mediaType,
      localPath: existingLocalPath,
      absolutePath: existingAbsolutePath,
      src: srcFromCanvasLocalPath(existingLocalPath) || args.src,
      outputWidth: firstNumber(args.outputWidth, dimensions?.width),
      outputHeight: firstNumber(args.outputHeight, dimensions?.height),
    }
  }

  if (srcIsBrowserReadable(args.src) && !args.src.startsWith('/asset-store/')) {
    return args
  }

  const candidatePath = firstString(args.absolutePath, isAbsoluteLocalPath(args.src) ? args.src : undefined)
  if (!candidatePath) return args

  const sourcePath = normalize(candidatePath)
  let sourceStat
  try {
    sourceStat = await stat(sourcePath)
  } catch {
    return args
  }
  if (!sourceStat.isFile()) return args

  const mediaType = args.mediaType || inferMediaTypeFromPath(sourcePath)
  const group = mediaType === 'video' ? 'videos' : 'images'
  const extension = extname(sourcePath).replace(/^\./, '') || (mediaType === 'video' ? 'mp4' : 'png')
  const baseName = sanitizeFilePart(basename(sourcePath, extname(sourcePath))) || 'generated-media'
  const fileName = `${baseName}-${Date.now()}.${extension}`
  const localPath = `${STORE_DIR}/assets/${group}/${fileName}`
  const runtimeAssetsRoot = runtime.assetsRoot || join(runtime.storeRoot, 'assets')
  const absolutePath = join(runtimeAssetsRoot, group, fileName)

  await mkdir(join(runtimeAssetsRoot, group), { recursive: true })
  await materializeWritebackFile(sourcePath, absolutePath)
  const dimensions = await inferMediaDimensionsFromFile(absolutePath, mediaType)

  return {
    ...args,
    mediaType,
    outputMediaType: args.outputMediaType || mediaType,
    src: `/asset-store/assets/${group}/${fileName}`,
    localPath,
    absolutePath,
    outputWidth: firstNumber(args.outputWidth, dimensions?.width),
    outputHeight: firstNumber(args.outputHeight, dimensions?.height),
  }
}

async function inferMediaDimensionsFromFile(path, mediaType) {
  if (mediaType === 'image') {
    try {
      return inferMediaDimensionsFromBytes(await readFile(path), mediaType, path)
    } catch {
      return undefined
    }
  }
  if (mediaType === 'video') return inferVideoDimensionsFromFile(path)
  return undefined
}

function inferMediaDimensionsFromBytes(bytes, mediaType, hint = '') {
  if (mediaType !== 'image' || !Buffer.isBuffer(bytes)) return undefined
  return inferPngDimensions(bytes) || inferJpegDimensions(bytes) || inferGifDimensions(bytes) || inferWebpDimensions(bytes, hint)
}

function validDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  if (width <= 0 || height <= 0) return undefined
  return { width, height }
}

async function inferVideoDimensionsFromFile(path) {
  let stdout
  try {
    const result = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:stream_tags=rotate:stream_side_data=rotation',
        '-of',
        'json',
        path,
      ],
      { maxBuffer: 1024 * 1024, timeout: 3000 }
    )
    stdout = result.stdout
  } catch {
    return undefined
  }

  try {
    const parsed = JSON.parse(String(stdout || '{}'))
    const stream = Array.isArray(parsed.streams)
      ? parsed.streams.find((candidate) => validDimensions(Number(candidate?.width), Number(candidate?.height))) || parsed.streams[0]
      : undefined
    const dimensions = validDimensions(Number(stream?.width), Number(stream?.height))
    if (!dimensions) return undefined

    const rotation = getVideoStreamRotation(stream)
    if (rotation === 90 || rotation === 270) {
      return { width: dimensions.height, height: dimensions.width }
    }
    return dimensions
  } catch {
    return undefined
  }
}

function getVideoStreamRotation(stream) {
  const candidates = [
    stream?.tags?.rotate,
    ...(Array.isArray(stream?.side_data_list) ? stream.side_data_list.map((entry) => entry?.rotation) : []),
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (!Number.isFinite(value)) continue
    return ((Math.round(value) % 360) + 360) % 360
  }
  return 0
}

function inferPngDimensions(bytes) {
  if (bytes.length < 24) return undefined
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return undefined
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return undefined
  return validDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
}

function inferGifDimensions(bytes) {
  if (bytes.length < 10) return undefined
  const signature = bytes.toString('ascii', 0, 6)
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return undefined
  return validDimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
}

function inferJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined

  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    let marker = bytes[offset + 1]
    offset += 2
    while (marker === 0xff && offset < bytes.length) {
      marker = bytes[offset]
      offset += 1
    }

    if (marker === 0xd9 || marker === 0xda) return undefined
    if (offset + 2 > bytes.length) return undefined

    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame && segmentLength >= 7) {
      return validDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
    }

    offset += segmentLength
  }

  return undefined
}

function inferWebpDimensions(bytes) {
  if (bytes.length < 30) return undefined
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return undefined
  const chunkType = bytes.toString('ascii', 12, 16)

  if (chunkType === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    return validDimensions(width, height)
  }

  if (chunkType === 'VP8 ' && bytes.length >= 30) {
    const width = bytes.readUInt16LE(26) & 0x3fff
    const height = bytes.readUInt16LE(28) & 0x3fff
    return validDimensions(width, height)
  }

  if (chunkType === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return validDimensions(width, height)
  }

  return undefined
}

function srcIsBrowserReadable(src) {
  if (typeof src !== 'string' || src.length === 0) return false
  return src.startsWith('/asset-store/') || /^https?:\/\//i.test(src) || /^data:(image|video)\//i.test(src)
}

function isAbsoluteLocalPath(value) {
  return typeof value === 'string' && isAbsolute(value) && !value.startsWith('/asset-store/')
}

async function materializeWritebackFile(sourcePath, targetPath) {
  try {
    await copyFile(sourcePath, targetPath, constants.COPYFILE_FICLONE_FORCE)
    return
  } catch {
    // Fall through to a hard link or full copy when copy-on-write cloning is unavailable.
  }

  try {
    await link(sourcePath, targetPath)
    return
  } catch {
    // Cross-device links are expected to fail; keep writeback durable with a plain copy.
  }

  await cp(sourcePath, targetPath)
}

function canvasApiUrl(path) {
  return new URL(path, CANVAS_SERVER_URL).toString()
}

function canvasRuntimeTimeoutSignal() {
  const timeoutMs = Number.isFinite(CANVAS_RUNTIME_TIMEOUT_MS) && CANVAS_RUNTIME_TIMEOUT_MS > 0 ? CANVAS_RUNTIME_TIMEOUT_MS : 500
  return AbortSignal.timeout(Math.max(50, timeoutMs))
}

function normalizeCanvasRuntime(input) {
  const runtime = input?.runtime && typeof input.runtime === 'object' ? input.runtime : input
  if (!runtime || typeof runtime !== 'object' || typeof runtime.storeRoot !== 'string' || runtime.storeRoot.length === 0) {
    return undefined
  }

  const normalizedStoreRoot = normalize(runtime.storeRoot)
  const normalizedWorkspaceRoot =
    typeof runtime.workspaceRoot === 'string' && runtime.workspaceRoot.length > 0
      ? normalize(runtime.workspaceRoot)
      : dirname(normalizedStoreRoot)

  return {
    source: typeof runtime.source === 'string' ? runtime.source : 'canvas-server',
    root: typeof runtime.root === 'string' ? normalize(runtime.root) : undefined,
    workspaceRoot: normalizedWorkspaceRoot,
    storeDir: typeof runtime.storeDir === 'string' ? runtime.storeDir : STORE_DIR,
    storeRoot: normalizedStoreRoot,
    legacyStoreRoot:
      typeof runtime.legacyStoreRoot === 'string' && runtime.legacyStoreRoot.length > 0
        ? normalize(runtime.legacyStoreRoot)
        : join(normalizedWorkspaceRoot, LEGACY_STORE_DIR),
    metadataRoot:
      typeof runtime.metadataRoot === 'string' && runtime.metadataRoot.length > 0
        ? normalize(runtime.metadataRoot)
        : join(normalizedStoreRoot, 'metadata'),
    assetsRoot:
      typeof runtime.assetsRoot === 'string' && runtime.assetsRoot.length > 0
        ? normalize(runtime.assetsRoot)
        : join(normalizedStoreRoot, 'assets'),
    commandsRoot:
      typeof runtime.commandsRoot === 'string' && runtime.commandsRoot.length > 0
        ? normalize(runtime.commandsRoot)
        : join(normalizedStoreRoot, 'commands'),
    pendingCommandsPath:
      typeof runtime.pendingCommandsPath === 'string' && runtime.pendingCommandsPath.length > 0
        ? normalize(runtime.pendingCommandsPath)
        : join(normalizedStoreRoot, 'commands', 'pending.jsonl'),
    clientVersion: typeof runtime.clientVersion === 'string' ? runtime.clientVersion : undefined,
  }
}

function sameRuntimeStore(a, b = createLocalCanvasRuntime()) {
  return Boolean(a?.storeRoot && b?.storeRoot && normalize(a.storeRoot) === normalize(b.storeRoot))
}

async function readActiveCanvasRuntime() {
  if (process.env.COFLOW_RUNTIME_JSON) {
    try {
      return normalizeCanvasRuntime(JSON.parse(process.env.COFLOW_RUNTIME_JSON))
    } catch {
      return undefined
    }
  }

  try {
    const response = await fetch(canvasApiUrl('/api/runtime'), {
      signal: canvasRuntimeTimeoutSignal(),
    })
    if (!response.ok) return undefined
    return normalizeCanvasRuntime(await response.json())
  } catch {
    return undefined
  }
}

async function readCanvasServerJson(path) {
  const response = await fetch(canvasApiUrl(path), {
    signal: canvasRuntimeTimeoutSignal(),
  })
  if (!response.ok) throw new Error(`Canvas server ${path} returned HTTP ${response.status}`)
  return response.json()
}

async function readLatestSelectionForRuntime(runtime) {
  if (!runtime || sameRuntimeStore(runtime) || runtime.source === 'env') return readLatestSelection()
  try {
    const latest = await readCanvasServerJson('/api/selection')
    if (latest?.selection) return latest
  } catch {
    // Fall back to the MCP-local cache when the running canvas cannot answer.
  }
  return readLatestSelection()
}

async function readLatestFrameContextForRuntime(runtime) {
  if (!runtime || sameRuntimeStore(runtime) || runtime.source === 'env') return readLatestFrameContext()
  try {
    const latest = await readCanvasServerJson('/api/frame-context')
    if (latest?.context !== undefined) return latest
  } catch {
    // Fall back to the MCP-local cache when the running canvas cannot answer.
  }
  return readLatestFrameContext()
}

async function appendCanvasCommandForRuntime(command, runtime) {
  if (!runtime || sameRuntimeStore(runtime) || runtime.source === 'env') {
    const targetCommandsRoot = runtime?.commandsRoot || commandsRoot
    const targetPendingCommandsPath = runtime?.pendingCommandsPath || pendingCommandsPath
    await mkdir(targetCommandsRoot, { recursive: true })
    await appendFile(targetPendingCommandsPath, `${JSON.stringify(command)}\n`)
    return {
      ok: true,
      command,
      queuedVia: runtime?.source === 'env' && !sameRuntimeStore(runtime) ? 'runtime-file' : 'local-file',
      storeRoot: runtime?.storeRoot || storeRoot,
    }
  }

  try {
    const response = await fetch(canvasApiUrl('/api/commands'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
      signal: canvasRuntimeTimeoutSignal(),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        error: `Canvas server command enqueue failed with HTTP ${response.status}.`,
        detail: payload?.error,
        canvasUrl: CANVAS_SERVER_URL,
        storeRoot: runtime.storeRoot,
      }
    }
    return {
      ok: true,
      command: payload?.command || command,
      queuedVia: 'canvas-server',
      storeRoot: runtime.storeRoot,
      canvasUrl: CANVAS_SERVER_URL,
    }
  } catch (error) {
    return {
      ok: false,
      error: `Canvas server command enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
      canvasUrl: CANVAS_SERVER_URL,
      storeRoot: runtime.storeRoot,
    }
  }
}

async function enqueueCanvasCommand(rawArgs, toolName) {
  const activeRuntime = await readActiveCanvasRuntime()
  const targetRuntime = activeRuntime || createLocalCanvasRuntime()
  const args = await materializeExternalWritebackAsset(normalizeWritebackArgs(rawArgs), targetRuntime)
  const validationError = validateWritebackCommandArgs(args, toolName, targetRuntime)
  if (validationError) return validationError

  const latest = await readLatestFrameContextForRuntime(activeRuntime)
  const latestSelection = await readLatestSelectionForRuntime(activeRuntime)
  const sourceShapeId = args.sourceShapeId || sourceShapeIdFromReferences(args.references)
  const hasReferenceInput = Boolean(sourceShapeId) || hasWritebackReferenceInput(args.references)
  const allowFrameFallback = args.disableFrameFallback !== true && (toolName !== 'canvas.insert_media' || hasReferenceInput)
  const frameId =
    args.frameId ||
    (allowFrameFallback ? latestSelection.selection?.activeFrame?.frameId || (!sourceShapeId ? latest.context?.frameId : undefined) : undefined)
  const queuedType = toolName === 'canvas.insert_media' ? 'canvas.create_version' : toolName
  const command = {
    id: `command:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    source: `mcp.${toolName}`,
    type: queuedType,
    requestedTool: toolName,
    frameId,
    sourceShapeId,
    targetShapeId: args.targetShapeId,
    linkType: args.linkType,
    prompt: args.prompt,
    provider: args.provider,
    outputMediaType: args.outputMediaType,
    generationMode: args.generationMode,
    references: Array.isArray(args.references) ? args.references : undefined,
    mediaType: args.mediaType,
    src: args.src,
    localPath: args.localPath,
    absolutePath: args.absolutePath,
    title: args.title,
    model: args.model,
    outputWidth: args.outputWidth,
    outputHeight: args.outputHeight,
    generationStartedAt: args.generationStartedAt,
    generationCompletedAt: args.generationCompletedAt,
    generationDurationMs: args.generationDurationMs,
    providerTimings: args.providerTimings,
    e2eStartedAt: args.e2eStartedAt,
    e2eCompletedAt: args.e2eCompletedAt,
    e2eDurationMs: args.e2eDurationMs,
    writebackCompletedAt: args.writebackCompletedAt,
    status: args.status || (queuedType === 'canvas.create_version' ? 'succeeded' : undefined),
    skillName: args.skillName || (queuedType === 'canvas.create_version' ? 'coflow-generation' : undefined),
    minClientVersion: queuedType === 'canvas.create_version' || queuedType === 'canvas.link_versions' ? CANVAS_CLIENT_VERSION : undefined,
  }

  const queued = await appendCanvasCommandForRuntime(command, activeRuntime)
  if (!queued.ok) return queued

  return {
    ok: true,
    command: queued.command,
    queuedVia: queued.queuedVia,
    runtime: {
      canvasUrl: queued.canvasUrl || CANVAS_SERVER_URL,
      storeRoot: queued.storeRoot,
    },
    note:
      queuedType === 'canvas.create_version'
        ? hasReferenceInput
          ? `Queued canvas writeback. Keep the canvas browser open; it will place the generated version on the board.`
          : `Queued standalone canvas writeback. Keep the canvas browser open; it will place the generated media on the board without a lineage link.`
        : frameId || sourceShapeId
          ? `Queued ${toolName} for the external Codex/Skill runtime.`
          : `Queued ${toolName} without frameId.`,
  }
}

function sourceShapeIdFromReferences(references) {
  if (!Array.isArray(references)) return undefined
  for (const reference of references) {
    if (!reference || typeof reference !== 'object') continue
    const shapeId = firstString(reference.sourceShapeId, reference.shapeId)
    if (shapeId) return shapeId
  }
  return undefined
}

function hasWritebackReferenceInput(references) {
  if (!Array.isArray(references)) return false
  return references.some((reference) => {
    if (!reference || typeof reference !== 'object') return false
    return Boolean(
      firstString(
        reference.sourceShapeId,
        reference.shapeId,
        reference.assetId,
        reference.localPath,
        reference.absolutePath,
        reference.src,
        reference.uri,
        reference.url,
      ),
    )
  })
}

function respond(id, result, error) {
  const message = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

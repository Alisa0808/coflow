import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const workspaceRoot = process.env.WORKSPACE_ROOT || join(root, '..')
const latestSelectionPath = join(workspaceRoot, '.codex-media-canvas', 'metadata', 'latest-selection.json')
const latestFrameContextPath = join(workspaceRoot, '.codex-media-canvas', 'metadata', 'latest-frame-context.json')
const latestCodexFrameRequestPath = join(workspaceRoot, '.codex-media-canvas', 'metadata', 'latest-codex-frame-request.json')
const commandsRoot = join(workspaceRoot, '.codex-media-canvas', 'commands')
const pendingCommandsPath = join(commandsRoot, 'pending.jsonl')
const CANVAS_CLIENT_VERSION = '2026-06-26-video-writeback-v2'

const tools = [
  {
    name: 'canvas.get_selection',
    description:
      'Read the latest real canvas selection published by the browser, including selected ids, normalized item bounds, text, asset metadata, and active frame context when available.',
    inputSchema: {
      type: 'object',
      properties: {},
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
          description: 'Optional local path inside .codex-media-canvas, e.g. .codex-media-canvas/assets/images/output.png.',
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
          description: 'Provider used by Codex/Skill, e.g. codex-native, atlas, openai, kling.',
        },
        model: {
          type: 'string',
          description: 'Model used by Codex/Skill.',
        },
        status: {
          type: 'string',
          description: 'Writeback status, normally succeeded.',
        },
      },
      required: ['mediaType'],
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.insert_media',
    description:
      'Insert a Codex-generated local media asset back onto the canvas. This queues a canvas writeback command and keeps provider/model execution in Codex or the active Skill.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'string',
          description: 'Optional frame id. Defaults to the active frame from the latest selection or latest frame context.',
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
          description: 'Optional local path inside .codex-media-canvas, e.g. .codex-media-canvas/assets/images/output.png.',
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
          description: 'Provider used by Codex/Skill, e.g. codex-native, atlas, openai, kling.',
        },
        model: {
          type: 'string',
          description: 'Model used by Codex/Skill.',
        },
        status: {
          type: 'string',
          description: 'Writeback status, normally succeeded.',
        },
      },
      required: ['mediaType'],
      additionalProperties: false,
    },
  },
  {
    name: 'canvas.agent_prompt',
    description:
      'Queue a Codex-style agent prompt for the canvas. This keeps Codex as the conversation layer while the browser executes the bounded canvas writeback.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'string',
          description: 'Optional frame id. Defaults to the latest published frame context when available.',
        },
        prompt: {
          type: 'string',
          description: 'Codex/skill instruction to execute against the selected or bounded frame context.',
        },
        provider: {
          type: 'string',
          enum: ['mock-provider', 'atlas', 'seedance', 'kling'],
          description: 'Optional preferred provider. Defaults to atlas; use mock-provider only for local fallback tests.',
        },
        outputMediaType: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'Optional desired output media type.',
        },
        generationMode: {
          type: 'string',
          enum: ['text_to_image', 'image_edit', 'text_to_video', 'reference_to_video'],
          description: 'Optional explicit provider mode.',
        },
      },
      required: ['prompt'],
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
      serverInfo: { name: 'phase0-tldraw-spike', version: '0.0.1' },
    })
  }

  if (method === 'tools/list') {
    return respond(id, { tools })
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    if (toolName === 'canvas.get_selection') {
      const payload = await readLatestSelection()
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

    if (toolName === 'canvas.create_version' || toolName === 'canvas.agent_prompt' || toolName === 'canvas.insert_media') {
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

async function readLatestSelection() {
  try {
    return JSON.parse(await readFile(latestSelectionPath, 'utf8'))
  } catch {
    return {
      updatedAt: null,
      source: 'phase0-tldraw-spike',
      selection: {
        version: 1,
        selectedIds: [],
        selectedItems: [],
        updatedAt: null,
      },
      warning: 'No selection has been published yet. Open the canvas and select a shape or frame.',
    }
  }
}

async function readLatestFrameContext() {
  try {
    return JSON.parse(await readFile(latestFrameContextPath, 'utf8'))
  } catch {
    return {
      updatedAt: null,
      source: 'phase0-tldraw-spike',
      context: null,
      warning: 'No frame context has been published yet. Click Read frame context in the canvas first.',
    }
  }
}

async function readLatestCodexFrameRequest() {
  try {
    return JSON.parse(await readFile(latestCodexFrameRequestPath, 'utf8'))
  } catch {
    return {
      updatedAt: null,
      source: 'phase0-tldraw-spike',
      request: null,
      warning: 'No Codex frame request has been published yet. Select a frame and click Send to Codex in the canvas.',
    }
  }
}

async function enqueueCanvasCommand(args, toolName) {
  const latest = await readLatestFrameContext()
  const latestSelection = await readLatestSelection()
  const frameId = args.frameId || latestSelection.selection?.activeFrame?.frameId || latest.context?.frameId
  const queuedType = toolName === 'canvas.insert_media' ? 'canvas.create_version' : toolName
  const command = {
    id: `command:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    source: toolName === 'canvas.agent_prompt' ? 'codex-agent-bridge' : `mcp.${toolName}`,
    type: queuedType,
    requestedTool: toolName,
    frameId,
    prompt: args.prompt,
    provider: args.provider,
    outputMediaType: args.outputMediaType,
    generationMode: args.generationMode,
    mediaType: args.mediaType,
    src: args.src,
    localPath: args.localPath,
    absolutePath: args.absolutePath,
    title: args.title,
    model: args.model,
    status: args.status || (toolName === 'canvas.create_version' ? 'succeeded' : undefined),
    skillName: args.skillName || (toolName === 'canvas.create_version' ? 'codex-media-generation' : undefined),
    minClientVersion: queuedType === 'canvas.create_version' ? CANVAS_CLIENT_VERSION : undefined,
  }

  await mkdir(commandsRoot, { recursive: true })
  await appendFile(pendingCommandsPath, `${JSON.stringify(command)}\n`)

  return {
    ok: true,
    command,
    note:
      queuedType === 'canvas.create_version'
        ? `Queued canvas writeback. Keep the canvas browser open; it will place the generated version on the board.`
        : frameId
          ? `Queued ${toolName} for the external Codex/Skill runtime.`
          : `Queued ${toolName} without frameId.`,
  }
}

function respond(id, result, error) {
  const message = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

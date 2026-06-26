import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const workspaceRoot = process.env.WORKSPACE_ROOT || join(root, '..')
const latestFrameContextPath = join(workspaceRoot, '.codex-media-canvas', 'metadata', 'latest-frame-context.json')
const commandsRoot = join(workspaceRoot, '.codex-media-canvas', 'commands')
const pendingCommandsPath = join(commandsRoot, 'pending.jsonl')

const tools = [
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
    name: 'canvas.create_version',
    description: 'Queue a version generation command for the canvas browser to execute against a bounded frame.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'string',
          description: 'Optional frame id. Defaults to the latest published frame context when available.',
        },
        prompt: {
          type: 'string',
          description: 'Optional generation instruction override.',
        },
        provider: {
          type: 'string',
          enum: ['mock-provider', 'atlas', 'seedance', 'kling'],
          description: 'Optional preferred provider. Defaults to atlas; use mock-provider only for local fallback tests.',
        },
        outputMediaType: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'Optional desired output media type. Use video for text-to-video or reference-to-video generation.',
        },
        generationMode: {
          type: 'string',
          enum: ['text_to_image', 'image_edit', 'text_to_video', 'reference_to_video'],
          description:
            'Optional explicit provider mode. Use reference_to_video for any video request with media references; provider adapters can map references to image-to-video, motion reference, element edit, etc.',
        },
      },
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

    if (toolName === 'canvas.create_version' || toolName === 'canvas.agent_prompt') {
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

async function enqueueCanvasCommand(args, toolName) {
  const latest = await readLatestFrameContext()
  const frameId = args.frameId || latest.context?.frameId
  const command = {
    id: `command:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    source: toolName === 'canvas.agent_prompt' ? 'codex-agent-bridge' : 'mcp',
    type: toolName,
    frameId,
    prompt: args.prompt,
    provider: args.provider,
    outputMediaType: args.outputMediaType,
    generationMode: args.generationMode,
  }

  await mkdir(commandsRoot, { recursive: true })
  await appendFile(pendingCommandsPath, `${JSON.stringify(command)}\n`)

  return {
    ok: true,
    command,
    note: frameId
      ? `Queued ${toolName}. Keep the canvas browser open; it will claim and execute the command.`
      : `Queued ${toolName} without frameId. The browser will fall back to the currently selected or first frame.`,
  }
}

function respond(id, result, error) {
  const message = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

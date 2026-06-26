import { resolve } from 'node:path'
import { createStore } from '../lib/media-store.mjs'
import { processNextCodexNativeRequest } from '../lib/codex-native-processor.mjs'

const workspaceRoot = resolve(process.env.WORKSPACE_ROOT ?? process.cwd())
const store = createStore({ workspaceRoot })
const result = await processNextCodexNativeRequest(store)

console.log(JSON.stringify(result, null, 2))

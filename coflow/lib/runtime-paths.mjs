import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const STORE_DIR = '.coflow'
export const LEGACY_STORE_DIR = `.${['codex', 'media', 'canvas'].join('-')}`

export function resolveRuntimePaths(options = {}) {
  const root = resolve(options.root || process.cwd())
  const env = options.env || process.env
  const homeDir = resolve(options.homeDir || homedir())
  const explicitWorkspaceRoot = firstNonEmpty(env.COFLOW_WORKSPACE_ROOT, env.WORKSPACE_ROOT)
  const explicitStoreRoot = firstNonEmpty(env.COFLOW_STORE_ROOT)

  if (explicitStoreRoot) {
    const storeRoot = resolve(explicitStoreRoot)
    const workspaceRoot = explicitWorkspaceRoot ? resolve(explicitWorkspaceRoot) : homeDir
    return buildRuntimePaths({
      root,
      workspaceRoot,
      storeRoot,
      legacyStoreRoot: join(workspaceRoot, LEGACY_STORE_DIR),
      storageSource: 'store-root-env',
    })
  }

  if (explicitWorkspaceRoot) {
    const workspaceRoot = resolve(explicitWorkspaceRoot)
    return buildRuntimePaths({
      root,
      workspaceRoot,
      storeRoot: join(workspaceRoot, STORE_DIR),
      legacyStoreRoot: join(workspaceRoot, LEGACY_STORE_DIR),
      storageSource: 'workspace-root-env',
    })
  }

  if (isCodexPluginCacheRoot(root)) {
    return buildRuntimePaths({
      root,
      workspaceRoot: homeDir,
      storeRoot: join(homeDir, STORE_DIR),
      legacyStoreRoot: join(homeDir, LEGACY_STORE_DIR),
      storageSource: 'home-fallback',
    })
  }

  const workspaceRoot = resolve(root, '..')
  return buildRuntimePaths({
    root,
    workspaceRoot,
    storeRoot: join(workspaceRoot, STORE_DIR),
    legacyStoreRoot: join(workspaceRoot, LEGACY_STORE_DIR),
    storageSource: 'checkout-parent',
  })
}

function buildRuntimePaths({ root, workspaceRoot, storeRoot, legacyStoreRoot, storageSource }) {
  return {
    root,
    workspaceRoot,
    storeDir: STORE_DIR,
    storeRoot,
    legacyStoreDir: LEGACY_STORE_DIR,
    legacyStoreRoot,
    storageSource,
  }
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)
}

function isCodexPluginCacheRoot(path) {
  return path.includes('/.codex/plugins/cache/')
}

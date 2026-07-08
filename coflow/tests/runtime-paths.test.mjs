import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveRuntimePaths } from '../lib/runtime-paths.mjs'

test('resolveRuntimePaths stores board data under explicit WORKSPACE_ROOT', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'coflow-runtime-paths-'))
  const workspaceRoot = join(tempRoot, 'project')
  const pluginRoot = join(tempRoot, '.codex/plugins/cache/personal/coflow/0.2.0+test')

  try {
    const paths = resolveRuntimePaths({
      root: pluginRoot,
      env: { WORKSPACE_ROOT: workspaceRoot },
      homeDir: join(tempRoot, 'home'),
    })

    assert.equal(paths.workspaceRoot, workspaceRoot)
    assert.equal(paths.storeRoot, join(workspaceRoot, '.coflow'))
    assert.equal(paths.legacyStoreRoot, join(workspaceRoot, '.codex-media-canvas'))
    assert.equal(paths.storageSource, 'workspace-root-env')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('resolveRuntimePaths never falls back to the Codex plugin cache as user storage', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'coflow-runtime-paths-'))
  const homeDir = join(tempRoot, 'home')
  const pluginRoot = join(tempRoot, '.codex/plugins/cache/personal/coflow/0.2.0+test')

  try {
    const paths = resolveRuntimePaths({
      root: pluginRoot,
      env: {},
      homeDir,
    })

    assert.equal(paths.workspaceRoot, homeDir)
    assert.equal(paths.storeRoot, join(homeDir, '.coflow'))
    assert.equal(paths.storageSource, 'home-fallback')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('resolveRuntimePaths keeps checkout runs scoped to the repository parent', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'coflow-runtime-paths-'))
  const repoRoot = join(tempRoot, 'coding-agent-canva')
  const checkoutRuntimeRoot = join(repoRoot, 'coflow')

  try {
    const paths = resolveRuntimePaths({
      root: checkoutRuntimeRoot,
      env: {},
      homeDir: join(tempRoot, 'home'),
    })

    assert.equal(paths.workspaceRoot, repoRoot)
    assert.equal(paths.storeRoot, join(repoRoot, '.coflow'))
    assert.equal(paths.storageSource, 'checkout-parent')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('resolveRuntimePaths lets COFLOW_STORE_ROOT override the computed store location', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'coflow-runtime-paths-'))
  const workspaceRoot = join(tempRoot, 'project')
  const storeRoot = join(tempRoot, 'stable-store')

  try {
    const paths = resolveRuntimePaths({
      root: join(tempRoot, '.codex/plugins/cache/personal/coflow/0.2.0+test'),
      env: {
        WORKSPACE_ROOT: workspaceRoot,
        COFLOW_STORE_ROOT: storeRoot,
      },
      homeDir: join(tempRoot, 'home'),
    })

    assert.equal(paths.workspaceRoot, workspaceRoot)
    assert.equal(paths.storeRoot, storeRoot)
    assert.equal(paths.storageSource, 'store-root-env')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

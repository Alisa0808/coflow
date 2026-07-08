import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCanvasManifest, mergeCanvasDocuments } from '../lib/canvas-document-store.mjs'

test('mergeCanvasDocuments keeps page-specific shapes from each saved page snapshot', () => {
  const pageOneDocument = createDocument({
    currentPageId: 'page:one',
    updatedAt: '2026-07-07T10:00:00.000Z',
    shapes: [
      shapeRecord('shape:one-image', 'page:one'),
      shapeRecord('shape:one-child', 'shape:one-image'),
    ],
  })
  const pageTwoDocument = createDocument({
    currentPageId: 'page:two',
    updatedAt: '2026-07-07T10:01:00.000Z',
    shapes: [shapeRecord('shape:two-image', 'page:two')],
  })

  const merged = mergeCanvasDocuments([pageOneDocument, pageTwoDocument])
  const store = merged.snapshot.store

  assert.equal(merged.currentPageId, 'page:two')
  assert.ok(store['shape:one-image'])
  assert.ok(store['shape:one-child'])
  assert.ok(store['shape:two-image'])
  assert.equal(store['shape:one-image'].parentId, 'page:one')
  assert.equal(store['shape:two-image'].parentId, 'page:two')
  assert.ok(store['asset:shared'])
})

test('mergeCanvasDocuments replaces stale shapes for a page with that page latest snapshot', () => {
  const stalePageOne = createDocument({
    currentPageId: 'page:one',
    updatedAt: '2026-07-07T10:00:00.000Z',
    shapes: [shapeRecord('shape:one-old', 'page:one')],
  })
  const latestPageOne = createDocument({
    currentPageId: 'page:one',
    updatedAt: '2026-07-07T10:02:00.000Z',
    shapes: [shapeRecord('shape:one-new', 'page:one')],
  })

  const merged = mergeCanvasDocuments([stalePageOne, latestPageOne])
  const store = merged.snapshot.store

  assert.equal(store['shape:one-old'], undefined)
  assert.ok(store['shape:one-new'])
})

test('buildCanvasManifest preserves known pages and adds pages from the saved snapshot', () => {
  const document = createDocument({
    currentPageId: 'page:two',
    updatedAt: '2026-07-07T10:01:00.000Z',
    shapes: [],
  })
  const manifest = buildCanvasManifest(document, {
    pages: [
      {
        id: 'page-one',
        localPath: '.coflow/canvas/pages/page-one/canvas.json',
        updatedAt: '2026-07-07T10:00:00.000Z',
      },
    ],
  })

  assert.equal(manifest.activePageId, 'page-two')
  assert.deepEqual(
    manifest.pages.map((page) => page.id).sort(),
    ['page-one', 'page-two'],
  )
})

function createDocument({ currentPageId, updatedAt, shapes }) {
  const store = {
    'document:document': {
      id: 'document:document',
      typeName: 'document',
    },
    'page:one': {
      id: 'page:one',
      typeName: 'page',
      name: 'Page 1',
    },
    'page:two': {
      id: 'page:two',
      typeName: 'page',
      name: 'Page 2',
    },
    'asset:shared': {
      id: 'asset:shared',
      typeName: 'asset',
      type: 'image',
    },
  }

  for (const shape of shapes) {
    store[shape.id] = shape
  }

  return {
    version: 1,
    updatedAt,
    source: 'test',
    currentPageId,
    snapshot: {
      store,
    },
  }
}

function shapeRecord(id, parentId) {
  return {
    id,
    typeName: 'shape',
    type: 'image',
    parentId,
    props: {
      assetId: 'asset:shared',
      w: 100,
      h: 100,
    },
  }
}

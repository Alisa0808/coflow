const STORE_DIR = '.coflow'

export function sanitizeCanvasFilePart(value) {
  return String(value || 'page')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

export function buildCanvasManifest(document, existingManifest) {
  const activePageId = sanitizeCanvasFilePart(document?.currentPageId || existingManifest?.activePageId || 'page')
  const pages = new Map()

  for (const page of Array.isArray(existingManifest?.pages) ? existingManifest.pages : []) {
    if (!page || typeof page !== 'object') continue
    const id = sanitizeCanvasFilePart(page.id)
    if (!id) continue
    pages.set(id, {
      id,
      localPath: page.localPath || `${STORE_DIR}/canvas/pages/${id}/canvas.json`,
      updatedAt: page.updatedAt,
    })
  }

  for (const pageId of pageIdsFromSnapshot(document?.snapshot)) {
    const id = sanitizeCanvasFilePart(pageId)
    if (!id) continue
    pages.set(id, {
      id,
      localPath: `${STORE_DIR}/canvas/pages/${id}/canvas.json`,
      updatedAt: pages.get(id)?.updatedAt,
    })
  }

  pages.set(activePageId, {
    id: activePageId,
    localPath: `${STORE_DIR}/canvas/pages/${activePageId}/canvas.json`,
    updatedAt: document?.updatedAt,
  })

  return {
    version: 1,
    updatedAt: document?.updatedAt,
    source: document?.source,
    activePageId,
    pages: Array.from(pages.values()),
    legacyDocumentPath: `${STORE_DIR}/canvas/document.json`,
    storageMode: 'page-snapshot-v1',
  }
}

export function mergeCanvasDocuments(documents) {
  const validDocuments = (Array.isArray(documents) ? documents : []).filter((document) => document?.snapshot?.store)
  if (validDocuments.length === 0) return null

  const newestDocument = validDocuments.reduce((newest, document) =>
    timestampMs(document.updatedAt) >= timestampMs(newest.updatedAt) ? document : newest
  )
  const mergedStore = {}

  for (const document of validDocuments) {
    const store = document.snapshot.store
    for (const [id, record] of Object.entries(store)) {
      if (!isShapeRecord(record)) mergedStore[id] = record
    }
  }

  for (const [id, record] of Object.entries(newestDocument.snapshot.store)) {
    if (isShapeRecord(record)) mergedStore[id] = record
  }

  const pageIds = new Set(validDocuments.flatMap((document) => pageIdsFromSnapshot(document.snapshot)))
  for (const pageId of pageIds) {
    const pageDocument = newestDocumentForPage(validDocuments, pageId)
    if (!pageDocument) continue

    for (const shapeId of collectShapeIdsForPage(mergedStore, pageId)) {
      delete mergedStore[shapeId]
    }
    for (const shapeId of collectShapeIdsForPage(pageDocument.snapshot.store, pageId)) {
      mergedStore[shapeId] = pageDocument.snapshot.store[shapeId]
    }
  }

  return {
    ...newestDocument,
    snapshot: {
      ...newestDocument.snapshot,
      store: mergedStore,
    },
  }
}

function newestDocumentForPage(documents, pageId) {
  return documents
    .filter((document) => document.currentPageId === pageId)
    .reduce((newest, document) => {
      if (!newest) return document
      return timestampMs(document.updatedAt) >= timestampMs(newest.updatedAt) ? document : newest
    }, undefined)
}

function pageIdsFromSnapshot(snapshot) {
  const store = snapshot?.store
  if (!store || typeof store !== 'object') return []
  return Object.values(store)
    .filter((record) => record?.typeName === 'page' && typeof record.id === 'string')
    .map((record) => record.id)
}

function collectShapeIdsForPage(store, pageId) {
  const shapeIds = new Set()
  const childrenByParent = new Map()
  for (const [id, record] of Object.entries(store || {})) {
    if (!isShapeRecord(record)) continue
    const children = childrenByParent.get(record.parentId) || []
    children.push(id)
    childrenByParent.set(record.parentId, children)
  }

  const visit = (parentId) => {
    for (const childId of childrenByParent.get(parentId) || []) {
      if (shapeIds.has(childId)) continue
      shapeIds.add(childId)
      visit(childId)
    }
  }
  visit(pageId)
  return shapeIds
}

function isShapeRecord(record) {
  return record?.typeName === 'shape' && typeof record.id === 'string'
}

function timestampMs(value) {
  const ms = Date.parse(value || '')
  return Number.isFinite(ms) ? ms : 0
}

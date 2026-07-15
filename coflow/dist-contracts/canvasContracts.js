export function getShapeBounds(shape) {
  const w = numberProp(shape.props.w, shape.type === 'note' ? 160 : 120)
  const h = numberProp(shape.props.h, shape.type === 'note' ? 160 : 90)
  return {
    x: shape.x,
    y: shape.y,
    w,
    h,
  }
}

export function extractFrameContext(shapes, frameId) {
  const frame = shapes.find((shape) => shape.id === frameId && shape.type === 'frame')
  if (!frame) throw new Error(`Frame not found: ${frameId}`)

  const frameBounds = getShapeBounds(frame)
  const inside = shapes.filter((shape) => shape.id !== frameId && isInsideFrame(shape, frame, frameBounds))

  const media = inside.filter(isMediaShape).map(toMediaContext)
  const annotations = inside.filter(isAnnotationShape).map(toAnnotationContext)

  return {
    frameId,
    frameName: stringProp(frame.props.name, 'Untitled frame'),
    bounds: frameBounds,
    anchorMedia: media[0],
    media,
    annotations,
  }
}

export function createGenerationContextFromSelection(snapshot) {
  if (snapshot.activeFrame) {
    return {
      ...snapshot.activeFrame,
      scope: 'frame',
      sourceItemIds: snapshot.selectedIds,
    }
  }

  if (snapshot.selectedItems.length > 0) {
    return itemsToGenerationContext('selection', 'selection:current', 'Selected canvas objects', snapshot.selectedItems)
  }

  if (snapshot.viewport?.items.length) {
    return itemsToGenerationContext('viewport', 'viewport:current', 'Visible canvas area', snapshot.viewport.items, snapshot.viewport.bounds)
  }

  return {
    scope: 'prompt',
    sourceItemIds: [],
    frameId: 'prompt:only',
    frameName: 'Prompt only',
    bounds: { x: 0, y: 0, w: 1, h: 1 },
    anchorMedia: undefined,
    media: [],
    annotations: [],
  }
}

export function createVersionPlacement(anchor, outputSize = { w: 360, h: 240 }, occupied = []) {
  const gap = 96
  const initial = {
    x: anchor.x + anchor.w + gap,
    y: anchor.y,
    w: outputSize.w,
    h: outputSize.h,
  }
  const childBounds = findOpenBounds(anchor, initial, occupied, gap)
  const lineageArrow = getLineageArrow(anchor, childBounds)

  return {
    childBounds,
    lineageArrow,
  }
}

function getLineageArrow(anchor, child) {
  const anchorCenter = getBoundsCenter(anchor)
  const childCenter = getBoundsCenter(child)
  const dx = childCenter.x - anchorCenter.x
  const dy = childCenter.y - anchorCenter.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    const childIsRight = dx >= 0
    return {
      start: {
        x: childIsRight ? anchor.x + anchor.w + 16 : anchor.x - 16,
        y: anchorCenter.y,
      },
      end: {
        x: childIsRight ? child.x - 16 : child.x + child.w + 16,
        y: childCenter.y,
      },
      startAnchor: { x: childIsRight ? 1 : 0, y: 0.5 },
      endAnchor: { x: childIsRight ? 0 : 1, y: 0.5 },
    }
  }

  const childIsBelow = dy >= 0
  return {
    start: {
      x: anchorCenter.x,
      y: childIsBelow ? anchor.y + anchor.h + 16 : anchor.y - 16,
    },
    end: {
      x: childCenter.x,
      y: childIsBelow ? child.y - 16 : child.y + child.h + 16,
    },
    startAnchor: { x: 0.5, y: childIsBelow ? 1 : 0 },
    endAnchor: { x: 0.5, y: childIsBelow ? 0 : 1 },
  }
}

function getBoundsCenter(bounds) {
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  }
}

export function richTextToPlainText(value) {
  const lines = richTextLines(value)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
  return lines.length > 0 ? lines.join('\n') : undefined
}

function richTextLines(value) {
  if (!value || typeof value !== 'object') return []
  const node = value

  if (typeof node.text === 'string') return [node.text]
  if (!Array.isArray(node.content)) return []

  if (node.type === 'doc') return node.content.flatMap(richTextLines)
  if (node.type === 'paragraph') return [node.content.flatMap(richTextLines).join('')]
  return node.content.flatMap(richTextLines)
}

function findOpenBounds(anchor, initial, occupied, gap) {
  const horizontalStep = initial.w + gap
  const verticalStep = initial.h + gap
  const candidates = []

  for (let ring = 0; ring < 8; ring += 1) {
    candidates.push(
      { ...initial, x: initial.x + ring * horizontalStep, y: initial.y },
      { ...initial, x: anchor.x, y: anchor.y + anchor.h + gap + ring * verticalStep },
      { ...initial, x: anchor.x, y: anchor.y - initial.h - gap - ring * verticalStep },
      { ...initial, x: anchor.x - initial.w - gap - ring * horizontalStep, y: anchor.y },
    )
  }

  for (const candidate of candidates) {
    if (!occupied.some((bounds) => intersects(candidate, inflateBounds(bounds, 24)))) {
      return candidate
    }
  }

  return {
    ...initial,
    y: initial.y + verticalStep,
  }
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function inflateBounds(bounds, padding) {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  }
}

function isInsideFrame(shape, frame, frameBounds) {
  if (shape.parentId === frame.id) return true
  const bounds = getShapeBounds(shape)
  if (
    bounds.x >= frameBounds.x &&
    bounds.y >= frameBounds.y &&
    bounds.x + bounds.w <= frameBounds.x + frameBounds.w &&
    bounds.y + bounds.h <= frameBounds.y + frameBounds.h
  ) {
    return true
  }
  const center = {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  }
  if (
    center.x >= frameBounds.x &&
    center.x <= frameBounds.x + frameBounds.w &&
    center.y >= frameBounds.y &&
    center.y <= frameBounds.y + frameBounds.h
  ) {
    return true
  }
  return overlapArea(bounds, frameBounds) / Math.max(1, bounds.w * bounds.h) >= 0.35
}

function isMediaShape(shape) {
  return shape.type === 'media-image' || shape.type === 'image' || shape.type === 'video'
}

function isAnnotationShape(shape) {
  return shape.type === 'geo' || shape.type === 'note' || shape.type === 'text' || shape.type === 'draw' || shape.type === 'arrow'
}

function toMediaContext(shape) {
  return {
    shapeId: shape.id,
    shapeType: shape.type,
    assetId: stringProp(shape.props.assetId, shape.id),
    versionId: stringProp(shape.props.versionId, `${shape.id}:v1`),
    localPath: stringProp(shape.props.localPath, stringProp(shape.props.assetId, shape.id)),
    prompt: optionalStringProp(shape.props.prompt),
    provider: optionalStringProp(shape.props.provider),
    bounds: getShapeBounds(shape),
  }
}

function toAnnotationContext(shape) {
  const richText = richTextToPlainText(shape.props.richText)
  return {
    shapeId: shape.id,
    type: shape.type,
    text: optionalStringProp(shape.props.text) ?? optionalStringProp(shape.props.plainText) ?? richText,
    style: getAnnotationStyle(shape.props),
    bounds: getShapeBounds(shape),
  }
}

function itemsToGenerationContext(scope, frameId, frameName, items, fallbackBounds) {
  const bounds = unionBounds(items.map((item) => item.bounds)) ?? fallbackBounds ?? { x: 0, y: 0, w: 1, h: 1 }
  const media = items.filter(isMediaItem).map(itemToMediaContext)
  const annotations = items.filter(isAnnotationItem).map(itemToAnnotationContext)

  return {
    scope,
    sourceItemIds: items.map((item) => item.id),
    frameId,
    frameName,
    bounds,
    anchorMedia: media[0],
    media,
    annotations,
  }
}

function isMediaItem(item) {
  return item.kind === 'image' || item.kind === 'video'
}

function isAnnotationItem(item) {
  return item.kind === 'text' || item.kind === 'note' || item.kind === 'arrow' || item.kind === 'shape'
}

function itemToMediaContext(item) {
  const asset = item.asset
  const localPath = asset?.localPath ?? asset?.absolutePath ?? asset?.src ?? asset?.assetId ?? item.id
  return {
    shapeId: item.id,
    shapeType: item.kind === 'video' || asset?.mediaType === 'video' ? 'video' : item.canvasType === 'media-image' ? 'media-image' : 'image',
    assetId: asset?.assetId ?? item.id,
    versionId: stringProp(item.metadata?.versionId, `${item.id}:v1`),
    localPath,
    absolutePath: asset?.absolutePath,
    prompt: optionalStringProp(item.metadata?.prompt),
    provider: optionalStringProp(item.metadata?.provider),
    bounds: item.bounds,
  }
}

function itemToAnnotationContext(item) {
  return {
    shapeId: item.id,
    type: item.canvasType === 'note' || item.canvasType === 'text' || item.canvasType === 'draw' || item.canvasType === 'arrow' ? item.canvasType : 'geo',
    text: item.text,
    style: item.style,
    bounds: item.bounds,
  }
}

export function getAnnotationStyle(props) {
  const style = {}
  const color = optionalStringProp(props.color)
  const fill = optionalStringProp(props.fill)
  const dash = optionalStringProp(props.dash)
  const size = optionalStringProp(props.size)
  const opacity = optionalNumberProp(props.opacity)

  if (color) style.color = color
  if (fill) style.fill = fill
  if (dash) style.dash = dash
  if (size) style.size = size
  if (opacity !== undefined) style.opacity = opacity

  return Object.keys(style).length > 0 ? style : undefined
}

function unionBounds(boundsList) {
  if (boundsList.length === 0) return undefined
  const minX = Math.min(...boundsList.map((bounds) => bounds.x))
  const minY = Math.min(...boundsList.map((bounds) => bounds.y))
  const maxX = Math.max(...boundsList.map((bounds) => bounds.x + bounds.w))
  const maxY = Math.max(...boundsList.map((bounds) => bounds.y + bounds.h))
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  }
}

function numberProp(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringProp(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function optionalStringProp(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumberProp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

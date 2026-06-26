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

export function createVersionPlacement(anchor, outputSize = { w: 360, h: 240 }, occupied = []) {
  const gap = 96
  const initial = {
    x: anchor.x + anchor.w + gap,
    y: anchor.y,
    w: outputSize.w,
    h: outputSize.h,
  }
  const childBounds = findOpenBounds(initial, occupied, gap)

  return {
    childBounds,
    lineageArrow: {
      start: {
        x: anchor.x + anchor.w + 16,
        y: anchor.y + anchor.h / 2,
      },
      end: {
        x: childBounds.x - 16,
        y: childBounds.y + childBounds.h / 2,
      },
    },
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

function findOpenBounds(initial, occupied, gap) {
  const horizontalStep = initial.w + gap
  const verticalStep = initial.h + 48

  for (let column = 0; column < 8; column += 1) {
    for (let row = 0; row < 8; row += 1) {
      const candidate = {
        ...initial,
        x: initial.x + column * horizontalStep,
        y: initial.y + row * verticalStep,
      }
      if (!occupied.some((bounds) => intersects(candidate, inflateBounds(bounds, 24)))) return candidate
    }
  }

  return {
    ...initial,
    x: initial.x + horizontalStep * 8,
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
  return (
    bounds.x >= frameBounds.x &&
    bounds.y >= frameBounds.y &&
    bounds.x + bounds.w <= frameBounds.x + frameBounds.w &&
    bounds.y + bounds.h <= frameBounds.y + frameBounds.h
  )
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
    bounds: getShapeBounds(shape),
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

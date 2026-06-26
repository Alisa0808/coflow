import { HTMLContainer, Rectangle2d, ShapeUtil, type TLBaseShape, type TLShapeUtilCanBindOpts } from 'tldraw'

export const MEDIA_IMAGE_SHAPE = 'media-image'

export type MediaImageShape = TLBaseShape<
  typeof MEDIA_IMAGE_SHAPE,
  {
    w: number
    h: number
    assetId: string
    versionId: string
    localPath: string
    src: string
    mediaType: 'image' | 'video'
    title: string
    prompt: string
    provider: string
    model: string
    generationMode: string
    requestId: string
    executionId: string
    status: string
    skillName: string
  }
>

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    [MEDIA_IMAGE_SHAPE]: MediaImageShape['props']
  }
}

export class MediaImageShapeUtil extends ShapeUtil<MediaImageShape> {
  static override type = MEDIA_IMAGE_SHAPE

  override getDefaultProps(): MediaImageShape['props'] {
    return {
      w: 360,
      h: 240,
      assetId: 'asset:unset',
      versionId: 'version:unset',
      localPath: '',
      src: '',
      mediaType: 'image',
      title: 'Media image',
      prompt: '',
      provider: 'codex-native',
      model: '',
      generationMode: '',
      requestId: '',
      executionId: '',
      status: '',
      skillName: '',
    }
  }

  override getGeometry(shape: MediaImageShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  override canBind(_opts: TLShapeUtilCanBindOpts<MediaImageShape>) {
    return false
  }

  override component(shape: MediaImageShape) {
    if (isVideoMedia(shape.props)) {
      return (
        <HTMLContainer className="media-shape">
          <video src={shape.props.src} controls muted loop playsInline draggable={false} />
        </HTMLContainer>
      )
    }

    return (
      <HTMLContainer className="media-shape">
        <img src={shape.props.src} alt={shape.props.title} draggable={false} />
      </HTMLContainer>
    )
  }

  override async toSvg(shape: MediaImageShape) {
    if (isVideoMedia(shape.props)) {
      return (
        <g aria-label={shape.props.title}>
          <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} fill="#0f172a" />
          <circle cx={shape.props.w / 2} cy={shape.props.h / 2} r={28} fill="rgba(255,255,255,0.18)" />
          <path
            d={`M ${shape.props.w / 2 - 8} ${shape.props.h / 2 - 14} L ${shape.props.w / 2 - 8} ${shape.props.h / 2 + 14} L ${shape.props.w / 2 + 16} ${shape.props.h / 2} Z`}
            fill="#ffffff"
          />
        </g>
      )
    }

    const src = await imageSrcToExportableDataUrl(shape.props.src)
    if (!src) return null

    return (
      <image
        href={src}
        width={shape.props.w}
        height={shape.props.h}
        preserveAspectRatio="xMidYMid meet"
        aria-label={shape.props.title}
      />
    )
  }

  override indicator(shape: MediaImageShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
  }

  override getIndicatorPath(shape: MediaImageShape): Path2D {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 14)
    return path
  }
}

function isVideoMedia(props: MediaImageShape['props']) {
  return (
    props.mediaType === 'video' ||
    props.src.toLowerCase().match(/\.(mp4|webm|mov)(\?|#|$)/) !== null ||
    props.localPath.toLowerCase().match(/\.(mp4|webm|mov)(\?|#|$)/) !== null
  )
}

async function imageSrcToExportableDataUrl(src: string) {
  if (!src) return ''
  if (src.startsWith('data:')) return src

  try {
    const response = await fetch(src)
    const blob = await response.blob()
    return await blobToDataUrl(blob)
  } catch {
    return src
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to convert image blob to data URL.'))
    reader.readAsDataURL(blob)
  })
}

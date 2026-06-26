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

  override canBind({ toShape, bindingType }: TLShapeUtilCanBindOpts<MediaImageShape>) {
    return bindingType === 'arrow' && toShape.type === MEDIA_IMAGE_SHAPE
  }

  override component(shape: MediaImageShape) {
    return (
      <HTMLContainer className="media-shape">
        <img src={shape.props.src} alt={shape.props.title} draggable={false} />
      </HTMLContainer>
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

import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { AssetCard } from './components'
import type { MediaAsset } from './media'

export type CanvasAdapterProps = {
  assets: MediaAsset[]
  selectedAssetIds: string[]
  onSelectAsset: (assetId: string) => void
}

export function CanvasAdapter({ assets, selectedAssetIds, onSelectAsset }: CanvasAdapterProps) {
  return (
    <main className="canvas-stage">
      <TldrawCanvasLayer />
      <MediaAssetLayer assets={assets} selectedAssetIds={selectedAssetIds} onSelectAsset={onSelectAsset} />
    </main>
  )
}

function TldrawCanvasLayer() {
  return (
    <div className="tldraw-layer" aria-hidden="true">
      <Tldraw persistenceKey="codex-media-canvas-whiteboard" />
    </div>
  )
}

function MediaAssetLayer({ assets, selectedAssetIds, onSelectAsset }: CanvasAdapterProps) {
  return (
    <div className="asset-layer">
      {assets.length ? (
        assets.map((asset) => (
          <AssetCard
            key={asset.assetId}
            asset={asset}
            selected={selectedAssetIds.includes(asset.assetId)}
            onSelect={onSelectAsset}
          />
        ))
      ) : (
        <div className="empty-canvas">
          <h1>Codex Media Canvas</h1>
          <p>Upload an image or video, select it, annotate it, then send the request to Codex.</p>
        </div>
      )}
    </div>
  )
}

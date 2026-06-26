import type { CanvasRequest, MediaAsset } from './media'
import {
  providerModeLabels,
  providerSetupMessages,
  sceneModeLabels,
  scenePresets,
  type ProviderMode,
  type SceneMode,
} from './media'

export function AssetCard({
  asset,
  selected,
  onSelect,
}: {
  asset: MediaAsset
  selected: boolean
  onSelect: (assetId: string) => void
}) {
  const title = asset.type === 'frame' ? `Frame · ${formatTime(asset.timestampMs ?? 0)}` : asset.fileName
  return (
    <button
      className={selected ? 'asset-card asset-card-selected' : 'asset-card'}
      style={{
        left: asset.position.x,
        top: asset.position.y,
        width: asset.position.w,
        height: asset.position.h,
      }}
      onClick={() => onSelect(asset.assetId)}
      type="button"
    >
      <div className="asset-card-header">
        <span>{asset.type}</span>
        <strong>v{asset.version}</strong>
      </div>
      {asset.type === 'video' ? (
        <video className="asset-preview" src={asset.publicUrl} muted controls />
      ) : (
        <img className="asset-preview" src={asset.publicUrl} alt={asset.fileName} />
      )}
      <div className="asset-card-footer">{title}</div>
    </button>
  )
}

export function DetailsPanel({
  selectedAsset,
  requests,
  providerMode,
  sceneMode,
  onProviderChange,
  onSceneChange,
}: {
  selectedAsset?: MediaAsset
  requests: CanvasRequest[]
  providerMode: ProviderMode
  sceneMode: SceneMode
  onProviderChange: (providerMode: ProviderMode) => void
  onSceneChange: (sceneMode: SceneMode) => void
}) {
  const latestRequest = requests[0]
  return (
    <aside className="right-panel">
      <section>
        <h2>Provider</h2>
        <label>
          Mode
          <select value={providerMode} onChange={(event) => onProviderChange(event.target.value as ProviderMode)}>
            {Object.entries(providerModeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="helper">Provider is configured in Codex. The canvas stores preference and metadata only.</p>
        <div className={providerMode === 'atlas' || providerMode === 'custom' ? 'setup-warning' : 'setup-note'}>
          <strong>Configure in Codex</strong>
          <span>{providerSetupMessages[providerMode]}</span>
        </div>
      </section>

      <section>
        <h2>Scene preset</h2>
        <label>
          Current mode
          <select value={sceneMode} onChange={(event) => onSceneChange(event.target.value as SceneMode)}>
            {Object.entries(sceneModeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="helper">{scenePresets[sceneMode].description}</p>
        {sceneMode !== 'none' ? (
          <ul className="preset-list">
            {scenePresets[sceneMode].outputs.map((output) => (
              <li key={output.id}>
                {output.label}
                {output.aspectRatio ? ` · ${output.aspectRatio}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h2>Selected asset</h2>
        {selectedAsset ? (
          <div className="metadata-card">
            <strong>{selectedAsset.fileName}</strong>
            <span>{selectedAsset.assetId}</span>
            <dl>
              <dt>Type</dt>
              <dd>{selectedAsset.type}</dd>
              <dt>Version</dt>
              <dd>v{selectedAsset.version}</dd>
              <dt>Provider</dt>
              <dd>{selectedAsset.provider ?? 'not generated yet'}</dd>
              <dt>Model</dt>
              <dd>{selectedAsset.model ?? 'not recorded'}</dd>
              <dt>Path</dt>
              <dd>{selectedAsset.localPath}</dd>
              <dt>Parent</dt>
              <dd>{selectedAsset.parentAssetId ?? 'none'}</dd>
            </dl>
            {selectedAsset.prompt ? (
              <>
                <h3>Prompt</h3>
                <p>{selectedAsset.prompt}</p>
              </>
            ) : null}
            <h3>Annotations</h3>
            {selectedAsset.annotations.length ? (
              <ul>
                {selectedAsset.annotations.map((annotation) => (
                  <li key={annotation.id}>{annotation.text}</li>
                ))}
              </ul>
            ) : (
              <p className="helper">No annotations yet.</p>
            )}
          </div>
        ) : (
          <p className="helper">Select an image, video, or frame to create Codex context.</p>
        )}
      </section>

      <section>
        <h2>Canvas requests</h2>
        {latestRequest ? (
          <div className="metadata-card">
            <strong>{latestRequest.requestType}</strong>
            <span>{latestRequest.status}</span>
            <p>{latestRequest.instruction}</p>
          </div>
        ) : (
          <p className="helper">No queued requests yet.</p>
        )}
      </section>
    </aside>
  )
}

function formatTime(timestampMs: number) {
  const seconds = Math.round(timestampMs / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

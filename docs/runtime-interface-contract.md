# Runtime interface contract

This document freezes the current Phase 0 runtime boundary so canvas state, local files, Codex commands, and provider requests do not drift into mixed responsibilities.

## Runtime roles

| Layer | Owns | Must not own |
| --- | --- | --- |
| tldraw browser | visual canvas state, selected frame, geometry, imported asset metadata, generated child shape writeback | API keys, provider/model orchestration, permanent execution history |
| local server | local asset store, canvas persistence, metadata snapshots, command queue, optional debug provider execution, provider output materialization | visual selection logic, raw Codex conversation state |
| Codex / MCP / Skills | high-level user intent, active skill session, provider/model choice, generation/edit orchestration | direct mutation of tldraw scene without going through canvas writeback tools |
| Atlas provider | temporary uploaded media URLs, async generation jobs, remote output URLs | local durable storage or canvas lineage |

## Canonical local store

All runtime files live under:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/
```

Expected layout:

```text
.codex-media-canvas/
  assets/
    images/
    videos/
  canvas/
    manifest.json
    document.json
    view-state.json
    backups/
    pages/
      <page-id>/
        canvas.json
  commands/
    pending.jsonl
  executions/
    execution-*.json
  logs/
    operations.jsonl
  metadata/
    latest-agent-prompt.json
    latest-frame-context.json
    latest-codex-frame-request.json
    latest-frame-input.json
    latest-frame-screenshot.json
    latest-generation-request.json
    latest-execution-result.json
  frame-inputs/
  frame-screenshots/
  uploads/
```

Rules:

- `canvas/pages/<page-id>/canvas.json` is the current page-level tldraw snapshot.
- `canvas/document.json` is legacy compatibility while Phase 0.5 migrates away from single-file persistence.
- `canvas/view-state.json` stores current page/camera separately from the document snapshot.
- `canvas/backups/` stores page snapshot backups before overwrite.
- `frame-inputs/*.json` are hidden agent source-of-truth artifacts created by `Send to Codex`.
- `frame-screenshots/*.png` are auxiliary visual artifacts for Codex/user inspection.
- `metadata/latest-*.json` files are snapshots for inspection and UI/debug convenience.
- `executions/*.json` and `logs/operations.jsonl` are the durable history.
- `.codex-media-canvas/assets/**` is the durable local media store.
- Provider remote URLs are temporary and must be materialized into `.codex-media-canvas/assets/**` before being considered canvas outputs.
- API keys never go into `.codex-media-canvas`.

## Path vocabulary

| Field | Meaning | Example | Consumer |
| --- | --- | --- | --- |
| `src` | browser-resolvable display URL | `/asset-store/assets/images/foo.png` | tldraw rendering |
| `localPath` | store-relative durable path | `.codex-media-canvas/assets/images/foo.png` | request/result metadata |
| `absolutePath` | local filesystem path | `/Users/qiutian/.../.codex-media-canvas/assets/images/foo.png` | server/provider upload |
| `image_url` | Atlas temporary public URL after upload | `https://atlas-img.../foo.png` | Atlas generation request |
| `outputUrl` | Atlas remote result URL | `https://.../output.png` | server materialization only |

Rules:

- Browser shapes may keep `src`, `localPath`, and `absolutePath` in asset metadata.
- Provider adapters should prefer `absolutePath` for local upload.
- Codex-facing request/result JSON can show `localPath` and `absolutePath` for debugging.
- `outputUrl` is not a final canvas asset; it is only the source to download into local storage.

## Codex bridge and generation flow

Current Phase 0.5 implementation note:

- The default frame button is `Send to Codex`.
- `Send to Codex` extracts bounded frame context, saves a hidden Frame Input JSON, saves a frame screenshot artifact, and publishes an awaiting-user-instruction frame request.
- It does not call a provider by default.
- Codex / an active Codex agent skill is responsible for choosing image/video/3D skill, provider, model, mode, and parameters.
- Browser-side provider execution may exist as a debug spike path only; it is not the canonical product path.
- `Generate version` may return later only when an active skill / auto-run mode is already established.

```text
User clicks Send to Codex
  -> browser resolves bounded frame context geometrically
  -> browser saves .codex-media-canvas/frame-screenshots/*.png
  -> browser POST /api/frame-context
  -> browser POST /api/codex/frame-requests
  -> server writes .codex-media-canvas/frame-inputs/*.json
  -> Codex reads canvas.get_frame_request / canvas.get_frame_input
  -> user confirms or adds instruction in Codex
  -> active skill/provider generates media outside the browser
  -> Codex calls canvas.insert_media or canvas.create_version
  -> browser polls /api/commands/pending
  -> browser places result and lineage on canvas
```

Current exposed MCP-style canvas tools:

```text
canvas.get_selection
canvas.get_frame_context
canvas.get_frame_request
canvas.get_frame_input
canvas.get_frame_screenshot
canvas.capture_frame
canvas.get_asset
canvas.insert_media
canvas.create_version
canvas.agent_prompt
```

Planned before Phase 1:

```text
canvas.capture_selection
canvas.link_versions
```

## Upload flow

Small files:

```text
tldraw asset store upload
  -> POST /api/assets/upload
  -> .codex-media-canvas/assets/images|videos
  -> tldraw asset meta: src, localPath, absolutePath, bytes, mimeType
```

Large files:

```text
tldraw asset store upload
  -> POST /api/assets/uploads/start
  -> POST /api/assets/uploads/chunk
  -> POST /api/assets/uploads/complete
  -> .codex-media-canvas/assets/images|videos
  -> tldraw asset meta: src, localPath, absolutePath, bytes, mimeType, uploadId, chunkCount
```

Rules:

- Upload progress UI should only be visible for chunked uploads, not normal small files.
- Canvas display size fitting must not downscale or rewrite the original stored file.
- Whiteboard placement can resize the visual shape, but stored assets remain original bytes.

## Provider execution flow

Current provider boundary is retained for debugging and future skill internals, but it is not the default browser interaction:

```text
ProviderReadyGenerationRequest
  -> ProviderJob
  -> providerPayloads.atlas | providerPayloads.seedance | providerPayloads.kling
  -> selectedProviderPayload
  -> runExternalProviderIfConfigured
```

Atlas-specific rules when an active skill or debug executor uses Atlas:

- If `ATLASCLOUD_API_KEY` is configured, local references are uploaded through `/model/uploadMedia`.
- Image edit and image-to-video use the uploaded reference as `image_url`.
- Image/video generation result URLs are downloaded into local asset store.
- If Atlas is not configured, execution may produce a local mock fallback, and `mockFallback: true` must be visible in `latest-execution-result.json`.

Product rule:

- Do not judge the project complete because a browser-side provider call returned a result.
- The acceptance test is whether Codex/Skill used the correct Frame Input, source asset, annotations, and writeback target.

## Built-in providers and default models

Built-in provider ids:

| Provider id | Current status | Purpose |
| --- | --- | --- |
| `atlas` | real executor | Best-supported default provider for image/video generation |
| `seedance` | payload stub | Future direct Seedance-style adapter |
| `kling` | payload stub | Future direct Kling-style adapter |
| `mock-provider` | local fallback/test only | Local placeholder output when explicitly requested or when a real provider cannot run |

Default provider:

- `atlas`

Atlas default models:

| Request situation | Default model | Override env |
| --- | --- | --- |
| text to image | `openai/gpt-image-2/text-to-image` | `ATLASCLOUD_IMAGE_TEXT_MODEL` |
| image edit / reference image edit | `openai/gpt-image-2/edit` | `ATLASCLOUD_IMAGE_EDIT_MODEL` |
| text to video | `bytedance/seedance-2.0/text-to-video` | `ATLASCLOUD_VIDEO_TEXT_MODEL` |
| image/reference to video | `bytedance/seedance-2.0/reference-to-video` | `ATLASCLOUD_VIDEO_IMAGE_MODEL` |

Default provider parameters:

| Parameter | Default | Override env |
| --- | --- | --- |
| image size | `1024x1024` | `ATLASCLOUD_IMAGE_SIZE` |
| video duration | `5` | `ATLASCLOUD_VIDEO_DURATION` |
| video aspect ratio | `16:9` | `ATLASCLOUD_VIDEO_ASPECT_RATIO` |

UI rules:

- Do not stamp generated images with provider/model/prompt text.
- Generated media should appear as clean media assets on the board.
- Prompt/model/provider metadata belongs in local result JSON now, and later in a Lovart-style hover/open asset info panel.
- Debug JSON panels should not be visible in the normal user canvas.

## Local provider configuration

The server now loads local environment files before reading provider keys:

1. `/Users/qiutian/Projects/apps/coding-agent-canva/.env.local`
2. `/Users/qiutian/Projects/apps/coding-agent-canva/phase0-tldraw-spike/.env.local`
3. `/Users/qiutian/Projects/apps/coding-agent-canva/.env`

Shell environment variables still win over file values.

Example:

```bash
cp phase0-tldraw-spike/.env.local.example .env.local
# edit .env.local and set ATLASCLOUD_API_KEY
cd phase0-tldraw-spike
npm run serve
```

Security rules:

- `.env`, `.env.*`, and `.codex-media-canvas/` are ignored by git.
- Do not put API keys in request JSON, execution JSON, operation logs, screenshots, or docs.

## Known cleanup targets

- `src/providerAdapter.ts` and `lib/provider-executor.mjs` duplicate provider payload mapping. Keep tests aligned for now; consolidate into one shared JS/TS contract before Phase 1.
- `metadata/latest-*.json` names can make people think they are authoritative history. They are only snapshots; history is in `executions/` and `operations.jsonl`.
- Video output currently uses SVG preview fallback even when the final provider output is a video. Phase 1 should add first-frame thumbnail extraction.
- `/api/executions/run-latest` and direct generation-request execution should be marked debug-only or moved behind active skill execution.
- `canvas.capture_selection` and `canvas.link_versions` are still missing as first-class MCP tools.

# Runtime interface contract

This document freezes the current Phase 0 runtime boundary so canvas state, local files, Codex commands, and provider requests do not drift into mixed responsibilities.

## Runtime roles

| Layer | Owns | Must not own |
| --- | --- | --- |
| tldraw browser | visual canvas state, selected frame, geometry, imported asset metadata, generated child shape writeback | API keys, permanent execution history |
| local server | local asset store, metadata snapshots, command queue, provider execution, provider output materialization | visual selection logic, raw Codex conversation state |
| Codex / MCP | high-level user intent and skill commands | direct mutation of tldraw scene without going through the command queue |
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
  commands/
    pending.jsonl
  executions/
    execution-*.json
  logs/
    operations.jsonl
  metadata/
    latest-agent-prompt.json
    latest-frame-context.json
    latest-generation-request.json
    latest-execution-result.json
  uploads/
```

Rules:

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

## Command and generation flow

Current Phase 0 implementation note:

- The frame generate button currently runs in the browser path: it extracts bounded frame context, creates a generation request, calls the local server executor, and writes the result back to the canvas.
- The Codex/MCP command path exists through `canvas.agent_prompt` and `canvas.create_version`, but Codex is not yet the required orchestration layer for every frame-button generation.
- Product target path remains: `Codex agent skill -> canvas/MCP context read -> media action -> provider executor -> canvas writeback`.
- Per the project roadmap, making Codex Skill the primary orchestration layer belongs to the Codex Skill integration phase, after the frame context/action contract is stable. In the migration plan this is Phase E; in the broader product roadmap it maps to Phase 2's first agent skill work.

```text
Codex or MCP
  -> POST /api/agent/prompt
  -> .codex-media-canvas/commands/pending.jsonl
  -> browser polls GET /api/commands/pending
  -> browser selects / resolves bounded frame context
  -> POST /api/frame-context
  -> POST /api/generation-requests
  -> POST /api/executions/run-latest
  -> server builds provider job
  -> Atlas uploads local references when needed
  -> Atlas generateImage / generateVideo
  -> server polls prediction
  -> server downloads provider output into .codex-media-canvas/assets
  -> browser updates generated child shape with preview.src
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

Current provider boundary:

```text
ProviderReadyGenerationRequest
  -> ProviderJob
  -> providerPayloads.atlas | providerPayloads.seedance | providerPayloads.kling
  -> selectedProviderPayload
  -> runExternalProviderIfConfigured
```

Atlas-specific rules:

- If `ATLASCLOUD_API_KEY` is configured, local references are uploaded through `/model/uploadMedia`.
- Image edit and image-to-video use the uploaded reference as `image_url`.
- Image/video generation result URLs are downloaded into local asset store.
- If Atlas is not configured, execution may produce a local mock fallback, and `mockFallback: true` must be visible in `latest-execution-result.json`.

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

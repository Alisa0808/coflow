# Runtime interface contract

This document freezes the current Phase 0 runtime boundary so canvas state, local files, Codex commands, and provider requests do not drift into mixed responsibilities.

## Runtime roles

| Layer | Owns | Must not own |
| --- | --- | --- |
| tldraw browser | visual canvas state, selected frame, geometry, imported asset metadata, generated child shape writeback | API keys, provider/model orchestration, permanent execution history |
| local server | local asset store, canvas persistence, metadata snapshots, command queue, optional debug provider execution, provider output materialization | visual selection logic, raw Codex conversation state |
| Codex / MCP / Skills | high-level user intent, invoked skill context, provider/model choice, generation/edit orchestration | direct mutation of tldraw scene without going through canvas writeback tools |
| Atlas provider | temporary uploaded media URLs, async generation jobs, remote output URLs | local durable storage or canvas lineage |

## tldraw schema-first hard rule

Any change to whiteboard elements, media assets, shapes, bindings, frames, selection behavior, copy/export/import, or writeback must start by checking the official tldraw schema, components, or starter implementation. Default to native tldraw `asset` / `shape` / `binding` / `store` records and official UI layers such as `InFrontOfTheCanvas`. Custom fields, custom shapes, or custom interaction state are allowed only when the native structure cannot represent the product need; the reason and compatibility boundary must be documented in this contract or the current implementation note.

Floating product affordances such as media details cards, `Send to Codex`, and `Generate` buttons are UI overlays. They must not be serialized into tldraw shape records unless the user-created canvas content itself requires it.

## Canonical local store

All runtime files live under:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.coflow/
```

Expected layout:

```text
.coflow/
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
- `.coflow/assets/**` is the durable local media store.
- Provider remote URLs are temporary and must be materialized into `.coflow/assets/**` before being considered canvas outputs.
- API keys never go into `.coflow`.

## Path vocabulary

| Field | Meaning | Example | Consumer |
| --- | --- | --- | --- |
| `src` | browser-resolvable display URL | `/asset-store/assets/images/foo.png` | tldraw rendering |
| `localPath` | store-relative durable path | `.coflow/assets/images/foo.png` | request/result metadata |
| `absolutePath` | local filesystem path | `/Users/qiutian/.../.coflow/assets/images/foo.png` | server/provider upload |
| `images` | Atlas temporary public image URLs after upload | `["https://atlas-img.../foo.png"]` | Atlas GPT Image 2 edit request |
| `reference_images` | Atlas temporary public image URLs after upload | `["https://atlas-img.../foo.png"]` | Atlas Seedance reference-to-video request |
| `outputUrl` | Atlas remote result URL | `https://.../output.png` | server materialization only |

Rules:

- Browser shapes may keep `src`, `localPath`, and `absolutePath` in asset metadata.
- Provider adapters should prefer `absolutePath` for local upload.
- Codex-facing request/result JSON can show `localPath` and `absolutePath` for debugging.
- `outputUrl` is not a final canvas asset; it is only the source to download into local storage.

## Codex bridge and generation flow

Current Phase 1 implementation note:

- The default frame button is `Send to Codex`.
- `Send to Codex` extracts bounded frame context, saves a hidden Frame Input JSON, saves a frame screenshot artifact, and publishes an awaiting-user-instruction frame request.
- It does not call a provider by default.
- Codex / the invoked Codex agent skill is responsible for choosing image/video/3D skill, provider, model, mode, parameters, and task-specific prompt.
- Codex context priority is: active frame / Frame Input > selected objects > visible viewport > prompt only.
- Selection capture uses a fresh browser capture as the primary path: Codex asks the open canvas browser to compute current selected ids, selected items, optional active frame, and visible viewport items from live tldraw editor state. Cached `latest-selection.json` is fallback/debug only.
- Browser-side provider execution may exist only for explicitly designed canvas-side Quick Edit flows; it is not the canonical frame / multi-object product path.
- Quick Edit is a selected single-image inline-prompt flow for simple one-shot image edits. It is not a frame action, not an active session, and not a replacement for `Send to Codex`.
- Phase 1 Codex-driven execution uses the real provider boundary by default.
- If provider credentials are missing or the provider fails, the canvas reports failure instead of inserting mock media.
- Default generation actions do not allow mock fallback. `mock-provider` is reserved for explicit local tests/debugging.

```text
User clicks Send to Codex
  -> browser resolves bounded frame context geometrically
  -> browser saves .coflow/frame-screenshots/*.png
  -> browser POST /api/frame-context
  -> browser POST /api/codex/frame-requests
  -> server writes .coflow/frame-inputs/*.json
  -> Codex reads canvas.get_frame_request / canvas.get_frame_input
  -> user confirms or adds instruction in Codex
  -> Codex skill/provider generates media outside the browser
  -> Codex calls canvas.insert_media or canvas.create_version
  -> browser polls /api/commands/pending
  -> browser places result and lineage on canvas

User selects image/object group and prompts Codex
  -> Codex reads canvas.capture_selection / canvas.get_selection
  -> MCP requests a fresh capture from the open browser canvas
  -> browser computes current selection plus viewport context from live tldraw editor state
  -> skill normalizes selection into a bounded generation context
  -> generated output is written back through canvas.insert_media or canvas.create_version

User has no explicit selection but refers to visible canvas
  -> Codex may use selection.viewport as context when ambiguity is low
  -> if multiple source images/media are visible and no source is selected/framed, Codex asks the user to choose the source or name it explicitly
  -> otherwise Codex asks the user to select or frame the intended source
```

Current exposed MCP-style canvas tools:

```text
canvas.get_selection
canvas.get_frame_context
canvas.get_frame_request
canvas.get_frame_input
canvas.get_frame_screenshot
canvas.capture_frame
canvas.capture_selection
canvas.get_asset
canvas.insert_media
canvas.create_version
canvas.link_versions
canvas.get_provider_status
canvas.get_provider_settings
canvas.set_provider_settings
canvas.run_provider
```

Removed runtime surface:

```text
canvas.agent_prompt
POST /api/agent/prompt
GET /api/agent/prompt/latest
metadata/latest-agent-prompt.json
```

Reason: these legacy bridge APIs queued a prompt for browser-side provider execution. That is no longer the product architecture and was misleading in real user plugin use. The canonical flow is Codex skill capture -> provider generation -> `canvas.insert_media` / `canvas.create_version` writeback.

Phase 2 cleanup target:

```text
browser-generated fresh selected-region PNG capture
```

## Quick Edit flow

Quick Edit is an optional canvas-side single-image flow. It is designed for low-friction edits where the user has exactly one image selected and can express the desired change in a short inline prompt.

```text
user selects exactly one image
  -> canvas shows an image-only Quick Edit affordance
  -> user enters a short prompt
  -> browser/server provider executor runs the configured image provider
  -> server materializes the provider output into .coflow/assets
  -> server queues canvas.create_version / canvas.insert_media
  -> browser places output near the source image with lineage
```

Constraints:

- Quick Edit appears only for exactly one selected image.
- It is for simple image edits such as color/style changes, cleanup, upscale, remove background, or small local revisions.
- It must not appear for frames, multi-selection, video, 3D, or ambiguous scene-level tasks.
- It must not read or write active Skill session metadata.
- It must not replace `Send to Codex` for complex tasks.
- If provider credentials or required capabilities are missing, it must fail clearly or point to setup; it must not insert mock media.

Writeback payload contract for `canvas.insert_media` / `canvas.create_version`:

```json
{
  "mediaType": "image",
  "localPath": ".coflow/assets/images/output.png",
  "absolutePath": "/Users/qiutian/Projects/apps/coding-agent-canva/.coflow/assets/images/output.png",
  "prompt": "user prompt plus bounded canvas context",
  "provider": "atlas",
  "model": "openai/gpt-image-2/edit",
  "skillName": "coflow-image",
  "outputWidth": 1024,
  "outputHeight": 1024,
  "generationStartedAt": "2026-06-28T07:00:00.000Z",
  "generationCompletedAt": "2026-06-28T07:00:42.000Z",
  "generationDurationMs": 42000,
  "providerTimings": {
    "uploadDurationMs": 1200,
    "submitDurationMs": 800,
    "pollDurationMs": 39000,
    "pollAttempts": 14,
    "totalDurationMs": 42000
  },
  "e2eStartedAt": "2026-06-28T06:59:58.000Z",
  "writebackCompletedAt": "2026-06-28T07:00:45.000Z",
  "e2eCompletedAt": "2026-06-28T07:00:45.000Z",
  "e2eDurationMs": 47000
}
```

Rules:

- Generated media must be represented as native tldraw `asset` plus native `image` / `video` shape records.
- `outputWidth` / `outputHeight` are measured output dimensions, not guessed provider params.
- Provider timing fields are optional for older commands but required for new real provider-backed Skill runs when the provider executor can observe them.
- `providerTimings` / `generationDurationMs` measure provider execution and model polling.
- `e2eStartedAt` / `e2eCompletedAt` / `e2eDurationMs` / `writebackCompletedAt` are internal diagnostics for the user-perceived path from canvas/Codex action to visible writeback. They are not part of the end-user asset details popover.
- The canvas stores timing fields under generated asset/shape metadata for performance diagnosis, while the visible asset popover stays focused on prompt, references, model/provider, and local provenance.

Interaction rules:

- `Send to Codex` is the frame action. It exports context for Codex/user follow-up and does not directly run a provider.
- Quick Edit is a separate selected-image action. It should not appear on frames.
- A frame-level one-click generation action must not be reintroduced through active sessions or browser-direct provider execution. It can return only if it routes through a real Codex callback/task mechanism that preserves Codex-owned context understanding.
- Real provider selection stays inside Codex Skill logic, except for the intentionally narrow single-image Quick Edit path.
- `coflow-image` decides text-to-image vs image/reference edit.
- `coflow-video` decides text-to-video vs image/reference/video regeneration.
- Mock fallback is not allowed for normal product experience.

## Upload flow

Small files:

```text
tldraw asset store upload
  -> POST /api/assets/upload
  -> .coflow/assets/images|videos
  -> tldraw asset meta: src, localPath, absolutePath, bytes, mimeType
```

Large files:

```text
tldraw asset store upload
  -> POST /api/assets/uploads/start
  -> POST /api/assets/uploads/chunk
  -> POST /api/assets/uploads/complete
  -> .coflow/assets/images|videos
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

Atlas Cloud-specific rules when an invoked skill or debug executor uses Atlas Cloud:

- Treat each Atlas Cloud model's live schema URL from `GET https://api.atlascloud.ai/api/v1/models` as the source of truth for provider payload fields. Do not copy field names from another model family or a generic Atlas Cloud example.
- If `ATLASCLOUD_API_KEY` is configured, local references are uploaded through `/model/uploadMedia`.
- GPT Image 2 text-to-image uses `size`; GPT Image 2 edit uses uploaded references as `images`.
- Atlas Cloud polling is model-aware. Video schemas use `/model/prediction/{request_id}`. GPT Image 2 schemas may expose `/model/result/{request_id}`, so the adapter keeps the existing prediction poll path but falls back to the result path for image jobs instead of assuming one endpoint works for every model family.
- Image-to-video / reference-to-video sends image references as `reference_images`, video references as `reference_videos`, and audio references as `reference_audios`.
- For Atlas Cloud video fields, follow the Atlas Cloud model page/API schema for Seedance 2.0 Reference-to-Video. The current implementation submits top-level request input fields `duration`, `resolution`, `ratio`, `bitrate_mode`, `generate_audio`, `watermark`, and `return_last_frame`.
- Do not submit source-media constraint fields such as `width`, `height`, or `FPS` as top-level request input fields. In the Atlas Cloud schema, those describe accepted reference media limits inside `reference_images` / `reference_videos`, not generation controls.
- Video request `ratio` inference order:
  1. explicit user prompt ratio, e.g. `9:16`, `16:9`, `1:1`, `portrait`, `landscape`, `竖屏`, `横屏`;
  2. otherwise submit Atlas Cloud `ratio: "adaptive"`, which follows the primary reference media aspect ratio.
- Video generation enables audio by default with `generate_audio: true`. Set `ATLASCLOUD_VIDEO_AUDIO=false` to disable it.
- Provider adapters keep only light, provider-level guardrails such as not rendering canvas annotations or editor UI. Product-specific constraints belong in the Codex image/video skill prompt compiler.
- AVIF references stored as `.avif.bin` are normalized to PNG before Atlas Cloud image-edit upload.
- Image/video generation result URLs are downloaded into local asset store.
- If Atlas Cloud is not configured, provider execution fails visibly and must not insert mock media.

Product rule:

- Do not judge the project complete because a browser-side provider call returned a result.
- The acceptance test is whether Codex/Skill used the correct Frame Input, source asset, annotations, and writeback target.

## Built-in providers and default models

Built-in provider ids:

| Provider id | Current status | Purpose |
| --- | --- | --- |
| `atlas` | real executor | Atlas Cloud compatibility id for image/video generation |
| `seedance` | payload stub | Future direct Seedance-style adapter |
| `kling` | payload stub | Future direct Kling-style adapter |
| `mock-provider` | explicit test only | Reserved for local contract tests; not used by product flows |

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
| video resolution | `720p` | `ATLASCLOUD_VIDEO_RESOLUTION` |
| video ratio | prompt ratio first, otherwise `adaptive` | none in normal execution |
| video bitrate mode | `standard` | `ATLASCLOUD_VIDEO_BITRATE_MODE` |
| video audio | `true` | `ATLASCLOUD_VIDEO_AUDIO=false` disables it |

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

- `.env`, `.env.*`, and `.coflow/` are ignored by git.
- Do not put API keys in request JSON, execution JSON, operation logs, screenshots, or docs.

Provider setup can be inspected without exposing secrets through:

```text
canvas.get_provider_status
GET /api/provider/status
```

The user-facing status should report selected provider/model defaults first. Credential environment presence is only a redacted runtime diagnostic for preflight or failure handling, not the main "provider status" answer. The payload must never include raw API key values.

## Known cleanup targets

- `src/providerAdapter.ts` and `lib/provider-executor.mjs` duplicate provider payload mapping. Keep tests aligned for now; consolidate into one shared JS/TS contract before expanding provider breadth further.
- `metadata/latest-*.json` names can make people think they are authoritative history. They are only snapshots; history is in `executions/` and `operations.jsonl`.
- Video output currently uses SVG preview fallback even when the final provider output is a video. Phase 2 should add first-frame thumbnail extraction.
- Canvas video writeback must not assume every generated video is `16:9`. Use actual materialized media dimensions when available; otherwise preserve the source/anchor display size until provider dimensions are known.
- `/api/executions/run-latest` and direct generation-request execution were removed from the product runtime. Do not restore them as the frame or multi-object generation path.
- `canvas.capture_selection` and `canvas.link_versions` now exist as first-class MCP tools. `capture_selection` requests fresh structured selection/viewport context from the open browser first, then falls back to cached snapshots only when the browser is unavailable. Fresh browser-rendered selected-region PNG capture is still a Phase 2 cleanup target.

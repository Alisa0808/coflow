# CoFlow

CoFlow is an agent-native tldraw canvas for generating and revising images and videos from visual context.

The canvas is not a provider form. It is the visual surface for:

- selecting or framing source media;
- adding notes, boxes, arrows, and other annotations;
- letting Codex skills read bounded context;
- writing generated media back as native tldraw image/video assets;
- preserving local paths, prompts, provider metadata, and version lineage.

## Design philosophy

CoFlow starts from a simple premise: pair Codex, one of the strongest AI agents available to developers today, with an infinite whiteboard canvas.

Codex provides the execution harness: it reads bounded visual context, turns open-ended intent into actionable prompts, chooses the right model and provider route, saves generated assets locally, and writes results back with lineage. The canvas preserves the free-form side of creative work: spatial thinking, references, annotations, alternate versions, and branching ideas, without reducing the workflow to a rigid form or provider panel.

## Current phase

This branch contains:

- Phase 1 RC image/video generation and writeback plumbing;
- Phase 2 plugin productization scaffolding:
  - provider/model setup and redacted provider diagnostics;
  - provider default settings stored outside the canvas document;
  - image and video skills;
  - local-first open-source setup docs.

## Quick start

```bash
cd coflow
cp .env.local.example .env.local
npm install
npm run serve
```

Open:

```text
http://127.0.0.1:5176/
```

The Codex plugin skill `coflow-open` should open this URL in the Codex in-app browser by default.

## Provider setup

CoFlow ships with these default generation routes:

- image text-to-image: Codex built-in GPT Image 2;
- image edit/reference: Codex built-in GPT Image 2 when the runtime can pass local references;
- video text-to-video: Atlas Cloud Seedance 2.0;
- video reference/video editing: Atlas Cloud Seedance 2.0 reference-to-video.

Use the Codex skill `coflow-provider-setup` as the single user-facing entry for:

- viewing current image/video provider and model defaults;
- changing image/video provider and model defaults;
- skipping setup for now;
- rerunning setup later;
- diagnosing runtime generation failures.

Normal provider status should answer "which provider/model is selected" and whether the selected external provider is connected. Credential checks are always redacted.

If Atlas Cloud is the selected provider for real generation, add credentials to either:

```text
<repo>/.env.local
<repo>/coflow/.env.local
```

Required:

```bash
ATLASCLOUD_API_KEY=...
```

Useful optional defaults:

```bash
ATLASCLOUD_API_BASE_URL=https://api.atlascloud.ai/api/v1
ATLASCLOUD_IMAGE_SIZE=1024x1024
ATLASCLOUD_VIDEO_DURATION=5
ATLASCLOUD_VIDEO_RESOLUTION=720p
ATLASCLOUD_VIDEO_RATIO=adaptive
ATLASCLOUD_VIDEO_BITRATE_MODE=standard
ATLASCLOUD_VIDEO_AUDIO=true
ATLASCLOUD_VIDEO_WATERMARK=false
ATLASCLOUD_VIDEO_RETURN_LAST_FRAME=false
```

Do not paste API keys into Codex chat. Use the local env files.

## Supported models

CoFlow uses friendly model names in user-facing docs and skills. Internal provider model ids stay in runtime configuration and diagnostics.

Defaults:

- Image generation/editing: Codex built-in GPT Image 2
- Video generation/editing: Atlas Cloud Seedance 2.0

Atlas Cloud image options:

- GPT Image 2
- Nano Banana 2
- Nano Banana 2 Lite
- Nano Banana Pro
- Seedream 5.0 Pro
- Seedream 5.0 Lite
- Seedream 4.5
- Wan 2.7
- Grok Imagine Image
- Qwen Image 2.0

Atlas Cloud video options:

- Seedance 2.0
- Seedance 2.0 Mini
- Kling V3.0 Turbo / Standard / Pro / 4K
- Kling O3 Standard / Pro / 4K
- Wan 2.7
- HappyHorse 1.1
- Grok Imagine Video
- Grok Imagine Video v1.5

Provider onboarding/defaults are stored locally at:

```text
<repo>/.coflow/metadata/provider-settings.json
```

This file stores only setup state and default provider/model intent for image/video skills. It must not contain API keys.

Available diagnostics/config surfaces:

- MCP: `canvas.get_provider_status`
- MCP: `canvas.get_provider_settings`
- MCP: `canvas.get_provider_onboarding`
- MCP: `canvas.set_provider_settings`
- HTTP: `GET /api/provider/status`
- HTTP: `GET /api/provider/settings`
- HTTP: `GET /api/provider/onboarding`
- HTTP: `PUT /api/provider/settings`

## Skills

Core skills:

- `coflow-open` — open the canvas.
- `coflow-image` — text-to-image, image-to-image, and image edit; it decides the mode from frame, selection, viewport, or prompt.
- `coflow-video` — text-to-video, reference-to-video, and video regeneration/keyframe-guided revision; it decides the mode from canvas context.
- `coflow-provider-setup` — view/change image and video provider/model defaults, skip or rerun setup, and diagnose provider runtime failures.

Scenario-specific skills are intentionally not shipped yet.

## CoFlow writeback contract

CoFlow does not need a separate workflow skill for the current image/video loop.

The lightweight contract is:

- Codex is responsible for understanding the request, reading canvas context, and choosing a generation route.
- CoFlow is responsible for bounded canvas context capture and canvas writeback.
- Built-in providers, Codex native generation, external skills, MCP tools, or other installed providers may generate the media.
- If the task starts from CoFlow canvas context, the generated image/video is not complete until it has been written back with `canvas.insert_media`.

This applies to frame, selection, and viewport tasks. A task is considered CoFlow-contextual if it uses Frame Input, selected objects, visible viewport items, source assets, annotation text/geometry, or a canvas screenshot.

Minimum normalized generated-media shape:

```json
{
  "mediaType": "image | video",
  "localPath": "...",
  "absolutePath": "...",
  "src": "...",
  "prompt": "...",
  "provider": "...",
  "model": "..."
}
```

When available, pass the complete successful provider result to `canvas.insert_media` as `providerResult`. If a result comes from Codex native generation, an external skill, MCP, or another provider, normalize it to the minimum shape before writeback.

If generation succeeds but no writable local path, absolute path, or URL is available, the agent must stop and report that the result cannot be written back to CoFlow. It must not pretend the task is complete.

## Canvas context priority

Skills should read canvas context in this order:

1. latest Frame Input from `Send to Codex` / active `Generate version`;
2. current selection;
3. visible viewport when the user clearly refers to visible content;
4. prompt only.

When multiple possible source assets are visible and none is selected or framed, Codex should ask the user to choose instead of guessing.

## Local files

Generated media and metadata are local-first under:

```text
<current-workspace>/.coflow/
```

This directory is ignored by git. It may contain uploaded assets, generated outputs, execution snapshots, and operation logs.

## Development

```bash
cd coflow
npm test
npm run build
```

Hard rule for future canvas changes: follow official tldraw schemas and APIs first. Do not invent custom shape records when a native image/video/frame/arrow/note path exists.

# CoFlow

CoFlow is an agent-native tldraw canvas for generating and revising images, videos, and future 3D assets from visual context.

The canvas is not a provider form. It is the visual surface for:

- selecting or framing source media;
- adding notes, boxes, arrows, and other annotations;
- letting Codex skills read bounded context;
- writing generated media back as native tldraw image/video assets;
- preserving local paths, prompts, provider metadata, and version lineage.

## Current phase

This branch contains:

- Phase 1 RC image/video generation and writeback plumbing;
- Phase 2 plugin productization scaffolding:
  - provider/model setup and redacted provider diagnostics;
  - provider default settings stored outside the canvas document;
  - image and video skills;
  - experimental scene workflow skill candidates;
  - first 3D workflow boundary;
  - local-first open-source setup docs.

Full 3D canvas preview/editing is not claimed yet. The current 3D skill defines the workflow contract and local asset boundary; a dedicated 3D viewer shape is a later product feature.

## Quick start

```bash
cd phase0-tldraw-spike
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

Atlas Cloud is the default provider for the first real generation loop:

- image text-to-image: GPT image 2 via Atlas Cloud;
- image edit/reference: GPT image 2 edit via Atlas Cloud;
- video text-to-video: Seedance 2.0 via Atlas Cloud;
- video reference-to-video: Seedance 2.0 reference-to-video via Atlas Cloud.

Use the Codex skill `coflow-provider-setup` as the single user-facing entry for:

- viewing current image/video provider and model defaults;
- changing image/video provider and model defaults;
- skipping setup for now;
- rerunning setup later;
- diagnosing runtime generation failures.

Normal provider status should answer "which provider/model is selected." It should not lead with whether Atlas Cloud credentials are configured. Credential checks are only a redacted runtime diagnostic when generation is about to run or fails.

If Atlas Cloud is the selected provider for real generation, add credentials to either:

```text
<repo>/.env.local
<repo>/phase0-tldraw-spike/.env.local
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

Experimental scene workflow skill candidates:

- `coflow-product-marketing` — product/ad/social marketing variants.
- `coflow-social-repurpose` — 1:1, 9:16, and 16:9 social adaptations.
- `coflow-video-ad-keyframes` — storyboard/keyframe planning for video ads.
- `coflow-style-exploration` — multiple visual style directions.
- `coflow-3d` — first 3D generation/revision workflow boundary.

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
phase0-tldraw-spike/.coflow/
```

This directory is ignored by git. It may contain uploaded assets, generated outputs, execution snapshots, and operation logs.

## Development

```bash
cd phase0-tldraw-spike
npm test
npm run build
```

Hard rule for future canvas changes: follow official tldraw schemas and APIs first. Do not invent custom shape records when a native image/video/frame/arrow/note path exists.

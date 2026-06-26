# Codex Media Canvas

Codex Media Canvas is an open-source multimodal canvas plugin prototype for Codex / coding agents.

Positioning:

> Select an image or video frame, describe the change, and let Codex generate a traceable new version back onto the canvas.

Chinese tagline:

> 指哪改哪，自动回板，版本可追踪。

This project is not a Lovart / Canva clone. The canvas stores visual context, local assets, annotations, queued requests, and version metadata. Codex remains responsible for conversation context, Skill orchestration, provider selection, generation, and writing outputs back to the canvas.

## Current status

This is the v0/v1 implementation baseline from [`../docs/codex-media-canvas-plan.md`](../docs/codex-media-canvas-plan.md).

Implemented:

- tldraw-based canvas shell for fast v0/v1 validation;
- local asset store under `.codex-media-canvas/`;
- image import;
- video import and browser-side frame extraction;
- selected asset context;
- annotation workflow as a core workflow, not a user-facing Skill;
- queued canvas requests for Codex;
- asset metadata and version lineage;
- automatic right-side/grid placement for generated child assets;
- first-run provider onboarding for Codex native, Atlas Cloud, and custom providers;
- MCP-style tools for Codex:
  - `canvas.get_selection`
  - `canvas.insert_asset`
  - `canvas.create_version`
  - `canvas.extract_video_frame`
  - `canvas.get_asset_metadata`
  - `canvas.update_asset_metadata`
  - `canvas.claim_request`
  - `canvas.update_request`
- provider strategy as Codex-driven hybrid:
  - Codex native generation;
  - Atlas Cloud Skill/MCP/CLI;
  - custom provider via Skill/MCP/CLI.

Not implemented as direct canvas behavior:

- direct provider API calls from the browser;
- heavyweight model marketplace UI;
- full timeline video editing;
- full Tapnow-style flow graph;
- 3D generation.

## Run locally

```bash
npm install
npm run build
npm run serve
```

Open:

```text
http://127.0.0.1:5174
```

Use another port:

```bash
npm run serve -- --port=43218
```

For frontend-only development:

```bash
npm run dev
```

The production local server is preferred for end-to-end testing because it provides the API and local asset storage.

## MCP server

Run the MCP-style stdio server from this directory:

```bash
npm run mcp
```

The MCP server stores data in the same `.codex-media-canvas/` workspace folder by default. Set `WORKSPACE_ROOT` to point it at another project workspace:

```bash
WORKSPACE_ROOT=/path/to/project npm run mcp
```

Generation flow:

1. The user selects or annotates media on the canvas.
2. The canvas creates a queued request for Codex.
3. Codex claims the request through MCP.
4. Codex uses Codex native generation, Atlas Cloud Skill/MCP/CLI, or a custom provider.
5. Codex saves the output locally.
6. Codex inserts the generated asset back onto the canvas through MCP.

The browser canvas should not call provider APIs directly in v1.

For zero-configuration local demos, a Codex-side native processor can claim one queued request and write traceable SVG outputs back to the canvas:

```bash
npm run process:next
```

This processor is a development/demo stand-in for the Codex native generation path. It consumes the queued request and writes local outputs through the same asset/version metadata contract.

## Tests

```bash
npm test
npm run build
```

The tests cover:

- local asset creation;
- selection context;
- right-side child asset placement;
- metadata persistence;
- queued Codex requests;
- local-path insertion for MCP/provider outputs;
- Codex native request processing without Atlas setup;
- multi-output scene preset grid placement;
- video-frame request lineage;
- browser video metadata/frame extraction logic through injectable browser dependencies.

## Storage

Runtime files are stored under:

```text
.codex-media-canvas/
  canvases/
  assets/
    images/
    videos/
    frames/
    thumbnails/
  metadata/
  jobs/
```

Large media files are stored as local files. The canvas metadata stores references, not embedded media bytes.

## License note

The v0/v1 canvas shell uses tldraw for speed. Public distribution or production use should confirm the current tldraw SDK license path before launch, as noted in the project plan.

# Phase 0 Execution Log

Date: 2026-06-25

## Goal

Validate whether a real canvas foundation can support the north-star workflow:

```text
media shape + native annotations + task frame
→ read bounded frame context
→ create child version to the right
→ show visible lineage arrow
```

## Current implementation

Created:

```text
coflow/
```

This is intentionally separate from `canvas-studio/`, because `canvas-studio/` is a failed prototype whose UI and canvas model should not be continued.

Implemented:

- React + Vite + tldraw 5 spike.
- A real custom tldraw shape: `MediaImageShape`.
- Seeded task frame.
- Seeded source media shape.
- Seeded native tldraw annotation shapes: `geo` and `note`.
- `canvasContracts.ts` pure functions:
  - `extractFrameContext`
  - `createVersionPlacement`
- UI buttons:
  - `Read frame context`
  - `Generate version`
- Generated child media shape placed to the right.
- Visible lineage arrow from task frame/source area toward generated child.
- JSON panel proving bounded `canvas.get_frame_context` semantics.

## Verification

Commands:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 2/2 tests.
- `npm run build`: passed.
- Local preview started at `http://127.0.0.1:5176/`.
- `curl -I http://127.0.0.1:5176/`: returned `HTTP/1.1 200 OK`.

## Early tldraw assessment

tldraw should not be rejected yet.

Evidence in this spike:

- Custom media shape is feasible.
- Built-in frame shape is usable as task boundary.
- Built-in annotation shapes can coexist in the same canvas coordinate space.
- A bounded frame context can be extracted from current page shapes.
- A child media shape can be inserted to the right.
- Visible arrow lineage can be created.

Open risks:

- Need browser-level interaction QA: drag/drop real files, manual frame creation, selecting arbitrary frames.
- Need verify real arrow bindings, not only visible arrow coordinates.
- Need verify frame reparent behavior with custom media shapes.
- Need verify tldraw production/commercial license path.
- Need verify UI can be simplified enough to not feel like generic whiteboard software.

## Backend/storage answer

The project needs a backend, but v1 should use a local backend:

- local HTTP server;
- MCP server;
- project-local `.codex-media-canvas/` store;
- assets saved as files;
- metadata/jobs/sessions saved as JSON or JSONL;
- provider outputs materialized locally;
- API keys kept out of the browser.

Cloud backend is deferred until collaboration, sync, hosted sharing, proxy billing, or marketplace needs appear.

## Pluggable skill answer

Scene capabilities should be pluggable Codex agent skills.

The canvas project owns:

- canvas MCP contract;
- selection/frame context schema;
- create version/place media tools;
- metadata write-back contract.

User-installed Codex skills can drive generation if they:

- read `canvas.get_selection` or `canvas.get_frame_context`;
- generate or edit media through any provider;
- save outputs locally;
- call `canvas.create_version` or equivalent;
- write back prompt/provider/model/job metadata.

## Next steps

1. Add real file import into `MediaImageShape` without falling back to a DOM asset layer.
2. Verify manual frame creation and frame containment with custom media shapes.
3. Replace coordinate-only lineage arrow with true tldraw arrow binding.
4. Turn current pure `canvasContracts` into MCP tool contracts.
5. Define first Codex agent skill manifest for Product Marketing Set session mode.

## Phase 0.1 update

Date: 2026-06-25

Goal:

```text
Validate real image import, selected/manual frame context behavior, and true arrow bindings.
```

Implemented:

- Added `Import image as shape` control.
- Imported image files become real `MediaImageShape` tldraw shapes.
- Import does not create an external DOM asset layer.
- `findContextFrame` now prefers selected frame.
- If a selected shape is parented to a frame, context lookup can resolve that owning frame.
- `Generate version` now creates tldraw arrow bindings via `createBindings`, not only coordinate-only arrows.
- Arrow binding connects:
  - start terminal to parent media shape;
  - end terminal to generated child media shape.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 2/2 tests.
- `npm run build`: passed.
- Preview restarted at `http://127.0.0.1:5176/`.

Updated tldraw assessment:

- Real custom media shapes remain viable.
- Real file import into custom media shape is viable.
- True tldraw arrow bindings are viable with `createBindingId` / `createBindings`.
- The remaining important uncertainty is not "can tldraw do it at all", but whether its UX, license, frame reparent semantics, and customization surface are good enough for the product.

Still open:

- Manually creating a frame around arbitrary imported media should be tested in browser.
- Need verify whether tldraw automatically reparents custom media shapes into user-created frames, or whether we need our own geometric containment logic.
- Need expose this through an actual MCP server, not only in-browser JS.
- Need persist imported files to `.codex-media-canvas/assets/` instead of using data URLs.
- Need replace hard-coded note text extraction with real rich text extraction.

## Phase 0.1 user-observed fix

Date: 2026-06-25

Observed in browser:

- Seeded top frame could generate versions.
- User-created lower frame around an anime girl image could read context but could not generate.
- The right-side JSON showed `media: []`, so the generator reported `Frame has no media anchor`.
- Repeated generation from the seeded frame created multiple children, but only one visible relationship looked correctly connected.

Root causes:

1. The context extractor only treated custom `media-image` shapes as media.
   User-added images can be native tldraw `image` shapes, so they were ignored as anchors.

2. The generated arrow used a stable shape id seed, which could collide across multiple generations.

Fixes:

- `CanvasShapeKind` now includes native `image` and `video` shapes.
- `MediaContext` now records `shapeType`.
- `extractFrameContext` treats `media-image`, `image`, and `video` as media anchors.
- Native tldraw image/video shapes use their `assetId` as a temporary `localPath` fallback until local materialization exists.
- Added a regression test for native tldraw image shapes inside a frame.
- Generated child shapes and lineage arrows now use unique ids for every generation.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 3/3 tests.
- `npm run build`: passed.
- Preview restarted at `http://127.0.0.1:5176/`.

Remaining caveat:

- Native tldraw image `assetId` is not yet a durable project-local file path. For production, the local backend must materialize native tldraw assets into `.codex-media-canvas/assets/` and rewrite metadata with a real `localPath`.

## Phase 0.2 update

Date: 2026-06-25

Goal:

```text
Move media upload into the tldraw toolbar, reduce toolbar clutter, and add a minimal local backend/MCP boundary.
```

UI changes:

- Removed the top `Import image as shape` button.
- Added media upload through tldraw's bottom toolbar using `AssetToolbarItem`.
- Removed `EraserToolbarItem` from the main toolbar content.
- Kept only the core toolbar items for the spike:
  - select
  - hand
  - draw
  - arrow
  - text
  - note
  - asset upload
  - frame
  - custom `Generate version`

Backend/MCP changes:

- Added `server.mjs`.
- Added `mcp-server.mjs`.
- Added frontend API helpers in `src/api.ts`.
- `Read frame context` now publishes the current bounded frame context to:

```text
.codex-media-canvas/metadata/latest-frame-context.json
```

- `Generate version` also publishes frame context and appends a version operation to:

```text
.codex-media-canvas/logs/operations.jsonl
```

- MCP server exposes:

```text
canvas.get_frame_context
```

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
npm run serve
```

Results:

- `npm test`: passed, 4/4 tests.
- `npm run build`: passed.
- Local backend server running at `http://127.0.0.1:5176/`.
- MCP `tools/list` returned `canvas.get_frame_context`.
- MCP `tools/call` returned a no-context warning before browser publication, as expected.

Browser instruction:

- Refresh `http://127.0.0.1:5176/`.
- Select a frame.
- Click `Read frame context`.
- The local file `.codex-media-canvas/metadata/latest-frame-context.json` should appear/update.

Remaining caveats:

- The backend currently stores only the latest frame context, not full historical session state.
- Native tldraw assets are not yet materialized into `.codex-media-canvas/assets/`.
- MCP currently reads latest context only; it does not yet support `canvas.create_version` from Codex.
- The custom toolbar is still a spike UI, not final product design.

## Phase 0.3 update

Date: 2026-06-26

Goal:

```text
Move generation from a confusing global toolbar action into a selected-frame local action.
```

Why:

- The bottom toolbar's leftmost custom `Generate version` action used a duplicate-like icon, which looked like a native duplicate command.
- The desired product model is not "press a whiteboard toolbar button to generate globally".
- The desired model is "draw/select a frame that scopes media + annotations, then generate from that bounded frame".

UI changes:

- Removed the custom `Generate version` item from the bottom tldraw toolbar.
- Removed the top statusbar `Generate version` button.
- Added a frame-local action button:

```text
按标注生成新版
```

- The button appears only when a frame is selected.
- The button is positioned near the selected frame's top edge/title area.
- Clicking it calls generation with that exact frame id, instead of relying on global fallback frame selection.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
npm run serve
```

Results:

- `npm test`: passed, 4/4 tests.
- `npm run build`: passed.
- Local preview restarted at `http://127.0.0.1:5176/`.

Browser acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- The bottom toolbar should no longer show a duplicate-like custom `Generate version` button.
- Selecting a frame should show `按标注生成新版` near the frame.
- Selecting non-frame objects or empty canvas should hide the frame-local generate button.
- Clicking the frame-local button should generate from that selected frame only.
- The generated child should still be placed to the right/down with collision avoidance.
- The generated lineage arrow should still bind from source media to child media.
- `.codex-media-canvas/metadata/latest-frame-context.json` should update after generation.
- `.codex-media-canvas/logs/operations.jsonl` should append a `version.created` operation after generation.

Remaining caveats:

- The frame-local button position is a spike-level overlay and may need refinement for zoom/pan/title collision.
- The generated output is still a placeholder SVG, not a real model call.
- Native tldraw assets are still not materialized into `.codex-media-canvas/assets/`.
- MCP still only exposes `canvas.get_frame_context`; Codex cannot yet call `canvas.create_version`.

## Phase 0.4 update

Date: 2026-06-26

Goal:

```text
Polish the selected-frame generation affordance and remove polling-based lag.
```

Problem observed:

- The previous `按标注生成新版` button was visually too rough for the intended product quality bar.
- The Chinese label was inconsistent with the project's English-first interface direction.
- The button followed frame movement via a 250ms polling loop, so dragging a frame made the button feel sticky and delayed.

UI/interaction changes:

- Replaced the large blue debug-like button with a quieter Lovart-style mini action.
- New button label:

```text
Generate
```

- Added a compact sparkle icon in a dark rounded square.
- Changed visual treatment to:
  - white translucent surface
  - subtle border
  - small radius
  - light shadow
  - restrained hover ring
- Moved the action into tldraw's `InFrontOfTheCanvas` overlay layer.
- Replaced the polling loop with `useEditor` + `useValue`, so button position follows selected-frame state through tldraw/react signals.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
npm run serve
```

Results:

- `npm test`: passed, 4/4 tests.
- `npm run build`: passed.
- Local preview restarted at `http://127.0.0.1:5176/`.

Browser acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Select a frame.
- The selected-frame action should read `Generate`, not Chinese.
- The button should feel like a light contextual action, not a primary blue CTA.
- Drag the selected frame; the button should follow much more smoothly than the previous polling implementation.
- Click `Generate`; it should still generate from the selected frame only.

Remaining caveats:

- This is still a custom spike overlay, not final production chrome.
- We still need to decide whether the final action belongs beside the frame title, on a selection toolbar, or in a compact contextual menu.
- The generated output remains a placeholder SVG.
- MCP still needs `canvas.create_version` for true Codex-skill-driven generation.

## Phase 0.5 update

Date: 2026-06-26

Goal:

```text
Fix frame-local Generate click-through and add a minimal MCP-to-browser create_version command path.
```

Bug observed:

- The `Generate` mini action rendered correctly and followed the frame smoothly.
- Clicking it behaved like clicking the whiteboard canvas.
- The selected frame was cleared.
- No generation happened.

Root cause:

- The action lived in tldraw's front-of-canvas layer, but pointer events still leaked to the canvas selection system.
- Once the frame was deselected, the contextual action unmounted before a reliable click action could complete.

Fix:

- Added explicit pointer-event ownership to `.frame-action-button`.
- Stopped pointer down/up/mouse down events in the capture phase so tldraw does not treat the action click as a canvas click.
- Kept `preventDefault` on the final click only, preserving normal button click behavior.
- The click now directly calls the selected-frame generation path with `frameId`.

MCP progress:

- Added a local pending command queue:

```text
.codex-media-canvas/commands/pending.jsonl
```

- Added backend endpoints:

```text
POST /api/commands
GET /api/commands/pending
```

- The browser now polls pending commands and executes:

```text
canvas.create_version
```

- Added MCP tool:

```text
canvas.create_version
```

- The MCP tool queues a command for the browser to claim and execute.
- If no `frameId` is provided, MCP defaults to the latest published frame context when possible.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
node -e '... MCP tools/list + canvas.create_version smoke test ...'
npm run serve
```

Results:

- `npm test`: passed, 4/4 tests.
- `npm run build`: passed.
- MCP `tools/list` now returns `canvas.get_frame_context` and `canvas.create_version`.
- MCP `canvas.create_version` successfully wrote a pending command in smoke test.
- Smoke-test pending command was cleared before browser handoff.
- Local preview restarted at `http://127.0.0.1:5176/`.

Browser acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Select a frame.
- Click `Generate`.
- The frame should remain selected long enough for the action to run.
- A generated version should appear.
- The generated version should still use only the selected frame context.
- `.codex-media-canvas/logs/operations.jsonl` should append `version.created`.

MCP acceptance checklist:

- Publish/read a frame context from the browser first.
- Call `canvas.create_version` from MCP.
- Keep the browser open.
- Within roughly one second, the browser should claim the pending command and create a generated version on the canvas.

Remaining caveats:

- Browser polling is a Phase 0 bridge, not the final production sync architecture.
- Commands are claimed by clearing `pending.jsonl`; this is acceptable for a local spike but not durable multi-client sync.
- Generated output is still placeholder SVG.
- Native image/video asset materialization remains the next necessary foundation before real model execution.

## Phase 0.6 update

Date: 2026-06-26

Goal:

```text
Materialize canvas media assets into stable local project files before Codex/Skill model execution.
```

Why:

- Before this step, native tldraw `image` / `video` shapes were recognized as media anchors, but their `localPath` was only an `assetId` fallback.
- That was enough for bounded-frame detection, but not enough for real model calls.
- A Codex skill needs stable filesystem paths it can pass to image/video generation/editing providers.

Backend changes:

- Added local asset root:

```text
.codex-media-canvas/assets/
```

- Added asset materialization endpoint:

```text
POST /api/assets/materialize
```

- The endpoint accepts a browser-provided data URL and writes files into:

```text
.codex-media-canvas/assets/images/
.codex-media-canvas/assets/videos/
```

- The endpoint returns:

```json
{
  "assetId": "...",
  "shapeId": "...",
  "mimeType": "...",
  "localPath": ".codex-media-canvas/assets/...",
  "bytes": 123
}
```

- Materialization events are appended to:

```text
.codex-media-canvas/logs/operations.jsonl
```

Frontend changes:

- Added `materializeAsset` API helper.
- Added `extractMaterializedFrameContext`.
- `Read frame context` now attempts to materialize all frame media before publishing context.
- `Generate` now also materializes frame media before creating a version.
- Native tldraw image/video assets are read from `editor.getAsset(assetId).props.src`.
- Custom `media-image` shapes are also materialized from their `props.src`, so seeded/generated SVG media can become real project files.
- Published `FrameContext.media[].localPath` now points to materialized local files when materialization succeeds.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
npm run serve
```

Additional API smoke test:

```text
POST http://127.0.0.1:5176/api/assets/materialize
```

Result:

```json
{
  "ok": true,
  "asset": {
    "assetId": "asset:smoke",
    "shapeId": "shape:smoke",
    "mimeType": "image/svg+xml",
    "localPath": ".codex-media-canvas/assets/images/smoke-smoke.svg",
    "bytes": 67
  }
}
```

Results:

- `npm test`: passed, 4/4 tests.
- `npm run build`: passed.
- API smoke test wrote `.codex-media-canvas/assets/images/smoke-smoke.svg`.
- Local preview restarted at `http://127.0.0.1:5176/`.

Browser acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Import an image through the bottom toolbar.
- Draw/select a frame around the image and annotations.
- Click `Read frame context` or `Generate`.
- Check the right-side JSON:
  - `media[].localPath` should become a `.codex-media-canvas/assets/...` path rather than a raw `assetId`.
- Check local filesystem:
  - the referenced file should exist under `.codex-media-canvas/assets/images/`.
- Click `Generate`:
  - generation should still work.
  - `version.created` should still be appended.
  - asset materialization should be logged as `asset.materialized`.

Acceptance criteria:

- Native uploaded image/video assets can be converted into stable local project files.
- Frame context no longer depends only on ephemeral tldraw asset ids.
- Codex/MCP/Skill execution can read frame media through local file paths.
- Existing Generate flow remains intact.

Remaining caveats:

- Browser sends assets as data URLs; this is acceptable for Phase 0 but not optimal for large video files.
- Remote URL/CORS failures are recorded as `asset.materialize_failed`, but not yet surfaced in the UI.
- There is no dedupe/content hash yet; repeated materialization may rewrite equivalent assets.
- The generated media is still placeholder SVG.
- The next step is to make `canvas.create_version` consume these materialized paths and produce a more realistic provider-ready generation operation contract.

## Phase 0.7 update

Date: 2026-06-26

Goal:

```text
Make materialized asset paths directly copyable and fix duplicated file extensions.
```

Problem observed:

- A video upload produced a frame context path like:

```text
.codex-media-canvas/assets/videos/493524168-20260512-224640.mp4.mp4
```

- The file did exist, but `localPath` was relative to the project root, so copying it directly from the JSON was confusing outside the repo.
- The filename also duplicated the extension because the uploaded file name already contained `.mp4` and the backend appended `.mp4` again.

Verification of existing video:

```text
Context localPath:
.codex-media-canvas/assets/videos/493524168-20260512-224640.mp4.mp4

Actual file:
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/videos/493524168-20260512-224640.mp4.mp4
```

Fixes:

- `MediaContext` now supports:

```ts
absolutePath?: string
```

- `POST /api/assets/materialize` now returns both:

```json
{
  "localPath": ".codex-media-canvas/assets/...",
  "absolutePath": "/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/..."
}
```

- Frontend materialization now copies `absolutePath` into `FrameContext.media[]` and `FrameContext.anchorMedia`.
- Backend filename generation now strips an existing matching extension before appending the normalized extension.
- Example after fix:

```text
clip.mp4 -> .codex-media-canvas/assets/videos/smoke-video-clip.mp4
```

Why preset images are SVG:

- The seeded source product image and generated placeholder image are code-created SVG data URLs.
- Their materialized files therefore correctly appear as `.svg`.
- User-uploaded JPG/PNG/MP4 assets should keep their own MIME-derived extensions.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
npm run serve
```

API smoke result:

```json
{
  "ok": true,
  "asset": {
    "assetId": "asset:smoke-video",
    "shapeId": "shape:smoke-video",
    "mimeType": "video/mp4",
    "localPath": ".codex-media-canvas/assets/videos/smoke-video-clip.mp4",
    "absolutePath": "/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/videos/smoke-video-clip.mp4",
    "bytes": 3
  }
}
```

Browser acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Select the video frame.
- Click `Read frame context` again.
- Right-side JSON should now include `absolutePath` under the video media entry.
- The video path should no longer duplicate `.mp4` for newly materialized files.
- Copy `absolutePath` and check it in Finder/terminal; it should exist.

Acceptance criteria:

- `localPath` remains project-relative for repo portability.
- `absolutePath` is directly copyable and inspectable on the local machine.
- New uploaded video filenames do not duplicate extensions.
- Preset SVG assets remain SVG because their source is SVG, not because all assets are forced to SVG.

Remaining caveats:

- Existing previously materialized files with `.mp4.mp4` are not renamed automatically.
- Re-clicking `Read frame context` on the same current video should write a corrected new file if the browser still has the asset source available.
- A future cleanup command should dedupe or migrate old materialized assets.

## Phase 0.8 / Phase 1.0 update

Date: 2026-06-26

Goal:

```text
Stabilize core canvas editing behavior, remove the 10MB media gate, and introduce the provider-ready generation contract.
```

Issues observed:

- Right-clicking a selected canvas element could open the tldraw element menu once, then later right-click menus stopped appearing.
- Video uploads were capped at 10MB by tldraw's default external asset guard.
- Phase 1 needed a real execution boundary beyond placeholder canvas shape creation.

Right-click/context-menu fix:

- The custom selected-frame `Generate` action now sits inside a `.canvas-front-layer` wrapper with:

```css
pointer-events: none;
```

- Only the actual `Generate` button uses `pointer-events: auto`.
- The button now only stops propagation for primary/left-click pointer events.
- Right-click/context menu events are no longer globally captured by the custom overlay.

Media upload limit investigation:

- tldraw default asset limit is:

```ts
DEFAULT_MAX_ASSET_SIZE = 10 * 1024 * 1024
```

- This limit applies broadly to external file ingestion, not only video:
  - toolbar upload
  - drag/drop
  - paste
  - image assets
  - video assets

Limit override:

- The spike now passes:

```tsx
maxAssetSize={2 * 1024 * 1024 * 1024}
maxImageDimension={Infinity}
```

- Effective Phase 0 upload target:
  - max asset size: 2GB
  - image resize cap: disabled
  - max files at once: tldraw default remains 100

Important caveat:

- This removes tldraw's 10MB reject gate.
- It does not mean browser memory, data URL transport, or provider API upload limits are solved for production.
- Production video flow should move to file-backed/chunked upload and avoid keeping huge videos as base64 JSON payloads.

Phase 1 contract added:

- Added `src/generationContract.ts`.
- Added test mirror `dist-contracts/generationContract.js`.
- Added `createProviderReadyGenerationRequest`.
- Added backend endpoints:

```text
POST /api/generation-requests
GET /api/generation-requests/latest
```

- Latest request is stored at:

```text
.codex-media-canvas/metadata/latest-generation-request.json
```

- Request events are appended as:

```text
generation.requested
```

Generation request shape:

```ts
type GenerationKind = 'image_edit' | 'video_edit' | 'image_generate'
```

- Image source frame -> `image_edit`
- Video source frame -> `video_edit`
- No source media -> `image_generate`

The request includes:

- frame id/name/bounds
- input asset id
- input shape id/type
- input `localPath`
- input `absolutePath`
- annotation-derived prompt
- provider output target path
- canvas writeback ids

Implementation detail:

- The provider output path and the temporary canvas preview path are now separate.
- For video edits, the provider request targets:

```text
.codex-media-canvas/assets/videos/generated-<timestamp>.mp4
```

- The current visible child shape remains an SVG preview placeholder until a real executor returns media.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
npm run serve
```

Results:

- `npm test`: passed, 5/5 tests.
- `npm run build`: passed.
- Generation request API smoke test passed.
- Local preview restarted at `http://127.0.0.1:5176/`.

Browser acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Select different canvas elements and right-click them repeatedly.
- The tldraw element/context menu should continue to appear after the first invocation.
- Upload a video larger than 10MB.
- It should no longer be rejected by the 10MB tldraw guard.
- Frame the video and click `Read frame context`.
- The JSON should include materialized media with `absolutePath`.
- Click `Generate`.
- A preview child should be written to the canvas.
- `.codex-media-canvas/metadata/latest-generation-request.json` should contain a provider-ready request.
- If the source is video, request `kind` should be `video_edit` and output media type should be `video`.

Acceptance criteria:

- Core tldraw right-click behavior is not broken by our custom frame action overlay.
- Upload constraints are no longer capped at 10MB in this spike.
- Frame context has stable materialized input paths.
- Generate creates both:
  - a visible canvas preview/writeback
  - a provider-ready generation request for Phase 1 execution

Remaining caveats:

- Very large video materialization still uses browser memory/data URL in this spike.
- No real model provider is called yet.
- The generated canvas child is a placeholder preview, not the provider output.
- Next step should replace the mock provider boundary with a real or filesystem-backed executor that writes output media and then updates the canvas preview.

## Phase 1.1 update

Date: 2026-06-26

Status: superseded by Phase 1.2 for request-mode naming and import display fit. Kept here as an execution record.

Goal:

```text
Fix context-menu interference more safely, support explicit video generation modes, expose copyable JSON paths, and prevent huge imports from destroying the canvas scale.
```

JSON path:

- Latest provider-ready request absolute path:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-generation-request.json
```

- Opened locally via:

```bash
open /Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-generation-request.json
```

Video generation request model:

- The request contract now separates:
  - output media type
  - generation mode
  - coarse request kind

New types:

```ts
type OutputMediaType = 'image' | 'video'
type GenerationMode =
  | 'text_to_image'
  | 'image_edit'
  | 'text_to_video'
  | 'image_to_video'
  | 'reference_to_video'
  | 'video_to_video'
```

Implication:

- Seedance-style models with multiple modes do affect the request contract.
- Codex/Skill can still infer a sensible default from the selected frame:
  - no media + video output -> `text_to_video`
  - one image + video output -> `image_to_video`
  - multiple media + video output -> `reference_to_video`
  - video + video output -> `video_to_video`
- But the request now also supports explicit overrides from MCP/Skill:

```json
{
  "outputMediaType": "video",
  "generationMode": "image_to_video"
}
```

MCP changes:

- `canvas.create_version` now accepts:
  - `outputMediaType`
  - `generationMode`

Context menu fix:

- The selected-frame `Generate` action was moved out of tldraw's `InFrontOfTheCanvas` component tree.
- It is now a plain outer React overlay driven by editor store changes and `requestAnimationFrame`.
- This avoids sharing the same React/Radix component subtree as tldraw's context menu.
- The overlay still follows selected frames smoothly without polling.

Upload/display fit:

- tldraw's 10MB asset rejection remains overridden:

```tsx
maxAssetSize={2 * 1024 * 1024 * 1024}
maxImageDimension={Infinity}
```

- New imported native image/video shapes are now display-fitted on canvas to:

```text
max 720 x 520
```

- This changes only canvas shape dimensions.
- It does not intentionally compress or downscale the source file used for materialization/model input.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
npm run serve
```

Results:

- `npm test`: passed, 6/6 tests.
- `npm run build`: passed.
- MCP smoke test accepted `outputMediaType: "video"` and `generationMode: "image_to_video"`.
- Smoke pending command was cleared after verification.
- Local preview restarted at `http://127.0.0.1:5176/`.

Browser acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Right-click several different canvas elements repeatedly.
- Context menu should keep appearing after the first invocation.
- Upload a high-resolution image or video.
- Canvas should not zoom out dramatically because the imported shape should be display-fitted.
- Read/generate from a framed image or video.
- Check:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-generation-request.json
```

- For an explicit MCP image-to-video command, the request should show:

```json
{
  "output": { "mediaType": "video" },
  "generationMode": "image_to_video"
}
```

Remaining caveats:

- `Generate` button default still infers output type from the anchor media; explicit video generation from an image is currently best triggered through MCP/Skill command arguments.
- Large video materialization still needs file-backed/chunked transport before production.
- Computer-use could verify first context menu open in Chrome, but the tool intermittently returned `noWindowsAvailable` on repeated clicks, so repeated right-click regression still needs manual browser confirmation.

## Phase 1.2 update

Date: 2026-06-26

Goal:

```text
Remove overly narrow video-to-video request typing, make media imports preserve original assets while preventing destructive zoom, disable the stuck tldraw style panel, and wire the mock provider boundary to a filesystem-backed executor.
```

Request contract correction:

- The previous `image_to_video` / `video_to_video` split was too provider-product-specific.
- Current contract treats video output as:

```ts
type GenerationMode =
  | 'text_to_image'
  | 'image_edit'
  | 'text_to_video'
  | 'reference_to_video'
```

- Any video request with media inside the frame now becomes `reference_to_video`.
- The request now carries explicit `references[]`:

```ts
type GenerationReference = {
  shapeId: string
  assetId: string
  mediaType: 'image' | 'video' | 'audio' | 'model3d' | 'text'
  role:
    | 'source'
    | 'reference'
    | 'style'
    | 'motion'
    | 'audio'
    | 'geometry'
    | 'mask'
    | 'start_frame'
    | 'end_frame'
  localPath: string
  absolutePath?: string
  bounds: Bounds
}
```

Implication:

- The canvas/Skill layer should express user intent and references, not mirror each model provider's UI mode names.
- Provider adapters can later map the same request to Seedance, Kling, C-Dance, etc.:
  - one image reference may map to provider image-to-video
  - one video reference may map to video context, motion reference, or extension
  - multiple image/video/audio/3D references may map to a multimodal reference/edit endpoint

Research note:

- Seedance 2.0 explicitly supports text, image, audio, and video inputs; public descriptions mention up to 9 images, 3 videos, and 3 audio clips as multimodal references.
- Kling/Kling-Omni style systems also point toward multimodal visual-language inputs, reference images, video contexts, motion reference, element editing, and unified generation/editing flows.
- Therefore, a first-class `video_to_video` request type would be the wrong abstraction boundary for this project.

Right-click / color panel fix:

- Disabled tldraw's default `StylePanel` in this spike.
- Reason: the stuck floating color panel is outside our intended workflow and likely interferes with selection/context menu state.
- The selected-frame `Generate` overlay remains outside the tldraw canvas subtree, so it should not swallow right-click behavior.

Import display fit clarification:

- The import fit is display-only.
- The original uploaded file is still materialized and preserved under `.codex-media-canvas/assets/...`.
- No crop, downsample, or compression is applied to the stored model input.
- Initial canvas shape fit is now:

```text
max 1280 x 720 display box
```

- If tldraw auto-zooms too far out during import, the spike now restores zoom to 100% when it detects the camera below 75%.

Executor boundary:

- `Generate` now writes a provider-ready request and immediately calls:

```text
POST /api/executions/run-latest
```

- The local mock executor writes:
  - latest execution JSON:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-execution-result.json
```

  - per-execution result JSON:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/executions/
```

  - output assets:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/images/
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/videos/
```

- Image mock output now uses `.svg` consistently.
- Video mock output writes a short placeholder `.mp4` through local ffmpeg when available.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 6/6 tests.
- `npm run build`: passed.
- Restarting `http://127.0.0.1:5176/` was blocked by the current Codex execution quota, so the browser may still be serving the previous build until the server is restarted.

Manual acceptance checklist after restart:

- Refresh `http://127.0.0.1:5176/`.
- Confirm the stuck top-right color picker no longer appears.
- Right-click several different elements repeatedly over 30-60 seconds.
- Context menu should appear consistently, not only after waiting.
- Upload a 4K image/video.
- The canvas should not stay zoomed out dramatically; the media shape should be visible as an initial display-fit object.
- Check that the original materialized media path under `.codex-media-canvas/assets/...` exists.
- Frame a media object plus annotations and click `Generate`.
- Check:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-generation-request.json
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-execution-result.json
```

- For video output with any media reference, the request should use:

```json
{
  "generationMode": "reference_to_video",
  "references": [
    {
      "mediaType": "image",
      "role": "source"
    }
  ]
}
```

Next plan:

- Restart local preview and manually re-test the right-click/color-panel regression in the browser.
- Replace the current data-URL materialization path with a file-backed/chunked upload path for large videos.
- Add provider adapter interfaces for Atlas/Seedance/Kling-style modes, mapping `references[]` into provider-specific payloads.

## Phase 1.3 update

Date: 2026-06-26

Goal:

```text
Start the local deployment, verify Phase 1.2, then create a sturdier asset storage boundary and provider adapter boundary for the next implementation phase.
```

Deployment:

- Local preview is running at:

```text
http://127.0.0.1:5176/
```

- Server workspace store:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas
```

Phase 1.2 completion audit:

- `npm test`: passed, 6/6 before Phase 1.3 changes.
- `npm run build`: passed.
- Local executor smoke test passed with a `reference_to_video` request.
- Smoke output:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/videos/smoke-1782412402561.mp4
```

Phase 1.3 changes:

1. Local tldraw asset store

- The app now passes a custom `assets` store to `<Tldraw />`.
- Imported files are uploaded directly to:

```text
POST /api/assets/upload
```

- Server writes files to:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/images/
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/videos/
```

- The browser renders them through:

```text
/asset-store/assets/...
```

- Asset metadata now carries:
  - `localPath`
  - `absolutePath`
  - `bytes`
  - `mimeType`

2. Frame context materialization improvement

- If tldraw asset metadata already contains `localPath` and `absolutePath`, frame extraction uses those paths directly.
- This avoids converting uploaded files back through data URLs before creating model input.
- This is still not a full chunked uploader, but it moves the critical path from "base64 in JSON" to "file-backed asset store".

3. Provider adapter boundary

- Added:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/coflow/src/providerAdapter.ts
/Users/qiutian/Projects/apps/coding-agent-canva/coflow/dist-contracts/providerAdapter.js
```

- Provider job shape:

```ts
type ProviderJob = {
  provider: 'mock-provider'
  requestId: string
  mode: 'text_to_image' | 'image_edit' | 'text_to_video' | 'reference_to_video'
  outputMediaType: 'image' | 'video'
  prompt: string
  inputs: Array<{
    mediaType: 'image' | 'video' | 'audio' | 'model3d' | 'text'
    role: string
    localPath: string
    absolutePath?: string
  }>
  outputLocalPath: string
  outputAbsolutePath?: string
}
```

- Server execution result now includes `providerJob`, so the request-to-provider mapping can be inspected in JSON.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 7/7 tests.
- `npm run build`: passed.
- Asset upload smoke:
  - `POST /api/assets/upload`: passed
  - `GET /asset-store/assets/images/...`: passed
- Provider adapter smoke:
  - `POST /api/generation-requests`: passed
  - `POST /api/executions/run-latest`: passed
  - execution result contains `providerJob.inputs[0].absolutePath`

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Upload an image or video through the bottom toolbar.
- Select/frame it and click `Read frame context`.
- Confirm JSON contains a real absolute path under:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/
```

- Click `Generate`.
- Confirm latest execution has a `providerJob`:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-execution-result.json
```

- Confirm `providerJob.inputs[]` points to original uploaded asset paths.

Next plan:

- Replace the simple raw upload endpoint with chunked/resumable upload for very large video files.
- Add a right-click/context-menu browser regression test or controlled custom menu if the tldraw menu remains flaky.
- Implement first real provider adapter stub for Atlas/Seedance-style `reference_to_video` payloads.

## Phase 1.4 update

Date: 2026-06-26

Goal:

```text
Restore style controls, replace flaky tldraw/Radix context menu with a controlled menu, add chunked upload, and add Seedance/Kling-style provider adapter stubs.
```

Right-click menu diagnosis:

- tldraw's default `DefaultContextMenu` wraps the entire canvas with Radix `ContextMenu.Root`.
- tldraw's style panel / mobile style popover also uses tldraw UI floating layers.
- Since the right-click bug reproduced even when the selected media was far from the frame generate button, the likely cause is not the Generate overlay.
- The spike now avoids that unstable path by replacing the default Radix context menu with a controlled local context menu.

Right-click menu change:

- Added a custom `StableContextMenu` component.
- It wraps the tldraw Canvas and handles `onContextMenuCapture`.
- Current controlled actions:
  - Duplicate
  - Bring forward
  - Send backward
  - Select all
  - Delete
- This intentionally prioritizes stable menu invocation over complete feature parity with tldraw's default context menu.

Style panel correction:

- Removed the previous `StylePanel: null` override.
- The color/style panel is restored to its original tldraw entry point.
- The fix target is no longer "disable the panel"; it is "keep the panel available while the right-click menu is controlled separately."

Chunked upload:

- Files larger than 32MB now use chunked upload from the browser asset store.
- Chunk size:

```text
8MB
```

- New server endpoints:

```text
POST /api/assets/uploads/start
POST /api/assets/uploads/chunk
POST /api/assets/uploads/complete
```

- Temporary chunks are stored under:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/uploads/
```

- Completed files are merged into:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/videos/
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/images/
```

Provider adapter stubs:

- Added Seedance-style payload mapping:

```ts
buildSeedanceProviderPayload(job)
```

- Added Kling-style payload mapping:

```ts
buildKlingProviderPayload(job)
```

- Both adapters treat video requests with media inputs as reference-driven generation/editing payloads.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 7/7 tests.
- `npm run build`: passed.
- Local server restarted at:

```text
http://127.0.0.1:5176/
```

- Chunked upload smoke:
  - 33MB file
  - 8MB chunks
  - 5 chunks
  - merged output:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/assets/videos/chunk-smoke-1782413191806-chunk-smoke.mp4
```

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Select a shape and open the color/style control from its original toolbar entry.
- The style panel should still be available and should close/fold normally.
- Right-click shapes repeatedly without waiting.
- The custom context menu should open every time.
- Try Duplicate/Delete from the custom menu.
- Upload a video larger than 32MB.
- The upload should complete and write a file under `.codex-media-canvas/assets/videos/`.
- Frame media + annotations, Generate, then inspect:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-execution-result.json
```

- Confirm provider mapping remains inspectable through `providerJob`.

Next plan:

- If the custom menu is accepted, expand it toward default tldraw feature parity.
- Add visible upload progress for chunked uploads.
- Replace mock Seedance/Kling payload stubs with a real Atlas/Seedance executor adapter once credentials/provider boundary is chosen.

## Phase 1.5 update

Date: 2026-06-26

Goal:

```text
Fix the bottom style panel regression, expand the custom context menu, add upload progress, and add a configurable real-provider executor boundary.
```

Style panel diagnosis:

- Directly inserting tldraw's `MobileStylePanel` or a custom popover into `DefaultToolbar` children is incorrect.
- `DefaultToolbar` passes children through `OverflowingToolbar`.
- The overflow system treats arbitrary children as toolbar items, which caused the broken nested "Styles" button instead of rendering the actual style panel.

Style panel fix:

- Removed the style button from `PhaseToolbarContent`.
- Added `PhaseToolbar`, which renders:
  - the default toolbar with drawing/media/frame tools
  - a separate `.bottom-style-panel-dock` outside the overflow toolbar
- `BottomStylePanelButton` now lives outside `OverflowingToolbar`.
- tldraw's default `StylePanel` component override is set to `null`, so:
  - no desktop top-right style panel
  - no default mobile style panel conflict
  - only the controlled bottom dock entry opens `DefaultStylePanel isMobile`

Context menu expansion:

- Added:
  - Bring to front
  - Send to back
  - Group
  - Ungroup
- Existing:
  - Duplicate
  - Bring forward
  - Send backward
  - Select all
  - Delete

Chunked upload progress:

- Browser asset store now reports upload progress.
- Direct uploads show start and completion.
- Chunked uploads update after each chunk.
- A floating progress card appears while uploading and briefly after completion.

Provider executor boundary:

- Added Atlas payload mapping:

```ts
buildAtlasProviderPayload(job)
```

- Server execution result now includes:
  - `providerPayloads.atlas`
  - `providerPayloads.seedance`
  - `providerPayloads.kling`
  - `externalExecution`

- Real provider endpoint can be configured with:

```text
ATLAS_PROVIDER_ENDPOINT
ATLAS_PROVIDER_API_KEY
```

- Without those env vars, the executor still writes mock media output and reports:

```json
{
  "externalExecution": {
    "status": "skipped",
    "reason": "No provider endpoint configured."
  }
}
```

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 7/7 tests.
- `npm run build`: passed.
- Local server restarted at `http://127.0.0.1:5176/`.
- Provider smoke test passed:
  - Atlas payload generated.
  - External execution skipped because no endpoint is configured.

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Select a native styleable shape such as note, arrow, geo, or draw.
- Click the separate bottom style dock button.
- The actual color/style panel should open immediately, not another "Styles" button.
- Select a custom media shape; style dock may be disabled because the custom media shape does not expose tldraw style props yet.
- Right-click a shape and confirm the expanded context menu works.
- Upload a large video and confirm upload progress appears.
- Generate and inspect:

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.codex-media-canvas/metadata/latest-execution-result.json
```

- Confirm `providerPayloads.atlas` is present.

Next plan:

- If the style dock now feels correct, keep it as the product-specific style entry.
- Add provider selection UI or command parameter for Atlas/Seedance/Kling.
- Replace mock media output with real provider output once endpoint credentials are available.

## Phase 1.6 update

Date: 2026-06-26

Goal:

```text
Restore native tldraw UI components and make newly imported media avoid existing canvas objects.
```

Decision:

- Reverted the tldraw core UI back to native defaults.
- Removed the custom toolbar override.
- Removed the custom context menu override.
- Removed the custom bottom style-panel popover.
- Kept only app-specific layers that are not replacements for tldraw core UI:
  - top status bar
  - right frame-context JSON panel
  - frame-level Generate button
  - local/chunked asset upload store
  - upload progress toast

Why:

- The prior custom toolbar/style/context-menu path was fighting tldraw's own UI state and overflow system.
- The product goal is not to rebuild tldraw chrome; it is to let Codex/skills operate on bounded canvas context.
- From now on, native tldraw UI bugs should be diagnosed at the event/source boundary instead of papered over with wholesale component replacements.

Upload placement fix:

- New native image/video shapes are still stored as original uploaded assets.
- The whiteboard shape display is normalized independently from source storage:
  - large media is shown at a bounded initial display size
  - original file resolution/content is not cropped or rewritten
  - newly imported media now searches for an open canvas slot before settling
  - imported media avoids existing shapes and other files imported in the same batch

Provider payload status:

- `providerPayloads.atlas` is accepted as checked and remains unchanged in this pass.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 7/7 tests.
- `npm run build`: passed.

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Compare with the native reference at `http://localhost:5182/`.
- Confirm native tldraw toolbar, style panel, page/menu chrome, and context menu behavior are back.
- Right-click several different shapes repeatedly; the menu should be tldraw native and should not get stuck.
- Select styleable shapes; the style panel should behave like the native reference.
- Upload an image or video while shapes already exist on the canvas; the new media should land in an open area rather than directly covering the existing objects.
- Confirm large/high-resolution media is not cropped or transcoded by this placement normalization; only the shape's initial canvas display size is adjusted.

Next plan:

- If native tldraw UI is accepted, stop customizing core tldraw chrome for Phase 0/1.
- Add provider selection / request-mode control on the Codex command side, not as more whiteboard toolbar clutter.
- Continue replacing mock output with real Atlas/provider executor once endpoint credentials and provider API contract are ready.

## Phase 1.7 update

Date: 2026-06-26

Goal:

```text
Fix upload UX regressions after restoring native tldraw UI.
```

Diagnosis:

- The upload progress toast was shown for every file because the asset store called `onProgress(...)` before checking whether the file needed chunked upload.
- This was too noisy for small images/videos and did not match the intended design.
- The previous upload-placement avoidance only searched to the right/down from the initial import point, which could push large imported media outside the current viewport and make it look like upload failed.
- The asset store returned the correct `{ src, meta }` shape, but now also stores `src` in `meta` and uses it as a `resolve()` fallback for additional safety.

Fix:

- Small files still upload through `/api/assets/upload`, but no longer show the progress toast.
- Only files larger than `CHUNKED_UPLOAD_THRESHOLD_BYTES` use chunked upload and show progress.
- Upload failure now appears in the top status bar as `Upload failed: ...`.
- Successful upload updates the top status bar as `Uploaded ...`.
- Imported media placement now searches around the initial drop point and prefers visible open slots in the current viewport.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 7/7 tests.
- `npm run build`: passed.
- Local server restarted at `http://127.0.0.1:5176/`.
- HTTP probe returned `200 OK`.

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Upload a small image; it should appear on canvas and should not show the upload progress toast.
- Upload a small video; it should appear on canvas and should not show the upload progress toast.
- Upload a large video over 32MB; the upload progress toast should appear and update during chunked upload.
- Upload near existing shapes; the new asset should avoid overlap while staying visible near the current viewport.
- If upload fails, the status bar should show a readable failure reason.

Next plan:

- If upload is now stable, keep the native tldraw UI baseline and move back to provider execution.
- Add provider selection/request-mode control through Codex command or skill invocation.
- Continue real Atlas/provider executor integration.

## Phase 1.8 update

Date: 2026-06-26

Goal:

```text
Fix video upload viewport drift and reduce noisy transient upload failure states.
```

Diagnosis:

- Video files were uploaded successfully to the local asset store, but after import the viewport could remain offset from the newly inserted video.
- The user had to click tldraw's native "Back to content" control to re-center on the asset.
- This was caused by our post-import normalization moving/resizing imported media without explicitly re-centering the camera afterward.
- Some transient upload cancellations could be reported as failures, which made the status feel noisier than the underlying backend logs.

Fix:

- After importing image/video shapes, the app now:
  - normalizes size
  - applies overlap-avoidance placement
  - selects the imported media
  - calls native `zoomToSelection` after two animation frames
- This is intentionally equivalent to automatically doing the "Back to content" action for the newly imported media.
- Direct small-file upload now retries once for non-abort errors.
- Abort/cancel is reported as `Upload canceled.` instead of `Upload failed: ...`.

Verification:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 7/7 tests.
- `npm run build`: passed.
- Local server restarted at `http://127.0.0.1:5176/`.
- HTTP probe returned `200 OK`.

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Upload a small video.
- The viewport should end centered on the imported video, without needing to click "Back to content".
- Upload a larger chunked video.
- The viewport should also end centered on the imported video after upload completes.
- If a file picker/upload is canceled or superseded, the status should not show a scary failure unless a real upload error happened.

Next plan:

- If video upload viewport behavior is accepted, return to Phase 1 provider execution work.
- Add provider/request-mode control through the Codex skill/command path.
- Start wiring the real Atlas executor behind the already validated `providerPayloads.atlas`.

## Phase 1.9 update

Date: 2026-06-26

Goal:

```text
Start the tldraw Agent Starter migration without adopting its self-built chat panel.
Keep Codex as the conversation layer and expose a Codex-to-canvas prompt bridge.
```

Product boundary:

- The official tldraw agent UI proves that canvas selection/area context can be linked to an agent conversation.
- Our product should not copy that chat panel as the primary UX.
- Codex / installable Codex Skill remains the conversation and scenario layer.
- tldraw provides the canvas runtime: selection, frame context, prompt/action execution, and canvas writeback.

Implementation:

- Added a Codex-style command type:
  - `canvas.agent_prompt`
- Added a local HTTP endpoint:
  - `POST /api/agent/prompt`
  - `GET /api/agent/prompt/latest`
- Added the same command to the local MCP server as:
  - `canvas.agent_prompt`
- The browser polling loop now treats both of these as executable canvas intents:
  - `canvas.create_version`
  - `canvas.agent_prompt`
- `canvas.agent_prompt` can pass:
  - `prompt`
  - `frameId`
  - `outputMediaType`
  - `generationMode`
- The generated provider request now preserves the Codex/Skill prompt and appends canvas annotation text under `Canvas annotations:` when both exist.

Why this matters:

- This is the first concrete bridge from:

```text
Codex Skill / Codex chat
→ canvas.agent_prompt
→ bounded frame context
→ provider-ready generation request
→ executor
→ canvas writeback with lineage
```

- It keeps the official starter's useful agent pattern while avoiding a product pivot into a separate in-canvas chat app.

Validation:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 8/8 tests.
- `npm run build`: passed.
- Local server restarted at `http://127.0.0.1:5176/`.
- HTTP probe returned `200 OK` for:
  - `/`
  - `/api/agent/prompt/latest`

Manual acceptance checklist:

- Keep `http://127.0.0.1:5176/` open.
- Select or keep a frame on the canvas.
- Send:

```bash
curl -X POST http://127.0.0.1:5176/api/agent/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Create a premium revised version from this frame.","outputMediaType":"image"}'
```

- The canvas should create a generated version near the source/frame.
- The latest generation request should include the Codex prompt.
- If the frame also has annotations, the prompt should include both the Codex instruction and the canvas annotation text.

Next plan:

- Promote bounded frame context into an explicit prompt-part-shaped module.
- Add a dedicated `generate-media` action contract instead of overloading `create_version`.
- Continue wiring Atlas behind the existing provider executor boundary.

## Phase 1.10 update

Date: 2026-06-26

Goal:

```text
Review the Codex-to-canvas prompt run, then turn the current implementation into a clearer prompt-part/action-contract shape.
```

Review:

- Latest generation request is valid.
- It used the Codex prompt:
  - `Create a premium revised version from this frame.`
- It preserved canvas annotation text under:
  - `Canvas annotations:`
- It resolved the bounded task frame:
  - `shape:task-frame`
  - `Product hero edit task`
- It resolved the source media:
  - `shape:source-media`
  - `.codex-media-canvas/assets/images/source-product-Source-product-image.svg`
- It produced an `image_edit` request and wrote a child canvas shape plus lineage arrow.
- The operation log confirms the full sequence:

```text
agent.prompt.enqueued
→ frame-context.updated
→ generation.requested
→ generation.executed
→ version.created
```

Implementation:

- Added `agentPromptParts.ts`.
- Added `buildBoundedFrameContextPromptPart(...)`.
- Added `mediaActionContract.ts`.
- Added explicit `generate-media` action contract.
- The browser generation path now flows as:

```text
FrameContext
→ bounded_frame_context prompt part
→ generate-media action
→ ProviderReadyGenerationRequest
→ executor
→ canvas writeback
```

- The action contract is now the migration seam for the official tldraw agent starter style:
  - prompt parts
  - action schemas
  - action utils
  - provider execution
- `canvas.create_version` and `canvas.agent_prompt` still work as external command triggers, but internally they now converge into `generate-media`.

Atlas/provider boundary:

- The current executor still creates `providerPayloads.atlas`.
- If `ATLAS_PROVIDER_ENDPOINT` or `REAL_PROVIDER_ENDPOINT` is configured, the server attempts a real external provider call.
- In the current local run, the executor correctly reports:
  - `externalExecution.status = skipped`
  - `reason = No provider endpoint configured.`
- This is expected and should not be treated as a failed Atlas call.

Validation:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm run build
npm test
```

Results:

- `npm run build`: passed.
- `npm test`: passed, 9/9 tests.

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Run another `POST /api/agent/prompt` request.
- Confirm a generated version still appears on the board.
- Confirm `.codex-media-canvas/logs/operations.jsonl` contains `generateMediaAction` inside the `version.created` operation.
- Confirm latest generation request still includes:
  - Codex prompt
  - canvas annotations
  - source media reference
  - `providerPayloads.atlas` in latest execution result

Next plan:

- Convert `generate-media` from a local contract into an official-starter-style action util boundary.
- Add provider selection/policy to the action input.
- Replace mock output with real Atlas executor when endpoint/key are available.

## Phase 1.11 update

Date: 2026-06-26

Goal:

```text
Move generate-media closer to an official-starter-style action util boundary and add provider selection/policy.
```

Implementation:

- Added `GenerateMediaActionUtil`.
- `GenerateMediaActionUtil.create(...)` creates a structured `generate-media` action.
- `GenerateMediaActionUtil.toGenerationRequest(...)` converts that action into `ProviderReadyGenerationRequest`.
- Added provider policy to `generate-media` actions:
  - `preferredProvider`
  - `fallbackProviders`
  - `allowMockFallback`
- Added provider selection to:
  - `canvas.agent_prompt`
  - `canvas.create_version`
  - local MCP server schemas
  - local HTTP command payloads
- Supported provider ids:
  - `mock-provider`
  - `atlas`
  - `seedance`
  - `kling`
- The local executor now chooses the external provider payload based on `request.provider`.

Provider endpoint behavior:

- `atlas` uses:
  - `ATLAS_PROVIDER_ENDPOINT`
  - `ATLAS_PROVIDER_API_KEY`
- `seedance` uses:
  - `SEEDANCE_PROVIDER_ENDPOINT`
  - `SEEDANCE_PROVIDER_API_KEY`
- `kling` uses:
  - `KLING_PROVIDER_ENDPOINT`
  - `KLING_PROVIDER_API_KEY`
- All can fall back to:
  - `REAL_PROVIDER_ENDPOINT`
  - `REAL_PROVIDER_API_KEY`
- If no endpoint is configured, execution remains local/mock and reports a clear skipped external execution.

Validation:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm run build
npm test
```

Results:

- `npm run build`: passed.
- `npm test`: passed, 10/10 tests.
- Local server restarted at `http://127.0.0.1:5176/`.
- HTTP probe returned `200 OK`.

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Run:

```bash
curl -X POST http://127.0.0.1:5176/api/agent/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Create a premium revised version from this frame.","provider":"atlas","outputMediaType":"image"}'
```

- Confirm latest generation request has:
  - `provider: "atlas"`
  - `providerPayloads.atlas`
  - `generateMediaAction.providerPolicy.preferredProvider: "atlas"` in the operation log
- If Atlas endpoint is not configured, latest execution result should still say external execution is skipped rather than failed.

Next plan:

- Extract provider execution from `server.mjs` into a dedicated executor module.
- Add a real Atlas executor request/response adapter once the exact Atlas endpoint contract is confirmed.
- Add result materialization rules for real provider outputs instead of only mock SVG/MP4 placeholders.

## Phase 1.12 update

Date: 2026-06-26

Goal:

```text
Stop the migration from feeling abstract by writing down the current architecture, what is real, what is mock, and the next visible provider loop.
```

Deliverable:

- Added `docs/current-status-and-next-loop.md`.

Key clarification:

- We are building a Codex-driven media canvas.
- tldraw provides canvas runtime.
- Codex remains the conversation / Skill layer.
- The official tldraw agent starter influences prompt parts and action utils, not the product UI.
- The next implementation should focus on a visible Atlas/provider loop rather than more invisible abstractions.

Next plan:

- Extract provider execution from `server.mjs` into `coflow/lib/provider-executor.mjs`.
- Preserve current mock output behavior.
- Make latest execution metadata clearly distinguish:
  - mock execution;
  - skipped external provider because endpoint is missing;
  - failed external provider;
  - succeeded external provider.

## Phase 1.13 update

Date: 2026-06-26

Goal:

```text
Extract provider execution from server.mjs into a dedicated module while preserving the current canvas writeback behavior.
```

Implementation:

- Added `coflow/lib/provider-executor.mjs`.
- Moved provider-specific logic out of `server.mjs`:
  - provider job construction;
  - Atlas / Seedance / Kling payload construction;
  - provider endpoint selection;
  - API key selection;
  - external provider fetch;
  - skipped / failed / succeeded external execution status.
- `server.mjs` now calls `prepareProviderExecution(request)` and remains responsible for:
  - mock output file writing;
  - preview generation;
  - latest execution metadata;
  - canvas-facing response.
- Latest execution result now includes:
  - `selectedProvider`
  - `selectedProviderPayload`
  - `externalExecution.endpointConfigured`

Validation:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm run build
npm test
```

Results:

- `npm run build`: passed.
- `npm test`: passed, 12/12 tests.
- Local server restarted at `http://127.0.0.1:5176/`.
- HTTP probe returned `200 OK`.

Manual acceptance checklist:

- Refresh `http://127.0.0.1:5176/`.
- Run:

```bash
curl -X POST http://127.0.0.1:5176/api/agent/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Create a premium revised version from this frame.","provider":"atlas","outputMediaType":"image"}'
```

- Confirm canvas still writes a generated preview back.
- Confirm latest execution result contains:
  - `selectedProvider: "atlas"`
  - `selectedProviderPayload.task: "media_generation"`
  - `externalExecution.status: "skipped"`
  - `externalExecution.endpointConfigured: false`

Next plan:

- Define the exact Atlas request/response adapter contract.
- Add `lib/providers/atlas.mjs` once the endpoint contract is confirmed.
- Add materialization support for remote provider output URLs.

## Phase 1.14 update

Date: 2026-06-26

Goal:

```text
Integrate the real Atlas Cloud media generation API behind provider=atlas.
```

Implementation:

- Added `coflow/lib/providers/atlas.mjs`.
- `provider=atlas` now uses the official Atlas Cloud media API:
  - `POST https://api.atlascloud.ai/api/v1/model/uploadMedia`
  - `POST https://api.atlascloud.ai/api/v1/model/generateImage`
  - `POST https://api.atlascloud.ai/api/v1/model/generateVideo`
  - `GET https://api.atlascloud.ai/api/v1/model/prediction/{id}`
- The adapter reads:
  - `ATLASCLOUD_API_KEY`
  - optional `ATLASCLOUD_API_BASE_URL`
  - optional model overrides:
    - `ATLASCLOUD_IMAGE_TEXT_MODEL`
    - `ATLASCLOUD_IMAGE_EDIT_MODEL`
    - `ATLASCLOUD_VIDEO_TEXT_MODEL`
    - `ATLASCLOUD_VIDEO_IMAGE_MODEL`
  - optional output params:
    - `ATLASCLOUD_IMAGE_SIZE`
    - `ATLASCLOUD_VIDEO_DURATION`
    - `ATLASCLOUD_VIDEO_ASPECT_RATIO`
    - `ATLAS_POLL_ATTEMPTS`
    - `ATLAS_POLL_INTERVAL_MS`
- Local reference media is uploaded to Atlas before generation.
- Atlas prediction output URLs are downloaded back into `.codex-media-canvas/assets/...`.
- Image outputs are used directly as canvas previews.
- Video outputs are saved locally while keeping the current SVG preview placeholder.
- If `ATLASCLOUD_API_KEY` is missing, Atlas execution returns:
  - `status: "skipped"`
  - `endpointConfigured: false`
  - `reason: "ATLASCLOUD_API_KEY is not configured."`

Default model choices:

- Text-to-image:
  - `bytedance/seedream-v5.0-lite`
- Image edit:
  - `bytedance/seedream-v5.0-lite/edit`
- Text-to-video:
  - `kwaivgi/kling-v3.0-std/text-to-video`
- Image-to-video:
  - `kwaivgi/kling-v3.0-std/image-to-video`

These can and should be overridden with env vars if a specific Atlas model is desired.

Validation:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
npm test
npm run build
```

Results:

- `npm test`: passed, 14/14 tests.
- `npm run build`: passed.
- Local server restarted at `http://127.0.0.1:5176/`.
- HTTP probe returned `200 OK`.
- Current shell reports `ATLASCLOUD_API_KEY=missing`, so manual Atlas generation will currently verify the skipped path unless the server is restarted with the key.

Manual acceptance checklist:

1. Start server with key:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/coflow
ATLASCLOUD_API_KEY="..." npm run serve
```

2. In another terminal:

```bash
curl -X POST http://127.0.0.1:5176/api/agent/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Create a premium revised version from this frame.","provider":"atlas","outputMediaType":"image"}'
```

Expected with key:

- local reference image uploads to Atlas;
- Atlas image generation task is submitted;
- prediction is polled;
- output URL is downloaded into `.codex-media-canvas/assets/images/`;
- latest execution result has `providerOutput.materialized: true`;
- canvas generated preview uses the local materialized image.

Expected without key:

- canvas still writes mock preview;
- latest execution result says Atlas external execution is skipped because `ATLASCLOUD_API_KEY` is missing.

Next plan:

- Add UI/status visibility so the canvas says whether a result is mock, Atlas skipped, Atlas processing, failed, or materialized.
- Add async long-running job support for video so the browser does not block for the whole generation duration.

## 2026-06-26 — Fix Atlas image-edit context pollution and misleading preview placeholder

User report:

- `latest-generation-request.json` looked structurally correct, but the canvas output did not follow the source image and annotations.
- Canvas first showed a preset-looking generated image placeholder, then later replaced it with an unrelated Atlas output.

Root cause:

- Native tldraw note props were normalized with a hardcoded seeded fallback text: `Make this area cleaner and more premium.`
- This meant a user note like `make her hair pink` could still be serialized into the generation request as the old seeded product-note copy.
- The canvas child preview used a fake “Generated version” image before the provider result arrived, which looked like an actual model output.
- Atlas image edit prompt was too permissive for reference-image editing; it did not explicitly require preserving the source image.

Changes made:

- Added real tldraw rich-text extraction via `richTextToPlainText`.
- `normalizeProps` now preserves actual note text and no longer hardcodes seeded copy.
- Replaced the preset-looking generated image placeholder with a neutral `Generating image/video…` placeholder.
- Wrapped Atlas reference image-edit prompts with preservation instructions:
  - preserve subject, identity, pose, composition, and background unless explicitly annotated;
  - do not replace the image with an unrelated product, web page, scene, or layout.
- Added regression tests for native note rich-text extraction and Atlas image-edit prompt wrapping.
- Verified Atlas public model list still contains the configured default models:
  - `bytedance/seedream-v5.0-lite/edit`
  - `bytedance/seedream-v5.0-lite`
  - `kwaivgi/kling-v3.0-std/image-to-video`
  - `kwaivgi/kling-v3.0-std/text-to-video`

Verification:

- `npm test`: passed, 15/15.
- `npm run build`: passed.

Manual acceptance checklist:

1. Restart the local server with `ATLASCLOUD_API_KEY`.
2. Put a source image and a note such as `make her hair pink` inside a selected frame.
3. Trigger Atlas image generation from Codex or frame action.
4. Open `.codex-media-canvas/metadata/latest-generation-request.json`.

Expected:

- `instructions.prompt` contains the actual note text, e.g. `make her hair pink`.
- The canvas child preview initially says `Generating image…`, not a fake completed image.
- `.codex-media-canvas/metadata/latest-execution-result.json` shows Atlas received the wrapped edit prompt and the uploaded source `image_url`.
- The visual output should preserve the source image and apply the annotated edit. If Atlas still returns unrelated content after this fix, the next debugging target is model-specific image-edit parameter schema or selecting a stricter edit model.

Next plan:

- Add visible provider execution status on the generated child card: queued, uploading references, submitted, polling, materialized, failed/skipped.
- Add a debug affordance to open the exact generation request/result from the canvas.
- If unrelated Atlas edits still happen, query model-specific schema and add model override UI/config for stricter image-edit models.

## 2026-06-26 — Persist local provider config and freeze runtime interface boundaries

User question:

- Why does the server require typing `ATLASCLOUD_API_KEY=... npm run serve` after every restart?
- Re-check the tldraw refactor runtime boundary so canvas media, local storage, Codex input/output, and provider requests do not become mixed logic.

Root cause:

- `ATLASCLOUD_API_KEY=... npm run serve` only sets an environment variable for that single process.
- The server had no local `.env.local` loader, so a restarted process had no provider key unless it was typed again.
- Runtime responsibilities were spread across browser code, server endpoints, MCP command queue, provider executor, and metadata files without one concise interface contract.

Changes made:

- Server now loads local env files before reading provider config:
  - project root `.env.local`
  - `coflow/.env.local`
  - project root `.env`
- Added `.gitignore` to exclude `.env*` and `.codex-media-canvas/`.
- Added `coflow/.env.local.example`.
- Renamed internal execution function from `runMockExecutor` to `runGenerationExecutor`.
- Added `mockFallback` to execution results so mock fallback is explicit.
- Canvas generated child title now says `Generated image output` for real provider results and `Mock fallback image` only for fallback.
- Added runtime interface contract doc:
  - `docs/runtime-interface-contract.md`

Verification:

- `node --check server.mjs`: passed.
- `npm test`: passed, 15/15.
- `npm run build`: passed.

Manual acceptance checklist:

1. Create `.env.local` once:

```bash
cp coflow/.env.local.example .env.local
```

2. Put the real key into `.env.local`:

```bash
ATLASCLOUD_API_KEY=...
```

3. Restart with only:

```bash
cd coflow
npm run serve
```

Expected:

- Server logs `Atlas provider key: configured`.
- You no longer need to type the key in every restart command.
- `latest-execution-result.json` never contains the key.
- If Atlas is configured and succeeds, generated child card title is `Generated image output`.
- If Atlas is missing/skipped, result contains `mockFallback: true` and child title says `Mock fallback image`.

Follow-up incident:

- User filled `.env.local` correctly, but restart still failed with `EADDRINUSE`.
- Root cause was a stale Node process occupying `127.0.0.1:5176`, not an Atlas key problem.
- Stopped stale PIDs and restarted the updated server.
- Server now prints a friendly `EADDRINUSE` message with the exact `lsof` check and alternate `PORT=5177 npm run serve` fallback.
- Server also prints a friendly `EPERM` message when Codex sandbox cannot bind local ports.
- Current local probe returned `200`, and startup logs show `Atlas provider key: configured`.

## 2026-06-26 — Fix frame generate default provider still using mock

User report:

- After `.env.local` was configured and server showed `Atlas provider key: configured`, frame generation still produced a `Mock fallback image`.

Root cause:

- The browser/frame-action path did not pass an explicit provider.
- `createGenerateMediaAction` and `createProviderReadyGenerationRequest` still defaulted provider to `mock-provider`.
- Therefore `latest-generation-request.json` contained:
  - `provider: "mock-provider"`
  - correct prompt/annotations
- The mock output was not an Atlas failure; Atlas was never selected for that request.

Changes made:

- Default provider changed to `atlas` in:
  - `src/mediaActionContract.ts`
  - `src/generationContract.ts`
  - matching `dist-contracts/*` files
- Explicit `provider: "mock-provider"` remains supported for local fallback tests.
- MCP tool descriptions now say Atlas is the default and mock is only for fallback tests.
- Added regression assertions that default generate-media actions produce `provider: "atlas"` and fallback list `["mock-provider"]`.

Verification:

- `npm test`: passed, 15/15.
- `npm run build`: passed.
- `node --check server.mjs && node --check mcp-server.mjs`: passed.
- Restarted local server at `http://127.0.0.1:5176/`.
- Startup logs show `Atlas provider key: configured`.

Manual acceptance checklist:

1. Refresh the browser page to load the new bundle.
2. Select the horse frame and click generate.
3. Check `.codex-media-canvas/metadata/latest-generation-request.json`.

Expected:

- `request.provider` is `atlas`.
- The generated child card initially says `Generating image…`.
- If Atlas succeeds, child title becomes `Generated image output`.
- If it still falls back, `latest-execution-result.json` should show `provider: "atlas"` plus the Atlas failure/skipped reason, not `provider: "mock-provider"`.

## 2026-06-26 — Return canvas UI from debug spike to user-facing shape

User report:

- Atlas generation now succeeds, but the board still looks like a debug spike:
  - generated image cards are stamped with title/provider text;
  - the generating placeholder is visually heavy and provider-branded;
  - the right-side `canvas.get_frame_context` JSON panel is still visible;
  - the next work should return to the project goal and product docs.

Changes made:

- Removed the generated/source media bottom label overlay from custom media shapes.
- Simplified the generating placeholder to a plain white card with only `Generating image…` / `Generating video…`.
- Removed the black right-side debug JSON panel and `Read frame context` debug button from the normal UI.
- Converted the app layout back to full-screen canvas.
- Kept a small, non-interactive status pill for lightweight runtime feedback.
- Added provider/model defaults and UI metadata rules to `docs/runtime-interface-contract.md`.

Current built-in provider/model policy:

- Default provider: `atlas`.
- Real connected provider: `atlas`.
- Stub/custom provider ids: `seedance`, `kling`.
- Local fallback/test provider: `mock-provider`.
- Default image edit model: `bytedance/seedream-v5.0-lite/edit`.
- Default text-to-image model: `bytedance/seedream-v5.0-lite`.
- Default image/reference-to-video model: `kwaivgi/kling-v3.0-std/image-to-video`.
- Default text-to-video model: `kwaivgi/kling-v3.0-std/text-to-video`.

Verification:

- `npm test`: passed, 15/15.
- `npm run build`: passed.
- `node --check server.mjs && node --check mcp-server.mjs`: passed.
- Restarted local server at `http://127.0.0.1:5176/`.
- Startup logs show `Atlas provider key: configured`.

Manual acceptance checklist:

1. Refresh the browser page.
2. Generate from a frame.

Expected:

- No right-side black JSON debug panel.
- Generated images do not show provider/title/prompt text stamped over the image.
- The waiting card is a simple `Generating image…` card.
- Provider/model/prompt remain inspectable through local JSON now, and later should move into a Lovart-style hover/open asset info panel.

Next plan:

- Build the asset info affordance on generated media hover/selection.
- Add provider execution status states without turning the whiteboard into a debug console.
- Re-center the next implementation loop on the core product goal: bounded frame/selection → Codex Skill action → provider generation → clean writeback → lineage/metadata.

## 2026-06-26 — Clarify Codex orchestration phase, seed frame, seeded status, and default models

User questions:

- Is Codex actually linked with the whiteboard now? Does Codex receive the request and generate when clicking generate?
- The preset frame should fully include the source image and sticky note.
- What is the top seeded status bar for?
- Default models should be GPT Image 2 and Seedance 2.0.

Clarification:

- Current frame-button generation is linked to the local server/provider executor, not yet to Codex as a required agent orchestration layer.
- The browser extracts frame context, builds the request, calls the local executor, and writes the output back.
- The Codex/MCP command path already exists through `canvas.agent_prompt` / `canvas.create_version`, but the frame button does not yet force Codex to receive/plan every request.
- Original roadmap:
  - Phase 0/1: prove frame context, action request, provider execution, clean canvas writeback.
  - Migration plan Phase E / broader roadmap Phase 2: make Codex Skill the primary user-facing orchestration path.
  - Phase 3: strengthen Atlas/provider routing and lineage.

Changes made:

- Removed the initial `Seeded: media shape + native annotations + task frame` status pill.
- Enlarged the preset task frame so it fully contains the seeded source image, annotation box, and sticky note.
- Changed Atlas default image models to GPT Image 2:
  - image edit: `openai/gpt-image-2/edit`
  - text-to-image: `openai/gpt-image-2/text-to-image`
- Changed Atlas default video models to Seedance 2.0:
  - text-to-video: `bytedance/seedance-2.0/text-to-video`
  - reference/image-to-video: `bytedance/seedance-2.0/reference-to-video`
- Verified these model ids are currently public in Atlas model list with `display_console: true`.
- Updated `.env.local.example` and `docs/runtime-interface-contract.md`.

Next plan:

- Stop treating the frame button as the long-term primary architecture.
- Implement the Codex Skill/MCP orchestration loop so frame actions become shortcuts that ask Codex/active skill to execute, rather than bypassing Codex.
- Keep the whiteboard as visual context and clean writeback surface, not a model/provider control panel.

## 2026-06-26 — Replace ugly loading card and stop processing jobs from becoming mock outputs

User feedback:

- The generating placeholder was visually too crude and clipped inside the output shape.
- A generation that was still processing eventually appeared as a dark mock-looking output, which made it look like generation completed incorrectly.

Root cause:

- The browser correctly created an immediate placeholder while waiting for `/api/executions/run-latest`.
- The Atlas prediction in the latest recorded run was still `processing` after the previous polling window.
- The local executor treated "no provider output yet" as "write mock fallback" even when Atlas was configured and still processing.
- This collapsed three different states — real success, still processing, and local mock fallback — into one misleading canvas writeback.

Changes made:

- Replaced the large text/spinner placeholder with a lightweight Lovart-style skeleton SVG:
  - white card
  - soft shimmer blocks
  - no big cropped text
  - no provider/debug stamp
- Kept generated media display at `object-fit: contain` so placeholders and real outputs are not cropped by the shape.
- Increased Atlas polling window in the provider adapter:
  - image: up to 100 attempts
  - video: up to 160 attempts
  - default interval remains 3 seconds
- Added explicit executor states:
  - `succeeded`: provider output was materialized into local asset storage
  - `processing`: provider is still running; keep a non-final skeleton preview instead of mock output
  - `failed`: provider failed or output materialization failed; keep a failed-state preview
- Changed `mockFallback` to mean only a deliberate local mock fallback, e.g. provider skipped/not configured, not provider still processing.
- Updated the front-end writeback title/status logic so `processing` and `failed` are visible as non-final states.

Verification:

- `npm run build`: passed.
- `npm test`: passed, 15/15.
- `node --check server.mjs && node --check mcp-server.mjs`: passed.
- Restarted local server at `http://127.0.0.1:5176/`.
- Server startup logs show `Atlas provider key: configured`.

Manual acceptance checklist:

1. Refresh `http://127.0.0.1:5176/`.
2. Use a frame that fully contains the source image and the text/note annotation.
3. Click `Generate`.

Expected:

- The temporary generated shape shows a subtle skeleton placeholder, not the old large `Generating image...` card.
- The placeholder is not cropped.
- If Atlas finishes within the poll window, the shape is replaced by the real image.
- If Atlas is still processing after the poll window, the shape remains a non-final skeleton state and the status pill says it is still generating.
- It should not write the dark mock image unless the provider is actually skipped/not configured.

Next plan:

- Fix prompt/context extraction if plain text or annotation text inside a frame is not entering `providerPayloads.atlas.prompt`.
- Move this toward the core Codex Skill loop: canvas action should become a shortcut that asks Codex/active Skill to execute, instead of bypassing Codex.
- Add a Lovart-like asset info affordance on hover/selection for prompt, model, references, provider, and lineage metadata.

## 2026-06-26 — Rich text annotations, asset info panel, skill action identity, and git baseline

User request:

- Continue the full next plan.
- Convert the current project directory into a git repository so future iterations are traceable.

Changes made:

- Fixed annotation prompt extraction:
  - Added native `text` shapes to the frame annotation contract.
  - Extracted text from `props.richText` for native text/note/geo/arrow annotation shapes.
  - Kept the extraction in `canvasContracts`, so browser, tests, and future Codex/MCP paths share the same contract.
- Added regression coverage:
  - A frame containing a native image plus native text richText now produces `request.instructions.prompt = "only make her hair pink"`.
  - `GenerateMediaAction` must now carry `skillName = "codex-media-generation"`.
- Added generated media metadata fields:
  - `model`
  - `generationMode`
  - `requestId`
  - `executionId`
  - `status`
  - `skillName`
- Added a minimal Lovart-like selected asset info panel:
  - Appears when selecting a media/image/video shape.
  - Shows prompt, model, provider, mode, status, skill, local path, request id, and execution id when available.
  - Keeps provider/prompt metadata off the generated image itself.
- Strengthened the Skill transition boundary:
  - `GenerateMediaAction` now has a first-class `skillName`.
  - Frame-button generation now queues a `canvas.agent_prompt` command through the local command bus first, then the browser claims that command and executes the `codex-media-generation` action contract.
  - This is the transition version of the Codex Skill loop: the command path is Codex/MCP-shaped, while the local browser still performs the actual bounded canvas writeback.
- Initialized the workspace as a git repository:
  - branch: `main`
  - `.env.local`, `.codex-media-canvas/`, node_modules, dist, `.next`, and local hidden workspace state are ignored.

Verification:

- `npm run build`: passed.
- `npm test`: passed, 16/16.
- `node --check server.mjs && node --check mcp-server.mjs`: passed.
- File-name/line-level secret scan was run with key masking; no real API key was found outside ignored local env/build artifacts.

Manual acceptance checklist:

1. Refresh `http://127.0.0.1:5176/`.
2. Put a native tldraw text annotation inside a frame, e.g. `only make her hair pink`.
3. Generate from that frame.
4. Inspect `.codex-media-canvas/metadata/latest-generation-request.json`.

Expected:

- `providerPayloads.atlas.prompt` includes the real text annotation, not the fallback `Create a new version from frame "Untitled frame".`
- Selecting a generated media shape shows the asset info panel.
- The generated image itself remains clean: no prompt/provider/model text stamped on top.
- Operations include `skillName: "codex-media-generation"`.
- Clicking the frame `Generate` button first enqueues `canvas.agent_prompt`; the browser then picks it up and runs generation shortly after.

Next plan:

- Add a polling/resume path for long-running Atlas jobs, so `processing` outputs can update themselves when Atlas finishes after the initial request window.
- Improve the asset info panel from selected-only to selected-or-hover, without breaking tldraw native pointer interactions.
- Replace the local command-bus handoff with true Codex runtime orchestration once the skill packaging is ready.

## 2026-06-26 — Fix stuck status toast and annotation context loss

User report:

- Upload and generation status toasts stayed visible and did not disappear.
- Atlas returned an unrelated image even though the selected frame contained a source image plus visual/text annotations.
- Clarification needed: whether every object and annotation on the whiteboard is currently used as model input.

Root cause:

- The current product contract is bounded context, not whole-whiteboard context:
  - selected frame / chosen frame is read;
  - media and annotations inside that frame are extracted;
  - unrelated objects elsewhere on the board are intentionally ignored.
- The latest failed generation had a valid source image reference, but the extracted frame context contained only one geometric rectangle and no text prompt.
- Because the text annotation was not included, the provider prompt fell back to a generic frame prompt.
- The provider currently receives:
  - source media reference;
  - structured annotation text / metadata;
  - synthesized text summaries for non-text annotations.
- The provider does not yet receive a rendered visual composite of the full frame, so a drawn box/arrow is only model-visible through structured prompt text unless we add `annotation.render_composite`.

Changes made:

- Status toasts now go through a single `showStatus` helper and auto-dismiss after a short duration.
- Frame context inclusion is less brittle:
  - shapes parented to the frame are included;
  - fully contained shapes are included;
  - shapes whose center point is inside the frame are included;
  - mostly-overlapping edge annotations are included.
- Non-text annotations now contribute useful prompt lines:
  - geometric boxes describe the target region;
  - arrows describe a pointed target region;
  - freehand drawings describe a marked target region.
- Atlas image-edit prompt is stricter:
  - preserve the exact original subject, identity, pose, composition, medium, and style;
  - do not replace an illustration with a photo or a product image with a webpage;
  - apply only the requested frame annotations.
- Added regression tests for edge-crossing annotations and non-text geometric prompt summaries.
- Restarted the local server so the updated server-side Atlas prompt wrapper is active.

Verification:

- `npm test`: passed, 18/18.
- `npm run build`: passed.
- `node --check server.mjs`: passed.
- `node --check mcp-server.mjs`: passed.
- Restarted local server at `http://127.0.0.1:5176/`.
- Server startup logs show `Atlas provider key: configured`.

Manual acceptance checklist:

1. Refresh `http://127.0.0.1:5176/`.
2. Use a frame that contains:
   - one source image;
   - one visible text/note annotation, e.g. `make her hair pink`;
   - optional rectangle/arrow annotations.
3. Click the frame generation affordance.
4. Inspect `.codex-media-canvas/metadata/latest-generation-request.json` and `.codex-media-canvas/metadata/latest-execution-result.json`.

Expected:

- Upload/generation status pill disappears automatically.
- `latest-generation-request.json` includes the source image reference.
- `latest-generation-request.json` prompt includes the text annotation.
- If the frame contains only a box/arrow with no text, the prompt still includes a synthesized target-region description.
- `latest-execution-result.json` uses `provider: "atlas"` and `mockFallback: false` when Atlas succeeds.
- Visual output should preserve the original source subject and apply the annotation. If it still ignores the marked region, the next fix is to send a rendered frame composite or mask to the provider, not more generic prompt text.

Next plan:

- Add `annotation.render_composite`: render the selected frame into an image that includes the source media, arrows, boxes, notes, and spatial layout, then pass it as a visual reference/mask where the provider supports it.
- Add polling/resume for long-running Atlas jobs so processing placeholders can update after the initial request returns.
- Move the current command-bus bridge closer to the final Codex Skill runtime path.

## 2026-06-26 — Stop direct canvas provider execution and return to Codex-led frame context

User report:

- The generated image was unrelated to the source frame.
- The generated image contained the visual red annotation box as image content.
- This proves the problem is not simply weak Atlas prompt wording. The direct canvas-to-provider path is mixing reference media, annotation overlays, and task intent incorrectly.

Decision:

- Abandon direct provider execution from the whiteboard button as the product main path.
- Return to the intended Cowart-like shape:
  - tldraw canvas is the visual workspace;
  - Codex reads a selected/bounded frame context;
  - Codex/active Skill decides the task, provider, model, prompt, reference strategy, and execution;
  - canvas receives structured writeback/version operations.
- Atlas remains a provider executor, but it should be invoked by Codex/Skill, not by a canvas button that bypasses Codex.

Changes made:

- Removed automatic browser polling of pending `canvas.agent_prompt` / `canvas.create_version` commands.
- The selected frame button no longer runs generation or calls `/api/executions/run-latest`.
- The selected frame button now says `Send to Codex`.
- Clicking it only:
  - extracts the selected frame context;
  - materializes media paths;
  - writes `.codex-media-canvas/metadata/latest-frame-context.json`;
  - records `codex.frame_context_sent` in the operation log;
  - shows a status message with media + annotation counts.
- Updated `/api/agent/prompt` response copy so it no longer claims the browser will auto-claim and execute provider calls.

Current boundary:

- The canvas can expose a bounded frame context for Codex.
- The canvas does not yet make Codex itself natively read a clicked frame inside the chat runtime.
- The remaining bridge is local metadata / future MCP:
  - `latest-frame-context.json`
  - operation log
  - future `canvas.get_frame_context(frameId)` tool.

Verification:

- `npm run build`: passed.
- `npm test`: passed, 18/18.
- `node --check server.mjs`: passed.

Manual acceptance checklist:

1. Refresh `http://127.0.0.1:5176/`.
2. Select a frame.
3. Confirm the frame affordance says `Send to Codex`, not `Generate`.
4. Click it.
5. Confirm no generated image, skeleton, Atlas output, or lineage arrow is created.
6. Confirm `.codex-media-canvas/metadata/latest-frame-context.json` updates with the selected frame's media and annotations.

Next plan:

- Implement the real Codex-facing contract:
  - `canvas.get_frame_context(frameId?)`;
  - `canvas.capture_frame(frameId?)`;
  - `canvas.create_version(...)`.
- Package this as a Codex agent Skill/MCP bridge instead of a whiteboard API button.
- Use Atlas only behind the Codex Skill executor after Codex has correctly selected source assets, prompt, references, and writeback semantics.

## 2026-06-26 — Close the canvas/Codex/writeback bridge instead of stopping at context export

User report:

- Merely exporting frame context is not enough. Cowart/tldraw agent patterns already prove that the canvas-agent loop should be closed.
- The intended loop is: canvas frame → Codex/Skill → generated result → canvas writeback.

Changes made:

- Added a first-class Codex frame request:
  - browser endpoint: `POST /api/codex/frame-requests`;
  - latest request endpoint: `GET /api/codex/frame-requests/latest`;
  - metadata file: `.codex-media-canvas/metadata/latest-codex-frame-request.json`;
  - operation log event: `codex.frame_request.created`.
- `Send to Codex` now publishes both:
  - latest frame context;
  - latest Codex frame request with a default instruction for Codex/Skill.
- Updated MCP server tools:
  - `canvas.get_frame_context`: read latest bounded frame context;
  - `canvas.get_frame_request`: read latest user-triggered frame request;
  - `canvas.create_version`: write a Codex-generated media result back to the canvas.
- Reframed `canvas.create_version`:
  - it no longer means "ask the browser to generate";
  - it now means "Codex has generated something; place it as a child version on the board."
- Restored browser polling only for `canvas.create_version` writeback commands.
- Added type-filtered command claiming:
  - browser claims only `canvas.create_version`;
  - `canvas.agent_prompt` or other Codex-side commands are not accidentally swallowed.
- Canvas writeback now:
  - places generated media to the right of the source frame;
  - creates a lineage arrow from source media to child version;
  - stores prompt/provider/model/status metadata on the generated media shape;
  - records `codex.version_placed`.

Current honest boundary:

- The local bridge is now structurally closed.
- The browser still cannot directly wake up the current Codex desktop chat process by itself.
- Full automatic click-to-Codex execution requires registering this bridge as a Codex MCP/Skill or running a local Codex worker.
- Until that wiring is registered, the practical loop is:
  1. user clicks `Send to Codex`;
  2. Codex reads `canvas.get_frame_request` / `canvas.get_frame_context`;
  3. Codex generates using the active Skill/provider;
  4. Codex calls `canvas.create_version`;
  5. browser polls the writeback command and places the result.

Verification:

- `npm run build`: passed.
- `npm test`: passed, 18/18.
- `node --check server.mjs`: passed.
- `node --check mcp-server.mjs`: passed.
- Restarted local server at `http://127.0.0.1:5176/`.

Manual acceptance checklist:

1. Refresh `http://127.0.0.1:5176/`.
2. Select a frame and click `Send to Codex`.
3. Confirm `.codex-media-canvas/metadata/latest-codex-frame-request.json` is created or updated.
4. Queue a `canvas.create_version` command through MCP or `POST /api/commands`.
5. Confirm the browser places the generated media to the right of the frame and creates a lineage arrow.

Next plan:

- Register the bridge as a Codex MCP/Skill so this chat can call `canvas.get_frame_request`, `canvas.get_frame_context`, and `canvas.create_version` directly.
- Add `canvas.capture_frame(frameId?)` so Codex can inspect an exact visual crop of the bounded frame, not only structured JSON.
- Move Atlas/GPT Image 2/Seedance execution behind the Codex Skill runner, never behind the canvas button.

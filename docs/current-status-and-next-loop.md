# Current Status and Next Visible Loop

Date: 2026-06-27

## 1. Stage verdict

We are now at **Phase 1 RC: Image Annotation Edit Loop**.

Phase 0 / 0.5 / 0.6 are closed as implementation spikes. The remaining Phase 1 work is acceptance hardening, not redefining the product shape.

The project is no longer trying to prove that the browser canvas can call a provider API directly. That path produced confusing source/reference handling and drifted away from the product goal.

The canonical product loop is now:

```text
User frames or selects media + annotations
→ canvas exports structured context and optional screenshot
→ Codex / active agent skill reads Frame Input
→ Codex chooses the right image/video/3D skill and provider
→ Codex writes the generated media back to canvas
→ canvas places the result with visible lineage and local metadata
```

The canvas is a **visual context container and writeback surface**. Codex is the orchestration layer.

## 2. What is real now

- Native tldraw canvas with mostly native tldraw UI.
- Default board opens blank.
- Local image/video upload into `.codex-media-canvas/assets`.
- Chunked upload for large media.
- Bounded frame context extraction based on geometry, not only tldraw parent/child nesting.
- Selection publishing for Codex tools.
- Frame `Send to Codex` button.
- Frame screenshot artifact saved under `.codex-media-canvas/frame-screenshots`.
- Hidden Frame Input JSON saved under `.codex-media-canvas/frame-inputs`.
- MCP-style tools for:
  - `canvas.get_selection`
  - `canvas.get_frame_context`
  - `canvas.get_frame_request`
  - `canvas.get_frame_input`
  - `canvas.get_frame_screenshot`
  - `canvas.capture_frame`
  - `canvas.capture_selection`
  - `canvas.get_asset`
  - `canvas.insert_media`
  - `canvas.create_version`
  - `canvas.link_versions`
  - `canvas.agent_prompt`
- Canvas writeback command polling for generated media placement.
- Visible lineage arrow from source frame/context to generated result.
- Floating annotation arrows that avoid tldraw target bindings.
- Local canvas persistence with page snapshot, manifest, view state, and backups.
- Active Skill Session metadata under `.codex-media-canvas/metadata/active-skill-session.json`.
- Minimal active-skill indicator in the canvas.
- Frame action always keeps `Send to Codex`; `Generate version` is added only when active skill `autoRun` is enabled.
- Active skill execution now routes to the real provider boundary by default (`atlas`), and must fail visibly instead of inserting mock media.
- Phase 1 image loop is now executable: frame + image + native annotations → active image Skill → Atlas / GPT image 2 edit → local output materialization → native tldraw image asset writeback → visible lineage arrow.
- `Generate version` immediately enters a visible generating state and disables repeat clicks for the active frame until the run finishes.
- Default media generation actions no longer allow mock fallback unless `mock-provider` is explicitly selected for tests.

## 3. What changed in Phase 0.5

### 3.1 Persistence is no longer a single fragile file only

The canvas still keeps a legacy compatibility file, but Phase 0.5 now writes a more explicit local store:

```text
.codex-media-canvas/
  canvas/
    manifest.json
    document.json                  # legacy compatibility snapshot
    view-state.json
    backups/
    pages/
      <page-id>/
        canvas.json
  assets/
  frame-inputs/
  frame-screenshots/
  metadata/
  logs/
  commands/
```

This follows the Cowart/tldraw direction more closely: document state, view state, media assets, frame inputs, and request metadata should not be mixed into one ambiguous artifact.

### 3.2 `Send to Codex` is the default bridge

Default behavior:

```text
Send to Codex
→ save frame screenshot artifact
→ save Frame Input JSON
→ publish latest frame request
→ wait for Codex/user instruction
```

This button should not spend generation credits on its own.

### 3.3 `Generate version` returns only inside active skill mode

Current Phase 1 behavior:

```text
Active skill / auto-run mode is on
→ user frames media + annotations
→ Generate version
→ canvas publishes fresh Frame Input with ready_to_execute status
→ active Codex skill reads frame input
→ active skill infers the generation mode
→ real provider execution runs outside the browser canvas
→ canvas writeback
```

This preserves the low-friction Lovart/Cowart-style editing loop without turning the canvas into a provider form.

Important boundary:

- Phase 1 uses the real provider boundary for active skill execution.
- If provider credentials are missing or the provider fails, the canvas must show failure instead of inserting a mock image/video.
- Real generation remains a Codex Skill/provider responsibility, not a browser canvas responsibility.

### 3.4 Image/video generation and editing are skills

The project should expose generation/editing as Codex agent skills, for example:

- image generation
- image edit
- video generation
- reference-to-video
- video frame revision
- 3D generation / revision

Those skills share the same canvas contract instead of each adding new whiteboard buttons.

## 4. Phase 1 primary loop to validate

```text
1. Open the blank canvas.
2. Upload or place media.
3. Add annotations with notes/arrows/boxes.
4. Frame the task region.
5. Activate codex-media-canvas-image, or keep an existing active image Skill session.
6. Click Generate version on the frame.
7. Browser publishes a fresh Frame Input and frame screenshot.
8. Active image Skill reads the Frame Input and calls the real provider.
9. Server materializes the provider result into local assets.
10. Browser places the result next to the framed context with lineage.
```

Acceptance for Phase 1:

- Codex can tell exactly which frame/selection is active.
- Frame Input contains local/absolute asset paths, object ids, bounds, and annotation text.
- Frame screenshot is saved as an auxiliary artifact, even if system clipboard copy fails.
- Canvas reload preserves object positions.
- Image edits use the source asset and frame annotations; annotations/UI chrome must not appear in the generated result.
- Generated image results are written as native tldraw `asset` + `image` shape records.
- The original image remains on canvas; the new image appears to the right with visible lineage.
- Missing credentials or provider failure shows an error; it does not insert mock media.
- `Send to Codex` remains available as the context bridge; `Generate version` is active-skill-only.

## 5. What remains incomplete after Phase 1 RC

- `canvas.capture_selection` is currently a first-class structured MCP capture. It returns the latest published selection and can include the latest matching Frame Input / frame screenshot artifacts. It does not yet ask the browser to create a fresh arbitrary selected-region PNG on demand.
- `canvas.link_versions` exists as a separate MCP writeback tool and queues a visible, unbound lineage arrow between two existing shapes.
- Direct provider executor code still exists for debugging/spike history and should be isolated further.
- Active skill session mode is implemented for real provider-backed image/video loops.
- Image and video Skills are packaged as merged intent skills: each skill decides whether the request is text-to-media, reference-to-media, or edit/regeneration.
- 3D skills are not packaged yet.
- Host-level automatic composer attachment is not available; screenshot copy remains best-effort.
- Full tldraw/Cowart-grade snapshot sanitization and multi-page history are not done.
- Video remains Phase 2 scope; video Skill exists, but Phase 1 acceptance is image-only.

## 6. Next implementation plan

### Phase 1 closeout

Status: implementation complete, pending user acceptance with a real image edit.

1. Manual acceptance:
   - activate `codex-media-canvas-image`;
   - frame a source image plus annotation;
   - click `Generate version`;
   - verify the output is relevant, native, local, and linked.

2. Stabilization:
   - confirm plugin MCP process is not stale;
   - keep `dist-contracts` and TS contract source synchronized;
   - isolate debug executor paths from product docs.

3. Move next broad scope to Phase 2:

```text
video asset/frame loop
→ video Skill acceptance
→ first-frame thumbnail/proxy
→ reference-to-video / keyframe-guided regeneration
```

Manual validation:

```bash
curl -X PUT http://127.0.0.1:5176/api/active-skill/session \
  -H 'content-type: application/json' \
  -d '{"skillName":"codex-media-canvas-image","displayName":"Canvas Image Skill","outputMediaType":"image","provider":"atlas","autoRun":true}'
```

Then select a frame containing media and annotations:

```text
Generate version
→ fresh Frame Input saved
→ real provider output materialized locally
→ browser places a generated child media shape next to the frame
→ lineage arrow is drawn
```

Packaged user-facing Skills:

- `codex-media-canvas-open`
- `codex-media-canvas-image`
- `codex-media-canvas-video`

### Phase 2: video loop and official tldraw agent architecture migration

Goal:

- port useful pieces from the official tldraw agent starter:
  - prompt parts;
  - action schemas;
  - action history;
  - structured request lifecycle;
  - selected/context/screenshot parts.
- keep Codex as the conversation layer.
- do not copy the official chat panel as the product entry.

Acceptance:

- bounded frame context is represented as an agent prompt part;
- media generation/editing is an action schema;
- Codex skills can drive the canvas without custom per-button logic.

## 7. Things to avoid

- Do not patch whiteboard elements by inventing custom structures first. For any tldraw canvas element change, inspect the official tldraw source/schema/starter implementation first, then optimize on top of the native `asset` / `shape` / `binding` / `store` model. Custom fields or custom shapes are allowed only when the native schema cannot represent the product need, and the reason must be documented.
- Do not rebuild tldraw chrome unless absolutely necessary.
- Do not create a whiteboard skill marketplace panel.
- Do not make provider/model selection the visible core UI.
- Do not treat API success as product success if source/reference/annotation context is wrong.
- Do not show debug JSON panels in the user-facing canvas.
- Do not use browser-side provider execution as the primary loop.

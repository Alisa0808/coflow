# Current Status and Next Visible Loop

Date: 2026-06-27

## 1. Stage verdict

We are in **Phase 0.5: Storage and Codex Bridge Stabilization**.

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
  - `canvas.get_asset`
  - `canvas.insert_media`
  - `canvas.create_version`
  - `canvas.agent_prompt`
- Canvas writeback command polling for generated media placement.
- Visible lineage arrow from source frame/context to generated result.
- Floating annotation arrows that avoid tldraw target bindings.
- Local canvas persistence with page snapshot, manifest, view state, and backups.

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

### 3.3 `Generate version` will return only inside active skill mode

Future behavior:

```text
Active skill / auto-run mode is on
→ user frames media + annotations
→ Generate version
→ active Codex skill reads frame input
→ skill executes with its provider policy
→ canvas writeback
```

This preserves the low-friction Lovart/Cowart-style editing loop without turning the canvas into a provider form.

### 3.4 Image/video generation and editing are skills

The project should expose generation/editing as Codex agent skills, for example:

- image generation
- image edit
- video generation
- reference-to-video
- video frame revision
- 3D generation / revision

Those skills share the same canvas contract instead of each adding new whiteboard buttons.

## 4. Current primary loop to validate

```text
1. Open the blank canvas.
2. Upload or place media.
3. Add annotations with notes/arrows/boxes.
4. Frame the task region.
5. Click Send to Codex.
6. Codex reads canvas.get_frame_request / canvas.get_frame_input.
7. User gives or confirms the instruction in Codex.
8. Codex generates/edits through an active skill.
9. Codex calls canvas.insert_media or canvas.create_version.
10. Browser places the result next to the framed context with lineage.
```

Acceptance for Phase 0.5:

- Codex can tell exactly which frame/selection is active.
- Frame Input contains local/absolute asset paths, object ids, bounds, and annotation text.
- Frame screenshot is saved as an auxiliary artifact, even if system clipboard copy fails.
- Canvas reload preserves object positions.
- Generated/writeback results are placed without relying on provider calls from the browser.
- Documentation no longer treats browser-side provider execution as the main path.

## 5. What remains mock or incomplete

- `canvas.capture_selection` is still not a first-class browser-generated artifact.
- `canvas.link_versions` is not yet a separate MCP tool; lineage is currently created as part of `canvas.create_version`.
- Direct provider executor code still exists for debugging/spike history and should be isolated further.
- Active skill session mode is specified but not implemented.
- Real image/video/3D skills are not packaged yet.
- Host-level automatic composer attachment is not available; screenshot copy remains best-effort.
- Full tldraw/Cowart-grade snapshot sanitization and multi-page history are not done.

## 6. Next implementation plan

### Phase 0.5 closeout

1. Harden local persistence:
   - keep page-level snapshots;
   - keep manifest and view state;
   - keep backup snapshots;
   - avoid running import/reposition logic during restore.

2. Complete Codex bridge tools:
   - `canvas.get_frame_input`;
   - `canvas.get_frame_screenshot`;
   - `canvas.capture_frame`;
   - `canvas.get_asset`;
   - later: `canvas.capture_selection`, `canvas.link_versions`.

3. Clean product docs:
   - canvas is context bridge;
   - skills own generation/editing;
   - direct provider calls are debug-only;
   - `Generate version` only appears in active skill mode.

### Phase 0.6: active skill session mode

Goal:

```text
Codex activates a media skill
→ canvas knows active skill mode
→ frame button changes from Send to Codex to Generate version
→ click triggers a skill-owned request, not browser provider execution
```

Acceptance:

- A visible but minimal active-skill indicator exists.
- The frame button text changes only when active skill mode is present.
- Generated output still goes through Codex writeback tools.

### Phase 1: official tldraw agent architecture migration

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

- Do not rebuild tldraw chrome unless absolutely necessary.
- Do not create a whiteboard skill marketplace panel.
- Do not make provider/model selection the visible core UI.
- Do not treat API success as product success if source/reference/annotation context is wrong.
- Do not show debug JSON panels in the user-facing canvas.
- Do not use browser-side provider execution as the primary loop.

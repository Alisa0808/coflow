# Current Status and Next Visible Loop

Date: 2026-06-28

## 1. Stage verdict

We are now at **Phase 1 RC: Image Annotation Edit Loop**.

Phase 0 / 0.5 / 0.6 are closed as implementation spikes. The remaining Phase 1 work is acceptance hardening, not redefining the product shape.

The project is no longer trying to prove that the browser canvas can call a provider API directly. That path produced confusing source/reference handling and drifted away from the product goal.

The canonical product loop is now:

```text
User frames or selects media + annotations
→ canvas exports structured frame / selection / viewport context and optional screenshot
→ Codex / active agent skill reads the freshest bounded context
→ Codex chooses the right image/video/3D skill, mode, provider, and prompt
→ Codex writes the generated media back to canvas
→ canvas places the result with visible lineage and local metadata
```

The canvas is a **visual context container and writeback surface**. Codex is the orchestration layer.

## 2. What is real now

- Native tldraw canvas with mostly native tldraw UI.
- Default board opens blank.
- Local image/video upload into `.coflow/assets`.
- Chunked upload for large media.
- Bounded frame context extraction based on geometry, not only tldraw parent/child nesting.
- Selection publishing for Codex tools, including selected objects and visible viewport fallback.
- Frame `Send to Codex` button.
- Frame screenshot artifact saved under `.coflow/frame-screenshots`.
- Hidden Frame Input JSON saved under `.coflow/frame-inputs`.
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
- Canvas writeback command polling for generated media placement.
- Removed legacy `canvas.agent_prompt` as a user-facing MCP tool. It queued browser-side provider execution and could mislead Codex into thinking generation/writeback had completed; generation must now run through Codex media skills plus `canvas.insert_media` / `canvas.create_version`.
- Visible lineage arrow from source frame/context to generated result.
- Floating annotation arrows that avoid tldraw target bindings.
- Local canvas persistence with page snapshot, manifest, view state, and backups.
- Active Skill Session metadata under `.coflow/metadata/active-skill-session.json`.
- Minimal active-skill indicator in the canvas.
- Frame action always keeps `Send to Codex`; `Generate version` is added only when active skill `autoRun` is enabled.
- Active skill execution must be Codex-driven: the skill reads frame / selection / viewport context, chooses native/provider mode, generates media, then writes back through `canvas.insert_media` / `canvas.create_version`.
- Phase 1 image loop target: frame + image + native annotations → active image Skill reads bounded context → Codex native prompt-only or reference-capable provider edit/generation → local output materialization → native tldraw image asset writeback → visible lineage arrow.
- Phase 1 video loop target: frame/selection/viewport context → active video Skill reads bounded context → Atlas Cloud / Seedance 2.0 reference-to-video or text-to-video → local output materialization → native tldraw video asset writeback → visible lineage arrow.
- `Generate version` immediately enters a visible generating state and disables repeat clicks for the active frame until the run finishes.
- Default media generation actions no longer allow mock fallback unless `mock-provider` is explicitly selected for tests.
- Generation context now follows the tldraw agent-style priority: active frame > selected objects > visible viewport > prompt only.
- Image/video provider adapters no longer contain product-specific hard prompts such as poster/UI preservation rules. Skills build task-specific prompts from the user's message plus canvas context; adapters only keep light safety/annotation guardrails.

## 3. What changed in Phase 0.5

### 3.1 Persistence is no longer a single fragile file only

The canvas still keeps a legacy compatibility file, but Phase 0.5 now writes a more explicit local store:

```text
.coflow/
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
5. Activate coflow-image, or keep an existing active image Skill session.
6. Click Generate version on the frame.
7. Browser publishes a fresh Frame Input and frame screenshot.
8. Active image Skill reads the Frame Input and calls the real provider.
9. Server materializes the provider result into local assets.
10. Browser places the result next to the framed context with lineage.
```

Acceptance for Phase 1:

- Codex can tell exactly which frame/selection is active, and can fall back to the visible viewport when no explicit selection exists.
- Frame Input contains local/absolute asset paths, object ids, bounds, and annotation text.
- Selection capture contains selected object ids, normalized items, asset metadata, optional active frame, and visible viewport items.
- Frame screenshot is saved as an auxiliary artifact, even if system clipboard copy fails.
- Canvas reload preserves object positions.
- Image edits use the source asset and frame annotations; annotations/UI chrome must not appear in the generated result.
- Generated image results are written as native tldraw `asset` + `image` shape records.
- Generated video results are written as native tldraw `asset` + `video` shape records.
- After image/video generation succeeds, Codex responses must show an inline media preview in the conversation, not only a local file path.
- The original image remains on canvas; the new image appears to the right with visible lineage.
- Missing credentials or provider failure shows an error; it does not insert mock media.
- `Send to Codex` remains available as the context bridge; `Generate version` is active-skill-only.

## 5. What remains incomplete after Phase 1 RC

- `canvas.capture_selection` is currently a first-class structured MCP capture. Its primary path asks the open browser canvas for a fresh live tldraw editor snapshot, then returns current selection, active frame if available, and visible viewport fallback. Cached latest-selection files are fallback/debug only. It can include the latest matching Frame Input / frame screenshot artifacts. It does not yet ask the browser to create a fresh arbitrary selected-region PNG on demand.
- When the fresh viewport contains multiple visible source images/media and the user has not selected/framed one, the image/video skill must not randomly choose a source. It should ask the user to select/frame/name the intended source, unless the user request is clearly standalone generation rather than editing.
- `canvas.link_versions` exists as a separate MCP writeback tool and queues a visible, unbound lineage arrow between two existing shapes.
- Direct provider executor code still exists for debugging/spike history and should be isolated further.
- Active skill session mode is implemented for real provider-backed image/video loops.
- Image and video Skills are packaged as merged intent skills: each skill decides whether the request is text-to-media, reference-to-media, or edit/regeneration.
- A first 3D workflow skill is now packaged as a Codex-side boundary. It does not yet claim native 3D canvas preview/editing.
- Host-level automatic composer attachment is not available; screenshot copy remains best-effort.
- Full tldraw/Cowart-grade snapshot sanitization and multi-page history are not done.
- Video is no longer only Phase 2 scope: the first real video generation/writeback path is part of Phase 1 RC. Phase 2 is for deeper video UX, thumbnails/proxies, queueing, richer keyframe/timeline controls, 3D, and provider breadth.
- Generation timing instrumentation is being added to provider execution and writeback metadata so each generated image/video can expose upload, submit, poll, total duration, and started/completed timestamps.

## 6. Next implementation plan

### Phase 1 closeout

Status: implementation complete, pending user acceptance with real image/video runs and three visible UX hardening items.

1. Manual acceptance:
   - activate `coflow-image`;
   - frame a source image plus annotation;
   - click `Generate version`;
   - verify the output is relevant, native, local, linked, and previewed inline in the Codex conversation.

2. Stabilization:
   - confirm plugin MCP process is not stale;
   - keep `dist-contracts` and TS contract source synchronized;
   - isolate debug executor paths from product docs.
   - keep generated writeback placement close to the source/frame anchor and preserve lineage.
   - keep image/video Skill responses user-visible with inline Markdown previews, not only file paths.
   - record provider timing metadata on generated assets so slow steps can be diagnosed instead of guessed.

3. Phase 1 UX hardening before moving broad scope:

```text
generated result placement
→ lineage arrow anchored to source/frame
→ inline Codex media preview
→ latest request/result provenance visible enough for debugging
→ generation timing visible in metadata
```

4. Phase 2 productization / broad scope:

```text
video UX hardening
→ first-frame thumbnail/proxy
→ reference-to-video / keyframe-guided regeneration
→ queue/progress UX
→ scene skill matrix
→ provider setup/status diagnostics
→ 3D workflow boundary and typed references
```

### Phase 2.1 non-model path speed optimization

Goal:

Make the product-controlled path fast and diagnosable, without pretending we can optimize the model/provider generation time itself.

Latest implementation update:

- `canvas.generate_image` / `canvas.generate_video` are removed from the MCP public tool surface. Image/video skills must use the Codex-driven path: capture canvas context, generate with Codex/provider, then write back with `canvas.insert_media`.
- The normal skill chain is:
  - one fresh canvas context read when needed;
  - Codex-side bounded-context normalization;
  - Codex-side route choice: prompt-only native generation, reference-capable provider generation, or explicit setup failure;
  - provider execution only after the context and references are known;
  - output materialization under `.coflow/assets/`;
  - one native tldraw media writeback through `canvas.insert_media` or `canvas.create_version`.
- Skills must not rebuild this flow with shell scripts, temp Node snippets, `curl`, repeated provider status checks, or manual browser writeback during normal generation.
- If provider generation fails or provider credentials are missing, the skill must return a structured setup/failure message; it must not insert mock output or fall back to unrelated text-only generation.
- The non-provider timing target is now stricter: all product-controlled work outside provider generation should stay under 10 seconds in normal cached/local cases.

The measured path must be split into two layers:

1. **Provider/model time**
   - upload source references;
   - submit the provider job;
   - poll/wait for provider completion;
   - download/materialize provider output.

2. **Non-model product path**
   - read frame/selection/viewport context;
   - build the normalized provider request;
   - start provider execution;
   - receive completed local output;
   - queue canvas writeback;
   - render the native tldraw media shape and lineage.

Provider execution and writeback now write these fields into both the command and generated asset metadata when the provider executor can observe them:

- `generationStartedAt`
- `generationCompletedAt`
- `generationDurationMs`
- `providerTimings.startedAt`
- `providerTimings.uploadStartedAt`
- `providerTimings.uploadCompletedAt`
- `providerTimings.uploadDurationMs`
- `providerTimings.submitStartedAt`
- `providerTimings.submitCompletedAt`
- `providerTimings.submitDurationMs`
- `providerTimings.pollStartedAt`
- `providerTimings.pollCompletedAt`
- `providerTimings.pollDurationMs`
- `providerTimings.pollAttempts`
- `providerTimings.totalDurationMs`
- `e2eStartedAt`
- `writebackCompletedAt`
- `e2eCompletedAt`
- `e2eDurationMs`

`generationDurationMs` / `providerTimings` measure provider/API execution only. `e2eDurationMs` is an internal debugging metric for the full product path from canvas/Codex action to visible canvas writeback. Do not expose e2e timing in the end-user asset details UI.

Non-model optimization targets:

- separate provider/model generation time from product-controlled overhead;
- target `context read -> payload build -> provider submit` at P50 < 2s and P95 < 5s when source assets are already cached or locally lightweight;
- target `provider completed -> visible canvas writeback` at P50 < 2s and P95 < 5s;
- avoid extra placeholder/mock writebacks on real provider paths;
- avoid repeated context reads when the latest Frame Input / selection capture is fresh enough for the same user action;
- cache uploaded references only when the provider exposes stable reusable file references;
- keep writeback placement synchronous and cheap after the provider output is materialized;
- prefer a native tldraw media writeback first, then slower thumbnail/proxy enrichment later when possible;
- keep first-time large video / 4K reference upload async and cacheable instead of blocking the whole Codex turn;
- keep image uploads local and single-pass;
- Atlas Cloud polling defaults are unified at `2000` ms for both image and video, while retaining safe attempt windows for long-running jobs.

Current Atlas Cloud polling defaults:

- `ATLAS_POLL_INTERVAL_MS`: defaults to `2000` ms.
- `ATLAS_POLL_ATTEMPTS`: defaults to `160` attempts for video and `100` attempts for image.
- Effective poll windows: about 5.3 minutes for video and 3.3 minutes for image.
- This is a completion-detection interval, not the model generation duration. Lowering it can make completed jobs appear faster, but only within provider rate-limit safety.
- Phase 2.1 update: the default poll interval is now `2000` ms through `.env.local.example` / runtime defaults, with video and image attempts retaining safe windows for long-running jobs.

Important product rule:

- End users should see simple progress and final media preview.
- Developers/debuggers can inspect e2e timing in metadata / execution logs.
- The asset details popover should not show raw e2e timing by default.

### Phase 2.1 first-run plugin onboarding

Timing:

This should happen in **Phase 2.1**, immediately after Phase 1 UI closeout and before any public plugin release. It should not wait for broad Phase 3 provider work.

Why not earlier:

- Phase 1 had to prove the core canvas loop first: context → Codex skill → real provider → writeback.
- Onboarding without a stable generation loop would only configure settings for a shaky product.

What is already done:

- `canvas.get_provider_status`;
- `canvas.get_provider_onboarding`;
- `canvas.get_provider_settings`;
- `canvas.set_provider_settings`;
- `GET /api/provider/onboarding`;
- `GET /api/provider/status`;
- `GET /api/provider/settings`;
- `PUT /api/provider/settings`;
- `coflow-provider-setup`;
- `coflow-open` reads onboarding state on open and only prompts when `shouldPrompt` is true;
- provider/model defaults stored outside canvas JSON at `.coflow/metadata/provider-settings.json`;
- active skill sessions can omit `provider` and use the configured image/video default;
- `.env.local.example` defaults.

Provider setup UX decision:

- Users view and modify provider/model defaults through one skill: `coflow-provider-setup`.
- Normal status display should show current image/video provider and model defaults, not whether Atlas Cloud credentials are configured.
- Credential checks are only redacted diagnostics for generation preflight or failure handling.

Phase 2.1 implementation boundary:

- Repo-side onboarding is implemented as a reusable local payload, exposed through MCP and HTTP.
- `skip for now` and `rerun setup` are represented as explicit onboarding actions around the same settings contract.
- Credential presence is only exposed as a redacted runtime diagnostic; status display remains provider/model based.
- True automatic "right after plugin install / first enable" prompting still depends on a Codex host plugin lifecycle hook. Until that hook exists, the open skill is the product fallback: opening the canvas reads `canvas.get_provider_onboarding` and shows the first-run setup prompt only when status is `not_started`.

Manual validation:

```bash
curl -X PUT http://127.0.0.1:5176/api/active-skill/session \
  -H 'content-type: application/json' \
  -d '{"skillName":"coflow-image","displayName":"Canvas Image Skill","outputMediaType":"image","provider":"atlas","autoRun":true}'
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

- `coflow-open`
- `coflow-image`
- `coflow-video`
- `coflow-provider-setup`

Experimental scene workflow candidates exist in the worktree, but they should not be default-promoted until each workflow is product-validated.

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

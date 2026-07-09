# Phase 2 Productization Plan

Updated: 2026-06-28

## Verdict

Phase 2 is now scoped as plugin/productization on top of the Phase 1 RC generation loop. Scene-skill expansion is deferred until the workflows are product-validated.

The core product shape remains unchanged:

```text
canvas selection / frame / viewport
→ Codex skill reads bounded context
→ Codex chooses mode, provider, model, and prompt
→ provider generates image/video/asset
→ result is materialized locally
→ native canvas writeback with lineage and metadata
```

The browser canvas must stay a visual context and writeback surface. It must not become a provider form, hidden prompt mutator, or model-specific workflow UI.

## Phase 2 completed in this worktree

### 1. Plugin-facing skill matrix

Core skills:

- `coflow-open`
- `coflow-image`
- `coflow-video`
- `coflow-provider-setup`

Scene workflow candidates are intentionally not shipped yet. The core product entry remains the open/image/video/provider setup/model-list skill set.

### 2. Provider setup/status boundary

Added a provider setup/status contract:

- default provider: `atlas`;
- default image model intents: GPT image 2 text/edit;
- default video model intents: Seedance 2.0 text/reference video;
- optional custom provider endpoint status for Seedance, Kling, and generic providers;
- no API key values are exposed.

User-facing "provider status" means current provider/model defaults. It should not ask whether Atlas is configured just to show status. Credential presence remains available only as redacted runtime diagnostics when generation is about to run or fails.

New surfaces:

- MCP tool: `canvas.get_provider_status`;
- MCP tool: `canvas.get_provider_settings`;
- MCP tool: `canvas.get_provider_onboarding`;
- MCP tool: `canvas.set_provider_settings`;
- HTTP endpoint: `GET /api/provider/status`;
- HTTP endpoint: `GET /api/provider/settings`;
- HTTP endpoint: `GET /api/provider/onboarding`;
- HTTP endpoint: `PUT /api/provider/settings`;
- skill: `coflow-provider-setup`.

Local settings file:

```text
.coflow/metadata/provider-settings.json
```

This file stores onboarding state and default image/video provider/model intent. It must never store API keys.

### 3. Open-source quick start

Added `coflow/README.md` covering:

- local startup;
- provider setup;
- skill list;
- canvas context priority;
- local storage path;
- tldraw schema-first development rule.

### 4. Deferred scene and 3D capability boundary

Scene-specific and 3D skills are not part of the shipped plugin yet. They should stay out of the installed skill surface until the workflows are implemented and product-validated.

## Still not Phase 2 complete until validated by the main UI branch

These are intentionally left to the active Phase 1 UI/main-session work or follow-up validation:

- Lovart-style asset detail card polish;
- frame/selection button styling;
- arrow annotation UX;
- video thumbnail/proxy rendering inside tldraw;
- long-running job queue/progress UI;
- fresh browser-rendered selected-region PNG capture;
- native 3D viewer shape.

They are user-visible canvas UI features and should be changed against official tldraw APIs only.

## Next implementation order

1. Merge Phase 1 UI closeout with this Phase 2 plugin/productization layer.
2. Phase 2.1: implement non-model path speed instrumentation and optimization:
   - split provider/model timing from product-controlled e2e timing;
   - keep e2e timing in debug metadata, not end-user asset details;
   - reduce context/read/writeback overhead before touching provider parameters;
   - avoid unnecessary placeholder/mock writes on real provider paths;
   - use a safe Atlas polling interval reduction only after checking provider rate-limit behavior.
3. Phase 2.1: first-run plugin onboarding:
   - implemented local onboarding payload through `canvas.get_provider_onboarding` and `GET /api/provider/onboarding`;
   - open skill reads onboarding and prompts only on `not_started`;
   - provider setup skill handles use defaults, customize, skip for now, and rerun setup through one settings contract;
   - Codex plugin lifecycle can call the same onboarding payload when first-enable hooks are available.
4. Validate plugin install/reload:
   - open canvas skill;
   - provider setup skill;
   - image skill from frame;
   - image skill from selection;
   - video skill from reference image;
   - scene skill creates multiple outputs or asks for missing context.
5. Add video thumbnail/proxy support using native tldraw media assets plus metadata, not custom ad-hoc shapes.
6. Add queue/progress as Codex/server execution metadata first; expose canvas UI only after the data contract is stable.
7. Prototype 3D preview as a separate, documented shape/viewer feature.

## Acceptance criteria

Phase 2 can be accepted when:

- plugin metadata exposes the intended skills;
- provider setup can be checked without leaking secrets;
- provider defaults can be read/updated without touching canvas JSON;
- image/video skills can still complete real provider generation and writeback;
- scene skills route through Codex rather than canvas provider forms;
- non-model path timing is measurable separately from provider/model generation;
- first-run provider onboarding has a local payload, skip/rerun flow, and persistence boundary;
- docs clearly state current 3D limits;
- tests and build pass.

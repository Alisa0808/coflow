# CoFlow Plan

Last updated: 2026-06-25

## 1. Project Definition

**Project name:** CoFlow

**Repo name:** `coflow`

**One-line positioning:**

> An open-source multimodal canvas plugin for Codex / coding agents: select an image or video frame, describe the change, and let the agent generate a traceable new version back onto the canvas.

**Chinese tagline:**

> 指哪改哪，自动回板，版本可追踪。

**English tagline:**

> Point. Prompt. Generate back.

CoFlow is not intended to be a full Lovart, Tapnow, Canva, or Figma replacement. Its first product shape is a Codex ecosystem plugin: the canvas manages visual context and media assets; Codex handles conversation, skill orchestration, provider selection, generation, and local file management.

## 2. Target Users and Use Cases

### Primary users

- Codex / Claude Code / Cursor / MCP / Skill users
- AI builders
- Indie hackers
- Growth engineers
- Technical creators
- Small teams that already use local agent workflows and want controllable media generation

These users care about:

- using their own models, API keys, Skills, MCP servers, and local tools;
- keeping generated assets inside the project workspace;
- understanding how each asset was generated;
- iterating from a selected image, video frame, annotation, or reference set;
- avoiding closed, non-debuggable generation workflows.

### Secondary users

- Growth teams
- Content teams
- AI power users inside marketing teams
- Teams producing ad creatives, product visuals, social covers, and video concepts at scale

### Non-target users for v1

- General-purpose designers expecting a polished SaaS canvas
- Users expecting a complete Lovart / Canva experience
- Pure video editors who need timeline-first editing
- Non-technical users unwilling to configure Codex, Skills, MCP, CLI tools, or API keys

## 3. Product Boundary

The core product boundary is:

```text
Canvas = selection, annotation, reference, asset organization, version lineage
Codex = intent understanding, Skill selection, provider orchestration, generation execution
```

### The canvas should own

- media upload and local asset references;
- image, video frame, and annotation selection;
- visual placement and auto-layout;
- asset metadata display;
- parent-child version lineage;
- queued canvas requests for Codex;
- lightweight provider / preset status.

### Codex should own

- interpreting natural-language requests;
- maintaining conversation context;
- choosing or continuing a scene Skill;
- invoking Codex native generation, Atlas Cloud, or custom providers;
- saving generated files locally;
- writing generated results and metadata back to the canvas.

### Important v1 rule

In v1, canvas interactions that regenerate or edit media should **route through Codex**, not directly call provider APIs from the canvas.

The intended request path is:

```text
User selects/annotates on canvas
→ Canvas queues a structured request
→ Codex claims and processes the request
→ Codex calls the selected Skill/provider/tool
→ Result is saved locally
→ Codex inserts the new asset/version back onto the canvas
```

Direct provider API calls from the canvas may be explored later as a fast/headless mode, but they are not the first-version product path.

## 4. Provider Strategy

Provider integration uses a **Codex-driven hybrid model**.

CoFlow should not become a model marketplace UI. The canvas records preferences, presets, local assets, and metadata; Codex performs the actual provider orchestration.

### Provider paths

#### 4.1 Codex native generation

Use Codex's built-in generation/editing ability when available.

Purpose:

- zero-configuration first demo;
- simplest onboarding path;
- good for image-only quick starts.

Metadata should record:

- `provider: codex-native`
- generated local path
- prompt
- parameters inferred by Codex
- parent asset/version

#### 4.2 Atlas Cloud Skill/MCP/CLI

Atlas Cloud is the recommended advanced provider path, but the open-source project should not be Atlas-only.

Users can install Atlas integration through one or more of:

- Atlas Cloud Skill
- Atlas Cloud MCP server
- Atlas Cloud CLI
- direct Atlas API wrapper exposed to Codex

Purpose:

- image generation and editing;
- video generation;
- model discovery and routing;
- image-to-video or frame-guided generation;
- cost/provider flexibility;
- promotion of Atlas as the best-supported provider option.

Metadata should record:

- `provider: atlas-cloud`
- model id
- Atlas prediction id when available
- request params
- remote output URL when available
- downloaded local output path
- parent asset/version

#### 4.3 Custom provider via Skill/MCP/CLI

Advanced users can connect providers such as OpenAI, Replicate, ComfyUI, Runway, Higgsfield, or internal tools.

The only requirement is that the custom workflow returns:

- output local path;
- media type;
- parent asset/version id;
- prompt;
- provider name;
- model name when available;
- parameters;
- optional remote URL;
- optional provider job id.

### First-run provider onboarding

The provider onboarding should appear automatically after plugin installation / first enablement. It should not be hidden behind a canvas button.

Implementation timing:

- This belongs in **Phase 2.1**, after the Phase 1 generation/writeback loop is stable and before public plugin release.
- The current `coflow-provider-setup` skill is the single user-facing entry for viewing/changing provider and model defaults, skipping setup, rerunning setup, and diagnosing runtime failures. Full first-run onboarding should call this same settings contract instead of creating a separate provider skill.
- The current local settings foundation is `.coflow/metadata/provider-settings.json`, exposed through `canvas.get_provider_settings`, `canvas.get_provider_onboarding`, `canvas.set_provider_settings`, `GET /api/provider/settings`, `GET /api/provider/onboarding`, and `PUT /api/provider/settings`.
- Full automatic onboarding depends on Codex plugin lifecycle support for first-enable / first-run detection. Until that hook is available, the open skill reads `canvas.get_provider_onboarding` and shows the first-run prompt when status is `not_started`.

The first-run guide should collect:

1. Default image provider
   - Atlas Cloud recommended;
   - alternatives include Codex / GPT Image, Google / Nano Banana, OpenAI-compatible, or Custom.

2. Default video provider
   - Atlas Cloud recommended;
   - alternatives include Google / Veo, Seedance, Kling, OpenAI-compatible, or Custom.

3. Default image model and default video model
   - selected from the chosen provider capabilities when possible;
   - editable later from Codex settings / commands.

4. Credentials and endpoints
   - API keys, base URLs, MCP servers, or CLI commands;
   - secrets must stay out of canvas JSON, frame input, generation request artifacts, and git.

Runtime provider priority:

1. explicit provider / model named by the user for this turn;
2. active Skill provider policy when required and safe;
3. onboarding default provider / model;
4. safe fallback, or ask the user to configure a provider.

The first-run guide may still present this as three user-facing paths:

1. **Use Codex native generation**
   - fastest path;
   - no extra API key;
   - best for trying the image demo.

2. **Install Atlas Cloud integration**
   - recommended for serious media generation;
   - supports image/video/multi-model routing;
   - guides the user to configure `ATLASCLOUD_API_KEY`.

3. **Use a custom provider**
   - for advanced users;
   - guides users to expose a Skill, MCP server, or CLI command that follows the result contract.

### Canvas provider UI

The canvas should show lightweight provider state, not heavy provider forms:

- current provider mode: Auto / Codex / Atlas / Custom;
- current scene mode or preset;
- last used model;
- setup warning if a requested provider is missing;
- a “Configure in Codex” action.

Complex model choice and parameter negotiation should happen in the Codex conversation.

## 5. Core Workflows

### 5.1 Selection context

When the user selects canvas content, Codex should be able to read structured context:

- selected asset ids;
- media type;
- local file paths;
- thumbnails;
- video timestamp or frame id when applicable;
- visible annotations;
- parent version metadata;
- current scene mode / preset;
- provider preference.

The user should not need to copy paths, shape ids, JSON, or screenshots manually.

### 5.2 Annotation edit workflow

Annotation-based editing is a **core workflow**, not a user-facing scene Skill.

The user-facing action should be phrased as:

- “按标注生成新版”
- “交给 Codex 修改”
- “Generate new version”

Internally, the workflow should:

1. read selected source media;
2. collect annotation shapes/text;
3. create an edit request;
4. let Codex interpret the request;
5. call the selected generation/edit provider;
6. save output locally;
7. insert a new version to the right of the source;
8. preserve the original;
9. write full metadata and lineage.

### 5.3 Video frame reference workflow

Video support in v1 should focus on frame-level reference rather than full timeline editing.

The minimum workflow:

1. upload or import a video;
2. extract one or more frames;
3. select a frame;
4. annotate the frame;
5. ask Codex to revise the shot, produce an edited frame, or generate a video prompt/keyframe set;
6. return the result to the canvas with source video, timestamp, and prompt metadata.

The v1 promise should be “frame-guided video revision / concepting,” not arbitrary frame-perfect video retouching.

### 5.4 Auto placement and version lineage

Generated results should not be randomly inserted.

Default placement:

- single new asset: to the right of the source asset;
- multiple outputs: grid layout to the right of the source;
- branch outputs: visually connected to the parent asset/version.

Every generated media item must preserve:

- parent asset/version;
- input references;
- prompt;
- provider;
- model;
- generation parameters;
- output path;
- created time.

## 6. v1 Preset Scene Skills

Do not present core editing operations as Skills. Skills should represent **scene-specific outputs**, not basic canvas mechanics.

The v1 scene Skills are candidate presets, not claims about verified market popularity. A follow-up market/competitor research pass should validate which Skills are genuinely high-demand before expanding the list.

### 6.1 Product Marketing Set

Input:

- product image;
- optional brand/style references;
- user brief.

Output:

- a small set of marketing/ad/social product visuals;
- multiple variants placed in a grid;
- each output with prompt/model/provider metadata.

Why v1:

- practical for growth teams;
- easy to understand;
- fits Atlas multi-model image generation.

### 6.2 Social Repurpose

Input:

- one source image or generated asset.

Output:

- platform-specific adaptations, such as:
  - Xiaohongshu cover;
  - Instagram post;
  - Story/Reels vertical;
  - YouTube thumbnail;
  - horizontal ad/banner.

Why v1:

- frequent real-world need;
- good demo for auto-layout and multi-output generation;
- related to patterns seen in existing AI canvas tools.

### 6.3 Video Ad Keyframes

Input:

- product/reference image;
- optional video frame;
- user campaign brief.

Output:

- storyboard frames;
- video ad keyframes;
- optional prompt package for video generation.

Why v1:

- differentiates from image-only AI Canvas clones;
- gives Atlas video models a natural role;
- avoids overpromising full video editing in the first release.

### 6.4 Style Exploration

Input:

- one or more reference images;
- optional mood/style notes.

Output:

- multiple visual style directions;
- each direction linked back to the reference set;
- follow-up generation from any selected direction.

Why v1:

- showcases canvas-as-reference-space;
- useful for creative exploration;
- naturally benefits from version lineage.

## 7. Version Roadmap

### v0 — Canvas Bridge Spike

Goal:

Validate the Codex ↔ canvas ↔ local asset loop.

Scope:

- tldraw-based infinite canvas spike;
- image upload;
- basic annotations;
- selected element tracking;
- local asset store;
- minimal metadata;
- canvas adapter boundary;
- MCP tools:
  - `canvas.get_selection`
  - `canvas.insert_asset`
  - `canvas.update_asset_metadata`

Acceptance criteria:

- Codex can read the selected image;
- Codex can insert a local generated image back onto the canvas;
- new result appears to the right of the source;
- asset references and metadata survive a local service restart;
- large media files are referenced from local storage, not embedded into canvas JSON.

### v1 — Public MVP Demo

Goal:

Produce a public demo that is easy to record, explain, and share.

Scope:

- image annotation edit workflow;
- video upload and frame extraction;
- video frame selection context;
- multi-output grid placement;
- asset details panel;
- scene mode / preset state;
- first-run provider onboarding:
  - Codex native;
  - Atlas Cloud;
  - custom provider;
  - local provider defaults saved outside canvas JSON;
- v1 candidate scene Skills:
  - Product Marketing Set;
  - Social Repurpose;
  - Video Ad Keyframes;
  - Style Exploration.

Core MCP tools:

- `canvas.get_selection`
- `canvas.insert_asset`
- `canvas.create_version`
- `canvas.extract_video_frame`
- `canvas.get_asset_metadata`

Acceptance criteria:

- complete “select/annotate image → Codex generates → result returns to canvas → details visible” loop;
- complete “source product image → marketing asset set → grid placement” loop;
- no manual path copying;
- no manual drag-back of generated assets;
- Codex native path can run with minimal setup;
- Atlas setup is clearly recommended but optional;
- README explains that this is a Codex plugin, not a standalone SaaS.

### v2 — Atlas and Provider Router

Goal:

Make Atlas the best-supported advanced provider while preserving open-source neutrality, and package the workflow as installable Codex skills instead of canvas-only buttons.

Scope:

- Atlas setup guide;
- provider/model setup defaults plus redacted runtime diagnostics;
- Atlas Skill/MCP/CLI examples;
- provider preset schema;
- task metadata normalization;
- provider fallback;
- retry failed tasks;
- rerun a task with a different provider/model;
- custom provider result contract;
- scene workflow skills:
  - Product Marketing Set;
  - Social Repurpose;
  - Video Ad Keyframes;
  - Style Exploration;
- first 3D workflow boundary with thumbnail/metadata writeback until native 3D preview exists.

Acceptance criteria:

- Atlas image generation returns to canvas;
- Atlas video or frame-guided demo returns to canvas;
- `canvas.get_provider_status` reports provider readiness without exposing secrets;
- image/video/scene skills are visible in the plugin and route through Codex;
- Codex native and Atlas both work;
- custom provider can insert results through the same contract;
- failed provider tasks show traceable status and error details;
- rerun does not overwrite old versions;
- 3D docs and skill do not overclaim full native 3D editing.

### v3 — Asset Graph and Workflow Expansion

Goal:

Evolve from a media canvas plugin into a traceable multimodal asset workflow.

Scope:

- asset lineage graph;
- branchable versions;
- batch export;
- preset marketplace or community Skill registry;
- optional graph view using a flow-oriented canvas;
- initial 3D asset metadata and preview support.

Acceptance criteria:

- users can inspect parent/child generation chains;
- users can continue generation from any historical version;
- users can export a usable marketing/video asset package;
- 3D assets can at least be stored, previewed, and traced.

## 8. Technical Direction

### Canvas base

Use tldraw for v0/v1 speed, but hide it behind a canvas adapter.

Rationale:

- tldraw gives fast infinite canvas, image placement, and annotation primitives;
- the adapter preserves future optionality if license, performance, or graph-shape needs change;
- a future xyflow/graph view can be added without rewriting the media core.

### Local storage

The canvas should persist references, not large binaries.

Recommended storage model:

```text
.coflow/
  canvases/
  assets/
    images/
    videos/
    frames/
    thumbnails/
  metadata/
  jobs/
```

### Core metadata

Each asset should minimally record:

- `assetId`
- `type`: `image` / `video` / `frame` / `model3d`
- `localPath`
- `thumbnailPath`
- `parentAssetId`
- `parentVersionId`
- `references`
- `annotations`
- `prompt`
- `provider`
- `model`
- `params`
- `skillName`
- `jobId`
- `createdAt`

### Provider result contract

All generation paths must return a compatible result shape:

- output local path;
- media type;
- parent asset/version id;
- prompt;
- provider name;
- model name when available;
- parameters;
- optional remote URL;
- optional provider job id;
- optional cost/latency when available.

### Skill contract

Scene Skills should not mutate canvas internals directly.

Recommended flow:

1. read current selection through MCP;
2. ask clarifying questions only when necessary;
3. generate/edit media through Codex native, Atlas, or custom provider;
4. save output locally;
5. insert asset through MCP;
6. create version relation;
7. update metadata;
8. report concise result to the user.

## 9. Test Plan

### v0 tests

- image upload creates a local asset and metadata record;
- selected image is returned by `canvas.get_selection`;
- `canvas.insert_asset` places a new asset to the right of the parent;
- metadata survives service restart;
- large files are not embedded in canvas JSON.

### v1 tests

- annotation edit request routes through Codex;
- video file can produce an extractable frame;
- selected video frame appears in selection context;
- multi-output generation creates a grid;
- asset details panel shows provider/model/prompt/path;
- missing provider defaults show a clear “configure provider/model in Codex” message;
- Codex native generation path can complete without Atlas;
- Atlas path can be configured without making the project Atlas-only.

### v2 tests

- Atlas image generation returns a local canvas asset;
- Atlas video/frame-guided workflow returns a local canvas asset;
- custom provider result contract inserts successfully;
- provider failure updates task status without corrupting canvas state;
- rerun with another model creates a new version instead of overwriting;
- metadata includes provider job id when available.

## 10. Open Research Items

- Validate which scene Skills are genuinely popular across Lovart, Tapnow, Canva AI, Higgsfield, Krea, Runway, Figma AI, Product Hunt, X, Reddit, and GitHub.
- Confirm the current tldraw license path for public open-source distribution and any commercial demo.
- Decide whether v1 should expose only Codex plugin packaging or also generic MCP instructions for Claude Code / Cursor.
- Determine the best Atlas video workflow for v1:
  - native video edit;
  - image-to-video from edited keyframe;
  - shot regeneration;
  - prompt/keyframe package only.
- Decide how long Codex can realistically keep a canvas session listening, and document the resume behavior.

## 11. Working Assumptions

- The project name is **CoFlow**.
- v0/v1 use tldraw for speed, with an adapter boundary for future replacement.
- Provider strategy is Codex-driven hybrid.
- Atlas is the recommended advanced provider, not the only supported provider.
- First public demo covers both image/video-frame editing and marketing asset set generation.
- Basic annotation editing is a core workflow, not a user-facing Skill.
- v1 scene Skills are candidate presets until validated by separate market research.
- The canonical plan lives in this document; future direction changes should update this file directly.

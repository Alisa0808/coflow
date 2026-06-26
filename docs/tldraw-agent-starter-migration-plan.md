# Tldraw Agent Starter Migration Plan

Date: 2026-06-26

## Executive summary

The official tldraw AI-enabled canvas / agent starter kit is much closer to our intended product shape than the current `phase0-tldraw-spike`.

Our current spike proves several important project-specific ideas:

- local media asset storage
- chunked upload for large videos
- bounded frame context extraction
- provider payload generation for Atlas / Seedance / Kling-style requests
- canvas writeback for generated versions and lineage arrows

But it is not a strong foundation for the full product experience, because it manually rebuilds concepts that the official agent starter already solves:

- chat-driven agent loop
- programmable prompts
- user/context selection
- prompt part architecture
- action schema architecture
- streaming model response parsing
- chat history and action history
- agent todo/review loops
- canvas diff/history display
- agent viewport control
- shape sanitization and coordinate normalization

Recommendation: migrate toward the official tldraw agent starter architecture, while keeping our media-generation-specific backend and provider payload work as custom prompt parts/actions.

## Official starter capabilities

Source: <https://tldraw.dev/use-cases/ai-enabled-canvas>

Official tldraw positions the AI canvas use case around:

- generating and manipulating canvas content
- translating natural language into visual actions
- collaborating with an agent that understands canvas state
- building AI workflows on top of tldraw rather than replacing tldraw UI

Source template: <https://github.com/tldraw/tldraw/tree/main/templates/agent>

The agent starter is organized into three main layers:

```text
templates/agent
  client/   browser app, tldraw UI integration, agent app, action utils, prompt part utils
  shared/   shared schemas, prompt part definitions, action schemas, focused shape formats
  worker/   Cloudflare Worker, model providers, prompt builder, streaming action parser
```

The most relevant official concepts for us are:

### 1. Agent mode system

Official file:

- `client/modes/AgentModeDefinitions.ts`

Modes define:

- what the agent can see: `parts`
- what the agent can do: `actions`

This maps directly to our product idea of “scene skills” or “pluggable skills”.

Instead of adding whiteboard toolbar buttons for every capability, we should represent each capability as a mode/action set:

```text
media-edit mode
  parts:
    selected media
    selected frame
    annotations
    screenshot
    upload/media metadata
    chat history
  actions:
    generate media
    edit media
    extract video frame
    create 3D/reference request
    place generated result
    connect lineage
```

### 2. Prompt parts

Official files:

- `client/parts/*`
- `shared/schema/PromptPartDefinitions.ts`
- `worker/prompt/buildMessages.ts`

Prompt parts are the official way to define what the model can see. Existing official parts include:

- user messages
- selected shapes
- context items
- screenshot
- user viewport bounds
- agent viewport bounds
- blurry shapes in view
- peripheral shape clusters outside the view
- chat history
- user action history
- canvas lints
- todo list
- arbitrary retrieved data
- model name

This is the right replacement for our current `canvas.get_frame_context` side panel. We should keep the extraction logic, but move it into custom prompt parts:

- `MediaAssetsPart`
- `BoundedFrameContextPart`
- `AnnotationsPart`
- `ProviderIntentPart`
- `CanvasMediaHistoryPart`

### 3. Action schemas and action utils

Official files:

- `shared/schema/AgentActionSchemas.ts`
- `client/actions/*`

The official starter already has action schemas/utilities for:

- create
- update
- delete
- move
- resize
- rotate
- align
- distribute
- stack
- bring to front
- send to back
- pen/freehand drawing
- set agent viewport
- message
- think
- review
- update todo list
- count
- example external API call

Our media-specific features should be implemented as additional action schemas, not as special-case UI handlers:

```text
generate-media
  input:
    mode: text_to_image | image_edit | text_to_video | reference_to_video | 3d_generation
    providerIntent: atlas | seedance | kling | auto
    referenceAssetIds
    targetBounds
    annotations
  behavior:
    build provider payload
    execute provider or mock executor
    write output asset
    create result shape
    attach lineage
    save request/result history

extract-video-frame
  input:
    sourceVideoAssetId
    timecode
  behavior:
    materialize still frame
    insert frame as image/reference asset

apply-media-edit
  input:
    sourceMedia
    bounded annotations
    prompt
  behavior:
    choose provider mode
    run provider
    place version next to source/frame
```

### 4. Programmatic prompting

Official README documents:

```ts
agent.prompt('Draw a cat')
agent.prompt({
  message: 'Draw a cat in this area',
  bounds: { x: 0, y: 0, w: 300, h: 400 },
})
agent.request(input)
agent.schedule(input)
agent.interrupt(input)
```

This is exactly the missing bridge between Codex Skill and canvas interaction.

Instead of relying on a whiteboard button as the primary UX, a Codex Skill should trigger:

```ts
agent.prompt({
  message: 'Generate a new version using these annotations',
  bounds: selectedFrameBounds,
  contextItems: selectedFrameContext,
})
```

The frame-level button can remain as a convenience shortcut, but the canonical workflow should be skill/agent-driven.

### 5. Multi-step work

Official concepts:

- `schedule`
- `review`
- todo list
- chat history
- action history

This solves one of our previously discussed unresolved goals: how to keep users in a scenario skill until the task is actually done.

For our project:

```text
media campaign skill
  step 1: inspect selected media and annotations
  step 2: generate/edit candidate
  step 3: place output and lineage
  step 4: review result
  step 5: schedule further refinement if needed
```

The starter kit already has the lifecycle shape for this.

## What this replaces in our current spike

| Current spike concept | Replace / keep | Official starter equivalent |
| --- | --- | --- |
| custom frame JSON side panel | replace | prompt parts + chat/action history |
| manual `Read frame context` button | mostly replace | prompt parts gathered per request |
| frame `Generate` button | keep as shortcut only | `agent.prompt({ bounds })` |
| custom generation request schema | keep, wrap as action payload | `generate-media` action schema |
| provider payload builders | keep | called by `GenerateMediaActionUtil` |
| mock executor / Atlas executor | keep | action implementation backend |
| media upload/chunked store | keep | asset store integration |
| result placement / lineage arrows | keep and improve | `GenerateMediaActionUtil.applyAction` |
| tldraw native toolbar/context/style | keep native | official starter also avoids rebuilding core chrome |
| current polling command bridge | replace | agent request/stream endpoint |

## Migration architecture

Recommended target shape:

```text
phase0-tldraw-spike/
  src/
    App.tsx
    media/
      assetStore.ts
      mediaShape.tsx
      mediaMaterialization.ts
    agent/
      TldrawAgentAppProvider.tsx        # imported/adapted from official starter
      TldrawAgent.ts                    # imported/adapted
      modes/
        mediaGenerationMode.ts
      parts/
        BoundedFrameContextPartUtil.ts
        MediaAssetsPartUtil.ts
        MediaAnnotationsPartUtil.ts
        ProviderPayloadHistoryPartUtil.ts
      actions/
        GenerateMediaActionUtil.ts
        ExtractVideoFrameActionUtil.ts
        PlaceGeneratedVersionActionUtil.ts
    shared/
      schema/
        MediaAgentActionSchemas.ts
        MediaPromptPartDefinitions.ts
      types/
        MediaGenerationTypes.ts
  server.mjs
    /api/agent/stream
    /api/assets/*
    /api/executions/*
```

We do not need to adopt Cloudflare Worker immediately. The official worker logic can be ported into our existing `server.mjs` first:

```text
Cloudflare Worker AgentService
  -> local Node server AgentService
  -> later split to Worker / remote backend if needed
```

This is safer for our current local Codex workflow.

## Migration phases

### Phase A: official starter audit and local branch

Goal:

- import official agent starter files into an isolated local sandbox folder
- verify it runs locally
- document exact files to port

Acceptance:

- official starter can run independently
- we understand dependency additions
- no changes to current spike behavior

### Phase B: minimal agent shell inside our project

Goal:

- add the official agent app/runtime concepts to `phase0-tldraw-spike`
- keep native tldraw UI
- keep our current asset store
- do not add the official chat panel as the product entry
- expose a Codex-facing programmatic prompt bridge, equivalent to `agent.prompt(...)`

Acceptance:

- Codex can programmatically trigger an agent request through MCP or a local HTTP endpoint
- the canvas browser can claim that prompt, resolve the bounded frame context, and write a generated version back to the board
- no official starter chat panel is required
- no media provider execution yet

### Phase C: convert frame context into prompt parts

Goal:

- port our `extractFrameContext` logic into `BoundedFrameContextPartUtil`
- represent selected frame/media/annotations as official prompt parts
- remove dependence on the debug JSON side panel as primary data path

Acceptance:

- selecting a frame and prompting the agent gives it correct bounded media context
- context includes image/video asset paths and annotation text/geometry

### Phase D: custom media actions

Goal:

- add `generate-media` action schema
- implement `GenerateMediaActionUtil`
- call existing provider payload builders
- call mock/Atlas executor
- write output back to canvas with lineage

Acceptance:

- agent can decide to create a media-generation request
- output appears as a new canvas shape
- lineage is preserved
- `providerPayloads.atlas` remains valid

### Phase E: Codex Skill integration

Goal:

- make the real user-facing workflow live as an installable Codex agent skill
- skill calls into canvas agent programmatically
- canvas buttons become optional shortcuts

Acceptance:

- user can install/use the skill in Codex
- skill can drive selected frame/media workflows
- users can stay in the scenario until the task is complete

### Phase F: real provider executor

Goal:

- wire Atlas/Seedance/Kling executor behind the official-style action runtime
- support image/video/3D/reference modes as action payload variants

Acceptance:

- real provider output replaces mock output when credentials are configured
- request/result history is saved
- generated media remains inspectable/reusable by later agent turns

## Key design implications

### 1. We should stop over-investing in custom tldraw chrome

The official starter keeps tldraw UI mostly native and adds agent-specific overlays/tools/chat. This confirms our recent rollback was the right move.

### 2. “Frame generate button” should not be the core architecture

The button is useful as a local affordance, but the canonical action should be:

```text
Codex Skill / Chat Prompt -> Agent Request -> Prompt Parts -> Action Schema -> Action Util -> Provider Executor -> Canvas Writeback
```

### 3. Our product differentiation is media-generation actions, not generic canvas actions

Official starter already handles general canvas manipulation. We should focus on:

- media asset awareness
- provider payload abstraction
- image/video/3D generation modes
- annotation-to-edit workflows
- lineage and revision memory
- Atlas promotion/integration

### 4. The “Skill” model maps naturally to official modes

Each installed Codex skill can correspond to:

- a mode
- a set of prompt parts
- a set of actions
- provider policy
- output placement/review strategy

This is a much cleaner design than installing random toolbar buttons.

## Immediate next step

Do not continue adding features to the current spike as-is.

Recommended next task:

```text
Create a new branch/folder: phase1-agent-starter-migration
Port the official tldraw agent shell into our project while preserving:
  - existing local asset store
  - existing upload behavior
  - existing provider payload builders
  - native tldraw UI
```

The first concrete milestone should be:

```text
In our app, show the official-style chat panel and successfully call agent.prompt(...)
without yet generating media.
```

After that, migrate `canvas.get_frame_context` into a custom prompt part.

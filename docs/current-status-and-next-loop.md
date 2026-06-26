# Current Status and Next Visible Loop

Date: 2026-06-26

## 1. One-sentence summary

We are building a Codex-driven media canvas: users mark up images, video frames, or future 3D views on a tldraw canvas; Codex reads the bounded frame or selection; a media-generation action calls Atlas / Seedance / Kling / another provider; the generated result is written back to the canvas with visible lineage and saved metadata.

We are not building a generic AI drawing whiteboard, and we are not copying the official tldraw agent chat panel as the product entry.

## 2. Why the recent work felt abstract

The recent iterations were mostly “plumbing”:

```text
Codex intent
→ canvas command
→ bounded frame context
→ media action
→ provider request
→ executor
→ canvas writeback
```

This plumbing is necessary because the product should not become a pile of whiteboard buttons. The long-term workflow should be:

```text
User works in Codex
→ a Codex Skill drives the canvas
→ tldraw exposes canvas state and canvas actions
→ providers generate media
→ results return to the canvas
```

The official tldraw agent starter proved that an agent can understand and act on a canvas. But its agent chat panel is its own UI. In our product, Codex is the agent conversation layer.

## 3. Current working chain

The current local spike now separates two paths:

1. `Send to Codex` publishes context and waits for Codex/user instructions.
2. explicit writeback tools place Codex-generated media back onto the canvas.

The intended interactive path is:

```text
User clicks Send to Codex on a frame
→ browser extracts bounded frame context
→ writes latest frame context
→ writes latest Codex frame request with status: awaiting_user_instruction
→ Codex reads canvas.get_frame_request / canvas.get_selection
→ Codex summarizes the task in conversation
→ user confirms or adds instructions
→ Codex executes the relevant skill/provider
→ Codex calls canvas.insert_media / canvas.create_version
→ browser places the result back with lineage
```

The older `canvas.agent_prompt` / provider-executor chain is still available as a spike/testing path, but it is no longer the primary product interaction.

The concrete send-to-Codex chain in code is:

```text
Frame button
→ sendFrameToCodex(...)
→ extractMaterializedFrameContext(...)
→ publishFrameContext(...)
→ publishCodexFrameRequest({ status: "awaiting_user_instruction" })
→ canvas.get_frame_request / canvas.get_selection
→ canvas.insert_media / canvas.create_version
```

## 4. Current file map

| Area | File | Role |
| --- | --- | --- |
| Canvas app | `phase0-tldraw-spike/src/App.tsx` | tldraw app, frame context extraction, command polling, canvas writeback |
| Canvas command API | `phase0-tldraw-spike/src/api.ts` | browser-side API types and calls |
| Frame context | `phase0-tldraw-spike/src/canvasContracts.ts` | extracts bounded frame media and annotations |
| Prompt part | `phase0-tldraw-spike/src/agentPromptParts.ts` | converts frame context into `bounded_frame_context` |
| Media action | `phase0-tldraw-spike/src/mediaActionContract.ts` | defines `generate-media` action and provider policy |
| Action util | `phase0-tldraw-spike/src/generateMediaActionUtil.ts` | starter-style action boundary |
| Provider request | `phase0-tldraw-spike/src/generationContract.ts` | provider-ready request format |
| Provider payloads | `phase0-tldraw-spike/src/providerAdapter.ts` | Atlas / Seedance / Kling payload builders |
| Local server | `phase0-tldraw-spike/server.mjs` | asset store, commands, executor, metadata |
| MCP bridge | `phase0-tldraw-spike/mcp-server.mjs` | exposes canvas tools to Codex/MCP-style clients |
| Runtime metadata | `.codex-media-canvas/metadata/` | latest frame/request/execution files |
| Operation log | `.codex-media-canvas/logs/operations.jsonl` | durable history of canvas actions |

## 5. What is real now vs. still mock

### Real now

- Native tldraw canvas.
- Image/video upload through local asset store.
- Chunked upload for large videos.
- Bounded frame context extraction.
- Native annotations captured as structured context.
- Codex-style `canvas.agent_prompt` command.
- `generate-media` action contract.
- Provider payload generation for Atlas / Seedance / Kling.
- Canvas writeback with generated media shape and lineage arrow.
- Metadata and operation logging.
- Installable local Codex plugin exposing canvas MCP tools.
- `Send to Codex` frame requests that wait for conversation instructions instead of auto-generating.

### Still mock / incomplete

- The generated visual output is still placeholder SVG/MP4 unless a provider endpoint is configured.
- Atlas adapter is implemented, but it requires `ATLASCLOUD_API_KEY` at server startup to make real billable calls.
- Provider execution is still inside `server.mjs`, not a clean module.
- No robust provider job state machine yet.
- No real async polling for long-running provider jobs.
- No production result materialization from remote URLs.
- No first-class 3D asset shape / preview / provider mode yet.
- First-run example/onboarding content is not finalized; current seeded demo is still a Phase 0 test fixture.

## 6. The next visible loop

The next phase should not add more invisible abstractions. It should produce one user-visible loop:

```text
Select or frame a media task
→ send a Codex-style agent prompt with provider: "atlas"
→ create a provider job record
→ show/record provider status clearly
→ if ATLASCLOUD_API_KEY is missing, show "skipped: key not configured"
→ if ATLASCLOUD_API_KEY is configured, upload references and call Atlas Cloud
→ materialize real output
→ write result back to canvas
→ preserve lineage and execution metadata
```

This loop should make it obvious whether we are using mock output or real provider output.

## 7. Next implementation plan

### Step 1: Extract provider executor module

Move provider execution out of `server.mjs` into a dedicated module:

```text
phase0-tldraw-spike/lib/provider-executor.mjs
```

It should own:

- provider endpoint selection;
- API key lookup;
- provider payload selection;
- external request execution;
- normalized execution result;
- skipped / failed / succeeded status.

Acceptance:

- `server.mjs` no longer contains provider-specific branching.
- Existing mock generation behavior still works.
- `npm test` and `npm run build` pass.

### Step 2: Add explicit provider job metadata

Write a provider job file for each execution:

```text
.codex-media-canvas/executions/<execution-id>.json
```

The job should include:

- provider;
- endpoint configured or not;
- selected provider payload;
- status;
- prompt;
- references;
- output target;
- external response summary;
- timestamps.

Acceptance:

- latest execution result clearly states whether provider execution was mock, skipped, failed, or succeeded.
- operation log has enough data to debug a provider call without reading the browser state.

### Step 3: Atlas adapter contract

Implemented:

```text
phase0-tldraw-spike/lib/providers/atlas.mjs
```

It should map:

```text
ProviderReadyGenerationRequest / AtlasProviderPayload
→ Atlas API request
→ normalized provider result
→ local materialized output
```

Acceptance:

- With `ATLASCLOUD_API_KEY` configured, the executor calls Atlas instead of mock-only execution.
- Without key, execution is skipped with a clear reason.
- The canvas result makes provider status visible in metadata.

### Step 4: Materialize real provider outputs

Support provider outputs such as:

- remote image URL;
- remote video URL;
- base64 image/video;
- local file path;
- job id requiring polling.

Acceptance:

- real provider output is copied into `.codex-media-canvas/assets/...`;
- canvas preview points to the local stored asset;
- original provider output URI is preserved in execution metadata.

## 8. What we should avoid next

- Do not keep adding whiteboard buttons.
- Do not build a parallel chat panel inside the canvas.
- Do not make provider config a visible model playground.
- Do not continue abstracting action contracts without a visible provider loop.
- Do not call Atlas “done” until real output is materialized and written back.

## 9. Immediate next task

Implement Step 1:

```text
Extract provider execution from server.mjs into lib/provider-executor.mjs
```

Then verify:

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/phase0-tldraw-spike
npm run build
npm test
```

Manual validation after server restart:

```bash
curl -X POST http://127.0.0.1:5176/api/agent/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Create a premium revised version from this frame.","provider":"atlas","outputMediaType":"image"}'
```

Expected result without Atlas endpoint:

- canvas still writes a mock preview back;
- latest execution result says external execution is skipped;
- provider job metadata says `ATLASCLOUD_API_KEY` is not configured.

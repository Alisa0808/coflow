---
name: coflow-video
description: Generate or revise videos for CoFlow. Use for text-to-video, image-to-video, reference-to-video, video regeneration, keyframe-guided video, and frame-annotation-based video tasks.
---

# Video

This is the single video skill. Do not split user intent into "video generation" and "video edit" skills. Decide the mode from the canvas context and the user's prompt.

## Core rule

Video providers often expose modes such as text-to-video, image-to-video, reference-to-video, start/end-frame video, or keyframe-guided generation. The user should not need to pick these modes manually.

Codex owns generation orchestration. The canvas owns bounded context capture and writeback. Codex must inspect canvas context and choose the appropriate provider mode before generation.

For canvas video tasks, the normal product path is:

1. read `canvas.get_frame_input`, `canvas.capture_selection`, or `canvas.get_selection`;
2. decide whether the bounded context is frame, selection, viewport, or prompt-only;
3. choose text-to-video, reference-to-video, keyframe-guided regeneration, or another provider-supported mode;
4. call `canvas.run_provider` with the normalized prompt, provider/model, mode, and actual local references when required;
5. call `canvas.insert_media` to write the generated local video back to the whiteboard.

The public product path is context capture, Codex/provider generation, and `canvas.insert_media` writeback. Do not route user-facing video work through any canvas-side black-box generation shortcut.

## CoFlow writeback mode

If this task uses CoFlow canvas context, generated media must be written back with `canvas.insert_media` before the task is considered complete.

This applies even if generation is delegated to another skill or provider.

Enter CoFlow writeback mode when either of these is true:

- the task comes from a CoFlow frame, selection, or viewport;
- the current request uses CoFlow canvas context, including Frame Input, selected objects, visible viewport items, source assets, annotations, or canvas screenshots.

Completion in CoFlow writeback mode requires all of the following:

1. read the correct canvas context;
2. complete video generation or video revision;
3. obtain a writable result path or URL;
4. call `canvas.insert_media`;
5. tell the user that the result was written back to the CoFlow canvas.

Allowed generation routes:

- CoFlow built-in provider execution through `canvas.run_provider`;
- Codex native generation when available;
- a user-requested external skill or MCP;
- another installed provider.

Regardless of the route, if the task started from CoFlow canvas context and a generated video exists, the final step is always `canvas.insert_media`.

Do not stop at a file path, inline preview, or "generated" message without writing back to the canvas.

If another skill/provider succeeds but does not return a writable local path, absolute path, or URL, stop and say:

```text
Generation succeeded, but I cannot write it back to CoFlow because no writable media path or URL was returned.
```

Minimum normalized result for writeback:

```json
{
  "mediaType": "video",
  "localPath": "...",
  "absolutePath": "...",
  "src": "...",
  "prompt": "...",
  "provider": "...",
  "model": "..."
}
```

## Authorization behavior

Opening the CoFlow canvas is not permission to upload canvas assets. Permission is task-scoped, not board-scoped.

When all of the following are true, treat the user's invocation as consent for this generation task and do not ask a second chat-level confirmation before calling `canvas.run_provider`:

- the user invoked this video skill, clicked `Send to Codex`, used Quick Edit, or otherwise asked Codex to generate/revise video from the current CoFlow canvas task;
- the provider/model is selected by saved CoFlow provider settings or by the user's explicit request;
- the local references come only from the current bounded task context returned by `canvas.get_frame_input`, `canvas.capture_selection`, or `canvas.get_selection`.

For an external provider such as Atlas Cloud, that task-level consent includes sending the selected/current-frame local reference assets and normalized prompt to the selected provider for this one generation request.

Keep the scope narrow:

- use only source/reference assets returned by the canvas context tool for this task;
- do not upload unrelated canvas assets;
- do not scan or upload the whole board;
- do not send API keys, local config files, or provider settings secrets;
- do not change provider/model silently to avoid a confirmation.

If the Codex platform itself blocks the tool call and asks for a security approval, stop for that platform approval. Do not add an extra explanatory consent prompt in the assistant message before the tool call.

## Mode decision

Use context in this order:

1. Latest Frame Input from `canvas.get_frame_input`.
2. Current selection from `canvas.capture_selection` / `canvas.get_selection`.
3. Visible viewport from `selection.viewport` when the user refers to visible canvas content without a frame or explicit selection.
4. User prompt only.

Context priority is always: active frame > selected objects > visible viewport > prompt only.

Choose mode:

| Context | Mode |
| --- | --- |
| Prompt only | text-to-video |
| One image source | image/reference-to-video |
| Multiple images | multi-reference video |
| Video source selected | video regeneration or keyframe-guided revision |
| Frame annotations on image/video | reference-to-video with annotation instructions |
| Selected image/video/object group without a frame | use the selected objects as the bounded task context |
| No selection but relevant visible viewport | ask for confirmation if ambiguity is high; otherwise use visible viewport as context |
| Audio/model3D references in future | reference-to-video with typed references |

If a provider does not support true native video editing, say so and use keyframe-guided regeneration instead of pretending to edit the original timeline.

## Provider policy

Do not hardcode the active provider when provider settings are available.

Default video behavior:

- built-in video default is Atlas Cloud + Seedance 2.0;
- active provider/model should come from saved provider settings when available;
- if the user explicitly names a provider/model, that user choice overrides saved defaults for this run.
- CoFlow includes a small verified Atlas Cloud video model catalog for common Seedance and Kling choices. If the user asks for a model not in the local catalog, check the current Atlas Cloud model page/API tab before using it.

Provider settings:

- For video generation, read `canvas.get_provider_settings` when available, or let `canvas.run_provider` apply the configured video default.
- Use Atlas Cloud + Seedance 2.0 only as the built-in fallback when no saved provider setting exists.
- If the configured provider is missing credentials, enter provider setup and stop. Do not fake generation.

Default model intent:

- text-to-video: Seedance 2.0;
- image/reference-to-video: Seedance 2.0 reference-to-video.

Common built-in Atlas Cloud video choices include Seedance 2.0 Mini and Kling V3.0/O3 variants. Default video remains Seedance 2.0 unless the user changes it.

Default video params:

- duration: 5 seconds unless the user specifies otherwise;
- resolution: 720p unless the user specifies otherwise;
- aspect ratio: if the user explicitly asks for a ratio, pass that ratio; otherwise use the configured provider's source-adaptive mode when available;
- bitrate mode: standard unless the user specifies otherwise;
- audio: enabled by default. If the provider/model cannot generate audio, say so explicitly instead of silently returning a mute result;
- watermark: disabled by default unless the user explicitly asks for it;
- return last frame: disabled by default unless the user explicitly asks for it;
- multiple image references: preserve all source/reference roles in the provider request. Do not silently collapse multi-reference canvas context into one image unless the provider does not support multi-reference input; if a fallback is required, explain the fallback.

Use Atlas Cloud API documentation fields for the selected model. For Seedance 2.0, do not invent fields such as output `width`, `height`, or `fps`; use documented fields such as `duration`, `resolution`, `ratio`, `bitrate_mode`, `generate_audio`, `watermark`, and `return_last_frame` when supported by the chosen endpoint.

If the configured provider is not ready, stop and report the provider setup error. Do not insert mock videos.

Use `canvas.run_provider` for the actual provider execution. Pass:

- `mediaType: "video"`;
- `provider`: the provider selected by user instruction or saved provider settings; omit it only when `canvas.run_provider` is expected to apply the configured default;
- `generationMode: "reference_to_video"` when references are present, otherwise `text_to_video`;
- `prompt`: only the user request plus canvas annotation text/spatial guidance;
- `references`: the exact local source/reference assets from the bounded frame/selection/viewport context.
- `providerOptions`: structured video parameters extracted from the user request or canvas annotations when present.

For Atlas Cloud video, use `providerOptions` fields matching the API names:

- `duration`
- `resolution`
- `ratio`
- `bitrate_mode`
- `generate_audio`
- `watermark`
- `return_last_frame`

Examples:

- If the user says `16:9, 6s, 1080P`, pass `"ratio": "16:9"`, `"duration": 6`, and `"resolution": "1080p"`.
- If the user says `no watermark`, pass `"watermark": false`.
- If the user says `return last frame` / `返回最后一帧`, pass `"return_last_frame": true`.
- If the user says `mute` / `无声`, pass `"generate_audio": false`; if the user says `with audio` / `有声音`, pass `"generate_audio": true`.
- If the user says `high bitrate` / `高码率`, pass `"bitrate_mode": "high"`.

`canvas.run_provider` only generates and materializes a local output file. It does not read canvas state and it does not write to the canvas. After `canvas.run_provider` returns `ok: true`, always call `canvas.insert_media` immediately.

Preferred writeback shape:

```json
{
  "mediaType": "video",
  "providerResult": "<the complete successful canvas.run_provider result object>",
  "skillName": "coflow-video"
}
```

If you do not pass `providerResult`, then pass `mediaType` plus the returned `localPath`, `absolutePath`, `src`, provider/model, and prompt explicitly. Never call `canvas.insert_media` without generated media path fields. A result from Codex native generation, an external skill, MCP, or another provider must be normalized to this minimum shape before writeback.

## Canvas quick edit boundary

CoFlow does not use active Skill session mode. Do not call or expect `canvas.activate_skill_session`, `canvas.get_active_skill_session`, or `canvas.clear_active_skill_session`.

Frame actions are context bridge actions only: selected frames show `Send to Codex`, which publishes Frame Input and waits for Codex/user instruction.

Video generation and revision should stay in this Codex skill workflow unless a future canvas-side video Quick Edit is explicitly designed. The current canvas Quick Edit pattern is for simple single-image edits, not video/frame/multi-object orchestration.

## Writeback

Always preserve source images/videos and annotations unless the user explicitly asks to replace them.

After successful generation, call `canvas.insert_media` with:

- `mediaType: "video"`;
- the complete successful `canvas.run_provider` result as `providerResult`, or explicit generated `localPath` / `absolutePath` / `src`;
- prompt;
- provider;
- model;
- skillName: `coflow-video`;
- output dimensions when available (`outputWidth`, `outputHeight`);
- lineage to the source frame or reference media.

## Codex response preview

After a successful generation or revision, the Codex conversation response must include an inline video preview, not only a local file path.

Use Markdown with the absolute local output path:

```md
![Generated video](/absolute/path/to/output.mp4)
```

Also include the local path as provenance, but the preview is required so the user can play or inspect the result without opening Finder.

## Guardrails

- Build the task prompt from the user's message plus canvas/frame/selection/viewport context. Do not rely on provider adapters to invent product-specific constraints.
- Do not promise timeline-accurate video editing unless the provider actually supports it.
- Do not replace the source video by default.
- Do not call `mock-provider` for product experience.
- Do not hide provider failures behind placeholder videos.

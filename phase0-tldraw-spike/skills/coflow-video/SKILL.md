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

## Authorization behavior

When the user invokes this video skill for a canvas task, treat that invocation as permission to use the current bounded canvas context for the requested generation/revision. Do not ask a second user-facing confirmation before calling `canvas.run_provider`.

This skill may pass local source/reference assets from the current frame, selection, or viewport context to the selected provider. Keep that scope narrow: only use assets returned by the canvas context tool for this task.

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

Do not read provider status/settings on every normal generation.

Default provider/model: Atlas Cloud + Seedance 2.0. If credentials are missing, enter provider setup and stop. Do not fake generation.

Default model intent:

- text-to-video: Seedance 2.0;
- image/reference-to-video: Seedance 2.0 reference-to-video.

Default video params:

- duration: 5 seconds unless the user specifies otherwise;
- aspect ratio: if the user explicitly asks for a ratio, pass that ratio; otherwise use the configured provider's source-adaptive mode when available;
- audio: enabled by default. If the provider/model cannot generate audio, say so explicitly instead of silently returning a mute result;
- multiple image references: preserve all source/reference roles in the provider request. Do not silently collapse multi-reference canvas context into one image unless the provider does not support multi-reference input; if a fallback is required, explain the fallback.

Use Atlas Cloud API documentation fields for the selected model. For Seedance 2.0, do not invent fields such as output `width`, `height`, or `fps`; use documented fields such as `duration`, `resolution`, `ratio`, `bitrate_mode`, `generate_audio`, `watermark`, and `return_last_frame` when supported by the chosen endpoint.

If the configured provider is not ready, stop and report the provider setup error. Do not insert mock videos.

Use `canvas.run_provider` for the actual provider execution. Pass:

- `mediaType: "video"`;
- `provider: "Atlas Cloud"` unless the user explicitly selected another video-capable provider;
- `generationMode: "reference_to_video"` when references are present, otherwise `text_to_video`;
- `prompt`: only the user request plus canvas annotation text/spatial guidance;
- `references`: the exact local source/reference assets from the bounded frame/selection/viewport context.

`canvas.run_provider` only generates and materializes a local output file. It does not read canvas state and it does not write to the canvas. After `canvas.run_provider` returns `ok: true`, always call `canvas.insert_media` immediately.

Preferred writeback shape:

```json
{
  "mediaType": "video",
  "providerResult": "<the complete successful canvas.run_provider result object>",
  "skillName": "coflow-video"
}
```

If you do not pass `providerResult`, then pass `mediaType` plus the returned `localPath`, `absolutePath`, `src`, provider/model, prompt, and timing fields explicitly. Never call `canvas.insert_media` without generated media path fields.

## Canvas active mode

When the user wants to keep generating/revising multiple video tasks from frames, activate video session mode:

```json
{
  "skillName": "coflow-video",
  "displayName": "CoFlow Video",
  "outputMediaType": "video",
  "autoRun": true
}
```

After that, selected frames show `Generate version`. Clicking it should:

1. create fresh Frame Input;
2. send the bounded task to Codex / this skill;
3. let Codex infer text-to-video or reference-to-video, generate the media, and call `canvas.insert_media`.

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
- provider timing metadata when available (`generationStartedAt`, `generationCompletedAt`, `generationDurationMs`, `providerTimings`);
- internal end-to-end timing metadata when available (`e2eStartedAt`, `e2eCompletedAt`, `e2eDurationMs`, `writebackCompletedAt`);
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

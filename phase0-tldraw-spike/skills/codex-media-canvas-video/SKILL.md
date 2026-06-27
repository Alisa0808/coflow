---
name: codex-media-canvas-video
description: Generate or revise videos for Codex Media Canvas. Use for text-to-video, image-to-video, reference-to-video, video regeneration, keyframe-guided video, and frame-annotation-based video tasks.
---

# Codex Media Canvas Video

This is the single video skill. Do not split user intent into "video generation" and "video edit" skills. Decide the mode from the canvas context and the user's prompt.

## Core rule

Video providers often expose modes such as text-to-video, image-to-video, reference-to-video, start/end-frame video, or keyframe-guided generation. The user should not need to pick these modes manually.

Codex should inspect canvas context and choose the appropriate provider mode.

## Mode decision

Use context in this order:

1. Latest Frame Input from `canvas.get_frame_input`.
2. Current selection from `canvas.capture_selection` / `canvas.get_selection`.
3. User prompt only.

Choose mode:

| Context | Mode |
| --- | --- |
| Prompt only | text-to-video |
| One image source | image/reference-to-video |
| Multiple images | multi-reference video |
| Video source selected | video regeneration or keyframe-guided revision |
| Frame annotations on image/video | reference-to-video with annotation instructions |
| Audio/model3D references in future | reference-to-video with typed references |

If a provider does not support true native video editing, say so and use keyframe-guided regeneration instead of pretending to edit the original timeline.

## Provider policy

Default provider: `atlas`.

Default model intent:

- text-to-video: Seedance 2.0 via Atlas;
- image/reference-to-video: Seedance 2.0 reference-to-video via Atlas.

If Atlas is not configured, stop and tell the user to add `ATLASCLOUD_API_KEY`. Do not insert mock videos.

## Canvas active mode

When the user wants to keep generating/revising multiple video tasks from frames, activate video session mode:

```json
{
  "skillName": "codex-media-canvas-video",
  "displayName": "Canvas Video Skill",
  "outputMediaType": "video",
  "provider": "atlas",
  "autoRun": true
}
```

After that, selected frames show `Generate version`. Clicking it should:

1. create fresh Frame Input;
2. infer text-to-video or reference-to-video from the frame;
3. run the real provider flow;
4. materialize the output video locally;
5. write the result back to the canvas with lineage.

## Writeback

Always preserve source images/videos and annotations unless the user explicitly asks to replace them.

Write generated videos back with:

- `mediaType: "video"`;
- local/absolute output path;
- prompt;
- provider;
- model;
- skillName: `codex-media-canvas-video`;
- lineage to the source frame or reference media.

## Guardrails

- Do not promise timeline-accurate video editing unless the provider actually supports it.
- Do not replace the source video by default.
- Do not call `mock-provider` for product experience.
- Do not hide provider failures behind placeholder videos.

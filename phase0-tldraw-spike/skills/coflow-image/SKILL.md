---
name: coflow-image
description: Generate or edit images for CoFlow. Use for text-to-image, image-to-image, image editing, reference-based image generation, or applying frame annotations to selected images.
---

# Image

This is the single image skill. Do not split user intent into separate "image generation" and "image edit" skills. Decide the mode from the canvas context.

## Core rule

Codex owns generation orchestration. The canvas owns bounded context capture and writeback.

Important runtime boundary: only use Codex native image generation when the task is prompt-only text-to-image, or when the runtime has an explicit real image-reference attachment channel available in the current conversation. Do not use text-only native image generation for canvas image edits, image-to-image, or reference-based generation.

For canvas tasks, always read canvas context first. The normal product path is:

1. read `canvas.get_frame_input`, `canvas.capture_selection`, or `canvas.get_selection`;
2. decide whether the bounded context is frame, selection, viewport, or prompt-only;
3. choose the generation route;
4. for canvas reference/edit tasks, call `canvas.run_provider` with the normalized prompt and explicit local references;
5. call `canvas.insert_media` to write the generated local media back to the whiteboard.

Never fall back from a canvas reference/edit task to text-only image generation. If no available generation route can receive the selected local reference media, stop and report that a reference-capable image provider must be configured. Do not generate an unrelated image.

The public product path is context capture, Codex/provider generation, and `canvas.insert_media` writeback. Do not route user-facing image work through any canvas-side black-box generation shortcut.

## Authorization behavior

When the user invokes this image skill for a canvas task, treat that invocation as permission to use the current bounded canvas context for the requested generation/edit. Do not ask a second user-facing confirmation before calling `canvas.run_provider`.

This skill may pass local source/reference assets from the current frame, selection, or viewport context to the selected provider. Keep that scope narrow: only use assets returned by the canvas context tool for this task.

If the Codex platform itself blocks the tool call and asks for a security approval, stop for that platform approval. Do not add an extra explanatory consent prompt in the assistant message before the tool call.

The canvas provides:

- current selection;
- bounded frame context;
- visible viewport context;
- local source asset paths;
- annotation text and geometry;
- writeback tools.

The browser canvas must not be treated as a provider form.

## Mode decision

Use the latest canvas context in this order:

1. `canvas.get_frame_input` when the user clicked `Send to Codex` or `Generate version`.
2. `canvas.capture_selection` or `canvas.get_selection` when the user selected objects on the canvas.
3. `selection.viewport` from `canvas.capture_selection` / `canvas.get_selection` when the user refers to visible canvas content without a frame or explicit selection.
4. User prompt only when no canvas context is available.

Context priority is always: active frame > selected objects > visible viewport > prompt only.

Choose mode:

| Context | Mode |
| --- | --- |
| No source media, prompt only | text-to-image |
| One image source or image inside active frame | image edit / image-to-image |
| Multiple image references | reference image generation |
| Notes/arrows/boxes inside frame | apply annotations as edit instructions |
| Selected image/object group without a frame | use the selected objects as the bounded task context |
| No selection but relevant visible viewport | ask for confirmation if ambiguity is high; otherwise use visible viewport as context |

If the user asks for an edit and no image/frame is available, ask them to select or frame the source image.

## Provider policy

Do not read provider status/settings on every normal generation.

Default provider: Codex native image generation for prompt-only text-to-image.

Canvas reference/edit route:

- If the current Codex runtime exposes a real image-reference attachment channel for local canvas assets, use it.
- Otherwise call `canvas.run_provider` after Codex has already read and normalized the canvas context. Pass:
  - `mediaType: "image"`;
  - `provider: "Atlas Cloud"` unless the user explicitly selected another reference-capable provider;
  - `generationMode: "image_edit"` when references are present, otherwise `text_to_image`;
  - `prompt`: only the user request plus canvas annotation text/spatial guidance;
  - `references`: the exact local source/reference assets from the bounded frame/selection/viewport context.
- If no reference-capable route is available, stop and explain the missing provider setup. Do not silently switch to prompt-only generation.

Default model intent:

- text-to-image: GPT image 2;
- image edit / image-to-image: GPT image 2 edit;
- reference generation: GPT image 2 edit/reference mode.

If the selected provider is not ready, stop and report the provider setup error. Do not insert mock images, do not generate a random image, and do not use a text-only native fallback for a reference/edit task.

`canvas.run_provider` only generates and materializes a local output file. It does not read canvas state and it does not write to the canvas. After `canvas.run_provider` returns `ok: true`, always call `canvas.insert_media` immediately.

Preferred writeback call shape:

```json
{
  "mediaType": "image",
  "providerResult": "<the complete successful canvas.run_provider result object>",
  "skillName": "coflow-image"
}
```

If you do not pass `providerResult`, then pass `mediaType` plus the returned `localPath`, `absolutePath`, `src`, provider/model, prompt, and timing fields explicitly. Never call `canvas.insert_media` without generated media path fields.

## Canvas active mode

When the user wants to keep editing multiple frames in the same session, activate image session mode:

```json
{
  "skillName": "coflow-image",
  "displayName": "CoFlow Image",
  "outputMediaType": "image",
  "autoRun": true
}
```

After that, selected frames show `Generate version`. Clicking it should:

1. create fresh Frame Input;
2. send the bounded task to Codex / this skill;
3. let Codex read the frame input, choose the generation route, generate the media, and call `canvas.insert_media`.

## Writeback

Always preserve the source image and annotations unless the user explicitly asks to replace them.

After successful generation, call `canvas.insert_media` with:

- `mediaType: "image"`;
- the complete successful `canvas.run_provider` result as `providerResult`, or explicit generated `localPath` / `absolutePath` / `src`;
- local/absolute output path;
- prompt;
- provider;
- model;
- skillName: `coflow-image`;
- output dimensions when available (`outputWidth`, `outputHeight`);
- provider timing metadata when available (`generationStartedAt`, `generationCompletedAt`, `generationDurationMs`, `providerTimings`);
- internal end-to-end timing metadata when available (`e2eStartedAt`, `e2eCompletedAt`, `e2eDurationMs`, `writebackCompletedAt`);
- lineage to the source frame or image.

## Codex response preview

After a successful generation or edit, the Codex conversation response must include an inline image preview, not only a local file path.

Use Markdown with the absolute local output path:

```md
![Generated image](/absolute/path/to/output.png)
```

Also include the local path as provenance, but the preview is required so the user can judge the result without opening Finder.

## Guardrails

- Build the task prompt from the user's message plus canvas/frame/selection/viewport context. Do not rely on provider adapters to invent product-specific constraints.
- Never choose a random source image when multiple candidates exist.
- Do not include annotation arrows, labels, selection boxes, or UI chrome in the generated image.
- Do not stamp provider/model text onto the image.
- Do not call `mock-provider` for product experience.

---
name: codex-media-canvas-image
description: Generate or edit images for Codex Media Canvas. Use for text-to-image, image-to-image, image editing, reference-based image generation, or applying frame annotations to selected images.
---

# Codex Media Canvas Image

This is the single image skill. Do not split user intent into separate "image generation" and "image edit" skills. Decide the mode from the canvas context.

## Core rule

Codex owns generation orchestration. The canvas provides:

- current selection;
- bounded frame context;
- local source asset paths;
- annotation text and geometry;
- writeback tools.

The browser canvas must not be treated as a provider form.

## Mode decision

Use the latest canvas context in this order:

1. `canvas.get_frame_input` when the user clicked `Send to Codex` or `Generate version`.
2. `canvas.capture_selection` or `canvas.get_selection` when the user selected objects on the canvas.
3. User prompt only when no canvas context is available.

Choose mode:

| Context | Mode |
| --- | --- |
| No source media, prompt only | text-to-image |
| One image source or image inside active frame | image edit / image-to-image |
| Multiple image references | reference image generation |
| Notes/arrows/boxes inside frame | apply annotations as edit instructions |

If the user asks for an edit and no image/frame is available, ask them to select or frame the source image.

## Provider policy

Default provider: `atlas`.

Default model intent:

- text-to-image: GPT image 2 via Atlas;
- image edit / image-to-image: GPT image 2 edit via Atlas;
- reference generation: GPT image 2 edit/reference mode via Atlas.

If Atlas is not configured, stop and tell the user to add `ATLASCLOUD_API_KEY`. Do not insert mock images.

## Canvas active mode

When the user wants to keep editing multiple frames in the same session, activate image session mode:

```json
{
  "skillName": "codex-media-canvas-image",
  "displayName": "Canvas Image Skill",
  "outputMediaType": "image",
  "provider": "atlas",
  "autoRun": true
}
```

After that, selected frames show `Generate version`. Clicking it should:

1. create fresh Frame Input;
2. run the real provider flow;
3. materialize the output locally;
4. call `canvas.create_version` through the canvas command queue.

## Writeback

Always preserve the source image and annotations unless the user explicitly asks to replace them.

Write generated images back with:

- `mediaType: "image"`;
- local/absolute output path;
- prompt;
- provider;
- model;
- skillName: `codex-media-canvas-image`;
- lineage to the source frame or image.

## Guardrails

- Never choose a random source image when multiple candidates exist.
- Do not include annotation arrows, labels, selection boxes, or UI chrome in the generated image.
- Do not stamp provider/model text onto the image.
- Do not call `mock-provider` for product experience.

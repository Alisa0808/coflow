---
name: coflow-image
description: Generate or edit images for CoFlow. Use for text-to-image, image-to-image, image editing, reference-based image generation, or applying frame annotations to selected images.
---

# Image

This is the single image skill. Do not split user intent into separate "image generation" and "image edit" skills. Decide the mode from the canvas context.

## Core rule

Codex owns generation orchestration. The canvas owns bounded context capture and writeback.

Important runtime boundary: use the system `imagegen` skill's built-in `image_gen` tool as the default image route for both prompt-only image generation and image editing/reference work. Do not assume that `canvas.run_provider` can execute Codex native image generation: `canvas.run_provider` is only for external provider routes.

For canvas image edit/reference tasks, the selected frame/selection/viewport may include local source images. Use the system `imagegen` skill workflow: inspect each local source image with `view_image` so it is visible in the conversation context, then use built-in `image_gen` for the edit/reference generation. Never pass `provider: "codex-native"` to `canvas.run_provider`; Codex native image work happens through the built-in image generation path, not through CoFlow provider execution.

When explaining this route to the user, distinguish Codex native image generation from external provider execution:

- "Codex built-in GPT Image 2" is the default for image generation, image editing, and local-reference CoFlow image edits.
- A selected CoFlow image, frame, or viewport media item is a local reference file. Load it with `view_image` before using built-in `image_gen`.
- Do not tell the user to configure Atlas Cloud for default image generation/editing. Atlas Cloud is only an external image provider when the user explicitly chooses it, or when built-in image generation is unavailable and the user agrees to use an external fallback.

For canvas tasks, always read canvas context first. The normal product path is:

1. read `canvas.get_frame_input`, `canvas.capture_selection`, or `canvas.get_selection`;
2. decide whether the bounded context is frame, selection, viewport, or prompt-only;
3. choose the generation route;
4. generate with the selected route: system `imagegen` built-in `image_gen` for default image generation/edit/reference work, or an external provider through `canvas.run_provider` only when the user explicitly chooses that provider or built-in image generation is unavailable;
5. call `canvas.insert_media` to write the generated local media back to the whiteboard.

Never fall back from a canvas reference/edit task to text-only image generation. If no available generation route can receive the selected local reference media, stop and report that a reference-capable route must be configured or enabled. Do not generate an unrelated image.

The public product path is context capture, Codex/provider generation, and `canvas.insert_media` writeback. Do not route user-facing image work through any canvas-side black-box generation shortcut.

## CoFlow writeback mode

If this task uses CoFlow canvas context, generated media must be written back with `canvas.insert_media` before the task is considered complete.

This applies even if generation is delegated to another skill or provider.

Enter CoFlow writeback mode when either of these is true:

- the task comes from a CoFlow frame, selection, or viewport;
- the current request uses CoFlow canvas context, including Frame Input, selected objects, visible viewport items, source assets, annotations, or canvas screenshots.

Completion in CoFlow writeback mode requires all of the following:

1. read the correct canvas context;
2. complete image generation or image editing;
3. obtain a writable result path or URL;
4. call `canvas.insert_media`;
5. tell the user that the result was written back to the CoFlow canvas.

Allowed generation routes:

- Codex native generation/editing through the system `imagegen` skill and built-in `image_gen` tool;
- CoFlow provider execution through `canvas.run_provider` for routes that can accept materialized local references;
- a user-requested external skill or MCP;
- another installed provider.

Regardless of the route, if the task started from CoFlow canvas context and a generated image exists, the final step is always `canvas.insert_media`.

Do not stop at a file path, inline preview, or "generated" message without writing back to the canvas.

If another skill/provider succeeds but does not return a writable local path, absolute path, or URL, stop and say:

```text
Generation succeeded, but I cannot write it back to CoFlow because no writable media path or URL was returned.
```

Minimum normalized result for writeback:

```json
{
  "mediaType": "image",
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

For the default Codex native image route, the user invoking this skill for a canvas task is permission to use the current bounded canvas context with the built-in `imagegen` workflow for the requested generation/edit.

When saved CoFlow provider settings or the user's explicit request select an external image provider such as Atlas Cloud, treat the user's invocation as consent for this generation task and do not ask a second chat-level confirmation before calling `canvas.run_provider`, as long as the local references come only from the current bounded task context returned by `canvas.get_frame_input`, `canvas.capture_selection`, or `canvas.get_selection`.

For an external provider, that task-level consent includes sending the selected/current-frame local reference assets and normalized prompt to the selected provider for this one generation request.

Keep the scope narrow:

- use only source/reference assets returned by the canvas context tool for this task;
- do not upload unrelated canvas assets;
- do not scan or upload the whole board;
- do not send API keys, local config files, or provider settings secrets;
- do not change provider/model silently to avoid a confirmation.

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

1. `canvas.get_frame_input` when the user clicked `Send to Codex`.
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

Do not hardcode the active provider when provider settings are available.

Default image behavior:

- prompt-only text-to-image defaults to Codex native GPT image 2 through the system `imagegen` skill;
- canvas reference/edit tasks default to Codex native GPT image 2 through the system `imagegen` skill after loading local source images with `view_image`;
- do not default local-reference image edits to Atlas Cloud;
- if the user explicitly names a provider/model, that user choice overrides saved defaults for this run, as long as that route can accept the required references.

Provider settings:

- After reading the bounded canvas context and before choosing the route, read `canvas.get_provider_settings` and `canvas.get_provider_status`. Use them only for provider/model routing and credential preflight; do not turn a default Codex-native task into an Atlas setup prompt.
- If provider setup is `not_started` or `skipped`, use the built-in Codex image route unless the user explicitly asks for an external provider/model.
- If saved provider settings are `configured` and select an external image provider such as Atlas Cloud, honor that saved image provider for both prompt-only and reference/edit image tasks.
- If saved provider settings select `codex-native`, do not pass `codex-native` to `canvas.run_provider`; use the system `imagegen` built-in route instead.
- If saved provider settings select an external provider, call `canvas.run_provider` with explicit references. Choose the model from `settings.image.textModel` for prompt-only `text_to_image`, or `settings.image.editModel` for reference/edit `image_edit`; if the setting is absent, use the matching provider-status default such as `providers.atlas.models.imageText` or `providers.atlas.models.imageEdit`.
- If the selected external provider is missing credentials or cannot accept local reference media, stop and report provider setup requirements. Do not silently switch to prompt-only generation.

Canvas reference/edit route:

- For each local CoFlow image reference, call `view_image` on its absolute path before using built-in `image_gen`; this makes the file available to the built-in edit/reference flow.
- Use the system `imagegen` skill's built-in mode for the default edit/reference generation. After generation, normalize the saved output path and write it back with `canvas.insert_media`.
- If the user/settings explicitly require an external provider, call `canvas.run_provider` after Codex has already read and normalized the canvas context. Pass:
  - `mediaType: "image"`;
  - `provider`: the provider selected by user instruction or saved provider settings only when it is an external/reference-capable provider;
  - `model`: the selected text or edit image model when provider settings/status provides one;
  - `generationMode: "image_edit"` when references are present, otherwise `text_to_image`;
  - `prompt`: only the user request plus canvas annotation text/spatial guidance;
  - `references`: the exact local source/reference assets from the bounded frame/selection/viewport context.
- If an explicitly selected external route is unavailable, stop and explain the missing route/provider setup. Do not silently switch to prompt-only generation for a reference/edit task.

Default model intent:

- text-to-image: GPT image 2;
- image edit / image-to-image: GPT image 2 edit;
- reference generation: GPT image 2 edit/reference mode.

If the explicitly selected external provider is not ready, stop and report the provider setup error. Do not insert mock images, do not generate a random image, and do not use a text-only fallback for a reference/edit task.

`canvas.run_provider` only generates and materializes a local output file. It does not read canvas state and it does not write to the canvas. After either Codex native generation or `canvas.run_provider` returns a local output file, always call `canvas.insert_media` immediately.

Preferred writeback call shape:

```json
{
  "mediaType": "image",
  "providerResult": "<the complete successful canvas.run_provider result object>",
  "skillName": "coflow-image"
}
```

If you do not pass `providerResult`, then pass `mediaType` plus the returned `localPath`, `absolutePath`, `src`, provider/model, and prompt explicitly. Never call `canvas.insert_media` without generated media path fields. A result from Codex native generation, an external skill, MCP, or another provider must be normalized to this minimum shape before writeback.

## Canvas quick edit boundary

CoFlow does not use active Skill session mode. Do not call or expect `canvas.activate_skill_session`, `canvas.get_active_skill_session`, or `canvas.clear_active_skill_session`.

Frame actions are context bridge actions only: selected frames show `Send to Codex`, which publishes Frame Input and waits for Codex/user instruction.

Canvas-side Quick Edit, when present, is a separate single-selected-image inline prompt flow for simple one-shot edits such as color change, background cleanup, object tweak, remove background, or upscale. It should not be used for frame, multi-object, video, 3D, or ambiguous tasks, and it must not bypass this skill's Codex-owned context understanding for complex work.

## Writeback

Always preserve the source image and annotations unless the user explicitly asks to replace them.

After successful generation, call `canvas.insert_media` with:

- `mediaType: "image"`;
- the complete successful `canvas.run_provider` result as `providerResult`, or explicit generated `localPath` / `absolutePath` / `src` from Codex native output;
- local/absolute output path;
- prompt;
- provider;
- model;
- skillName: `coflow-image`;
- output dimensions when available (`outputWidth`, `outputHeight`);
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

# CoFlow Skill Guide

Languages: [English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

This guide explains the user-facing CoFlow skills. The executable skill instructions remain in `coflow/skills/*/SKILL.md`; those files are the canonical runtime instructions for Codex.

## Core Mental Model

CoFlow skills do not turn the canvas into a provider form. They let Codex read bounded visual context, choose a generation route, and write the result back to the canvas.

Use CoFlow when the task depends on:

- selected media on the canvas;
- a frame and its annotations;
- visible canvas context;
- version lineage and writeback;
- local generated-media files and metadata.

## Core Skills

### `coflow-open`

Open the local CoFlow canvas.

Use it when:

- you want to start or resume a CoFlow board;
- you need the local canvas URL;
- you want Codex to verify the whiteboard is running.

Example prompts:

```text
Open CoFlow.
Open the CoFlow canvas in the browser.
Check whether the CoFlow board is running.
```

### `coflow-provider-setup`

View or change image/video provider defaults.

Use it when:

- you want to see current image and video model defaults;
- you want to switch image generation to Atlas Cloud;
- you want to switch video models, such as Seedance or Kling;
- you need to diagnose missing Atlas Cloud credentials.

Example prompts:

```text
Show my CoFlow provider settings.
Switch video generation to Seedance 2.0 Mini.
Use Atlas Cloud for image generation.
Check whether Atlas Cloud is connected.
```

Atlas Cloud API key link:

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

### `coflow-model-list`

Summarize CoFlow's configured provider/model catalog.

Use it when:

- you want to know which image/video models CoFlow supports locally;
- you want a concise list of available Atlas Cloud model families;
- you want to choose a model without typing raw model ids.

Example prompts:

```text
What image and video models does CoFlow support?
List the available CoFlow video models.
Which model should I use for reference-to-video?
```

### `coflow-image`

Generate or edit images from canvas context.

Use it when:

- you want prompt-only text-to-image output on the canvas;
- you selected an image and want a revised version;
- you framed source images and annotations;
- you need the output to appear back on the whiteboard.

Example prompts:

```text
Generate a 9:16 poster and place it on the canvas.
Edit the selected image: make the background warmer.
Use this framed product image and create three ad variants.
```

Important behavior:

- prompt-only output is inserted as standalone media;
- reference-based edits should create traceable versions;
- image defaults use Codex built-in GPT Image 2 unless the user selects an external provider;
- external provider asset sharing is task-scoped.

### `coflow-video`

Generate or revise videos from prompt, image, video, or framed context.

Use it when:

- you want text-to-video;
- you selected an image and want image-to-video;
- you selected a video and want revision/regeneration;
- you want video output written back to the canvas.

Example prompts:

```text
Create a 5-second vertical video from this product image.
Turn the selected frame into a cinematic video.
Regenerate this video with softer motion.
```

Important behavior:

- default video provider is Atlas Cloud Seedance 2.0;
- model-specific options are validated before provider execution;
- output dimensions and aspect ratio should be preserved on writeback.

## Scenario Skills

Scenario-specific skills are intentionally not shipped yet. CoFlow currently exposes only the core canvas, image, video, provider setup, and model list skills.

## Writeback Rules

For CoFlow-contextual tasks, generation is not complete until the result is written back to the canvas with `canvas.insert_media`.

Minimum generated-media fields:

```json
{
  "mediaType": "image | video",
  "localPath": "...",
  "absolutePath": "...",
  "src": "...",
  "prompt": "...",
  "provider": "...",
  "model": "..."
}
```

If generation succeeds but no writable media path or URL is available, report the problem instead of pretending the task is complete.

## Safety Boundary

Opening the canvas is not blanket permission to upload assets.

External provider calls may use only the selected, framed, or visible bounded assets needed for the current task. Do not upload unrelated board assets, local config files, API keys, or secrets.

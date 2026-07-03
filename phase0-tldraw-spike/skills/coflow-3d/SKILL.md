---
name: coflow-3d
description: Prepare or run 3D generation/revision workflows from CoFlow image, video frame, or 3D references.
---

# 3D

This is the first 3D scene skill. It defines the Codex-side workflow and result contract, while the canvas remains a visual context and writeback surface.

## Current capability boundary

The current canvas can reliably display images and videos as native tldraw media. Full 3D preview is a Phase 2+ product capability and may require a dedicated preview card or viewer.

Until native 3D preview exists, generated 3D outputs should be:

- saved locally as `.glb`, `.gltf`, `.obj`, or provider-supported files;
- represented on canvas by a thumbnail/image preview when available;
- linked to the source references;
- recorded with `mediaType: "model3d"` in metadata when the writeback layer supports it.

If the current writeback tool only accepts image/video, insert a generated thumbnail preview and include the absolute 3D file path in metadata or the Codex response.

## Inputs

Read context in this priority:

1. latest Frame Input;
2. selected image/video frame/3D object;
3. visible viewport when unambiguous;
4. prompt only.

Potential references:

- product image;
- character concept image;
- orthographic views;
- video frame;
- existing 3D model;
- annotation notes about geometry, material, camera, or scale.

## Output

Return:

- generated 3D local file path;
- optional thumbnail local path;
- provider/model metadata;
- prompt;
- source references;
- camera/view notes if available.

## Guardrails

- Do not pretend the canvas supports full 3D editing if it only has thumbnail writeback.
- Prefer explicit user confirmation when multiple visible images/models could be the source.
- Keep generated 3D assets local-first and traceable.

---
name: coflow-social-repurpose
description: Repurpose a selected canvas image or generated asset into platform-specific social creative variants.
---

# Social Repurpose

Use this scene skill when the user wants one asset adapted into multiple social formats.

## Inputs

Read canvas context in this priority:

1. Frame Input;
2. selected image or object group;
3. visible viewport when unambiguous;
4. prompt only.

If multiple source assets are visible and none is selected/framed, ask the user to select or frame the source.

## Default variants

Unless the user specifies otherwise, create up to 3 variants:

- square post `1:1`;
- vertical story/reel `9:16`;
- horizontal banner/ad `16:9`.

The skill may reduce the number of variants when the source context is weak or provider budget is a concern.

## Writeback

Place variants in a compact grid to the right of the source and link them back to the parent asset/frame. Preserve the original.

Metadata should include:

- platform/format;
- aspect ratio;
- prompt;
- source references;
- provider/model;
- local path.

## Guardrails

- Do not crop away the main subject unless the requested format requires it and the prompt says how to handle it.
- Do not treat this as a generic image edit if the user asked for multi-platform adaptation.

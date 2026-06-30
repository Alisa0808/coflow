---
name: coflow-style-exploration
description: Explore multiple visual styles from selected canvas references, mood images, annotations, or a prompt.
---

# Style Exploration

Use this scene skill when the user wants several style directions from one or more references.

## Inputs

- source image or object;
- optional mood/style reference images;
- notes about audience, tone, brand, or medium.

Read context in this priority:

1. Frame Input;
2. selected objects;
3. visible viewport when unambiguous;
4. prompt only.

## Output

Default to 3 style directions:

- clean/premium;
- expressive/editorial;
- experimental/cinematic.

Adapt the labels to the user's brief.

## Writeback

Place outputs in a horizontal row or grid, linked to the source/reference set. Metadata must preserve the style label, prompt, provider/model, local path, and references.

## Guardrails

- Preserve the source subject unless the user asks for conceptual exploration.
- Do not randomly choose among multiple visible sources.

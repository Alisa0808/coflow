---
name: style-exploration
description: "Use with Codex Media Canvas when the user wants multiple visual style directions from selected reference assets."
---

# Style Exploration

This is a Codex Media Canvas scene preset for reference-driven visual exploration.

## Use when

- The user selects one or more reference images.
- The user asks for visual directions, mood exploration, style exploration, or creative variants.

## Output

Generate several distinct but related directions, usually 3-4 for v1.

Each direction should preserve a clear relationship to the selected references while exploring a different mood, color system, composition, or production style.

## Required insertion

For each output:

1. Save the generated image locally.
2. Call `canvas.create_version` when there is one clear parent asset, or `canvas.insert_asset` with `references` metadata when multiple references are used.
3. Set `skillName` to `style-exploration`.
4. Include provider, model, prompt, params, and reference asset ids.

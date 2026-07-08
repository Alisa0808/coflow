---
name: coflow-video-ad-keyframes
description: Generate video ad keyframes or storyboard frames from CoFlow references and a campaign brief.
---

# Video Ad Keyframes

Use this scene skill for storyboard/keyframe generation before or alongside video generation.

## Inputs

- product/reference image;
- optional brand/style images;
- optional frame annotations;
- campaign brief, target audience, offer, or platform.

Read context in this priority:

1. latest Frame Input;
2. selected canvas objects;
3. visible viewport when unambiguous;
4. prompt only.

## Output

Default to 3 keyframes:

1. hook/opening shot;
2. product/value shot;
3. CTA/ending shot.

If the user asks for a finished video, use the video skill after keyframe planning. If the provider cannot follow all keyframes, explain the fallback.

## Writeback

Write storyboard frames as native image assets in sequence, with optional lineage arrows from the source and labels that describe each frame. Do not replace the original source asset.

## Guardrails

- Do not promise frame-perfect timeline editing.
- Keep video provider parameters aligned with the current provider documentation.
- If the user asks for Seedance/Kling/etc., map the scene plan to the provider-supported reference mode through Codex, not through a canvas form.

---
name: video-ad-keyframes
description: "Use with Codex Media Canvas when the user wants video ad storyboard frames, keyframes, or frame-guided video generation prompts from selected media."
---

# Video Ad Keyframes

This is a Codex Media Canvas scene preset. It focuses on frame-guided video concepting, not full timeline video editing.

## Use when

- The selected asset is a product/reference image, video, or extracted video frame.
- The user asks for video ad ideas, storyboard frames, keyframes, or shot revisions.

## Output

Allowed v1 outputs:

- storyboard/keyframe images;
- edited selected frame;
- prompt package for video generation;
- generated video clip only when the configured provider supports it.

## Required insertion

For image/keyframe outputs:

1. Save generated frame/keyframe images locally.
2. Call `canvas.create_version` with the selected parent asset id.
3. Set `skillName` to `video-ad-keyframes`.
4. Include timestamp/source video metadata when available.

If producing a prompt package only, update the request result with the prompt package and do not pretend a video was generated.

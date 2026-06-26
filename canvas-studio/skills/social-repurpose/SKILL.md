---
name: social-repurpose
description: "Use with Codex Media Canvas when the user wants selected media adapted for multiple social platforms or aspect ratios."
---

# Social Repurpose

This is a Codex Media Canvas scene preset. It adapts one selected source asset into platform-specific versions.

## Use when

- The user asks to adapt a selected image for social platforms.
- The user mentions Xiaohongshu, Instagram, Story, Reels, YouTube thumbnail, ads, banners, or cross-platform versions.

## Output

Generate platform-specific outputs, usually 3-5 variants for v1:

- Xiaohongshu cover / portrait;
- Instagram square or portrait;
- Story/Reels vertical;
- YouTube thumbnail or horizontal banner;
- horizontal ad/banner when requested.

## Required insertion

For each output:

1. Save the generated asset locally.
2. Call `canvas.create_version` with the selected parent asset id.
3. Set `skillName` to `social-repurpose`.
4. Include provider, model, prompt, params, target platform, and aspect ratio in metadata.

---
name: product-marketing-set
description: "Use with Codex Media Canvas when the user wants a set of product marketing, ad, ecommerce, or social media visuals from the selected product/reference asset."
---

# Product Marketing Set

This is a Codex Media Canvas scene preset. It must run through the Codex Media Canvas workflow and MCP tools; do not mutate canvas files directly.

## Use when

- The selected asset is a product image or brand/reference visual.
- The user asks for ad creatives, ecommerce images, social assets, product visuals, or a marketing set.

## Output

Generate a small coherent set of variants, usually 3-4 for v1. Each output should be a complete raster visual suitable for review, not a separate text overlay.

Suggested directions:

- clean hero product visual;
- lifestyle/social version;
- benefit-led ad visual;
- promotional/launch variant.

## Required insertion

For each output:

1. Save the generated image locally.
2. Call `canvas.create_version` with the selected parent asset id.
3. Set `skillName` to `product-marketing-set`.
4. Include provider, model, prompt, and params metadata.

The canvas store handles right-side/grid placement.

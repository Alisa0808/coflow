---
name: coflow-product-marketing
description: Create a small set of product marketing images from CoFlow references, annotations, and a user brief.
---

# Product Marketing

Use this scene skill when the user wants product/ad/social marketing visuals from canvas references.

This is a scene workflow. It should call the image skill or provider executor through Codex, then write the outputs back to the canvas. It must not become a new provider form inside the whiteboard.

## Inputs

Read context in this priority:

1. latest Frame Input;
2. current canvas selection;
3. visible viewport only if the user clearly refers to visible assets;
4. prompt only for pure text-to-image marketing concepts.

Expected inputs:

- product image;
- optional brand/style references;
- optional annotations;
- user brief, audience, channel, or format.

## Output

Generate 2-4 variants by default unless the user asks for a different count:

- product hero image;
- social post/ad crop;
- clean marketplace image;
- optional lifestyle or premium variant.

Write each result back with:

- native image media;
- prompt and user brief;
- reference assets;
- provider/model metadata;
- lineage from source product/reference frame;
- grid placement to the right of the source.

## Prompt policy

Use the user's marketing goal and canvas annotations. Preserve the source product identity unless the user explicitly asks to redesign it.

Do not stamp prompt/provider/model text onto generated images.

## Acceptance

Codex should be able to explain:

- which canvas context was used: frame, selection, viewport, or prompt;
- which source product image was selected;
- how many variants were produced;
- where the output files were saved.

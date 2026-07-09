# CoFlow

CoFlow is an agent-native media canvas for Codex.

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

It combines an infinite tldraw whiteboard with Codex skills and MCP tools so you can point at visual context, describe the change, generate a new image or video, and write the result back onto the canvas with local assets and version lineage.

## Design Philosophy

CoFlow starts from a simple premise: pair Codex, one of the strongest AI agents available to developers today, with an infinite whiteboard canvas.

Codex provides the execution harness: it reads bounded visual context, turns open-ended intent into actionable prompts, chooses the right model and provider route, saves generated assets locally, and writes results back with lineage. The canvas preserves the free-form side of creative work: spatial thinking, references, annotations, alternate versions, and branching ideas, without reducing the workflow to a rigid form or provider panel.

## What CoFlow Is

CoFlow is not a provider form, a lightweight Canva clone, or a static image board.

The canvas is the visual context surface:

- select or frame source images and videos;
- add arrows, boxes, notes, and spatial annotations;
- let Codex read bounded canvas context through MCP;
- generate through Codex native image tools or external providers;
- write generated media back as native tldraw image/video objects;
- preserve prompts, model/provider metadata, local paths, and lineage links.

The core workflow is:

```text
select or frame media on canvas
→ describe the edit/generation request in Codex
→ CoFlow skills read bounded context
→ Codex chooses the right generation route
→ generated media is inserted back onto the canvas
→ linked versions remain traceable
```

## Current Status

CoFlow is in a Phase 1 RC state focused on the image/video writeback loop.

Working today:

- tldraw-based infinite canvas;
- native image and video asset writeback;
- prompt-only image generation writeback without accidental lineage links;
- reference-based image/video workflow boundaries;
- Atlas Cloud provider execution for supported external image/video models;
- provider/model onboarding and status tools;
- multi-page canvas persistence;
- local `.coflow/` asset and metadata store;
- Codex plugin manifest, skills, and MCP server.

Not claimed yet:

- full 3D canvas preview/editing;
- hosted multi-user collaboration;
- a polished consumer SaaS UI.

## Repository Layout

The active plugin/runtime lives in:

```text
coflow/
```

Important files:

```text
coflow/.codex-plugin/plugin.json  # Codex plugin manifest
coflow/.mcp.json                  # MCP server config
coflow/mcp-server.mjs             # Codex-facing MCP tools
coflow/server.mjs                 # local canvas server
coflow/src/                       # tldraw canvas app
coflow/skills/                    # CoFlow Codex skills
coflow/lib/                       # provider/runtime helpers
coflow/tests/                     # regression tests
```

Generated assets and local runtime state are stored under the current workspace's `.coflow/` and are ignored by git.

## Quick Start

```bash
cd coflow
npm install
npm run build
npm run serve
```

Then open:

```text
http://127.0.0.1:5176/
```

For plugin development, the local personal marketplace can point `~/plugins/coflow` at `coflow`, then install with:

```bash
codex plugin add coflow@personal
```

After reinstalling a local plugin version, start a new Codex thread or restart Codex so new skills and MCP tools are picked up.

## Provider Setup

Default image behavior uses Codex built-in GPT Image 2 for image generation and image editing/reference work when available.

Default video behavior uses Atlas Cloud Seedance 2.0 for text-to-video and reference/video editing routes.

Create an Atlas Cloud API key with this invite link:

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

Then add the key to a local env file:

```bash
ATLASCLOUD_API_KEY=...
```

Supported local env file locations:

```text
.env.local
coflow/.env.local
```

Do not commit API keys or paste secrets into chat.

## Supported Models

CoFlow uses friendly model names in user-facing docs and skills. Internal provider model ids stay in runtime configuration and diagnostics.

Defaults:

- Image generation/editing: Codex built-in GPT Image 2
- Video generation/editing: Atlas Cloud Seedance 2.0

Atlas Cloud image options:

- GPT Image 2
- Nano Banana 2
- Nano Banana 2 Lite
- Nano Banana Pro
- Seedream 5.0 Pro
- Seedream 5.0 Lite
- Seedream 4.5
- Wan 2.7
- Grok Imagine Image
- Qwen Image 2.0

Atlas Cloud video options:

- Seedance 2.0
- Seedance 2.0 Mini
- Kling V3.0 Turbo / Standard / Pro / 4K
- Kling O3 Standard / Pro / 4K
- Wan 2.7
- HappyHorse 1.1
- Grok Imagine Video
- Grok Imagine Video v1.5

## Codex Skills

Core plugin skills:

- `coflow-open` opens the local canvas.
- `coflow-provider-setup` reads or changes image/video provider defaults.
- `coflow-model-list` summarizes configured model support.
- `coflow-image` handles image generation and image editing from canvas context.
- `coflow-video` handles text-to-video and reference/video revision workflows.

## Development Checks

Run from `coflow/`:

```bash
npm test
npm run build
```

Plugin manifest validation:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py coflow
```

## Design Principles

- The canvas is visual context and writeback surface.
- Codex owns intent understanding, skill routing, and provider orchestration.
- Use native tldraw assets/shapes/bindings before inventing custom records.
- Prompt-only generation should not create fake lineage links.
- Reference-based generation should preserve source relationships.
- Provider setup is not blanket upload permission; asset sharing is task-scoped.
- Local-first storage should make generated media and metadata inspectable.

## License

MIT

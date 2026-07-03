---
name: coflow-model-list
description: List CoFlow providers, API-key status, default models, and supported built-in image/video models. Use when the user asks what models are available, which provider is active, whether keys are configured, or how to switch models.
---

# CoFlow Model List

Use this skill when the user wants to inspect or switch CoFlow's configured media generation models.

This is a CoFlow catalog skill, not an Atlas Cloud global discovery skill. In normal user-facing replies, list only the providers and models that CoFlow has configured in its own provider status/catalog.

## Workflow

1. Read `canvas.get_provider_settings` when available to inspect saved defaults.
2. Read `canvas.get_provider_status` when available to inspect provider availability, API-key status, and CoFlow's built-in model catalog.
3. Present the current defaults in these four user-facing modes:
   - Image generation
   - Image editing
   - Text-to-video
   - Video editing / reference video
4. Show friendly provider and model names by default. Do not expose raw model ids such as `bytedance/...` unless the user asks for API/debug details.
5. Show key status in plain language:
   - Codex native: available; no external API key needed.
   - Atlas Cloud: configured or not configured.
   - Custom providers: configured only when the required environment variable or endpoint is present.
6. If the user asks to switch a default model, use `canvas.set_provider_settings` with the selected provider/model intent. Never store API keys in provider settings.
7. If the user asks "what models do we support", answer from CoFlow's built-in catalog only. Do not query Atlas Cloud's entire model catalog just to answer a normal model-list request.
8. Only query Atlas Cloud MCP `atlas_list_models` or the official Atlas Cloud model API/docs when the user explicitly asks to add/verify a model that is not already in CoFlow's built-in catalog, or when maintaining the CoFlow catalog itself.

## Normal response shape

For a status request, keep the answer short and user-facing:

```text
Current defaults:

- Image generation: Codex built-in GPT Image 2
- Image editing: Codex built-in GPT Image 2
- Text-to-video: Atlas Cloud Seedance 2.0
- Reference/video editing: Atlas Cloud Seedance 2.0

Connection status:

- Codex built-in image model: Ready
- Atlas Cloud: Connected
```

Use `Atlas Cloud: Needs API key` when the Atlas Cloud key is missing. Then list CoFlow's configured models only if the user asked for the model list.

If the user asks for the model list, group all configured local catalog entries by provider and media type. Do not show only examples. Do not query Atlas Cloud's full global catalog as the default answer.

## Built-in providers

CoFlow ships with:

- Codex native image generation/editing, available without an external provider key.
- Atlas Cloud image/video models, requiring `ATLASCLOUD_API_KEY` for provider-backed generation.
- Optional custom providers configured through `coflow-provider-setup`.

## User-facing model families

Image model families may include these CoFlow-configured models when present in `canvas.get_provider_status`:

- GPT image 2
- Nano Banana 2
- Nano Banana 2 Lite
- Nano Banana Pro
- Seedream 5.0 Lite
- Seedream 4.5
- Wan 2.7
- Grok Imagine Image
- Qwen Image 2.0

Video model families may include these CoFlow-configured models when present in `canvas.get_provider_status`:

- Seedance 2.0
- Seedance 2.0 Mini
- Kling V3.0
- Kling O3
- Wan 2.7
- HappyHorse 1.1
- Grok Imagine Video

HappyHorse 1.1 is a video model. Do not list it under image models.

The exact available models and modes should come from `canvas.get_provider_status`, not this prose list.

## Guardrails

- Do not ask users to paste API keys into chat.
- Do not print secret values.
- Do not present Atlas Cloud's full global catalog as CoFlow's supported catalog.
- Do not guess Atlas Cloud model ids. Use `atlas_list_models` or Atlas Cloud official model docs/API only when a model is missing from CoFlow's local catalog and the user explicitly wants to verify/add it.
- Provider selection is not generation. Changing a default should not upload media or call a generation provider.

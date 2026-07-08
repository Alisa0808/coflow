---
name: coflow-provider-setup
description: View or change CoFlow provider/model defaults. Use when the user asks which provider/model is active, wants to change image/video defaults, wants to skip setup, rerun setup, or diagnose generation setup.
---

# Provider Setup

Use this skill as the single user-facing entry for provider/model defaults.

Users should not need separate skills for "view provider", "change model", "skip setup", or "rerun setup".

## Workflow

1. Read `canvas.get_provider_settings` when available to inspect onboarding state and media defaults.
2. Read `canvas.get_provider_onboarding` when available to decide whether this is first-run, skipped, configured, or rerun setup.
3. Read `canvas.get_provider_status` for available provider/model metadata and redacted key-configuration diagnostics.
4. For normal "view provider status" requests, report only:
   - image generation default provider and friendly model name;
   - image editing/reference default provider and friendly model name;
   - text-to-video default provider and friendly model name;
   - video editing/reference-video default provider and friendly model name;
   - onboarding status;
   - whether each selected external provider is configured, without exposing secrets.
5. Do not expose raw provider model ids such as `bytedance/...` or internal intents such as `reference_to_video` in normal user-facing status. Use friendly model names such as "GPT image 2" or "Seedance 2.0".
6. If the user wants to change defaults, call `canvas.set_provider_settings`.
   - If the user switches image generation/editing to Atlas Cloud, save `image.provider: "atlas"` plus the selected `image.textModel` and/or `image.editModel` when a concrete model is chosen from the catalog.
   - When saving any external provider default, explain the asset-sharing boundary in plain language: opening the canvas alone uploads nothing; when the user later runs a CoFlow image/video generation task with that external provider selected, CoFlow may send only the selected/current-frame local asset(s) and prompt for that task to the provider.
   - After saving an Atlas Cloud image default, immediately read `canvas.get_provider_status` or `canvas.get_provider_onboarding`. If Atlas Cloud is not connected, guide the user to configure the Atlas Cloud API key before generation; do not imply that the selected Atlas image route is ready without the key.
7. If the user chooses "Keep defaults and set up Atlas Cloud", call `canvas.set_provider_settings` with `status: "configured"` and the default image/video values from `canvas.get_provider_onboarding`, then immediately read `canvas.get_provider_status` or `canvas.get_provider_onboarding` again to check whether Atlas Cloud is connected.
   - If Atlas Cloud is connected, tell the user that image generation/editing uses Codex built-in GPT Image 2 and video generation/editing uses Atlas Cloud Seedance 2.0.
   - If Atlas Cloud is not connected, do not present setup as fully ready. Tell the user that defaults are saved but Atlas Cloud needs an API key, then guide them to create one at:

     ```text
     https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG
     ```

     Use this exact user-facing instruction:

     ```text
     CoFlow does not currently have an API-key input inside the canvas UI. Create an Atlas Cloud API key, then choose one of these setup paths:

     1. Ask Codex to save it to the local CoFlow environment for you.
     2. Or, if you prefer not to paste secrets into chat, add `ATLASCLOUD_API_KEY` to your local CoFlow `.env.local` file and restart CoFlow.
     ```
8. If the user wants to skip setup for now, call `canvas.set_provider_settings` with:

   ```json
   {
     "status": "skipped"
   }
   ```

9. If the user wants to rerun setup, read current settings, ask/confirm the desired image/video defaults when needed, then call `canvas.set_provider_settings` with `status: "configured"`.
10. Diagnose missing credentials during provider setup, and again when generation is about to run and the selected provider needs credentials. If Atlas Cloud credentials are missing, tell the user to create a key at:

   ```text
   https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG
   ```

   Do not tell users to look for an API-key input box in the CoFlow canvas page. That UI does not exist yet.

   Normal users should see this setup guidance:

   ```text
   CoFlow does not currently have an API-key input inside the canvas UI.

   To connect Atlas Cloud:
   1. Create an API key at https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG
   2. If you want Codex to save it locally, say: "Save my Atlas Cloud API key to CoFlow local config."
   3. If you prefer not to paste secrets into chat, add `ATLASCLOUD_API_KEY` to your local CoFlow `.env.local` file and restart CoFlow.
   ```

   Do not expose internal environment-file paths unless the user is debugging local installation or explicitly asks where the local config file is.
11. If the local server is already running and the key is added outside Codex's local setup step, tell the user they may need to restart CoFlow before the new key is detected.
12. Do not print API keys back to the user or store them in provider settings.
13. If the user wants to use a custom provider, collect the provider profile first, then save only non-secret provider/model defaults with `canvas.set_provider_settings`. API keys and bearer tokens must stay in environment variables, never in provider settings.
14. A saved custom provider profile is configuration metadata, not proof that generation can run. Execution still requires a supported adapter path or generic endpoint/response schema.

## First-run choices

When onboarding status is `not_started`, present this exact default explanation:

```text
CoFlow is ready to use with these defaults:

- Image generation and image editing: Codex built-in GPT Image 2
- Video generation and video editing: Atlas Cloud Seedance 2.0

To use the default video workflow, connect your Atlas Cloud API key.
```

If `canvas.get_provider_onboarding` reports `connectionStatus.atlasCloud: "connected"`, replace the final line with:

```text
Connection status:
- Codex built-in image model: Ready
- Atlas Cloud: Connected

Keep these defaults to save them, or customize providers and models.
```

Then present these choices in plain language:

1. Keep defaults and set up Atlas Cloud, or keep connected defaults when Atlas Cloud is already connected
   - Save Codex built-in GPT Image 2 for image generation, image editing, and local-reference image edits.
   - Save Atlas Cloud Seedance 2.0 for text-to-video, reference-to-video, and video editing.
   - Immediately check whether the Atlas Cloud API key is connected when it is not already connected.
   - If the key is missing, guide the user to the Atlas Cloud API-key URL and clearly show `Atlas Cloud: Needs API key`.
   - If the key is already connected, clearly show `Atlas Cloud: Connected` and do not ask the user to add another key.
2. Customize providers and models
   - Step 1: Ask what they want to configure:
     - Image models
     - Video models
     - Both image and video models
   - Step 2: Show CoFlow's current local model catalog grouped by provider and media type.
   - This catalog comes from `canvas.get_provider_status`; do not query Atlas Cloud's full catalog for the normal customize flow.
3. Skip for now
   - Do not start Atlas Cloud key setup.
   - Tell the user exactly:

     ```text
     You can use Codex built-in GPT Image 2 for image tasks. Video generation and Atlas Cloud models will require setup later.
     ```

Do not make provider setup feel like a required canvas-start blocker. It is required only when the chosen generation route needs an external provider credential or a custom provider profile.

Provider setup is not a blanket upload permission. It records provider/model preferences and credential readiness. Actual asset sharing is task-scoped: only after the user invokes a CoFlow image/video generation task should the generation skill send the bounded selected/frame/viewport references needed for that task to the selected external provider.

## What `shouldPrompt` means

`shouldPrompt` is an internal onboarding boolean, not a user-facing label.

- `true` means no provider/model setup decision has been saved yet.
- It should trigger one concise first-run setup offer when provider setup is relevant.
- It is not by itself proof that generation cannot run.
- It should not be printed verbatim to users.

## Onboarding state

Provider defaults are stored outside the canvas document:

```text
<repo>/.coflow/metadata/provider-settings.json
```

This file may store:

- `status`: `not_started`, `skipped`, or `configured`;
- image default provider/model intent;
- video default provider/model intent;
- custom provider display names, model ids, mode support, and environment variable names when needed.

It must never store API keys or bearer tokens.

API key persistence:

- API keys stay in local environment files or the running server environment, for example `.env.local`.
- Once the local server reads a key, later Codex sessions using the same local CoFlow install/workspace can reuse it.
- Keys are not stored in chat and not stored in `.coflow/metadata/provider-settings.json`.
- A new machine, new local install, or different workspace may need setup again.
- The CoFlow canvas UI does not currently include an API-key input field. Do not imply that users can paste a key into the canvas page.
- If the user asks "where do I paste the key?", answer that there are two supported paths:
  1. Ask Codex to save it to local CoFlow config.
  2. Manually add `ATLASCLOUD_API_KEY` to the local CoFlow `.env.local` file, then restart CoFlow.

When the user confirms provider setup or wants to change defaults, call `canvas.set_provider_settings`.
When the user wants to skip setup for now, set `status: "skipped"`.

## User-facing entry points

All of these belong in this one skill:

- "Show current providers and models"
- "Show configured providers and API-key status"
- "Use default providers and models"
- "Change the default image model to GPT image 2"
- "Change the default video provider to Seedance, Kling, or Atlas Cloud"
- "List all supported models"
- "Use a custom provider"
- "Skip provider setup for now"
- "Rerun provider setup"
- "Why did this generation fail?"

Normal status response should be concise, for example:

```text
Current defaults:

- Image generation: Codex built-in GPT Image 2
- Image editing/reference: Codex built-in GPT Image 2
- Text-to-video: Atlas Cloud Seedance 2.0
- Reference/video editing: Atlas Cloud Seedance 2.0

Connection status:

- Codex built-in image model: Ready
- Atlas Cloud: Connected
```

Use `Atlas Cloud: Needs API key` when the Atlas Cloud key is missing. Do not print low-level credential field names, model ids, or internal mode ids unless the user asks for diagnostics or API values. If needed, put raw model ids under an advanced/details section, never as the main status.

If the user wants the full configured model catalog or wants to switch models, tell them to use `coflow-model-list`. That skill is the user-facing place to list providers, supported models, and key status.

## Defaults

- Built-in default image provider/model: Codex native GPT image 2
  - user-facing text-to-image label: GPT image 2
  - user-facing image edit/reference label: GPT image 2
- Built-in default video provider/model: Atlas Cloud Seedance 2.0
  - user-facing text-to-video label: Seedance 2.0
  - user-facing reference/video-edit label: Seedance 2.0

Saved provider settings override these built-in defaults. User instructions in the current request override saved settings for that run.

If saved image settings select Atlas Cloud, `coflow-image` must route image generation/editing through `canvas.run_provider` with the selected Atlas image model. If Atlas Cloud is missing credentials, the setup response must guide the user to configure `ATLASCLOUD_API_KEY` rather than silently falling back to Codex built-in imagegen.

CoFlow ships with a small verified built-in Atlas Cloud model catalog so users can switch common models without typing raw model ids. This is not intended to be the complete Atlas Cloud catalog. If the user asks for a model not listed locally, check the current Atlas Cloud model page/API tab before adding it.

Built-in Atlas Cloud image model families currently include:

- Nano Banana 2;
- Nano Banana 2 Lite;
- Nano Banana Pro;
- Seedream 5.0 Lite;
- Seedream 4.5;
- Wan 2.7;
- Grok Imagine Image;
- Qwen Image 2.0.

Built-in Atlas Cloud video model families currently include:

- Seedance 2.0 Mini;
- Kling V3.0 Turbo / Standard / Pro / 4K;
- Kling O3 Standard / Pro / 4K;
- Wan 2.7;
- HappyHorse 1.1;
- Grok Imagine Video.

Default video remains Seedance 2.0 unless the user changes it.

## Custom providers

When the user chooses a custom provider, ask for the smallest provider profile that can be executed safely:

- Provider display name and stable provider id.
- Supported media types: image, video, 3D, audio, or other.
- Supported generation modes, for example text-to-image, image edit, image/reference generation, text-to-video, reference-to-video, video regeneration, start/end-frame video, or multi-reference video.
- API base URL and endpoint paths for submit, upload, status polling, and result retrieval.
- Documentation URL or pasted API reference for the selected model/provider.
- Authentication method and environment variable name, for example `MY_PROVIDER_API_KEY`. Never ask the user to paste the secret value into chat.
- Model ids and the default model for each supported mode.
- Required and optional request fields, including names, types, defaults, and provider-specific constraints.
- Reference asset requirements: supported file types, maximum file size, whether local files must be uploaded first, whether public URLs are required, and how multiple references should be represented.
- Response schema: where to find output URL, localizable file, job id, status, error message, and metadata.
- Async behavior: polling endpoint, polling interval, timeout, terminal success states, terminal failure states.
- Output artifact type and extension, for example PNG, JPG, MP4, GLB, or ZIP.

For a custom provider, prefer OpenAI-compatible or Atlas Cloud-like APIs when available. If the provider is not compatible, the user must provide enough API documentation to map submit, upload/reference handling, polling, and output extraction explicitly.

If any required custom-provider information is missing, stop and ask for that information. Do not guess API fields or silently map a custom provider to Atlas Cloud.

When saving a custom provider, pass it under `customProviders` and reference it from `image.provider` or `video.provider` by its stable provider id.

## Guardrails

- Never print API keys, token values, or Authorization headers.
- Treat provider setup as Codex-side configuration, not canvas UI state.
- Do not invent Atlas Cloud API fields. If a field is uncertain, check the current Atlas Cloud model documentation or the local provider adapter before changing code.

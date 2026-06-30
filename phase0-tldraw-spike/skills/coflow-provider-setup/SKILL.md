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
3. Read `canvas.get_provider_status` only for available provider/model metadata and redacted diagnostics.
4. For normal "view provider status" requests, report only:
   - image default provider and model intent;
   - video default provider and model intent;
   - onboarding status;
   - settings path when useful.
5. Do not lead with whether Atlas Cloud credentials are configured. Credential presence is a runtime diagnostic, not the main provider status UX.
6. If the user wants to change defaults, call `canvas.set_provider_settings`.
7. If the user wants to accept the default image/video providers and models, call `canvas.set_provider_settings` with `status: "configured"` and the default image/video values from `canvas.get_provider_onboarding`.
8. If the user wants to skip setup for now, call `canvas.set_provider_settings` with:

   ```json
   {
     "status": "skipped"
   }
   ```

9. If the user wants to rerun setup, read current settings, ask/confirm the desired image/video defaults when needed, then call `canvas.set_provider_settings` with `status: "configured"`.
10. Only when generation is about to run and the selected provider needs credentials, diagnose missing credentials. If Atlas Cloud credentials are missing, tell the user to add `ATLASCLOUD_API_KEY` to either:

   ```text
   <repo>/.env.local
   <repo>/phase0-tldraw-spike/.env.local
   ```

11. If the local server is already running, tell the user to restart it after changing `.env.local`.
12. Do not ask the user to paste the key into chat.

## Onboarding state

Provider defaults are stored outside the canvas document:

```text
<repo>/.coflow/metadata/provider-settings.json
```

This file may store:

- `status`: `not_started`, `skipped`, or `configured`;
- image default provider/model intent;
- video default provider/model intent.

It must never store API keys or bearer tokens.

When the user confirms provider setup or wants to change defaults, call `canvas.set_provider_settings`.
When the user wants to skip setup for now, set `status: "skipped"`.

## User-facing entry points

All of these belong in this one skill:

- "查看当前 provider / 模型"
- "使用默认 provider / 模型"
- "把图片默认模型改成 GPT image 2"
- "把视频默认 provider 改成 Seedance / Kling / Atlas Cloud"
- "这次跳过 provider setup"
- "重新配置 provider setup"
- "为什么这次生成失败"

Normal status response should be concise, for example:

```text
Image: Codex / image_edit
Video: Atlas Cloud / reference_to_video
Setup: configured
```

Do not print low-level credential fields unless the user asks for diagnostics or generation fails.

## Defaults

- Default image provider/model: Codex native GPT image 2
  - text-to-image: `gpt-image-2`
  - image edit/reference: `gpt-image-2`
- Default video provider/model: Atlas Cloud Seedance 2.0
  - text-to-video: `bytedance/seedance-2.0/text-to-video`
  - reference-to-video: `bytedance/seedance-2.0/reference-to-video`

## Guardrails

- Never print API keys, token values, or Authorization headers.
- Treat provider setup as Codex-side configuration, not canvas UI state.
- Do not invent Atlas Cloud API fields. If a field is uncertain, check the current Atlas Cloud model documentation or the local provider adapter before changing code.

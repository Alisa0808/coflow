---
name: codex-media-canvas
description: "Use when the user wants to open Codex Media Canvas, process queued canvas requests, revise selected images/video frames, or generate scene-preset media assets from canvas selection context."
---

# Codex Media Canvas

Codex Media Canvas is a Codex-driven media canvas. The canvas manages visual context, local files, annotations, queued requests, and asset lineage. Codex performs reasoning, Skill selection, provider orchestration, generation, and result insertion.

## Core rule

Do not call provider APIs directly from the browser canvas in v1. All generation/editing requests should route through Codex:

1. Read canvas selection/request through MCP.
2. Interpret the user instruction and canvas context.
3. Generate or edit media using Codex native generation, Atlas Cloud Skill/MCP/CLI, or a custom provider.
4. Save the output as a local file.
5. Insert the output through `canvas.insert_asset` or `canvas.create_version`.
6. Update the request with `canvas.update_request`.

Do not expose raw MCP JSON to normal users unless they ask to debug.

## Tool availability gate

This workflow requires these MCP tools:

- `canvas.get_selection`
- `canvas.insert_asset`
- `canvas.create_version`
- `canvas.get_asset_metadata`
- `canvas.claim_request`
- `canvas.update_request`

For video frame workflows, also use:

- `canvas.extract_video_frame`

If these tools are not callable, stop and tell the user:

```text
Codex Media Canvas 插件已经识别到，但 MCP 工具没有加载出来。请重启 Codex 或重新打开这个项目后再继续。
```

## Opening the canvas

When the user asks to open the canvas, provide the local app URL if known. In development, the default production server is:

```text
http://127.0.0.1:5174
```

If the user is developing the plugin, they can run:

```bash
npm run build
npm run serve
```

Do not start external browser windows unless the user explicitly asks.

## Processing queued canvas requests

When the user says any of:

- "continue processing canvas requests"
- "继续处理画布请求"
- "按画布请求生成"
- "处理 Codex Media Canvas"
- "开启自动处理模式"

Workflow:

1. Call `canvas.claim_request`.
2. If no request exists, tell the user Codex is waiting for a canvas request and they can select an asset, add annotations, and click "Send selected context to Codex".
3. If a request exists, call `canvas.update_request` with `status: "processing"`.
4. Read current selection with `canvas.get_selection`.
5. Choose the appropriate flow based on `requestType`:
   - `image.edit`: annotation edit workflow.
   - `video.frame-reference`: video-frame reference workflow.
   - `scene.product-marketing-set`: Product Marketing Set.
   - `scene.social-repurpose`: Social Repurpose.
   - `scene.video-ad-keyframes`: Video Ad Keyframes.
   - `scene.style-exploration`: Style Exploration.
6. Generate or edit media with the best available provider path:
   - Use Codex native generation for zero-config demos.
   - Use Atlas Cloud when the user requested Atlas or the project has Atlas configured.
   - Use a custom provider only when the user configured one or explicitly requests it.
7. Save every generated file locally.
8. Insert every output through `canvas.create_version` when there is a parent asset, otherwise `canvas.insert_asset`.
9. Call `canvas.update_request` with `status: "completed"` and include generated asset ids/paths in `result`.

If generation fails, call `canvas.update_request` with `status: "failed"` and a concise error.

## Annotation edit workflow

Annotation editing is a core workflow, not a scene Skill.

Use it when `requestType` is `image.edit`, or when the user says to revise a selected asset according to annotations.

Prompt requirements:

- Preserve the original subject, composition, identity, and important style unless the user asks otherwise.
- Apply only the visible annotations and instruction.
- If an annotation is ambiguous, keep that area unchanged or ask one concise clarification.
- Preserve the original asset; always create a new version to the right.

Result metadata:

- `provider`
- `model`
- `prompt`
- `params`
- `skillName: "annotation-edit-workflow"`
- parent asset id

## Video-frame reference workflow

Use it when `requestType` is `video.frame-reference`, or when the selected asset is a video/frame and the user asks for revision.

v1 should promise frame-guided video revision/concepting, not full timeline editing.

Allowed outputs:

- edited frame;
- keyframe set;
- video generation prompt package;
- generated video clip when the selected provider supports it.

Always preserve source video asset id and timestamp metadata when available.

## Scene preset workflows

Scene presets are candidate v1 Skills. They are not claims about verified market popularity.

### Product Marketing Set

Input:

- selected product image or reference asset;
- optional annotations;
- user brief.

Output:

- a small set of marketing/ad/social product visuals;
- multiple variants inserted as child versions or related assets;
- grid placement handled by the canvas store.

Use `skillName: "product-marketing-set"`.

### Social Repurpose

Input:

- one source image or generated asset.

Output:

- platform-specific adaptations such as Xiaohongshu cover, Instagram post, Story/Reels vertical, YouTube thumbnail, and horizontal ad/banner.

Use `skillName: "social-repurpose"`.

### Video Ad Keyframes

Input:

- product/reference image;
- optional selected video frame;
- campaign brief.

Output:

- storyboard frames;
- video ad keyframes;
- optional prompt package for video generation.

Use `skillName: "video-ad-keyframes"`.

### Style Exploration

Input:

- one or more reference images;
- optional mood/style notes.

Output:

- multiple visual style directions;
- each output linked back to the selected reference set.

Use `skillName: "style-exploration"`.

## User-facing tone

Be concise and product-like:

- "我会读取当前画布选择，并把请求交给 Codex 处理。"
- "新版本已经放到原素材右侧，旧版本保留。"
- "这个请求会通过 Codex/Skill/provider 执行，不会由画布直接调用模型。"
- "Atlas 是推荐 provider，但不是必须；也可以使用 Codex native 或自定义 provider。"

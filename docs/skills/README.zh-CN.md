# CoFlow Skill 使用指南

语言：[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

这份文档解释 CoFlow 面向用户的 skills。真正用于 Codex 执行的 skill 指令仍然在 `phase0-tldraw-spike/skills/*/SKILL.md`，那些文件是运行时 canonical instructions。

## 核心心智模型

CoFlow skills 不是把画布变成 provider 表单。它们让 Codex 读取有边界的视觉上下文，选择生成路径，并把结果写回画布。

适合使用 CoFlow 的情况：

- 任务依赖画布上的选中媒体；
- 任务依赖 frame 和其中的标注；
- 任务依赖当前可见画布上下文；
- 需要版本血缘和写回；
- 需要本地生成文件和元数据。

## 核心 Skills

### `coflow-open`

打开本地 CoFlow 画布。

适合：

- 开始或继续一个 CoFlow 白板；
- 获取本地画布 URL；
- 让 Codex 检查白板是否正在运行。

示例：

```text
打开 CoFlow。
在浏览器里打开 CoFlow 白板。
检查 CoFlow 白板是否在运行。
```

### `coflow-provider-setup`

查看或修改图片/视频 provider 默认设置。

适合：

- 查看当前图片和视频模型默认值；
- 把图片生成切换到 Atlas Cloud；
- 切换视频模型，比如 Seedance 或 Kling；
- 诊断 Atlas Cloud credential 是否缺失。

示例：

```text
查看我的 CoFlow provider 设置。
把视频生成切换到 Seedance 2.0 Mini。
图片生成使用 Atlas Cloud。
检查 Atlas Cloud 是否已连接。
```

Atlas Cloud API key 链接：

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

### `coflow-model-list`

总结 CoFlow 当前配置的 provider/model catalog。

适合：

- 想知道 CoFlow 本地支持哪些图片/视频模型；
- 想看可用 Atlas Cloud 模型家族；
- 想选择模型，但不想手写 raw model id。

示例：

```text
CoFlow 支持哪些图片和视频模型？
列出可用的 CoFlow 视频模型。
reference-to-video 应该用哪个模型？
```

### `coflow-image`

从画布上下文生成或编辑图片。

适合：

- prompt-only 文生图，并写回画布；
- 选中一张图片并生成修改版；
- 框住源图片和标注；
- 需要输出回到白板上。

示例：

```text
生成一张 9:16 海报并放回画布。
编辑选中的图片：把背景调暖。
使用这个 frame 里的产品图，生成三张广告变体。
```

重要行为：

- prompt-only 输出会作为独立媒体插入；
- reference 编辑应创建可追踪版本；
- 图片默认使用 Codex built-in GPT Image 2，除非用户选择外部 provider；
- 外部 provider 的素材共享只针对当前任务。

### `coflow-video`

基于 prompt、图片、视频或 frame context 生成/修改视频。

适合：

- text-to-video；
- 选中图片做 image-to-video；
- 选中视频做修改/重生成；
- 需要视频结果写回画布。

示例：

```text
用这张产品图生成 5 秒竖版视频。
把选中的 frame 变成电影感视频。
用更柔和的运动重生成这个视频。
```

重要行为：

- 默认视频 provider 是 Atlas Cloud Seedance 2.0；
- 模型参数会在 provider 执行前校验；
- 写回时应保留输出尺寸和比例。

## 场景 Skills

### `coflow-product-marketing`

基于选中素材生成产品营销图或 campaign variants。

适合：

- 产品广告变体；
- 电商 hero 图；
- 社媒 campaign 素材；
- 对比多个视觉方向。

### `coflow-social-repurpose`

把选中媒体适配到社交平台比例。

适合：

- 1:1 feed；
- 9:16 Stories、Reels、Shorts、TikTok；
- 16:9 YouTube 或横版投放；
- 让一个源概念在多个格式中保持一致。

### `coflow-video-ad-keyframes`

规划或生成视频广告关键帧。

适合：

- 分镜方向；
- hook/middle/end 结构；
- 产品 reveal sequence；
- 视频生成前的广告规划。

### `coflow-style-exploration`

基于同一个源素材探索多个视觉风格。

适合：

- 品牌视觉方向探索；
- mood/style variants；
- 在选择前比较不同视觉处理。

### `coflow-3d`

定义早期 3D 工作流边界。

适合：

- 收集未来 3D 生成所需 reference；
- 从画布上下文描述 3D 意图；
- 准备 3D generation workflow。

当前项目暂不宣称完整 3D 画布预览/编辑。

## 写回规则

对于使用 CoFlow 上下文的任务，生成成功不等于完成；必须通过 `canvas.insert_media` 写回画布。

最小生成媒体字段：

```json
{
  "mediaType": "image | video",
  "localPath": "...",
  "absolutePath": "...",
  "src": "...",
  "prompt": "...",
  "provider": "...",
  "model": "..."
}
```

如果生成成功但没有可写回的本地路径或 URL，应报告问题，而不是假装任务完成。

## 安全边界

打开画布不是上传素材的全局授权。

外部 provider 调用只能使用当前任务需要的选中、框选或可见 bounded assets。不要上传无关白板素材、本地配置文件、API keys 或 secrets。

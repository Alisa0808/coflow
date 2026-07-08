# CoFlow

CoFlow 是面向 Codex 的 agent-native 媒体画布。

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

它把无限 tldraw 白板、Codex skills 和 MCP 工具连接起来：你可以在画布上指向视觉上下文，描述要改什么，生成新的图片或视频，并把结果作为本地资产和可追踪版本写回画布。

## CoFlow 是什么

CoFlow 不是 provider 表单，不是轻量版 Canva，也不是静态图片板。

画布负责表达视觉上下文：

- 选择或框选源图片、视频；
- 添加箭头、框、文字备注和空间标注；
- 让 Codex 通过 MCP 读取有边界的画布上下文；
- 通过 Codex 原生图片能力或外部 provider 生成媒体；
- 把生成结果写回为 tldraw 原生图片/视频对象；
- 保留提示词、模型/provider 元数据、本地路径和版本血缘。

核心流程：

```text
在画布上选择或框选媒体
→ 在 Codex 里描述编辑/生成需求
→ CoFlow skills 读取有边界的上下文
→ Codex 选择合适的生成路径
→ 生成媒体被插回画布
→ 版本关系保持可追踪
```

## 当前状态

CoFlow 处于 Phase 1 RC，重点是图片/视频生成和写回闭环。

当前可用：

- 基于 tldraw 的无限画布；
- 原生图片和视频资产写回；
- prompt-only 图片生成不会误连到旧素材；
- 图片/视频 reference 工作流边界；
- Atlas Cloud 外部图片/视频模型执行；
- provider/model onboarding 和状态工具；
- 多 page 画布持久化；
- 本地 `.coflow/` 资产和元数据存储；
- Codex 插件 manifest、skills 和 MCP server。

暂不宣称：

- 完整 3D 画布预览/编辑；
- 托管式多人协作；
- 成熟消费级 SaaS UI。

## 仓库结构

活跃插件和运行时在：

```text
coflow/
```

重要文件：

```text
coflow/.codex-plugin/plugin.json  # Codex 插件 manifest
coflow/.mcp.json                  # MCP server 配置
coflow/mcp-server.mjs             # 面向 Codex 的 MCP 工具
coflow/server.mjs                 # 本地画布服务
coflow/src/                       # tldraw 画布应用
coflow/skills/                    # CoFlow Codex skills
coflow/lib/                       # provider/runtime helper
coflow/tests/                     # 回归测试
```

生成资产和本地运行状态存储在 `.coflow/`，该目录已被 git 忽略。

## 快速开始

```bash
cd coflow
npm install
npm run build
npm run serve
```

打开：

```text
http://127.0.0.1:5176/
```

插件开发时，可以让本地 personal marketplace 的 `~/plugins/coflow` 指向 `coflow`，然后安装：

```bash
codex plugin add coflow@personal
```

重新安装本地插件版本后，请启动新的 Codex 对话或重启 Codex，让新的 skills 和 MCP tools 生效。

## Provider 设置

默认图片路径使用 Codex 内置 GPT Image 2，用于图片生成和图片编辑/reference。

默认视频路径使用 Atlas Cloud Seedance 2.0，用于 text-to-video 和 reference/video editing。

使用这个邀请链接创建 Atlas Cloud API key：

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

然后把 key 写入本地 env 文件：

```bash
ATLASCLOUD_API_KEY=...
```

支持的本地 env 路径：

```text
.env.local
coflow/.env.local
```

不要提交 API key，也不要把密钥粘贴到聊天里。

## Codex Skills

核心插件 skills：

- `coflow-open` 打开本地画布。
- `coflow-provider-setup` 查看或修改图片/视频 provider 默认设置。
- `coflow-model-list` 总结当前配置的模型支持。
- `coflow-image` 从画布上下文执行图片生成和图片编辑。
- `coflow-video` 执行 text-to-video 和 reference/video revision。

场景 skills：

- `coflow-product-marketing`
- `coflow-social-repurpose`
- `coflow-video-ad-keyframes`
- `coflow-style-exploration`
- `coflow-3d`

## 开发检查

在 `coflow/` 下运行：

```bash
npm test
npm run build
```

插件 manifest 校验：

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py coflow
```

## 设计原则

- 画布是视觉上下文和写回表面。
- Codex 负责理解意图、选择 skill、编排 provider。
- 优先使用 tldraw 原生 assets/shapes/bindings。
- prompt-only 生成不能创建假的血缘连线。
- reference 生成应保留来源关系。
- provider setup 不是全局上传授权；素材共享只针对具体任务。
- 本地优先存储应让生成媒体和元数据可检查。

## License

MIT

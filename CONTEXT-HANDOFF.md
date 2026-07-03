# CoFlow / coding-agent-canva — 会话上下文交接

> 从 2026-06-25 那个 6.5G Codex 会话 + 项目 docs/git 提炼(已剔除 base64 图片)。
> 新会话开在本目录、先读本文件即可补齐上下文,**不要**去 `codex resume` 那个 6.5G rollout(会爆内存)。
> 原始完整对话(含图片)备份在 `~/.codex-oversized-sessions-backup/`。

工作目录:`/Users/qiutian/Projects/apps/coding-agent-canva`

---

## 0. 北极星(不可妥协)

用户在**无限画布**上指着一张图 / 一帧视频的**某个区域**说"这里要改",Codex 读到这个结构化上下文,生成新版本,**新版本作为画布对象出现在源素材右侧,并有连线指回父版本**。

- 中文标语:**指哪改哪,自动回板,版本可追踪**
- 英文:**Point. Prompt. Generate back.**
- 判断任何代码/UI 该不该存在,只问:它是否让上面这句话更快跑通?不是 → 不做。

## 1. 定位(不是什么)

不是 Cowart 简单复刻,也不是轻量版 Canva / Lovart。是**面向 Codex / coding agent 生态的本地优先、多模态创作画布插件**:图片/视频/3D 统一成"媒体资产 + 版本血缘 + 生成任务";**Atlas Cloud 作为最佳支持的多模型 provider**(顺带推广 Atlas)。
v1 非目标:完整视频时间轴、模型市场 UI、账号系统、3D 深度编辑、面向非技术用户的 SaaS。
原始需求来源:X @cellinlab 的 canvas 生图项目 + 开源 `github.com/zhongerxin/cowart`;调研文档见飞书 wiki `Kh0qw91amioM92kszPZlVSImgeO`。

## 2. 当前阶段:Phase 1 RC — 图片标注编辑闭环(截至 2026-06-28)

Phase 0 / 0.5 / 0.6 已作为实现 spike 关闭。剩下是**验收硬化,不是重定义产品形态**。
已明确放弃"浏览器画布直接调 provider API"那条路(source/reference 处理混乱、偏离目标)。

**规范产品闭环:**
```
用户框选媒体+标注 → 画布导出结构化 frame/selection/viewport 上下文(+可选截图)
→ Codex/active skill 读最新的 bounded 上下文 → Codex 选对 image/video/3D skill、mode、provider、prompt
→ Codex 把生成媒体写回画布 → 画布带可见血缘和本地元数据落位
```
**画布 = 视觉上下文容器 + 写回面(writeback surface);Codex = 编排层。**
生成上下文优先级(tldraw agent 风格):active frame > selected objects > visible viewport > prompt only。

## 3. 架构关键事实(避免踩坑)

- ⚠️ **当前实际运行的 MCP server 是 `phase0-tldraw-spike/mcp-server.mjs`**(见根目录 `.mcp.json`),**不是 `canvas-studio/`**。`canvas-studio/` 是**上一版严重偏离核心的旧实现**(spec 里点名批判),别以为它是主线。
- 画布基于 **tldraw**,媒体必须是 tldraw 画布上的**原生 shape / asset**(禁止把 tldraw 当背景壁纸、禁止另起独立素材 DOM 列表)。
- MCP 工具(canvas.*):`get_selection` `get_frame_context` `get_frame_request` `get_frame_input` `get_frame_screenshot` `capture_frame` `capture_selection` `get_asset` `insert_media` `create_version` `link_versions` + 写回轮询。
- 已移除会误导 Codex 的 `canvas.agent_prompt` / `canvas.run_provider` 用户级路径;生成必须走 Codex 媒体 skill + `insert_media`/`create_version`。
- 本地存储在 `.coflow/`(assets、frame-screenshots、frame-inputs、page snapshot/manifest/view state/backups)。
- 默认生成**不允许 mock fallback**(除非显式选 `mock-provider` 测试)。

## 4. 硬约束(DON'T,违反=实现作废)

1. 禁止把 tldraw 当背景壁纸、禁止独立素材 DOM 列表。
2. 禁止左侧表单墙(Import/Upload/Provider 三按钮/一堆 textarea/Session 面板)。上传=拖拽进画布或工具栏一个按钮,其余意图走对话。
3. 禁止把 provider/scene 选择做成画布主交互、更禁止重复出现两处。全局只留一个极轻只读状态条。

## 5. 最近一次会话结束时的状态(2026-07-02)

正在修图片编辑链路的边界 bug:`canvas.run_provider` 是 CoFlow 外部 provider runner,**不能**代表 Codex 原生 GPT Image 2 处理"带本地参考图的图片编辑";之前误把默认 provider `codex-native` 传进去,服务端返回 `requires_codex_native` 死循环。
已修:`coflow-image` skill 区分——prompt-only 文生图走 Codex built-in GPT Image 2;含画布本地图片/frame/selection 参考的,不把 `codex-native` 当 `canvas.run_provider` 的 provider,MCP runtime 遇到该情况自动 redirect 到 Atlas Cloud 这类可收本地 reference 的 route;加了回归测试;`npm test` 48 个全过;已同步到插件缓存 `~/.codex/plugins/cache/personal/coflow/0.2.0+codex.20260702170624`。
**下一步测试前需重启 Codex / reload 插件;本地 5176 服务也建议重启一次(旧 MCP 进程可能仍加载旧代码)。**

## 6. 权威文档(真正的 ground truth,按需深读)

`docs/` 下:
- `codex-media-canvas-spec.md` — **实现唯一执行依据(v2 防偏离版,冲突以它为准)**
- `current-status-and-next-loop.md` — 现状与下一个可见闭环(最该先读)
- `project-background-positioning-plan.md` — 背景/定位/完整规划
- `runtime-interface-contract.md` — 运行时接口契约
- `cowart-research.md` — 原开源项目调研
- `phase2-productization-plan.md` / `ai-canvas-deployment-and-roadmap.md` — 后续产品化/部署路线
- `phase0-execution-log.md` — Phase 0 执行日志

## 7. 最近 git 提交(代码是最强上下文,直接 `git log` / 看 diff)

```
b446ba2 feat: consolidate coflow plugin workflow
4a4a255 chore: remove legacy canvas studio prototype
a63c052 fix: preserve source layout in skill generation
51729e9 fix: preserve tldraw paste semantics and page bounds
9dcef49 feat: complete phase 1 image loop
14adf1f fix: write generated media as native tldraw assets
db7e39d fix: export frame screenshots by geometry
fc0424f feat: render codex video writebacks
b9a21e2 feat: add selection capture and version linking tools
3a6aa96 feat: persist local canvas state
```

## 8. 如何在新会话继续

1. 在本目录 `/Users/qiutian/Projects/apps/coding-agent-canva` 开**全新** Codex 会话。
2. 开场:"先读 `CONTEXT-HANDOFF.md` 和 `docs/codex-media-canvas-spec.md` + `docs/current-status-and-next-loop.md`,再继续 Phase 1 验收硬化。"
3. 认准运行主体是 `phase0-tldraw-spike/`(见 `.mcp.json`),别碰 `canvas-studio/` 旧版。
4. 记住北极星和第 4 节 DON'T,任何改动先自问是否让核心闭环更快跑通。

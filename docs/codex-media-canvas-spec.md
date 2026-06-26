# Codex Media Canvas — 实现规格（v2，防偏离版）

> 本文取代散文式规划，作为**实现 agent 的唯一执行依据**。
> 背景：上一版实现（见 `canvas-studio/`）严重偏离核心，本文用"硬约束 + 单一闭环 + 反面清单"重写。
> 如与 `codex-media-canvas-plan.md` 冲突，**以本文为准**。

Last updated: 2026-06-25

---

## 0. 北极星（不可妥协）

**一句话**：用户在**无限画布上**指着一张图 / 一帧视频的**某个区域**说"这里要改"，Codex 读到这个结构化上下文，生成新版本，**新版本作为画布上的对象出现在源素材右侧，并有连线指回父版本**。

判断任何代码/UI 是否该存在，只问一句：**它是否让上面这句话更快跑通？** 不是 → 不做。

非目标（v1 明确不做）：Lovart/Canva 替代品、完整视频时间轴编辑、模型市场 UI、账号系统、3D 深度编辑、给非技术用户的 SaaS。

---

## 1. 上一版为什么失败 —— 硬性禁令（DON'T）

实现 agent 必须逐条遵守。违反任意一条 = 实现作废。

1. **禁止把 tldraw 当背景壁纸。**
   上一版把 `<Tldraw>` 放进 `aria-hidden` 层，素材另起一个 DOM 列表平铺。
   → 素材**必须是 tldraw 画布上的自定义 shape**，和用户、和彼此共享同一坐标系。画布上**不允许**存在一个独立的"素材列表 DOM 层"。

2. **禁止左侧表单墙。**
   不要 Import 区 / Upload 按钮区 / Provider 三大按钮 / 一堆 textarea / Session 统计面板。
   → 上传 = 拖拽进画布 或 工具栏一个按钮。其余意图走 Codex 对话。

3. **禁止把 provider / scene 选择做成画布里的主交互，更禁止重复出现两次。**
   上一版左面板和右面板各放了一套 provider+scene 选择器。
   → 全局只保留**一个**极轻的状态条（当前 provider 模式 + 当前 preset + 缺配置告警），且只读为主。复杂选择走对话。

4. **禁止把"标注"退化成一个文本框。**
   标注 = 用户在**图片/帧 shape 上面**用 tldraw 的箭头/框/手绘/便签圈出区域（可附文字）。文本框不是标注。

5. **禁止用本地轮询请求队列冒充"Codex 绑定"。**
   不要每 2.5s 轮询 server、不要"提交 request 等 Codex 领取"作为主路径的全部。绑定的本质是：选中画布对象 → MCP 能立刻读到结构化 selection（见 §5）。

6. **禁止用广度冒充深度。**
   不要把本文每个名词都做成一个面板。**先把 §3 的单一闭环跑通**，跑不通之前不准加任何第二功能。

---

## 2. "画布"的精确定义

画布底座 = **tldraw 5.x，作为真正的交互主体**（铺满视口，可平移缩放，用户直接在上面操作）。

### 2.1 素材是自定义 shape
为每种素材定义 tldraw 自定义 `ShapeUtil`：

- `MediaImageShape` — 一张图片素材
- `MediaVideoShape` — 一段视频（可播放/暂停，可标记当前帧）
- `MediaFrameShape` — 从视频抽出的某一帧

每个 shape 的 `props` 携带素材业务元数据（见 §6），而不是只存一个 url。素材的**位置就是它在画布上的 x/y**——这样"插到源素材右侧""网格排列"才是真实的几何操作。

### 2.2 标注 = 画布原生图元
用户用 tldraw 自带的 arrow / geo(框) / draw / note 工具，**画在素材 shape 上方**。标注与被标注素材的关联通过**几何包含/重叠**或 tldraw `binding` 建立。不另做标注系统。

### 2.3 选择 = tldraw 选择
用户用 tldraw 选中一个或多个 shape。`editor.getSelectedShapes()` 就是 selection 的来源。不另做"选中状态"。

### 2.4 版本血缘 = 画布上的箭头
新版本插入到父素材右侧，并用一条 tldraw arrow（带 binding）从父指向子。血缘在画布上**可见、可追溯**，不只是 metadata 字段。

---

## 3. 唯一的垂直切片（必须最先、且只先做这个）

> 在它 100% 跑通前，不允许写视频、不允许写营销 skill、不允许写第二个 provider、不允许加任何面板。

**闭环 = 图片标注改图：**

1. 用户把一张图拖进画布 → 变成一个 `MediaImageShape`（带 assetId、本地路径、metadata）。
2. 用户用箭头/框在图上圈出要改的地方，可选附一句文字。
3. 用户选中该图（或图+标注），触发一个**单一动作**：`Generate new version`（工具栏按钮或右键菜单，**仅此一个按钮**）。
4. 该动作通过 MCP 把结构化 selection 暴露给 Codex（见 §5）：源图本地路径 + 标注区域(bbox/几何) + 标注文字 + metadata。
5. Codex（用当前 provider）生成新图，存到本地 asset store，调 `canvas.insert_asset`。
6. 新图作为新的 `MediaImageShape` 出现在**源图正右侧**，并自动连一条 arrow 指回源图。
7. 选中任意素材，能看到它的来源详情（prompt/model/provider/父版本/路径）——详情用 tldraw 的轻量浮层或一个**单一**右侧只读面板，不是表单。

### Definition of Done（v0 验收 = 上面 7 步真实跑通）
- [ ] 拖图进画布生成自定义 shape，重启服务后仍在原位置（引用持久化，大文件不进画布 JSON）
- [ ] MCP `canvas.get_selection` 返回选中图的路径 + 标注几何 + 文字
- [ ] MCP `canvas.insert_asset` 能把一张本地图插到指定 shape 右侧
- [ ] 插入后父子之间有一条可见 arrow
- [ ] 选中素材能看到 metadata
- [ ] 全程**没有**左侧表单墙、**没有** aria-hidden 的假画布、**没有**文本框冒充标注

---

## 4. UI 预算（chrome 上限）

整个应用允许出现的非画布 UI，**最多**只有这些：

| 元素 | 说明 |
|---|---|
| tldraw 自带工具栏 | 直接用，最多加 1 个自定义工具按钮 `Generate new version` |
| 顶部状态条（极轻、单行） | 当前 provider 模式 / 当前 preset / 缺配置告警 / "Configure in Codex" 链接。只读为主 |
| 素材详情（单一、只读） | 选中素材时显示其 metadata 和"用这个继续生成"。可做成画布内浮层或一个窄右栏，二选一 |

**以上之外的任何面板、表单、选择器一律不做。** 模型/比例/数量/质量等参数全部走 Codex 对话或 preset，不在画布出表单。

---

## 5. Codex ↔ 画布 绑定机制（核心）

绑定不是"轮询队列"，是**让 Codex 随时能读到画布的真实选择状态**。

### 5.1 MCP 工具面（v1 保持少而强）
```
canvas.get_selection          # 读当前选中 shape：assetId、类型、本地路径、缩略图、
                              #   视频帧时间戳、标注几何+文字、父版本 metadata、当前 preset/provider
canvas.insert_asset           # 插入一个本地素材为 shape，默认放在 anchorAssetId 右侧
canvas.create_version         # 插入并自动建立 parent→child arrow 与 lineage
canvas.update_asset_metadata  # 回写 prompt/model/provider/params 等
canvas.extract_video_frame    # 抽帧为 MediaFrameShape（v1 视频用）
```

### 5.2 交互契约
- 用户在画布选中 → Codex 对话里直接 `canvas.get_selection` 即可拿到"用户指的是哪张图、哪一帧、圈了哪块、想改什么"。**用户不需要复制路径、不需要截图、不需要贴 JSON。**
- 画布的 `Generate new version` 按钮**不直接调 provider**，它只是创建一个结构化请求并提示 Codex 处理（v1 走 Codex 以保上下文；直连 API 留作 v2 fast mode）。
- **Canvas Session Mode**：用户在对话里设一次场景（如"用 Product Marketing Set 模式处理后续请求"），之后画布操作沿用该模式，不必每次 `/skill`。状态显示在顶部状态条。

---

## 6. 数据模型 / Asset 协议

### 本地存储（引用，不存大二进制进画布）
```
.codex-media-canvas/
  canvases/        # tldraw 文档快照（只存 shape + 引用，不存大文件）
  assets/{images,videos,frames,thumbnails}/
  metadata/
  jobs/
```

### Asset metadata（每个素材至少）
`assetId` · `type`(image/video/frame/model3d) · `localPath` · `thumbnailPath` · `parentAssetId` · `parentVersionId` · `references[]` · `annotations[]` · `prompt` · `provider` · `model` · `params` · `skillName` · `jobId` · `createdAt`

### Provider result contract（所有生成路径统一返回）
output 本地路径 · media 类型 · parent asset/version id · prompt · provider · model? · params · remote URL? · job id? · cost/latency?

### Skill contract（场景 skill 不直接改画布内部）
读 selection (MCP) → 必要时反问 → 生成/编辑 → 存本地 → `canvas.insert_asset` / `create_version` → 写 metadata → 简洁回报。

---

## 7. Provider 策略（沿用，正确）

**Codex 驱动混合式**，画布不做模型市场。三条路径：
- **A. Codex Native** — 零配置 demo，`provider: codex-native`
- **B. Atlas Cloud（推荐）** — 装 Atlas Skill/MCP/CLI，配 `ATLASCLOUD_API_KEY`，覆盖图/视频/多模型路由
- **C. Custom Provider** — OpenAI/Fal/Replicate/ComfyUI/Runway/Higgsfield 等，只需按 result contract 回填

首次安装引导三选一。画布只显示轻量 provider 状态（§4），复杂选择走对话。

---

## 8. 构建顺序（每个 phase 的 DoD 是"闭环可用"，不是"面板齐全"）

### Phase 0 — 真画布地基
- tldraw 铺满视口、可交互（**不是** aria-hidden）
- 定义 `MediaImageShape` 自定义 ShapeUtil（先只图片）
- 拖图进画布 → 生成 shape + 本地 asset + metadata；持久化引用
- DoD：拖三张图进来，平移缩放、重启后仍在

### Phase 1 — §3 单一闭环（图片标注改图）
- 画布原生标注（arrow/框）+ `Generate new version` 单按钮
- MCP `get_selection` / `insert_asset` / `create_version`
- 新版本插右侧 + 父子 arrow + 详情只读浮层
- DoD = §3 的 7 步 + 验收清单全绿

### Phase 2 — 视频帧闭环 + 首发 skill
- `MediaVideoShape` / `MediaFrameShape` + `extract_video_frame`
- 选中某一帧标注 → 同一闭环
- 预置场景 skill（**先 1 个**，验证后再加）：Product Marketing Set
- DoD：一段视频抽帧改帧跑通；一张产品图出一组营销图、网格排在右侧、各带 metadata

### Phase 3 — Provider router / Atlas / 血缘视图
- provider fallback、失败重试、换模型重跑（不覆盖旧版本）
- 可选 xyflow graph view 看血缘；3D 仅做 metadata+预览
- 其余 scene skill（Social Repurpose / Video Ad Keyframes / Style Exploration）按调研结果增补

---

## 9. 技术架构

```
codex-media-canvas/
  canvas-web/      # React + TS + tldraw（自定义 MediaShape、标注、selection、自动布局）
  local-server/    # 本地 HTTP：asset 文件、metadata、job 状态、画布快照
  mcp-server/      # 暴露 canvas.* 工具给 Codex
  media-core/      # asset / version / annotation / job 的核心类型与 result contract
  providers/       # codex-native / atlas / custom adapter
  skills/          # 场景 skill（先 1 个）
```

交互原则：**对话负责复杂意图与参数，画布负责选择/标注/引用/展示/血缘。** 每个生成结果必须自动回板、必须可追溯。用户不应看到 `MCP ready` / `polling` / `Codex paused` 这类内部词。

---

## 10. 给实现 agent 的强制 checklist（提交前自检）

- [ ] tldraw 是可交互主体，没有任何 `aria-hidden` 的画布
- [ ] 素材是 tldraw 自定义 shape，没有独立的素材 DOM 列表层
- [ ] 标注是画布图元（箭头/框），不是 textarea
- [ ] 非画布 UI 没超出 §4 的三项预算
- [ ] provider/scene 选择器全局只出现一次，且只读为主
- [ ] §3 单一闭环已端到端跑通（不是各面板拼好）
- [ ] 大文件走本地引用，没进画布 JSON
- [ ] 没有重做 AI-Canvas 式的"提交 request 等轮询领取"作为主路径

---

## 11. 待调研（不阻塞 Phase 0/1）
- tldraw 生产/商用 license 路径（公开发布前必须确认）
- 哪些 scene skill 是真热门（Lovart/Tapnow/Canva AI/Higgsfield/Krea/Runway + X/Reddit/PH/GitHub）
- v1 是否同时出 Claude Code/Cursor 的通用 MCP 接入说明
- Atlas v1 视频工作流形态（原生编辑 / 关键帧图生视频 / 镜头重生成 / 仅 prompt 包）
- Codex 画布 session 能监听多久、resume 行为如何

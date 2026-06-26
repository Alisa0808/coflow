# Codex Media Canvas 项目背景、定位与完整方案规划

更新日期：2026-06-25  
工作目录：`/Users/qiutian/Projects/apps/coding-agent-canva`  
建议项目名：`Codex Media Canvas` / `Agent Media Canvas`

## 0. 一句话结论

我们要做的不是 Cowart 的简单复刻，也不是又一个轻量版 Canva / Lovart / Tapnow，而是一个面向 Codex 与 coding agent 生态的本地优先、多模态创作画布插件：

> 用户在画布上选择图片、视频帧或 3D 视图，直接标注修改意见或描述目标；Codex 负责理解意图、调用 Skill / MCP / provider 完成生成；结果自动回到画布，并保留完整版本血缘、提示词、模型、成本与来源记录。

中文标语：

> 指哪改哪，自动回板，版本可追踪。

英文标语：

> Point. Prompt. Generate back.

这个项目的战略价值在于：

1. 把 Codex 的对话式智能和画布的空间式创作结合起来；
2. 把图片、视频、3D 统一成“媒体资产 + 版本血缘 + 生成任务”的系统；
3. 以 Atlas Cloud 作为最佳支持的多模型 provider，让 Atlas 的图像、视频、3D、LLM 聚合能力自然嵌入真实创作流；
4. 保持开源中立：Atlas 是推荐路径，但项目本身不应退化成只能调用 Atlas 的壳。

## 1. 项目背景

### 1.1 起点：Codex 内置浏览器里的 AI 画布实验

最初触发这个想法的是 X 上一个非常轻巧的 demo：在 Codex 内置浏览器中打开一个本地画布，通过 Codex 生成图片、读取画布选择、把结果插回画布。

这个交互之所以有吸引力，不是因为它发明了新的图像模型，而是因为它把三个原本割裂的东西接上了：

- Codex 的自然语言理解、工具调用和文件系统能力；
- 浏览器画布的空间组织、选区、标注和对比能力；
- 本地项目目录里的素材、生成结果和可追溯记录。

传统 AI 生图工具常见的问题是：用户在聊天框里描述，在另一个网页里生成，在本地下载，再手动拖回设计工具。上下文丢失、版本难追、局部修改靠口头描述，创作链条很容易断。

Codex 画布型产品的核心机会就是把链条闭合：

```text
画布选择 / 标注 / 参考
→ Codex 理解和编排
→ 模型生成 / 编辑
→ 本地保存
→ 自动回到画布
→ 继续选择、对比、分支、迭代
```

### 1.2 Cowart 的启发与边界

Cowart 是这个方向的早期代表。它的核心机制非常聪明：

- 用 tldraw 做本地无限画布；
- 用项目本地 JSON 和 asset 文件夹保存画布数据；
- 暴露少量 MCP 工具，让 Codex 可以读取选区、插入图片；
- 用 Skill 文档告诉 Codex 如何打开画布、生成图片、根据标注截图修图；
- 真正的生图并不在 Cowart 内部完成，而是由 Codex 调用自身图像能力，生成本地文件后再插回画布。

Cowart 证明了一个重要事实：

> 一个 AI 画布 MVP 不一定需要先做复杂模型平台；只要把“选区上下文”和“回填结果”打通，Codex 本身就能驱动很多创作流程。

这里有一个需要永久写进项目边界的原则：

> 画布不是生成器，画布是 Codex 的视觉上下文容器。

也就是说，画布的首要职责不是在前端里直接拼 provider payload、调用 Atlas / OpenAI / Seedance / Kling API，然后自己判断结果如何写回；而是把当前画布的真实状态用结构化接口交给 Codex：

- 当前 selection：用户真实选中了哪个 frame、图片、视频、3D 视图、便利贴或标注；
- 对象 identity：shape id、asset id、版本 id、父子关系和 frame 归属；
- 空间信息：x / y / w / h / rotation / z-order / bounds / containment；
- 类型信息：image、video、audio、model3d、text、note、arrow、geo、frame、generated slot；
- 内容信息：文本、便利贴内容、frame title、箭头/标注关系；
- 素材信息：本地路径、absolute path、mime type、文件大小、原始分辨率、时长、视频帧信息；
- 任务边界：用户选中的 frame、框选区域、多选对象或当前 active request；
- 可选视觉快照：selection / frame 的截图或 render，用于让多模态模型判断复杂视觉关系。

Codex 读取这些上下文后，再决定应该调用哪个 agent skill、选择哪个 provider / model、构造什么生成请求、如何保存输出，以及把结果插回画布哪里。

这意味着 Cowart 值得借鉴的是 **selection persistence + MCP read/write bridge** 这个交互范式，而不是它的字段名、metadata 命名或具体实现。由于我们也要开源，必须采用 clean-room schema，避免复制 `cowart...` 这类项目特定字段名。

我们的中性命名应围绕：

```text
canvas.get_selection
canvas.get_frame_context
canvas.get_asset
canvas.capture_selection
canvas.capture_frame
canvas.insert_media
canvas.create_version
canvas.link_versions
```

对应的数据结构应该使用我们自己的开源中性 schema，例如：

```ts
type CanvasSelectionSnapshot = {
  version: 1
  selectedIds: string[]
  selectedItems: CanvasItem[]
  activeFrame?: CanvasFrameContext
  updatedAt: string
}

type CanvasItem = {
  id: string
  kind:
    | 'image'
    | 'video'
    | 'audio'
    | 'model3d'
    | 'text'
    | 'note'
    | 'arrow'
    | 'shape'
    | 'frame'
  bounds: {
    x: number
    y: number
    w: number
    h: number
    rotation?: number
  }
  parentId?: string
  text?: string
  asset?: {
    assetId: string
    mimeType: string
    localPath: string
    absolutePath: string
    width?: number
    height?: number
    durationMs?: number
    fileSize?: number
  }
  metadata?: Record<string, unknown>
}
```

后续实现中，如果某个按钮需要存在，它也只是把当前 selection / frame 变成 Codex 可读取的 request 或 trigger；它不应该成为 provider API 的主要入口。

但 Cowart 也暴露了明显边界：

- 没有 provider 抽象；
- 没有异步任务队列；
- 没有图像、视频、3D 的统一媒体模型；
- 没有稳定的 generation metadata；
- 依赖整份 tldraw snapshot 写入，存在冲突和损坏风险；
- 标注理解依赖截图和 Skill 文本，不够结构化；
- 没有原生视频帧、镜头重生成、3D 视图迭代能力；
- 代码仓库当时没有明确 license，不能直接复制实现。

所以我们的正确路径不是 fork Cowart，也不是照搬 Cowart 的内部字段，而是 clean-room 复现它验证过的“Codex 读取画布上下文并写回结果”的交互范式，并把底层抽象升级成可长期扩展的媒体创作系统。

### 1.3 AI-Canvas 的快速跟进与竞争态势

另一个值得重点观察、但不能作为产品形态参考的项目是 `binghe1980/AI-Canvas`。它已经从“简单画布 + 修图”进一步走向：

- Codex 本地 AI 无限画布；
- 图片生成、标注修图、多版本对比；
- Skill 面板；
- 小红书封面、YouTube 缩略图、电商营销组图、Logo 品牌、营销宣传册、跨平台适配等业务 Skill；
- MCP 长轮询请求；
- Codex 处理 Skill 请求后回填画布。

这个项目的定位可以理解为：

```text
Codex 里的 AI 画图白板 + 业务制图工作台
```

它有市场信号价值：说明“Codex + 本地画布 + 业务生图”这个方向确实能吸引开发者注意。作者在公开动态中提到的方向包括：

- 接入外部生图服务，减少 Codex 内置生成的 token / 成本消耗；
- 扩充业务 Skill，从单图编辑转向多图联动和商业生产流程；
- 走 Skill → Agent → 可选 Web API 代理的演进路线；
- 最终通过代理层连接外部生成服务，承载 API key 隔离、成本、配额、路由和计费；
- 继续打磨 Marketing / Branding / Studio 类 Skill。

但它的产品形态本身有明显问题，不能被我们直接参考。它把“AI 画布”推向了“业务制图面板 + Skill 表单 + 图片模板工作台”，这和我们要做的“用户直接在无限画布上指着某个对象/区域让 agent 修改”不是一回事。

AI-Canvas 对我们的价值更像一个反面教材：

1. **不能学 Skill 面板主导。**  
   Skill 应该以 Codex 内部 agent skill 的形态存在，由用户在对话里调用、切换或让 Codex 自动选择，而不是作为一排业务按钮塞进白板。白板是视觉上下文，不是 Skill marketplace。

2. **不能学表单化画布。**  
   如果用户主要在侧栏里选场景、填字段、点提交，画布就退化成结果陈列区。这会把项目带向低配 Canva AI，而不是 agent-native canvas。

3. **不能学图片业务模板堆叠。**  
   小红书封面、YouTube 缩略图、电商套图这些都可以作为 Codex agent skill 存在，但它们不是白板产品的核心。核心永远是“选中对象 / 框住局部上下文 / 标注区域 / 生成新版 / 回板 / 血缘”。

4. **不能用 request queue 冒充 Codex 绑定。**  
   画布提交请求、Codex 长轮询领取，可以作为某些异步任务的辅助机制，但不能成为主路径。真正的绑定是：Codex 能随时通过 MCP 读取当前画布真实 selection、frame selection、标注几何和媒体 metadata。

5. **不能把 provider 和 scene 选择器做成白板主交互。**  
   provider、模型、尺寸、质量、业务场景这些复杂选择应该走 Codex 对话或 agent skill 配置；白板最多显示一个轻量状态条。

6. **不能把版本关系藏在 metadata 里。**  
   新版本必须在空间上出现在父版本右侧，并在画布上有可见连线。血缘既是数据，也是用户理解创作过程的视觉结构。

所以，如果我们只是再做一个“图片 + Skill 面板”的 Codex 画布，很快会变成同质化竞争，而且会偏离最关键的交互范式。

我们的差异点必须更早建立在：

1. 多模态媒体资产，而不是图片模板；
2. provider/router/任务系统，而不是只靠 Codex 内置生成；
3. 视频帧批注和镜头重生成，而不是单图修图；
4. 3D 资产预览与迭代，而不是只做平面图；
5. Atlas 的多模型聚合与媒体 API 能力，而不是自建单一模型管线。

一句话判断：

> AI-Canvas 证明了市场兴趣，但它的形态容易滑向“业务制图表单”。我们的机会不是复刻它，而是做一个真正以画布对象、局部标注、frame 选区、自动回板和版本血缘为中心的 agent-native media canvas。

## 2. 项目本质：它到底应该是什么

### 2.1 不是完整设计工具

这个项目不应试图从第一天开始挑战 Canva、Figma、Lovart 或专业视频编辑器。原因很简单：

- 通用设计工具的门槛是海量交互细节、协作能力、模板生态和品牌资产管理；
- 专业视频编辑器需要 timeline、音频、字幕、转场、剪辑、合成、调色；
- 3D 编辑器需要 mesh、材质、UV、骨骼、灯光、场景层级。

这些都不是一个 Codex 插件 MVP 应该承担的复杂度。

### 2.2 也不是单纯的生图网页

它也不应该是又一个“左边 prompt，右边结果”的模型调用前端。那类产品的问题是：

- 缺少空间组织；
- 缺少多参考图之间的关系；
- 缺少局部标注；
- 缺少版本分支；
- 缺少对视频帧、3D 视图等复杂上下文的表达；
- 很难自然接入 Codex 的本地文件、Skill 和项目知识。

### 2.3 它应该是 agent-native media workspace

更准确的形态是：

> 一个 agent-native media workspace：画布负责表达视觉上下文，Codex 负责理解、计划和调用工具，provider 负责生成媒体，系统负责保存版本和血缘。

核心分工：

```text
Canvas = selection, annotation, reference, layout, comparison, lineage
Codex  = intent understanding, agent skills, provider selection, local file ops
Server = persistence, job queue, media processing, security boundary
Provider = image / video / 3D / LLM generation
```

这条边界很重要。画布不要变成模型市场 UI，也不要直接把所有 provider API 表单塞进前端。它应该呈现创作上下文、状态和结果；复杂的模型选择、参数协商、失败处理和任务编排交给 Codex / server / provider adapter。

尤其要明确：本项目推出的场景能力应以 **Codex agent skill** 的形态存在，而不是以“白板按钮/白板面板”的形态存在。

换句话说：

- 白板里可以有一个基础动作：`Generate new version`；
- 白板里可以显示当前 session mode / provider mode；
- 但“小红书封面”“Product Marketing Set”“Video Ad Keyframes”“Style Exploration”这些应该是 Codex 可调用、可组合、可自动选择的 agent skill；
- 用户可以在 Codex 对话里说“接下来用 Product Marketing Set 处理这个画布里的素材”；
- 画布只负责把当前 frame / selection / annotation context 暴露给 Codex，并把结果回填。

这能避免项目变成“白板里的表单应用”，也能让 Skill 真正利用 Codex 的上下文、工具调用和推理能力。

### 2.4 Codex-driven canvas bridge 是主路径

为了避免后续实现跑偏，项目主路径必须定义为 **Codex-driven canvas bridge**：

```text
Canvas exports context
→ Codex reads selection / frame / assets / annotations
→ Codex chooses skill and provider
→ Codex generates or edits media
→ Canvas receives inserted media and visible lineage
```

这和“browser-side provider executor”是两种不同产品逻辑：

| 方向 | 是否主路径 | 原因 |
| --- | --- | --- |
| 画布导出 selection / frame context，Codex 通过 MCP 读取 | 是 | 符合 agent-native canvas，能利用 Codex 的推理、工具调用和 Skill |
| Codex 生成后通过 MCP/API 插回画布 | 是 | 回板、版本血缘、文件保存都可追踪 |
| 白板按钮触发当前 frame 进入 Codex request | 可以作为快捷入口 | 只是 trigger，不是 provider 表单 |
| 前端直接调用 Atlas / Seedance / Kling 生成 | 不是主路径 | 容易丢失 Codex 编排能力，也容易造成源素材、标注、输出链路混乱 |
| 在白板里堆 provider / scene / skill 面板 | 不是主路径 | 会退化成表单式制图工具 |

因此，后续 Phase 0 / Phase 1 的实现应优先闭合这些能力：

1. `canvas.get_selection`：Codex 能读取当前选中的对象和素材 metadata；
2. `canvas.get_frame_context`：Codex 能读取指定 frame 内的媒体、文本、标注、空间关系；
3. `canvas.capture_frame` / `canvas.capture_selection`：需要视觉判断时，Codex 能拿到局部截图；
4. `canvas.insert_media`：Codex 能把生成结果作为新素材插回画布；
5. `canvas.create_version` / `canvas.link_versions`：生成结果和源素材之间有可见连线与可查询 metadata；
6. skill orchestration：图像、视频、3D 等场景能力以 Codex agent skill 存在，而不是白板业务按钮。

验收标准不是“画布里能调用某个 API”，而是：

> Codex 能准确知道用户选中了什么、frame 里有哪些上下文、源素材在哪里、标注是什么、输出应当写回哪里，并能把生成结果作为可追踪版本放回画布。

`Send to Codex` 的默认语义也必须固定：

```text
User clicks Send to Codex on a frame
→ canvas publishes frame context and a pending Codex frame request
→ Codex reads and summarizes the task context
→ user confirms or adds instructions in the Codex conversation
→ Codex chooses skill/provider/model and executes
→ Codex writes the result back to the canvas
```

它不是“点击后立即生成”。立即生成只能出现在用户已经显式进入某个持续 Skill / 自动执行模式、或按钮本身明确叫 `Generate version` 且上下文里已经有完整执行意图时。默认 `Send to Codex` 应该降低误触成本，避免不必要的 API / token / generation credit 消耗。

首次进入画布的 example 策略也先记为待办：

- 正式开源时，不应把 Phase 0 的 seeded product demo 强行展示给所有用户；
- 首次进入可以出现一个 example / sample project / onboarding canvas；
- example 的具体内容后续再定；
- 默认空白画布、开发模式自动 seed、以及 `Load example` 按钮三种形态需要在正式发布前确认。

## 3. 产品定位

### 3.1 推荐定位

产品定位：

> 面向 Codex 与 coding agent 用户的开源多模态媒体画布：选择图片、视频帧或 3D 视图，标注修改意见，由 agent 调用模型生成新版，并自动回填到画布，保留完整版本血缘。

更短的 GitHub About：

> Agent-native infinite canvas for generating and revising images, video, and 3D with frame-level feedback and version history.

中文对外介绍：

> Codex Media Canvas 是一个本地优先的 AI 创作画布插件。它把图片生成、标注修图、视频帧反馈、3D 预览和多模型生成放到同一条 agent 工作流里：你在画布上指，Codex 去理解和生成，结果自动回到画布。

### 3.2 目标用户

第一优先级用户：

- Codex / Claude Code / Cursor / Cline / MCP / Skill 用户；
- AI builder；
- indie hacker；
- growth engineer；
- 技术型内容创作者；
- 小团队里的增长、营销、产品视觉负责人；
- 需要在项目目录内管理生成素材的人。

他们通常在意：

- 能不能用自己的 API key、模型、Skill、MCP；
- 生成物能不能保存在本地项目里；
- 每张图 / 每段视频是怎么来的；
- 能不能从某个选区、某个视频帧、某个参考图继续迭代；
- 能不能调试、复现、扩展，而不是被封闭 SaaS 黑箱控制。

第二优先级用户：

- 内容团队；
- 广告投放团队；
- 电商运营；
- 社媒运营；
- 品牌和营销顾问；
- 需要批量生成广告图、封面、产品图、短视频概念和 3D mockup 的团队。

v1 暂不服务的用户：

- 完全非技术用户；
- 期待完整 Canva 模板生态的人；
- 期待专业 timeline 视频编辑的人；
- 期待稳定协同设计 SaaS 的企业设计团队；
- 不愿意配置本地工具、API key 或 Codex plugin 的用户。

### 3.3 场景定位

最适合切入的场景不是“画一切”，而是以下四类：

#### 场景 A：标注式修图

用户选中图片，在图上画箭头、圈选、写备注，然后让 Codex 生成新版。

典型需求：

- 把背景换成科技感办公室；
- 保留人物，换衣服颜色；
- 产品图加高端摄影灯光；
- 删除角落杂物；
- 把图改成小红书 / YouTube / 广告封面比例。

#### 场景 B：多图营销物料

用户导入一个产品图或品牌 brief，在 Codex 中调用对应 agent skill，skill 读取当前画布 selection / frame context 后生成一组可对比的营销图。

典型输出：

- 电商主图；
- 卖点图；
- 场景图；
- 社媒封面；
- banner；
- launch campaign visual。

#### 场景 C：视频帧反馈与镜头重生成

用户导入视频，暂停在某一帧，圈出问题，提出修改意见。系统基于该帧生成：

- 编辑后的关键帧；
- 新的视频 prompt；
- image-to-video 参考帧；
- 一段替换镜头；
- 或者完整 revised shot。

v1 不承诺逐帧精修，而承诺“frame-guided shot revision / concepting”。

#### 场景 D：图片到 3D 与视图反馈

用户从图片生成 3D `.glb` / `.gltf`，在画布中预览模型，冻结某个视角并标注反馈，再生成新版。

典型需求：

- 产品图生成 3D mockup；
- 角色概念图转 3D；
- 标注某个材质或视角继续优化；
- 生成多个 3D 方向并横向比较。

## 4. 核心产品逻辑

### 4.1 统一抽象：媒体资产，而不是画布 shape

Cowart / AI-Canvas 的早期实现容易把 tldraw image shape 当成主对象。但我们的项目必须从一开始把主对象定义为 Media Asset / Media Version。

原因：

- 图片、视频、视频帧、3D 模型都可以是媒体资产；
- 一次生成可能产生多个版本；
- 一个版本可能来自多个输入；
- 一个视频帧可能从属于视频资产；
- 一个 3D 视图截图可能从属于 3D 模型版本；
- 画布只是这些资产的空间呈现。

推荐核心模型：

```ts
type MediaKind = 'image' | 'video' | 'frame' | 'model3d'
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

interface MediaAsset {
  id: string
  kind: MediaKind
  path: string
  mimeType: string
  width?: number
  height?: number
  durationMs?: number
  createdAt: string
}

interface MediaVersion {
  id: string
  assetId: string
  parentVersionIds: string[]
  operation: 'generate' | 'edit' | 'variation' | 'frame-edit' | 'convert'
  provider: string
  model?: string
  prompt: string
  parameters: Record<string, unknown>
  annotationSetId?: string
  jobId: string
}

interface AnnotationSet {
  id: string
  sourceVersionId: string
  frameTimeMs?: number
  coordinateSpace: { width: number; height: number }
  items: AnnotationItem[]
}

interface GenerationJob {
  id: string
  type:
    | 'image.generate'
    | 'image.edit'
    | 'video.generate'
    | 'video.edit'
    | 'model3d.generate'
  status: JobStatus
  progress?: number
  providerJobId?: string
  inputVersionIds: string[]
  outputVersionIds: string[]
  error?: { code: string; message: string; retryable: boolean }
}
```

画布 shape 只保存：

- `mediaVersionId`；
- bounds；
- display mode；
- playback state；
- selected frame；
- 3D camera state；
- visual connection。

真正的 prompt、provider、model、job、成本、输入输出关系，都应保存在 media metadata 中。

### 4.2 统一流程：selection / frame context，而不是表单提交

v1 的核心规则：

> 画布中的生成、编辑、视频、3D 操作都应该通过 Codex 读取真实画布上下文来执行，而不是让浏览器直接调用 provider API，也不是让白板变成一堆表单和请求队列。

推荐主路径：

```text
用户在画布上选择素材，或用 frame 框住一组素材+标注
→ Codex 通过 MCP 读取当前 selection / frame context
→ Codex 根据对话上下文选择 agent skill / provider
→ provider adapter 提交任务
→ server 轮询 / 接收结果
→ 结果 materialize 到本地 asset store
→ canvas 在 anchor 右侧插入新版本并展示血缘
```

这样做有几个好处：

- API key 不暴露给浏览器；
- 可以复用 Codex 的上下文理解；
- 可以用 Codex agent skill 做高层业务编排；
- 可以保留完整 job / prompt / provider metadata；
- 可以支持长任务、失败重试、成本提示；
- 将来可以替换 provider，而不用重写画布 UI。

异步 job queue 仍然需要存在，但它属于 provider/job 层，不应该成为用户理解产品的主交互。也就是说：

- 允许：Atlas 视频生成、3D 生成、批量多图生成使用异步 job；
- 允许：server 记录 job status、失败重试、成本和 output materialization；
- 不允许：用户主要通过“提交请求 → 等 Codex 轮询领取”的方式使用白板；
- 不允许：用 request queue 代替 `canvas.get_selection` / `canvas.get_frame_context` 这种即时上下文读取能力。

### 4.3 Frame 作为局部上下文选择器

除了直接选中单个素材，产品还应该支持一个非常关键的交互：

> 用户在画布上完成各种标注后，可以拿一个 frame 框住“这次要处理的素材 + 标注 + 参考图”。frame 上出现 `按标注生成新版` 按钮。点击后，Codex 只处理这个 frame 内部的上下文，而不是处理整张白板上的所有标注。

这解决一个真实问题：用户在白板上可能同时有很多草稿、参考图、历史标注和不同分支。如果 Codex 每次都读取“全局标注”，上下文会混乱。frame 让用户用空间方式声明任务边界。

Frame context 至少应包含：

- frame id；
- frame bounds；
- frame 内部的 media shapes；
- frame 内部的 arrow / geo / draw / note 标注；
- 标注与素材的几何关系；
- frame title / note，作为本次任务的高层 brief；
- anchor media，即新版本默认要跟随的父素材；
- 当前 provider mode / session mode；
- 已存在的 parent version metadata。

Frame 上的按钮不是业务 Skill 按钮，而是一个基础动作：

```text
Generate new version from this frame
```

它的作用是触发 Codex 读取这个 frame context。真正采用哪个 agent skill、哪个 provider、哪个模型，仍然由 Codex 根据对话上下文、当前 session mode 和用户指令决定。

### 4.4 统一输出：自动回板与版本血缘

生成结果不能随机出现在画布角落。默认布局规则：

- 单个新版本：放在源资产右侧；
- 多个结果：在源资产右侧以 grid 布局；
- frame 触发的新版本：放在 frame 右侧或 anchor media 右侧，并保留与 frame / anchor 的连接；
- 视频帧结果：放在源视频或源帧右侧，并标注 timestamp；
- 3D 结果：放在源图 / 源模型右侧，保留 camera snapshot；
- 分支结果：用细线或 lineage panel 连接父版本。

每个生成物必须记录：

- parent asset / version；
- input references；
- prompt；
- provider；
- model；
- parameters；
- output local path；
- remote URL / provider job id；
- created time；
- cost / latency，如可得。

### 4.5 Canvas Session Mode：持续使用一个场景 Skill

用户不应该每处理一次素材都重新选择一次 Skill，也不应该在白板里点一堆业务按钮。我们需要支持一种“持续场景模式”：

> 用户在 Codex 对话中设定当前工作场景，例如“接下来这个白板都按 Product Marketing Set 来处理”。之后用户只需要继续在画布里选择素材、画标注、框 frame、点击生成；Codex 会默认沿用当前 active agent skill，直到用户切换或退出。

这就是 Canvas Session Mode。

它解决三个问题：

1. **连续工作流。**  
   用户做一组电商营销图、社媒适配图或视频广告关键帧时，不需要每次重复描述场景。

2. **避免白板表单化。**  
   场景选择留在 Codex 对话里，而不是变成白板里的 Skill 面板。

3. **让 frame 成为任务单元。**  
   同一个 active skill 可以连续处理多个 frame：每个 frame 是一次局部任务，session mode 是持续上下文。

推荐交互：

```text
用户：接下来用 Product Marketing Set 模式处理这个白板
Codex：已开启 Product Marketing Set。你可以框住任意产品图和标注，我会按这个场景生成营销套图。

用户在画布中框选 frame A → 点击按标注生成新版
Codex 读取 frame A context → 用 Product Marketing Set 生成一组图 → 回板

用户继续框选 frame B → 点击按标注生成新版
Codex 沿用 Product Marketing Set → 生成下一组图 → 回板

用户：切到 Video Ad Keyframes
Codex：已切换，后续 frame 会按视频广告关键帧处理
```

画布 UI 中最多显示一个轻量状态条：

```text
Active skill: Product Marketing Set · Provider: Auto/Atlas · Configure in Codex
```

但不要提供完整 Skill 列表、表单和参数面板。

Session Mode 需要记录：

- active agent skill；
- provider preference；
- output strategy，例如 single version / grid / storyboard；
- last used model；
- default placement；
- optional brand/style context；
- startedAt / updatedAt；
- clear / switch / resume 行为。

待验证问题：

- Codex 会话能否稳定保持这种 mode；
- 新对话或服务重启后如何 resume；
- session mode 存在画布 metadata、Codex memory、还是两边都存；
- 如果 frame title / 用户临时指令与 active skill 冲突，优先级如何处理。

### 4.6 官方 tldraw Agent Starter 的迁移原则：只拿 agent runtime，不改变核心需求

2026-06-26 的调研发现，tldraw 官方已经提供了成熟的 AI-enabled canvas / agent starter kit。这个发现会改变我们的技术路径，但不应该改变项目定位。

需要特别强调：

> 官方 tldraw agent starter 是我们的 agent canvas runtime 基座，不是我们的产品形态本身。

我们的核心需求仍然是：

```text
用户在画布上选择图片、视频帧或 3D 视图
→ 用标注、frame、selection 表达局部修改意图
→ Codex Skill / agent 理解上下文并选择生成策略
→ 调用 Atlas / Seedance / Kling / 其他 provider
→ 新图片 / 视频 / 3D 版本自动回到画布
→ 保留版本血缘、prompt、provider、job、资产路径和迭代记录
```

官方 starter 对我们有价值，是因为它已经成熟解决了“agent 如何看画布、如何行动、如何多轮工作”的基础设施问题，而不是因为我们要做一个通用 AI 绘图聊天白板。

#### 4.6.1 应该迁移的官方能力

只迁移与核心需求直接相关的能力：

1. **Agent App / Provider runtime。**  
   用官方 `TldrawAgentApp` / `TldrawAgent` 形态承载 agent 状态、prompt、request、schedule、interrupt，而不是继续维护我们临时拼出来的 polling / frame button 主流程。

2. **Prompt Parts。**  
   把“agent 能看见什么”模块化。我们当前的 `canvas.get_frame_context` 不应该长期停留在右侧 JSON 面板，而应该变成 prompt part：
   - selected media part；
   - bounded frame context part；
   - annotations part；
   - media asset metadata part；
   - provider/job history part；
   - screenshot / viewport part。

3. **Action Schemas + Action Utils。**  
   把“agent 能做什么”模块化。我们不应该继续把生成逻辑写成 UI button handler，而应该新增媒体动作：
   - `generate-media`；
   - `edit-media-from-annotations`；
   - `extract-video-frame`；
   - `generate-video-shot`；
   - `generate-3d-asset`；
   - `place-generated-version`；
   - `connect-version-lineage`。

4. **Chat history / action history / todo / review loop。**  
   这些用于支撑“用户持续使用一个场景 Skill 完成需求”。例如一个 Product Marketing Set skill 可以持续处理多个 frame，而不是每个 frame 都像一次孤立请求。

5. **Programmatic `agent.prompt(...)`。**  
   这是 Codex Skill 接入画布的关键。白板按钮只是快捷入口，主路径应是：

   ```text
   Codex Skill → agent.prompt({ message, bounds, contextItems }) → action utils → provider executor
   ```

6. **Agent viewport / selection / screenshot 能力。**  
   用来让 agent 在大画布中理解“用户当前看哪里、选了什么、框住了哪里”，而不是盲读整张白板。

#### 4.6.2 不应该迁移的官方 demo 方向

以下内容可以作为参考，但不应该成为我们的产品中心：

1. **不要迁移成通用“AI 画任何东西”的绘图 agent。**  
   官方 starter 默认可以 create / update / move / align / draw shapes，但我们的产品不是通用绘图助手。通用 shape 操作只作为辅助能力，核心永远是媒体生成与修订。

2. **不要把 chat panel 变成主产品，而忽略 Codex Skill。**  
   Chat panel 可以存在，但核心分发形态应该是 Codex agent skill。用户应该可以在 Codex 中安装/启用某个场景 Skill，由 skill 驱动画布。

3. **不要迁移官方示例外部 API。**  
   例如 country info 这类 demo action 与本项目无关，不进入我们的迁移范围。

4. **不要迁移成模型 provider playground。**  
   provider 选择、参数、成本、失败重试等应该隐藏在 Codex Skill / provider adapter / server executor 层，而不是变成画布上的模型控制台。

5. **不要重写 tldraw 原生 UI。**  
   官方 starter 也主要是在原生 tldraw 上增加 agent 能力。我们应保留原生 toolbar / style panel / context menu，只增加必要的媒体与 agent overlays。

6. **不要丢失本地优先与资产血缘。**  
   官方 starter 关心 canvas agent；我们还必须保留本地 asset store、绝对路径、provider payload、job metadata、version lineage。这是我们的差异化。

#### 4.6.3 迁移后的目标架构

迁移后的产品边界应该是：

```text
Tldraw native canvas
  - selection
  - frame
  - annotations
  - native image/video/model preview shapes

Agent runtime from official starter
  - prompt parts
  - action schemas
  - action utils
  - chat/action history
  - schedule/review loop

Codex Skill layer
  - scene skill install / switch / resume
  - user intent and project context
  - decides default workflow and provider policy

Media backend
  - local asset store
  - chunked upload
  - media materialization
  - provider payload builders
  - Atlas / Seedance / Kling executor
  - job/result/version metadata

Canvas writeback
  - generated media shape
  - placement near source/frame
  - visible lineage
  - version history
```

关键变化：

```text
当前 spike:
Frame button → extract context → build generation request → mock/provider → insert result

迁移后:
Codex Skill / frame shortcut
→ agent.prompt({ bounds, selected media, scene mode })
→ prompt parts collect bounded media context
→ model emits media-specific actions
→ action utils call provider executor
→ result materializes into asset store
→ canvas writeback creates version + lineage
→ history/review loop continues if needed
```

#### 4.6.4 分阶段迁移计划

迁移必须围绕核心需求，不做“大而全官方 demo 复刻”。

**Phase M0：官方 starter 最小运行验证**

目标：

- 在隔离目录中跑通官方 agent starter；
- 确认依赖、目录结构、worker / local server 适配方式；
- 不修改当前可用的 `phase0-tldraw-spike`。

验收标准：

- 官方 chat agent shell 可运行；
- 可调用一次 programmatic `agent.prompt(...)`；
- 明确哪些文件会被 port，哪些不会。

**Phase M1：迁入 agent shell，但不接媒体生成**

目标：

- 在本项目新建 `phase1-agent-starter-migration`；
- 迁入官方 agent app shell；
- 保留 tldraw 原生 UI；
- 保留我们的 asset store / upload；
- 只跑通 agent request / chat panel / programmatic prompt。

验收标准：

- 用户能在画布中打开 agent chat；
- Codex 或页面代码能调用 `agent.prompt(...)`；
- 上传图片/视频仍然工作；
- 不出现任何业务 Skill 面板化倾向。

**Phase M2：把 frame context 迁移为 prompt part**

目标：

- 把当前 `extractFrameContext` 改造成 `BoundedFrameContextPartUtil`；
- 把 media、annotation、frame title、asset path、timestamp、version metadata 放入 prompt part；
- 右侧 JSON 面板降级为 debug 工具。

验收标准：

- 选择 frame 后，agent prompt 能读到正确的 bounded context；
- 大白板中其他无关标注不会污染本次任务；
- 图片、视频、3D 的 asset metadata 能进入 prompt。

**Phase M3：新增媒体生成 action**

目标：

- 新增 `generate-media` / `edit-media-from-annotations` action schema；
- action util 调用我们现有的 provider payload builders；
- 继续使用 mock executor 验证 canvas writeback；
- 生成结果自动放到源素材或 frame 右侧，并保留可见血缘。

验收标准：

- agent 能从 frame context 决定生成一次媒体任务；
- `providerPayloads.atlas` 仍然生成正确；
- 新结果 shape、local path、lineage、operation log 都正确。

**Phase M4：Codex Skill 驱动场景模式**

目标：

- 把 Product Marketing Set / Video Ad Keyframes / Style Exploration 这类能力定义为 Codex Skill；
- Skill 通过 `agent.prompt(...)` 驱动画布；
- 支持 Canvas Session Mode：用户启用一个 Skill 后，可连续处理多个 frame。

验收标准：

- 用户在 Codex 中启用 Skill，而不是在白板里点 Skill 面板；
- frame 只是局部任务边界；
- active skill/provider 状态可见但不喧宾夺主。

**Phase M5：接真实 provider executor**

目标：

- 将 Atlas 作为首个真实 executor；
- 保持 Seedance / Kling / 其他 provider adapter 可插拔；
- 支持 image edit、text/image/reference to video、3D generation 等模式。

验收标准：

- mock provider 可替换为 Atlas；
- 结果真实回板；
- job status、错误、重试、成本/耗时、输出文件路径可追踪。

#### 4.6.5 迁移期间必须守住的核心需求

迁移过程中，如果任何实现选择与下面原则冲突，应优先回到这些原则：

1. **核心对象是媒体资产和版本，不是普通 shape。**
2. **核心交互是 selection / frame / annotation，不是表单。**
3. **核心能力通过 Codex agent skill 存在，不是白板按钮集合。**
4. **结果必须自动回板，并有可见血缘。**
5. **provider 抽象必须保留，Atlas 是推荐路径但不是唯一硬编码。**
6. **视频和 3D 是一等公民，不是图片功能的附属品。**
7. **官方 starter 只提供 agent runtime 基座，不改变我们的产品定位。**

## 5. 关键能力设计

### 5.1 图片生成与标注修图

这是 v1 必须打磨到最顺的主流程。

用户流程：

1. 打开画布；
2. 新建 holder 或上传图片；
3. 输入自然语言生成图片，或让 Codex 填充 holder；
4. 在图上画箭头、框选、圈选、文字备注；
5. 选择图本身，或用一个 frame 框住“这次要处理的图 + 标注 + 参考素材”；
6. 点击素材/右键菜单/窗口 frame 上的“按标注生成新版”；
7. Codex 读取选区或 frame 内的结构化 annotation；
8. Codex 根据当前对话上下文选择普通图片编辑流程或某个 agent skill；
9. 调用 Codex native / Atlas / custom provider；
10. 新图自动放到源图或 frame 右侧；
11. 用户继续标注、对比或分支。

需要强调：annotation edit 是核心能力，不应该包装成一个普通业务 Skill。用户看到的是一个基础动作：

- 按标注生成新版；
- 交给 Codex 修改；
- Generate new version。

这里有两种等价入口：

1. **Codex 主动读取。**  
   用户在对话里说“看我画布里选中的这张图，按标注改一下”。Codex 直接调用 `canvas.get_selection` 或 `canvas.get_frame_context`。

2. **Frame 局部触发。**  
   用户用 frame 框住一小片白板区域，frame 上浮出 `按标注生成新版`。点击后，系统把 frame id 交给 Codex，Codex 只处理 frame 内部上下文。

第二种入口很重要，因为它允许用户在一张大白板里同时保留很多历史分支、参考图和未处理标注，而每次只让 Codex 处理被 frame 明确框住的一组内容。

业务 Skill 应该用于“电商套图”“品牌视觉”“视频广告关键帧”这种场景输出，但它们以 Codex agent skill 存在，而不是以白板按钮存在。白板只提供 selection / frame context 和基础触发动作。

### 5.2 视频帧反馈与镜头重生成

视频是我们相对 AI-Canvas 的第一差异点。

但要诚实定义边界：

> “修改这一帧，然后自动改整段视频”不是一个通用可保证的操作。除非底层 provider 支持 video-to-video / temporal inpainting，否则很容易出现闪烁、身份漂移、镜头不连续。

所以产品应提供三种明确策略：

1. Native video edit  
   使用 provider 原生 video-to-video / inpainting 能力，适合模型支持时。

2. Keyframe-guided regeneration  
   先编辑关键帧，再用关键帧作为 image-to-video 起始帧或参考帧重新生成镜头。

3. Shot replacement  
   截取一段时间范围，重新生成替换镜头，必要时保留原音频或做简单拼接。

v1 推荐主打第二种：

```text
视频 → 抽帧 → 标注帧 → 生成关键帧 / prompt → image-to-video → 新镜头回板
```

用户流程：

1. 上传视频；
2. 播放并暂停在某一帧；
3. 点击 `Annotate frame`；
4. 系统提取该时间点 clean frame；
5. 用户在 frame 上标注；
6. Codex 读取 frame + timestamp + annotation；
7. 生成 edited frame、video prompt 或 revised shot；
8. 新视频或关键帧回到画布；
9. metadata 中记录源视频、时间戳、策略、provider、model。

### 5.3 3D 资产生成与视图反馈

3D 在 v1 可以先做到“生成、预览、视图标注、版本追踪”，不要承诺完整 3D 编辑器。

用户流程：

1. 选择一张图片；
2. 通过 Atlas / provider 生成 `.glb` / `.gltf`；
3. 画布中出现可旋转的 3D viewer shape；
4. 用户调整相机角度；
5. 冻结当前 view；
6. 标注材质、形体、颜色、比例等意见；
7. Codex 将反馈转成：
   - regenerate geometry；
   - regenerate texture / material；
   - generate new reference image；
   - another image-to-3D pass；
8. 新模型作为 child version 放到右侧。

产品表达上要避免误导：

- 不承诺直接编辑任意 mesh topology；
- 不承诺专业 UV / rig / animation；
- 不承诺 deterministic CAD 级修模；
- 先承诺“AI 生成 3D 资产的可视化迭代工作台”。

### 5.4 Codex agent skill

业务能力是增长和传播的重要抓手，但它们应该以 **Codex agent skill** 的形态存在，而不是变成白板里的按钮、表单或右侧 Skill 面板。

正确形态：

```text
用户在 Codex 中启用 / 调用 agent skill
→ skill 读取 canvas selection / frame context
→ skill 根据业务场景规划输出
→ 调 provider 生成
→ 调 canvas.create_version / place_media 回板
```

错误形态：

```text
白板右侧放一堆 Skill 卡片
→ 用户在白板里填表
→ 白板提交请求
→ Codex 被动处理
```

我们要避免第二种。它会把白板从“空间上下文”变成“业务表单容器”。

v1 可准备四类 agent skill，但首发不应该一口气全做完。优先把图片标注改图闭环跑通，然后只选择 1 个最能展示商业价值的 skill 作为样例。

#### Product Marketing Set agent skill

输入：

- canvas selection 或 frame context；
- 产品图；
- 品牌 / 风格参考；
- 用户 brief。

输出：

- 主图；
- 卖点图；
- 场景图；
- 广告图；
- 多个版本 grid。

#### Social Repurpose agent skill

输入：

- canvas selection 或 frame context；
- 一张源图或生成图。

输出：

- 小红书封面；
- Instagram post；
- Story / Reels；
- YouTube thumbnail；
- 横版 banner；
- LinkedIn / X 图片。

#### Video Ad Keyframes agent skill

输入：

- canvas selection 或 frame context；
- 产品图；
- 参考图；
- campaign brief；
- 可选视频帧。

输出：

- storyboard；
- 视频广告关键帧；
- video prompt package；
- 可选 image-to-video 任务。

#### Style Exploration agent skill

输入：

- canvas selection 或 frame context；
- 多张参考图；
- mood / style notes。

输出：

- 多个风格方向；
- 每个方向可继续生成；
- 保留参考关系和版本链。

## 6. Atlas Cloud 在项目中的定位

### 6.1 Atlas 是最佳支持 provider，不是唯一 provider

Atlas Cloud 的优势是非常适合这个项目：

- 图像生成；
- 图像编辑；
- 视频生成；
- image-to-video；
- 多模型路由；
- LLM API；
- 上传本地媒体并获得可用于模型输入的 URL；
- 统一异步任务与结果查询模式。

但如果开源项目从第一天强制用户只用 Atlas，会削弱 OSS 可信度。更好的定位是：

```text
Open provider protocol
Atlas Cloud as the best-supported default provider
```

对外口径：

- 没有 Atlas 账号也能打开画布、上传素材、标注、用 Codex native demo；
- 配置 Atlas 后获得完整 image / video / multi-model 能力；
- 高级用户可以接入 Fal、Replicate、ComfyUI、Runway、OpenAI、Higgsfield 或内部模型；
- Atlas 示例和文档最完整，默认推荐。

### 6.2 Atlas 的自然推广点

好的推广方式：

- README 第一推荐 Atlas setup；
- job details 中显示 `Powered by Atlas Cloud`；
- 生成 metadata 记录 Atlas model id / prediction id / cost；
- 提供“同一 prompt 多模型对比”的示例 canvas；
- 提供 image-to-video 和 3D demo，让 Atlas 的多模态模型优势自然出现；
- 提供一键打开 Atlas 模型详情或 playground 的链接；
- 用透明成本 / 延迟 / 模型记录建立信任。

需要避免：

- 不配置 Atlas 就无法打开项目；
- 把 generic protocol 字段命名成 Atlas 专属字段；
- 隐藏成本或 provider 调用；
- 将开源项目写成广告页；
- 在没有实时来源时夸大模型数量或价格优势。

### 6.3 Atlas provider adapter

推荐 adapter 形态：

```ts
interface MediaProvider {
  capabilities(): Promise<ProviderCapabilities>
  submit(request: MediaRequest): Promise<SubmittedJob>
  poll(job: SubmittedJob): Promise<ProviderJobState>
  cancel?(job: SubmittedJob): Promise<void>
  materialize(result: ProviderResult, destination: string): Promise<LocalAsset>
}
```

Atlas adapter 需要支持：

- text-to-image；
- image edit；
- image variations；
- text-to-video；
- image-to-video；
- video result polling；
- media upload；
- 模型列表发现；
- 错误处理；
- 成本 / 延迟记录；
- output URL materialize 到本地。

重要规则：

- 不要在代码里硬猜 model id；
- 启动或配置时拉取可用模型列表；
- 只展示公开可用模型；
- POST 生成任务不要自动重试，避免重复计费；
- GET polling 可以指数退避重试；
- provider URL 结果必须下载到本地，不能长期依赖远程临时链接。

## 7. 技术架构

### 7.0 后端形态：需要本地后端，不需要 v1 云后端

这个项目需要“后端”，但 v1 不应该先做云后端、账号系统或托管数据库。正确形态是：

> 本地 canvas web app + 本地 server / MCP server + 项目目录内持久化。

也就是说，后端职责先由本地进程承担：

- 保存生成图片、视频、3D 文件；
- 保存素材 metadata；
- 保存版本血缘；
- 保存 frame context / annotation set；
- 保存 generation job；
- 保存 provider result；
- 保存 Canvas Session Mode；
- 给 Codex 暴露 MCP tools；
- 负责 provider output materialization；
- 保护 API key 不进入浏览器。

推荐本地存储：

```text
.codex-media-canvas/
  canvases/
    default.tldr.json
  assets/
    images/
    videos/
    frames/
    thumbnails/
    models/
  metadata/
    assets.json
    versions.json
    annotations.json
    sessions.json
    skills.json
  jobs/
    <job-id>.json
  logs/
    operations.jsonl
```

其中：

- canvas snapshot 只保存 shape / placement / reference；
- 大媒体文件存在 `assets/`；
- 对话和打磨记录以 `operations.jsonl` + `versions.json` + `jobs/` 形式保存；
- Codex 具体聊天全文不一定要复制保存，但每次生成应保存用户意图摘要、skill、prompt、provider、model、input frame context、output path；
- provider 临时 URL 必须 materialize 到本地；
- API key 只存在 Codex 环境、本地 server 环境或系统 keychain，不进入 canvas browser。

未来可以做云后端，但它应该是 v2/v3 之后的可选能力：

- 多设备同步；
- 团队协作；
- hosted gallery；
- provider proxy / billing；
- shared skill marketplace；
- remote job runner。

这些都不应该阻塞 v1。

### 7.1 推荐目录结构

```text
apps/
  canvas-web/             React + TypeScript canvas UI
  local-server/           local HTTP API, job runner, media service

packages/
  media-core/             assets, versions, annotations, jobs, lineage
  canvas-adapter/         canvas-engine-neutral operations
  providers/              Atlas and custom provider adapters
  mcp-server/             Codex / MCP stdio server
  skills/                 Codex agent skills

plugins/
  codex/                  plugin metadata, install docs, Codex skills

docs/
  project-background-positioning-plan.md
  cowart-research.md
  ai-canvas-deployment-and-roadmap.md
  codex-media-canvas-plan.md
```

### 7.1.1 画布引擎选择：tldraw 只能作为候选，不是既定答案

此前方案默认使用 tldraw，是因为它能最快提供无限画布、基础图元、拖拽、缩放、箭头和便签。但从当前观察看，tldraw 对我们来说并不是一个无脑正确的选择：

- 它适合快速验证白板交互，但产品级自定义媒体 shape、复杂 frame context、视频/3D 嵌入、精确绑定、性能和样式控制都需要进一步验证；
- 它的默认 UI/交互比较“白板工具”，不一定天然适合 AI media workspace；
- 如果大量核心能力要绕开或改造 tldraw，使用它的收益会下降；
- 公开发布前还必须确认当前 tldraw SDK 的生产/商用 license 路径；
- 画布引擎一旦耦合过深，后续替换成本会非常高。

因此，正确决策不是“用 tldraw 做项目”，而是：

> 先用最小 spike 验证 tldraw 能否承载我们的北极星闭环；同时保持 canvas adapter 边界，避免媒体资产、版本血缘、provider/job 系统被 tldraw 结构绑死。

画布引擎评估标准：

1. 素材能否作为真实画布对象存在，而不是 DOM 覆盖层；
2. 能否定义 image / video / frame / 3D preview 等自定义 shape；
3. 标注能否使用原生图元，并可靠关联到素材或 frame；
4. frame 能否作为局部上下文容器，读取内部素材和标注；
5. 能否稳定实现父子版本连线和 binding；
6. 能否把 selection / frame context 结构化暴露给 MCP；
7. 大型画布、多个媒体对象、视频预览时性能是否可接受；
8. license 是否允许我们的开源和商业传播路径；
9. 是否能隐藏不需要的默认 UI，避免产品看起来像普通白板；
10. 如果将来替换引擎，media-core / providers / agent skills 是否不用重写。

候选方向：

- tldraw：最快验证，风险是可定制深度、license 和产品感；
- React Flow / xyflow：更适合 graph / workflow，不适合自由白板标注作为主画布；
- Konva / Fabric.js：更底层、更可控，但需要自建大量编辑器交互；
- Excalidraw fork / integration：手绘标注感强，但自定义媒体对象和深度集成风险高；
- 自研 canvas/SVG 层：长期可控，但 v0 成本最高。

Phase 0 的关键产出应该是一份 canvas engine spike 结论，而不是直接把 tldraw 写死。

### 7.1.2 `canvas-studio/` 失败复盘

当前 workspace 中的 `canvas-studio/` 不能再被视为 v0/v1 baseline。它只能作为失败原型和反面材料。它做对了一些数据层概念，例如本地 asset store、metadata、request、version 字段；但在产品形态上严重偏离北极星。

主要问题：

- tldraw 被放在 `aria-hidden` 层里，变成背景白板；
- 素材不是 tldraw 自定义 shape，而是独立 DOM asset card；
- 素材、标注、连线、位置关系不在同一个画布坐标系里；
- 标注被退化成 textarea，不是用户在图上画 arrow / box / note；
- 左侧出现 Import、Provider、Ask Codex、Annotation、Session 等表单墙；
- provider 和 scene 选择侵入白板 UI；
- request queue 成为主要交互，而不是 Codex 即时读取 selection / frame context；
- 视频、scene preset、provider onboarding 等广度功能早于图片标注改图闭环；
- 它看起来像一个本地素材管理面板，而不是 agent-native media canvas。

结论：

> `canvas-studio/` 不应继续沿用为正式实现。可以保留少量类型定义、测试思路或 asset store 经验，但 UI / canvas adapter / interaction model 应该推倒重来。

未来实现必须先满足：

- tldraw 或其他引擎是真正交互主体；
- media asset 是画布 shape；
- 标注是画布图元；
- selection 来自画布选择；
- frame 可作为局部任务边界；
- 新版本在画布上真实出现在父版本右侧并有可见连线。

### 7.1.3 当前已有原型材料

当前 workspace 中仍有一些材料可复用或参考：

- `docs/codex-media-canvas-spec.md`：更接近实现约束的“防偏离版”规格；
- `canvas-studio/`：失败原型，可参考数据层和测试，但不能参考 UI 形态；
- `reactflow-studio/`：未来 lineage / workflow graph 可探索，但不应替代主白板；
- `ai-canvas/`：竞品/反面教材和市场信号，不作为实现形态参考。

### 7.2 运行时架构

```text
Canvas UI
  ↓ user selection / frame context / annotation
Local Server
  ↓ persist media metadata / jobs / canvas ops
MCP Server
  ↓ expose selection / frame context / insert ops
Codex / Agent Skill
  ↓ choose provider, prompt, and execution strategy
Provider Adapter
  ↓ Atlas / Codex native / Custom provider
Materializer
  ↓ download / save local output
Canvas Operation API
  ↓ insert asset / create version
Canvas UI updates
```

### 7.3 本地存储

推荐存储目录：

```text
.codex-media-canvas/
  canvases/
    default.json
  assets/
    images/
    videos/
    frames/
    thumbnails/
    models/
  metadata/
    assets.json
    versions.json
    annotations.json
  jobs/
    <job-id>.json
  logs/
    operations.jsonl
```

原则：

- 大媒体文件不能嵌入 canvas JSON；
- canvas shape 保存引用；
- metadata 保存生成关系；
- operation log 用于恢复；
- 写文件要 atomic；
- 导入 asset 时避免文件名冲突；
- 路径必须限制在 workspace root 内。

### 7.4 MCP / tool surface

最小可用工具：

```text
canvas.open
canvas.get_selection
canvas.get_frame_context
canvas.get_context
canvas.create_holder
canvas.place_media
canvas.create_version
canvas.create_comparison
canvas.create_lineage_arrow

annotation.get_context
annotation.render_composite
annotation.capture_video_frame

media.generate_image
media.edit_image
media.generate_variations
media.generate_video
media.edit_video
media.generate_3d
media.get_job
media.cancel_job

version.get_lineage
version.restore
```

v1 可以不一次性做完所有工具，但接口设计要面向多模态，而不是只服务图片插入。

其中最关键的是：

- `canvas.get_selection`：读取当前真实画布选择；
- `canvas.get_frame_context`：读取某个 frame 内部的素材、标注、参考图、frame title、anchor media 和几何关系；
- `canvas.create_version`：插入新版本，并自动建立父子 metadata；
- `canvas.create_lineage_arrow`：在画布上建立可见父子连线。

如果这四个工具不稳，后续 provider、video、3D、agent skill 都会变成漂浮在 UI 上的功能，而不是画布原生工作流。

### 7.5 安全和可靠性要求

必须处理：

- API key 只存在 server / Codex 环境，不能进入浏览器；
- 所有本地路径限制在 workspace root；
- 拒绝 path traversal 和 symlink escape；
- local server 绑定 `127.0.0.1`；
- 使用 session token 或 origin 校验；
- 限制文件大小、视频时长、3D polygon size；
- 限制并发任务数；
- 远程 URL 下载要防 SSRF；
- provider 输出要尽快 materialize；
- canvas snapshot 要有 last-known-good；
- invalid records 要 quarantine；
- 写入要带 revision，避免 lost update；
- 失败任务显示明确错误和 retryable 状态。

### 7.6 可插拔 Codex agent skill 模型

Skill 必须可插拔。项目不能假设只有内置的几个 scene skill，也不能要求用户在白板里安装按钮。

理想模型：

```text
用户在 Codex 中安装任意 agent skill
→ skill 声明自己需要哪些 canvas capability
→ skill 调用 canvas.get_selection / canvas.get_frame_context
→ skill 调 provider 或其他工具生成结果
→ skill 调 canvas.create_version / canvas.place_media 回板
```

这个项目需要定义的是 **canvas MCP contract**，不是定义所有 Skill。

Skill 只要遵守以下契约，就可以驱动画布：

- 能读取 selection 或 frame context；
- 能理解 media asset / annotation / version metadata；
- 能产出一个或多个本地媒体文件；
- 能调用 `canvas.create_version` 或 `canvas.place_media`；
- 能写回 prompt / provider / model / params / jobId / cost / latency；
- 不直接改 canvas snapshot 内部结构。

Skill registry 可以非常轻：

```ts
interface CanvasAgentSkillManifest {
  id: string
  name: string
  description: string
  input: 'selection' | 'frame-context' | 'both'
  output: 'single-media' | 'media-grid' | 'storyboard' | 'model3d'
  requiredCapabilities: string[]
  defaultProviderMode?: 'auto' | 'codex-native' | 'atlas' | 'custom'
}
```

白板最多显示 active skill 名称，不显示完整 skill marketplace。安装、切换、配置 skill 都发生在 Codex 中。

### 7.7 未落实想法的探索阶段

当前仍有一些想法没有完全定型。它们不应该现在全部实现，而应该按阶段确认：

| 未定问题 | 探索/确认阶段 | 判断标准 |
|---|---|---|
| tldraw 是否适合作为画布引擎 | Phase 0 | 是否支持真实 media shape、frame context、原生标注、父子连线、license 可接受 |
| frame 按钮如何通知 Codex | Phase 0/1 | 能否让 Codex 可靠读取指定 frame context；避免把 request queue 变成主交互 |
| Canvas Session Mode 存在哪里 | Phase 1/2 | 重启/新对话后能否 resume；是否需要同时存在 canvas metadata 与 Codex context |
| Product Marketing Set 等 Skill 形态 | Phase 2 | 是否能作为 Codex agent skill 插拔安装并驱动画布，而不是白板按钮 |
| Atlas 第一个真实 provider 链路 | Phase 3 | image edit / image-to-video 哪条链路最能证明 Atlas 价值 |
| 视频编辑承诺边界 | Phase 2/3 | 当前 Atlas/provider 是否支持 native video edit；否则只承诺 keyframe-guided regeneration |
| 3D 深度 | Phase 4 | 先做生成/预览/视图标注/版本，不承诺专业 mesh 编辑 |
| 云后端是否需要 | Phase 5 之后 | 是否出现协作、同步、托管、计费需求；v1 不需要 |
| Skill marketplace | Phase 5 之后 | 先支持用户在 Codex 安装任意 skill，之后再考虑目录/市场 |

## 8. MVP 与路线规划

### Phase 0：真画布地基与引擎验证，2-3 天

目标：

验证 clean-room、canvas engine、Codex plugin 和最小画布对象模型。重点不是接 provider，而是确认白板载体能承载北极星闭环。

任务：

- 确认 Cowart 不复制代码，仅参考交互；
- 确认 tldraw 当前 license 和生产使用路径；
- 用 tldraw 做最小 spike，同时列出替代引擎可行性；
- 验证 media asset 能否作为真实画布 shape 存在；
- 验证 arrow / box / note 等标注能否与素材可靠关联；
- 验证 frame 能否作为局部任务边界；
- 验证父子版本连线能否作为真实画布对象存在；
- 定义 `canvas.get_selection` / `canvas.get_frame_context` / `canvas.create_version` 的最小接口。

退出标准：

- 不依赖 Cowart 代码；
- 画布引擎不是背景层，而是真正交互主体；
- 拖入图片后成为真实 media shape；
- 用户能在图上画标注，并用 frame 框住一组素材和标注；
- MCP 能读取 selection / frame context；
- 新版本可以插到右侧，并用画布 arrow 连回父版本；
- 若 tldraw 无法满足这些条件，Phase 0 必须输出替代引擎建议，而不是继续硬做。

### Phase 1：图片标注改图单一闭环，约 1 周

目标：

把“用户指着图的一块区域说这里要改”跑通到可演示、可复现、可追溯。

范围：

- 图片上传 / 粘贴；
- 本地 asset store；
- media image shape；
- 画布原生标注；
- frame 局部上下文；
- `Generate new version` 基础动作；
- `canvas.get_selection`；
- `canvas.get_frame_context`；
- `canvas.create_version`；
- Codex native generation 作为零配置路径；
- Atlas adapter 可以只做接口预留，不必抢在闭环之前；
- 新版本右侧摆放；
- 可见父子 lineage arrow；
- 只读 asset details；
- crash recovery；
- basic tests / CI。

明确不做：

- 不做 Skill 面板；
- 不做 provider 表单墙；
- 不做多个 scene preset；
- 不做视频；
- 不做 3D；
- 不做模型市场 UI。

退出标准：

- 用户可以完成“选图/框 frame → 画标注 → 触发生成 → Codex 读取局部上下文 → 新版回到右侧 → 画布上有父子连线”；
- 不需要手动复制本地路径；
- 不需要截图给 Codex；
- 不需要让 Codex 处理整张白板上的所有标注；
- 旧图保留，新图可追溯。

### Phase 2：视频帧闭环 + 首个 agent skill，约 1-2 周

目标：

建立区别于 AI-Canvas 的首个强差异点，同时验证 agent skill 形态。

范围：

- video asset shape；
- 本地视频导入；
- thumbnail / proxy；
- frame extraction；
- MediaFrameShape；
- frame annotation；
- timestamp-bound annotation；
- frame context 读取；
- image-to-video 或 keyframe-guided regeneration；
- 选择一个首发 Codex agent skill，例如 Product Marketing Set；
- 该 skill 通过 MCP 读取 selection / frame context，而不是在白板里放表单；
- 多输出 grid 放在 anchor 右侧；
- job progress、cancel / retry、cost / provider metadata。

退出标准：

- 用户可以暂停视频某一帧，抽出 frame 并标注修改意见；
- Codex 可以只处理这个 frame context；
- 系统可以生成新关键帧或 revised shot；
- 新结果带源视频 timestamp 和 provider metadata 回到画布；
- 至少一个 agent skill 能从画布 selection / frame context 生成一组结果并回板。

### Phase 3：Atlas / provider router 与血缘增强，约 1 周

目标：

让 Atlas 成为最佳支持 provider，同时保持 open provider protocol。

范围：

- Atlas image generate / edit；
- Atlas image-to-video；
- media upload；
- provider capability discovery；
- provider fallback；
- 失败重试；
- 换模型重跑但不覆盖旧版本；
- cost / latency display；
- lineage panel 或可选 graph view；
- custom provider result contract 文档。

退出标准：

- Codex native 和 Atlas 都能走同一套 `create_version` 回板；
- Atlas 输出有 model id、prediction id、cost/latency、remote URL、本地 materialized path；
- 换 provider / model 重跑会产生新的 child version；
- 失败任务不会污染画布状态。

### Phase 4：3D MVP，约 1 周

目标：

支持 3D 资产作为一等媒体类型。

范围：

- image-to-3D；
- `.glb` / `.gltf` materialization；
- 3D viewer shape；
- camera state persistence；
- view capture；
- view annotation；
- regenerate geometry / material / reference；
- 3D version lineage。

退出标准：

- 一张图片可以生成可预览 3D asset；
- 用户可以冻结视图并标注反馈；
- 新模型 / 新 reference 能作为 child version 回板。

### Phase 5：Public OSS Launch

目标：

以开源项目形式正式发布，并为 Atlas 建立自然入口。

范围：

- 解决 license；
- 完成安全审查；
- opt-in telemetry；
- contribution guide；
- changelog；
- issue templates；
- demo GIF / video；
- English README；
- Chinese README；
- Atlas setup guide；
- custom provider guide；
- sample canvases；
- GitHub topics；
- launch X thread。

退出标准：

- 新用户 5 分钟内可以跑通 demo；
- 有清晰项目边界；
- 有明确 roadmap；
- Atlas 集成被自然理解为高级能力入口，而不是硬广。

## 9. 与 Cowart / AI-Canvas 的差异化

| 维度 | Cowart | AI-Canvas | 我们的方向 |
|---|---|---|---|
| 核心形态 | 小型 Codex + tldraw 桥 | Codex AI 画图白板 + Skill 工作台 | 以 selection / frame context 为核心的 agent-native media canvas |
| 主要媒体 | 图片 | 图片 | 图片 + 视频帧 + 视频 + 3D |
| provider | Codex 内置 | 当前仍偏 Codex 内置，计划外部服务 | Atlas 默认 + open provider protocol |
| Skill | 少量说明型 Skill | 业务 Skill 面板 | Codex agent skill，不放进白板按钮区 |
| 标注 | 依赖截图理解 | 箭头/文字/圈选修图 | 画布原生标注 + frame 局部上下文 |
| 局部任务边界 | 无 | 弱 | 用户用 frame 框住本次要处理的素材和标注 |
| 视频 | 无 | 无公开重点 | v1/v2 核心差异点 |
| 3D | 无 | 无公开重点 | v3 差异点 |
| 元数据 | 弱 | 中等 | asset/version/job lineage 一等公民 |
| 商业入口 | 无 | 代理层 / 外部服务设想 | Atlas provider / model routing / cost transparency |
| 开源可信度 | 无 license 风险 | MIT | Apache-2.0 或 MIT + provider 中立 |
| 画布引擎 | tldraw | tldraw | 引擎待验证，必须通过 adapter 保持可替换 |

核心战略：

> 不和 AI-Canvas 比谁有更多图片 Skill，也不参考它的白板内 Skill 面板形态。我们先把 selection / frame context → Codex agent skill → 生成 → 回板 → 血缘 这个闭环做深，再推进 Atlas provider、视频和 3D。

## 10. 产品命名与包装建议

候选项目名：

1. `Codex Media Canvas`  
   优点：直观，和 Codex 强绑定。  
   缺点：如果将来扩展到 Claude / Cursor / Cline，名字略窄。

2. `Agent Media Canvas`  
   优点：更泛化，适合多 agent。  
   缺点：没有 Codex 关键词带来的明确场景。

3. `Atlas Media Canvas`  
   优点：强推广 Atlas。  
   缺点：开源中立性弱，容易被理解为 Atlas 客户端。

建议：

- GitHub repo 用 `agent-media-canvas` 或 `codex-media-canvas`；
- 产品 README 中强调 Codex first；
- provider 文档中强调 Atlas best-supported；
- 不建议项目名直接叫 `Atlas Canvas`，除非目标就是做 Atlas 官方客户端。

推荐 README 首屏结构：

```text
# Agent Media Canvas

Agent-native infinite canvas for generating and revising images, video, and 3D.

Select media. Annotate changes. Let Codex generate a new version back onto the canvas.

Powered by Atlas Cloud by default. Open to custom providers.
```

## 11. 商业与传播逻辑

### 11.1 为什么这个项目适合推广 Atlas

Atlas 的核心卖点是多模型、多模态、统一 API。普通 API 文档很难让用户马上感受到价值，因为开发者要先想象应用场景。

这个项目把 Atlas 放进一个非常具体、可演示、可传播的场景里：

- 同一张产品图，用多个 image model 比较；
- 选中某一帧，用 image-to-video 生成新镜头；
- 从图片生成 3D mockup；
- 每个结果都记录 model / cost / latency；
- 用户能在画布里直观看到模型差异。

这比单纯说“Atlas 支持 300+ 模型”更有说服力。

### 11.2 传播切入

适合 X / GitHub launch 的叙事：

1. Cowart 类项目证明 Codex + canvas 很有趣；
2. AI-Canvas 开始把它做成业务制图工作台；
3. 但现有方案仍主要围绕图片；
4. 我们做了一个 agent-native media canvas；
5. 它能处理图片、视频帧和 3D；
6. Atlas Cloud 让它可以接入多模型生成；
7. 但协议开放，开发者可以接入自己的 provider。

### 11.3 示例 demo

推荐准备 4 个 demo：

1. 图片标注修图  
   产品图上圈出背景和文字，生成新版广告图。

2. 电商多图套装  
   一张产品图生成主图、卖点图、场景图、广告图。

3. 视频帧改镜头  
   暂停视频某一帧，标注“镜头更近、光线更戏剧化”，生成 revised shot。

4. 图片转 3D  
   产品图生成 3D mockup，旋转视角后标注材质修改。

## 12. 当前仓库状态与下一步建议

当前仓库已经包含：

- `docs/cowart-research.md`：Cowart 逆向与 Atlas Canvas proposal；
- `docs/ai-canvas-deployment-and-roadmap.md`：AI-Canvas 部署和作者路线调研；
- `docs/codex-media-canvas-plan.md`：初版产品/技术规划；
- `docs/codex-media-canvas-spec.md`：Claude Code 复盘后的防偏离实现规格，当前更适合作为实现约束；
- `canvas-studio/`：失败原型，只能参考少量数据层经验，不能作为 baseline；
- `ai-canvas/`：部署的 AI-Canvas 竞品/反面教材；
- `reactflow-studio/`：可能用于未来 workflow / graph view 的实验。

建议下一步优先级：

1. 停止沿着 `canvas-studio/` 当前 UI 继续堆功能；
2. 基于 `docs/codex-media-canvas-spec.md` 重建最小真画布 spike；
3. 验证 tldraw 是否能承载 media shape、原生标注、frame context、父子连线；
4. 如果 tldraw 不合适，快速评估 Konva/Fabric/Excalidraw/custom canvas 等替代；
5. 先跑通图片标注改图单一闭环；
6. 将 Product Marketing Set 等能力实现为 Codex agent skill，而不是白板按钮；
7. 再做 Atlas adapter 的真实 vertical slice；
8. 最后推进 video frame annotation → image-to-video 的差异化 demo。

## 13. 最关键的产品原则

最后把这个项目的逻辑压缩成几条原则：

1. 画布不是模型表单，画布是视觉上下文和版本空间。
2. Skill 不属于白板按钮区，Skill 应该以 Codex agent skill 的形态存在。
3. Codex 不是简单按钮回调，Codex 是理解、计划、agent skill 编排和本地执行层。
4. Provider 不是写死的 API，provider 是可替换的生成能力接口。
5. Atlas 不是广告贴片，Atlas 是最佳支持的多模态 provider。
6. 图片不是唯一资产，视频帧和 3D 视图必须从一开始进入数据模型。
7. 标注不是截图玄学，标注应该是画布原生图元，并能被 selection / frame context 精确读取。
8. Frame 是任务边界：用户可以框住本次要处理的局部素材和标注，而不是让 Codex 理解整张白板。
9. 生成结果不是一次性文件，结果是可追溯、可分支、可恢复的 media version。
10. 画布引擎必须可替换；tldraw 只是候选，不是产品逻辑本身。
11. MVP 不追求全能，而追求一个闭环打磨到顺：frame/selection、标注、生成、回板、血缘。

## 14. 参考来源

- Cowart repository: https://github.com/zhongerxin/cowart
- Cowart / Atlas proposal: [`docs/cowart-research.md`](./cowart-research.md)
- AI-Canvas repository: https://github.com/binghe1980/AI-Canvas
- AI-Canvas deployment and roadmap research: [`docs/ai-canvas-deployment-and-roadmap.md`](./ai-canvas-deployment-and-roadmap.md)
- Codex Media Canvas plan: [`docs/codex-media-canvas-plan.md`](./codex-media-canvas-plan.md)
- Failed prototype: [`../canvas-studio/README.md`](../canvas-studio/README.md)
- Implementation constraint spec: [`docs/codex-media-canvas-spec.md`](./codex-media-canvas-spec.md)
- Atlas Cloud API integration notes are reflected from the local `atlas-cloud` skill used during planning.

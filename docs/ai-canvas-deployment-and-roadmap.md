# AI-Canvas Deployment and Author Roadmap Research

调研日期：2026-06-25（Asia/Shanghai）

## 1. 部署结果

上游仓库：[binghe1980/AI-Canvas](https://github.com/binghe1980/AI-Canvas)

本地路径：

```text
/Users/qiutian/Projects/apps/coding-agent-canva/ai-canvas
```

本次部署使用的上游提交：

```text
ecc7963 Document AI Canvas skill workflows
```

已完成：

- 克隆完整仓库；
- Node.js 22.17.0 环境下安装锁定依赖；
- 构建 canvas app、MCP server 和 shared package；
- TypeScript 类型检查通过；
- MCP server 8 个测试全部通过；
- Codex plugin validation 通过；
- 本地服务启动并通过 Codex 内置浏览器验证；
- 本地 marketplace `ai-canvas` 已注册到 Codex 配置。

运行地址：

```text
http://127.0.0.1:43218/
```

本地画布数据：

```text
/Users/qiutian/Projects/apps/coding-agent-canva/.ai-canvas/
```

当前 `codex-cli 0.130.0` 有 `plugin marketplace add`，但没有仓库文档中使用的 `codex plugin add` 子命令。因此 marketplace 已注册，完整插件激活仍需要在支持插件安装的 Codex 桌面界面中完成，或等待 CLI 升级。独立画布服务不受影响。

重新启动服务：

```bash
cd /Users/qiutian/Projects/apps/coding-agent-canva/ai-canvas/ai-canvas-codex-plugin
NODE_ENV=production node packages/canvas-app/dist/server/server.js \
  --port 43218 \
  --workspace-root /Users/qiutian/Projects/apps/coding-agent-canva
```

## 2. 当前项目成熟度

截至调研时，GitHub 官方 API 返回：

- 创建时间：2026-06-20；
- 116 stars、11 forks；
- MIT license；
- 无公开 issue / PR；
- 只有 6 个主分支提交，仍属于非常早期的快速迭代项目；
- 仓库自身没有 CI 配置，但已有少量 MCP 单元测试和插件校验脚本。

项目已经明显超过 Cowart 的两个 MCP 工具模式。当前代码包含：

- 图片 holder、图片插入、版本创建、快照保存；
- 标注解析和编辑请求队列；
- Skill 请求队列、状态更新和运行记录；
- Skill 列表、推荐、运行准备和运行接口；
- Codex 长轮询监听编辑/Skill 请求；
- 6 个业务 Skill：小红书封面、YouTube 封面、电商营销组图、Logo/品牌、营销宣传册、跨平台适配。

但它仍然不是独立生成平台。`codexImage20Adapter.ts` 明确要求由 Codex 自己调用 Image 2.0，再把本地图片路径交回画布。当前仓库没有真正的外部图片 provider、Web API proxy、用户计费或独立 Agent runtime。

## 3. 作者在 X 上明确提出的迭代方向

作者主页：[冰河 @binghe](https://x.com/binghe)

### 3.1 外部生图进入画布，减少 Codex Token 消耗

作者在 [2026-06-21 的首版设想](https://x.com/binghe/status/2068588588342915090) 中明确列出：

- 使用外部生图服务生成图片；
- 将结果放入画布；
- 再通过画布完成二次编辑；
- 目标之一是减少 Codex 内置生成的 Token/成本消耗。

这条尚未在当前代码中落地。当前仍是 Codex 内置图片生成流程。

### 3.2 从单图编辑转向业务 Skill 和多图联动

同一条发布中，作者提出让画布调用 Skill，生成特定场景的完整套路和多图组合，包括：

- 封面图；
- 产品套图；
- 多平台适配图；
- 品牌图；
- 营销图；
- 生成后继续进行画布修改。

这是目前进展最快的方向。仓库已经落地 6 个 Skill、结构化表单、批量任务描述和多版本画布回填。

### 3.3 Skill + MCP + Agent

作者在 [后续路线说明](https://x.com/binghe/status/2068631244028670030) 中给出的顺序是：

1. Skill；
2. Agent；
3. 可选 Web API 代理。

作者强调画布不是截图修图工具，而要把真实业务场景放进来，成为“能赚钱的工具”。

当前 Agent 处于“Codex 驱动的 agentic workflow”阶段：Skill 会生成结构化任务，Codex 通过 MCP 长轮询接单、生成、回填。它还不是独立调度多模型、多步骤任务的后台 Agent。

### 3.4 Web API 代理与外部生成服务

作者的最终一层设想是：

```text
AI Canvas -> 自建代理服务 -> 外部生图服务
```

这既是模型/provider 解耦，也是最明确的商业化入口。代理层可以承载：

- 统一模型接口；
- API key 隔离；
- 成本、配额和计费；
- 模型路由；
- 任务队列和失败重试；
- 图片持久化。

当前仓库未实现该层。

### 3.5 继续扩充 Marketing 与商业生产 Skill

作者在 [2026-06-24 的最新进度](https://x.com/binghe/status/2069726422550372461) 中表示：

- 小红书、YouTube、电商营销组图已经完成；
- Logo 标准和网站配色等 Branding Skill 已完成；
- 下一步打磨 Marketing Skill；
- 全部 Skill 完成后更新 GitHub。

当前主分支已经包含 `marketing-brochure`，说明这轮更新随后已经部分发布。结合作者内容定位，后续大概率会继续增加可直接用于获客、销售和内容变现的 Skill，而不是优先发展通用绘图功能。

## 4. 路线状态判断

| 方向 | 作者明确提到 | 当前代码状态 | 判断 |
|---|---|---|---|
| 基础无限画布与标注改图 | 是 | 已完成 | 可用 MVP |
| 业务 Skill | 是 | 已有 6 个 | 当前主线 |
| 多图联动/套图 | 是 | 已有任务拆分和画布回填 | 部分完成 |
| Agent | 是 | 依赖 Codex + MCP 长轮询 | 半完成 |
| 外部生图 | 是 | 无真实 provider adapter | 未完成 |
| Web API 代理 | 是 | 无代理服务 | 未完成 |
| 成本/计费/账号 | 隐含于“赚钱工具” | 无 | 未完成 |
| 视频/3D | 未在本轮公开路线中提及 | 无 | 不是作者当前重点 |

## 5. 对我们方案的意义

直接复刻同样的“图片 + Skill 面板”已经不够形成差异。这个项目会继续沿着商业制图 Skill、Agent 编排、外部 API 代理走，而这些方向与 Atlas 的模型聚合能力高度重叠。

更好的切入是：

1. **不要和他比赛堆图片 Skill。** 可以兼容 Skill，但核心放在图、视频、3D 共用的媒体资产和版本血缘。
2. **先把 Atlas provider/代理层做好。** 这恰好是他公开路线里尚未落地、但 Atlas 已经具备资源优势的一层。
3. **视频帧批注和镜头重生成应成为首个明显差异点。** 作者目前没有公开提到视频或 3D。
4. **开放 provider 接口。** Atlas 默认、体验最佳，但避免把开源项目做成只能使用 Atlas 的壳。
5. **把 Agent 做成真实异步任务编排，而不是依赖 Codex 一直长轮询。** 支持暂停、恢复、成本预算、重试和输出物血缘。

一句话判断：

> AI-Canvas 正在向“Lovart 的 Codex 本地版”演进；我们的机会是更早做成“Atlas 驱动的多模态创作操作系统”，用视频、3D、模型路由和版本管理拉开距离。

## 6. 风险提醒

- 项目使用 tldraw 3.x。仓库代码采用 MIT，不代表 tldraw SDK 的生产使用自动变成 MIT；公开部署仍需单独核对 tldraw 当前许可。
- 作者迭代极快，X 上的“下一步”可能在数天内进入 GitHub，后续比较应以最新提交和发布动态为准。
- 当前测试仅覆盖少量 MCP contract 和标注解析，不能据此判断整个画布在长期运行、并发写入和损坏恢复方面已经稳定。

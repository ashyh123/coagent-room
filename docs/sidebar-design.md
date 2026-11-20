# 左侧会话导航栏（Left Session Sidebar）设计与三角色取舍

> 适用范围：v0.2.1 前端三栏工作台演进。本文档记录产品边界、三角色架构取舍、三栏布局约束与跨通道隐私路由保障；关于核心协议与私密问答零入库约束，另见 [decisions.md](decisions.md)（`D8`、`D9`、`D10`）。

## 1. 设计动机：为什么增加可折叠左侧会话栏并锚定右侧看板

借鉴 Antigravity 的左侧会话导航心智，coagent-room 在不改变「右栏 Spec/Diff 常驻锚定」前提下引入可折叠左侧会话导航栏，核心解决三个协作痛点：

1. **防止误发私密思考到公共群聊**：此前公共群聊与私密提问共用同一个中栏流与底部输入框，协作者一旦忘记切换状态，就会把试探性提问或未成熟草稿直接写入房间公共事件流。将其拆分为独立侧栏入口后，公共通道与私人通道实现物理隔离。
2. **消除上下文混流**：主群聊、锚定话题线程、只读私有参谋问答、本地 Coding Agent 执行节点各自拥有明确归属视图，切换上下文不再冲刷或污染其他会话的阅读位置。
3. **支持「右看 Diff、中栏私聊/控 Agent」的并行工作流**：在 `split` 模式下，点击左侧会话导航仅切换**中栏**内容，右侧 `BoardPane`（Spec 卡片列表、详情与产出 Diff 验收）始终保持锚定。协作者可以一边对照右侧 Diff 或卡片接口约定，一边在中栏向 `私有参谋` 核查风险，或向个人 Coding Agent 下达卡片作用域指令。
4. **释放纵向阅读空间**：将原先占用中栏顶部高度的水平 `TopicBar` 胶囊列表上收到左侧导航栏中；中栏进入具体话题时仅保留紧凑的上下文锚点条（`#topicTitle`、锚点徽标与 `返回主对话`）。

## 2. 三角色取舍分析

工作台按「谁可见、谁控制、是否进入房间事件流」明确划分三类核心交互角色：

| 角色 | 归属分组 | 真源与通信路径 | 产品定位与关键取舍 |
| --- | --- | --- | --- |
| **群聊与话题** | `房间（公共）` | 房间事件流 + SQLite + WebSocket 广播 | **必选公共主轴**。承载全员可见讨论、`@成员` 提及、锚定话题线程与卡片状态流转。横向话题胶囊迁入左侧栏，中栏专注消息与产出流。 |
| **个人 Coding Agent** | `我的（仅我可见）` | 本地 CLI（`coagent join`）+ 房间 MCP 工具 + `workSteps`/`outputs` | **核心差异化能力，但 Web UI 刻意保持最薄**。定位为「房间感知遥控器（Room-aware Remote Control）」，不与本地 IDE 或终端编辑体验竞争；仅展示状态、当前锁定卡片与 `fileGlobs`、相关步骤/产出时间线、`waiting_human` 快捷批复（`允许继续`/`拒绝`）、一键 `急停` 与卡片作用域指令框。 |
| **私有参谋 Bot** | `我的（仅我可见）` | `POST /api/private-ask`（只读 `RoomState` 快照） | **轻量只读私有参谋，绝不写库或广播**。与个人 Coding Agent 统一收口在 `我的（仅我可见）`，避免用户分别维护两套厚重 Bot 配置。若未来引入全房间共享的 `@房间Bot`（Export B），其属公共成员/协作区（`房间协作 Agent`），**不放入**个人侧栏。 |

### 关于「私有参谋 Bot」与「房间常驻 Bot」的边界

- **私有参谋 Bot（`私有参谋`）**：服务于单个协作者的私密推演与上下文归纳（支持选词引用 `quote`、当前卡片 `activeCardId` 与当前话题 `topicId` 作为只读上下文，支持 `COAGENT_LLM_BASE_URL` 或离线本地中文上下文分析）。未经过用户显式点击「发到房间里」或「转为卡片草案」，其内容**永远不会**产生房间事件、SQLite 记录或 WebSocket 帧。
- **房间常驻 Bot / 其他成员的 Agent**：响应房间内公开 `@` 提及并向公共房间提交工作步骤或产出，属于房间公共协作资产；除个人名下 Agent（`ownerId === currentMemberId` 或无 `ownerId`）外，其他成员接入的协作 Agent 在侧栏仅以紧凑的 `房间协作 Agent` 分组呈现（仅当数量 `> 0` 时显示），供随时查看进度或 `@` 协作。

## 3. 三栏可折叠布局与 Design System 规范

- **三栏布局结构**（`viewMode !== "board"` 时挂载在左、中位置，右侧固定为 `BoardPane`）：
  - **展开态（Expanded Sidebar）**：默认宽度 `228px`（`DEFAULT_SIDEBAR_WIDTH`），允许拖拽调整范围 `180px ~ 320px`（`MIN_SIDEBAR_WIDTH` ~ `MAX_SIDEBAR_WIDTH`），右侧紧邻 `.split-handle-x` 拖拽分隔条。
  - **折叠态（Icon Rail）**：收起为 `48px`（`COLLAPSED_SIDEBAR_WIDTH`）纯图标窄轨，依次提供 `#` 全部对话、话题图标、锁图标 `私有参谋`、个人 Agent 头像、`+` 接入本地 Agent 与展开按钮，全部挂载 Radix `Tooltip`。
  - **防溢出宽度约束**：中栏宽度 `effectiveChatWidth` 根据剩余可用宽度 `containerWidth - occupiedSidebarWidth` 动态钳制（保留中栏最小 `260px` 与右栏 `BoardPane` 最小 `360px`），确保三栏在任意常见桌面窗口宽度下不发生水平溢出。
  - **Topbar 联动**：顶部栏左侧品牌标识旁放置紧凑折叠开关（`aria-label="切换左侧会话栏"`）；当用户处于 `board`（仅卡片）模式点击该开关时，自动切回 `split` 分栏并打开左侧导航栏。
- **纯黑白 Design System 约束**：
  - 背景与表面严格遵循 `tokens.css` 的 Neutral/Zinc 色阶（浅色 `#fafafa`/`#ffffff`/`#f4f4f5`，深色 `#09090b`/`#141417`/`#1c1c21`），**禁止高饱和蓝/紫色**。
  - 间距遵守 `4px` 阶梯，导航项统一 `8px` 圆角；仅在 Agent 在线/执行/等待确认/急停状态处使用 `6px` 语义小圆点（语义色彩总面积 `< 3%`）。

## 4. 通道抽象、分组规则与防误发路由保障

### 4.1 通道切换矩阵（`ActiveChannel`）

| `ActiveChannel` | 侧栏归属 | 中栏渲染组件 | 右侧 `BoardPane`（`split` 模式） |
| --- | --- | --- | --- |
| `{ kind: "room" }` | `房间（公共）` → `# 全部对话` | `ChatPane`（`hideTopicPills`，无横向话题条） | 常驻锚定不变 |
| `{ kind: "topic", topicId }` | `房间（公共）` → 具体话题 | `ChatPane`（仅保留激活话题锚点条与 `返回主对话`） | 常驻锚定不变 |
| `{ kind: "private_bot" }` | `我的（仅我可见）` → `私有参谋` | `PrivateBotPane`（只读私密问答流 + 锁死私密输入） | 常驻锚定不变 |
| `{ kind: "agent", agentId }` | `我的（仅我可见）` / `房间协作 Agent` | `AgentSessionPane`（状态/锁卡/步骤与产出流/急停/定向指令） | 常驻锚定不变 |

> 降级保护：若当前选中的 `agentId` 已从成员表移除或缺失，`AgentSessionPane` 自动安全回退到 `ChatPane`。

### 4.2 Agent 归属切分（`partitionAgents`）

- **个人 Agent（`myAgents`）**：筛选 `kind === "agent"` 且 `ownerId === currentMemberId || !ownerId`，展示在 `我的（仅我可见）` 分组中，并附带 `+ 接入本地 Agent` 快捷入口。
- **协作 Agent（`otherAgents`）**：筛选其他人类协作者接入的 Agent，仅在 `otherAgents.length > 0` 时渲染 `房间协作 Agent` 分组，保持零冗余噪音。

### 4.3 隐私与防误发路由护栏

1. **私密通道输入硬锁定**：`PrivateBotPane` 内部使用 `FloatingComposer` 时开启 `lockedPrivateMode` 与 `hidePrivateToggle`，强制虚线锁边框与只读私密占位文案，提交行为严格路由到 `POST /api/private-ask`，前端与服务端均不向房间 WS 或 SQLite `events` 发送任何帧。
2. **显式晋升机制**：私密问答仅在用户主动点击 `PrivateBubble` 上的「发到房间里」或「转为卡片草案」后，才进入公共消息或卡片编辑流程。
3. **跨入口自动切轨**：
   - 选中内容浮条（`SelectionActionBar`）点击「问我的 Agent」或主聊输入框以 `@我的agent` / `@自己的agent` / `/ask` 前缀提交时，自动将中栏切换至 `{ kind: "private_bot" }` 并展示回答；
   - 点击收件箱（`InboxPopover`）条目时按目标类型精准路由：卡片待办保持左/中栏当前通道不变、仅跳转右侧看板；`agent_help` 自动切换中栏至 `{ kind: "agent", agentId }`；`topic` / `message` 自动切至对应话题或主群聊并滚动高亮目标消息；
   - 在侧栏或中栏新建话题成功后，自动将 `activeChannel` 切入新话题 `{ kind: "topic", topicId }`，防止后续回复误落回主群聊。

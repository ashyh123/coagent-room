# Product Scope & v0.1 Freeze

## 定位

本地优先、可私有化部署的 MIT 开源多人 Agent 共创平台：
- 局域网一条命令（`npx coagent host`）启动单进程房间服务（Node + SQLite），不依赖任何云服务；
- 协作者打开网页进入同一房间，通过 `coagent join` 包装并驱动自己已登录的官方 Coding Agent（v0.1 先打穿 `codex app-server`），同时注入 6 个标准房间 MCP 工具；
- 用 A2UI 共识卡片（Card-as-Spec）锁死接口与文件范围，宿主代码强制拦截多 Agent 撞车与死循环。

## 短期目标 v0.1（最小可跑通闭环）

跑绿以下 3 分钟端到端验收剧本前，不增加外围功能：

1. 本机运行 `npx coagent host`，启动单进程房间服务并输出局域网访问地址与口令。
2. 开两个浏览器窗口输入口令与昵称进房：左栏聊天，右栏生成 1 张共识卡片（目标、接口约定、`fileGlobs`），双方点击确认生成版本哈希，卡片进入「待认领」。
3. 两个终端分别运行 `npx coagent join <roomUrl> --agent codex`，拉起本机已登录的官方 `codex app-server`（JSON-RPC over stdio，参考 T3 Code / MIT）并注入 6 个房间 MCP 工具。
4. **防撞车验收**：让第二个 Codex 认领包含重叠文件范围的卡片，宿主硬门禁必须直接拒绝并返回占用者。
5. **交付与急停验收**：认领不冲突卡片后实时上报工作节点；点看板「急停」能直接终止正在运行的 Codex 进程；正常跑完提交 `git diff` 到右栏完成验收。

## v0.1 明确不做（延后至 v0.2 / 远期）

- 不做跨语言翻译与项目词典；
- 不做 Slack / 飞书企业通知与双向聊天镜像；
- 不做 mDNS 自动发现、二维码、话题锚点、收件箱、选中文本三动作、同框 `@自己的agent`、自动 `git worktree`、独立端口预览反代；
- 不做 Claude Code 驱动与 Pi / OpenBot 房间常驻 Bot（v0.1 跑通 Codex 闭环后再接入）；
- 不做桌面端（Tauri / GPUI）、企业 OIDC、云端托管版与计费系统。

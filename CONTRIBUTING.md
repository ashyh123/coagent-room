# Contributing to coagent-room

欢迎贡献！所有人类协作者与 Coding Agent 请先阅读 [AGENTS.md](AGENTS.md) 和 [docs/product.md](docs/product.md)。

## 工作流

1. 从最新 `main` 切出功能分支（如 `feat/server-room-core`、`fix/lock-glob-overlap`）。
2. 若改动涉及协议或新架构决策，先更新 `packages/protocol` 与 [docs/decisions.md](docs/decisions.md)。
3. 提交前在本地运行：
   ```bash
   pnpm verify
   ```
4. 按 PR 模板填写改动、实际验证命令及用例数，严禁提交密钥或未验证的声明。

# AGENTS.md

人和 Coding Agent 在本仓库开发共用同一套约定、验证和护栏。核心原则：**能用代码拦住的规则就写成检查（`pnpm ci:hygiene`），不只写成文字；验证结果以实际跑过的命令输出为准。**

## 1. 开工前

1. 读 [docs/product.md](docs/product.md)：明确当前 v0.1 冻结范围、验收剧本和**明确不做什么**。
2. 读 [docs/README.md](docs/README.md)，按修改模块查阅对应设计文档与 [docs/decisions.md](docs/decisions.md)。
3. 确认工作区干净并记录当前 `git rev-parse --short HEAD` 基线。

## 2. 模块边界（由 `pnpm ci:hygiene` 强制检查）

- `packages/protocol/src/**`：**全栈纯 TypeScript 唯一真源**，严禁 import `node:*` 模块（保证在局域网非 HTTPS 浏览器中也能同步运行），严禁依赖 `apps/*`。
- `apps/server/src/**` 与 `apps/cli/src/**`：严禁 import `apps/web`。
- `apps/web/src/**`：严禁 import `apps/server` 或 `apps/cli`。
- 协议变更必须先改 `packages/protocol` 并补单元测试，再改消费端。

## 3. 开发与测试纪律

- **一个任务一个分支 / worktree**，分支命名：`feat/<slug>`、`fix/<slug>`、`refactor/<slug>`、`chore/<slug>`、`docs/<slug>`。
- **缺陷先写离线失败单测复现，再修复**；单元测试只用合成/Mock 数据，不连外网、不消耗真实模型额度。
- **驱动层契约测试**：`apps/cli/src/drivers/*` 保持最薄，每个驱动必须有离线契约测试覆盖（启动、派活、收进度、急停、交产出）。
- **设计决策入库**：新增或改变的架构决定写进 [docs/decisions.md](docs/decisions.md)（含日期、决定、理由、放弃的方案、重评条件）；新增 `docs/*.md` 必须在 [docs/README.md](docs/README.md) 登记。
- **脱敏**：严禁提交个人路径、密钥（`sk-` / `gho_` / `ghp_`）、私密房间口令或真实内网地址。

## 4. 提交与 PR 前本地验证

每次提交或开 PR 前必须实际运行并贴出真实结果（不要笼统写“全绿”）：

```bash
pnpm verify   # 等价于 pnpm ci:hygiene && pnpm typecheck && pnpm test
```

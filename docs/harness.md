# Repo Harness 说明

Repo Harness 是开发 `coagent-room` 的人类与 Coding Agent 共用的自动护栏，与产品自身的运行期宿主门禁区分开。

## 自动检查项（`pnpm ci:hygiene`）

由 [scripts/ci/check-hygiene.mjs](../scripts/ci/check-hygiene.mjs) 执行，并在 GitHub Actions（`.github/workflows/ci.yml`）中作为必过门禁：

1. **无非法控制字符**：扫描所有 Git 跟踪文本文件，拦截意外混入的 ASCII 控制字符。
2. **模块边界守卫**：
   - `packages/protocol/src/**` 禁止 import `node:*` 或 `apps/*`；
   - `apps/server/src/**`、`apps/cli/src/**` 禁止 import `apps/web`；
   - `apps/web/src/**` 禁止 import `apps/server` 或 `apps/cli`。
3. **文档索引一致性**：`docs/*.md` 全部必须列在 `docs/README.md` 中，且 `docs/README.md` 内不能有断链。
4. **无孤儿测试**：任意子包存在 `*.test.ts` 时，其 `package.json` 必须定义可执行的 `test` 脚本。
5. **基础防泄密检查**：拦截明显密钥前缀（如 `sk-proj-`、`ghp_`、`gho_`）误入版本库。

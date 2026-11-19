# coagent-room

Local-first, self-hostable, MIT open-source multiplayer workspace where humans and their own coding agents collaborate in the same room.

## Quick Start (v0.1)

Requires **Node.js >= 22** (uses built-in `node:sqlite`, zero native compilation) and **pnpm**.

```bash
pnpm install
pnpm build

# 1. Start a single-process room host (serves Web UI + SQLite + WebSocket + MCP gateway)
node apps/cli/dist/index.js host --port 3000 --name "My Room"

# 2. Open http://127.0.0.1:3000 (or the printed LAN URL) in two browser windows,
#    join with the printed passcode, create & confirm a Card-as-Spec card,
#    then click "+ 接入我的 Agent" to get a one-time invite command:
node apps/cli/dist/index.js join http://127.0.0.1:3000 --token <inviteToken> --agent codex
```

To verify all repo guardrails, builds, types, and unit/integration/contract tests:

```bash
pnpm verify
```

## Architecture

```text
coagent-room/
├── packages/
│   └── protocol/    # Shared Zod schemas, pure-JS SHA-256 card hash, file-scope locks, event reducer, 6 MCP tool contracts
└── apps/
    ├── server/      # Single-process Node + node:sqlite event log, WS cursor sync, host guardrails, static Web hosting
    ├── web/         # Dual-pane React workspace (left chat + ref strips, right Card-as-Spec board + diff review, IndexedDB cache)
    └── cli/         # `coagent host` / `coagent join` / `coagent mcp` + Codex `app-server` JSON-RPC stdio driver (MIT, inspired by T3 Code)
```

## Milestone v0.1 (Completed)

- [x] `packages/protocol`: event schemas, 5-state card lifecycle, deterministic pure-JS SHA-256 version hash, file-lock conflict detection, shared event reducer
- [x] `apps/server`: single-process SQLite room + WebSocket cursor sync + host file-lock & emergency-stop guardrails + static Web hosting
- [x] `apps/web`: dual-pane chat & Card-as-Spec board + IndexedDB cursor cache + diff highlight review + emergency stop button
- [x] `apps/cli`: `coagent host` / `coagent join --agent codex` driving `codex app-server` (JSON-RPC over stdio) + 6 room MCP tools + real process-level emergency stop
- [x] Repo harness: `AGENTS.md`, `docs/` index, `pnpm ci:hygiene`, GitHub Actions CI

## License

[MIT](./LICENSE)

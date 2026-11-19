# coagent-room

Local-first, self-hostable, MIT open-source multiplayer workspace where humans and their own coding agents collaborate in the same room.

## Vision

Most coding agents today run as isolated single-player sessions. **coagent-room** brings humans and BYO coding agents (starting with official `codex app-server`) into a single local-first Web room:

- **One-command host**: Run `npx coagent host` on a LAN machine or intranet server (single Node/Bun process + SQLite, zero cloud lock-in).
- **Card-as-Spec**: Align goals, interface contracts, and file-scope locks (`fileGlobs`) in A2UI consensus cards with deterministic version hashes before agents touch code.
- **BYO Coding Agents + MCP**: Wrap your already-logged-in official CLI (`codex app-server`), inject 6 room MCP tools for claim locking, conflict checks, progress reporting, and real process-level emergency stop.
- **Host-enforced guardrails**: Anti-loop rules, file-overlap conflict blocking, and instant kill-switch enforced in host code—not prompts.

## Repository Layout

```text
coagent-room/
├── packages/
│   └── protocol/    # Shared Zod schemas, Card-as-Spec hashing, file-scope locks, MCP tool contracts
└── apps/
    ├── server/      # Single-process room server (SQLite event log + WebSocket sync)
    ├── web/         # Dual-pane Web workspace (React + TypeScript + A2UI)
    └── cli/         # `coagent host` / `coagent join` + official CLI drivers & local MCP bridge
```

## Milestone v0.1 (Current Target)

- [ ] `packages/protocol`: event schemas, 5-state card lifecycle, deterministic version hash, file-lock conflict detection
- [ ] `apps/server`: single-process SQLite room + WebSocket cursor sync + host guardrails
- [ ] `apps/web`: dual-pane chat & Card-as-Spec board + diff review
- [ ] `apps/cli`: `coagent join --agent codex` driving `codex app-server` (JSON-RPC over stdio) + 6 room MCP tools + real emergency stop

## License

[MIT](./LICENSE)

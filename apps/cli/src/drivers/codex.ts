import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { MCP_TOOL_NAMES } from "@coagent/protocol";
import {
  AgentDriver,
  ApprovalPolicy,
  DirectiveOptions,
  DriverApprovalRequest,
  DriverStepEvent,
  DriverTurnCompletedEvent,
  TaskBrief,
} from "./types.js";

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexDriverOptions {
  cwd: string;
  /** Command to spawn (defaults to resolved "codex"). Overridable for offline contract tests. */
  command?: string;
  /** Arguments (defaults to ["app-server"]). */
  args?: string[];
  /** Extra environment variables passed to the spawned process. */
  env?: Record<string, string>;
  /** Approval policy passed to thread/start and turn/start. */
  approvalPolicy?: ApprovalPolicy;
  /** Sandbox mode passed to thread/start. */
  sandbox?: CodexSandboxMode;
}

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Builds `codex app-server` `-c` arguments using dotted TOML overrides,
 * because codex-cli >= 0.171 parses `-c` values as TOML rather than raw JSON objects.
 */
export function buildCodexMcpArgs(options: { command: string; args: string[] }): string[] {
  const args = [
    "app-server",
    "-c",
    `mcp_servers.coagent.command=${JSON.stringify(options.command)}`,
    "-c",
    `mcp_servers.coagent.args=${JSON.stringify(options.args)}`,
  ];
  for (const toolName of MCP_TOOL_NAMES) {
    args.push("-c", `mcp_servers.coagent.tools.${toolName}.approval_mode="approve"`);
  }
  return args;
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves the `codex` CLI binary path across explicit overrides, env vars, PATH,
 * and common user-local installation directories.
 */
export function resolveCodexCommand(explicit?: string): string {
  if (explicit && explicit !== "codex") {
    return explicit;
  }

  const envBin = process.env.COAGENT_CODEX_BIN?.trim();
  if (envBin && isExistingFile(envBin)) {
    return envBin;
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = path.join(dir, "codex");
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }

  const home = os.homedir();
  const fallbackCandidates = [
    path.join(home, ".local", "bin", "codex"),
    path.join(home, ".npm-global", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  for (const candidate of fallbackCandidates) {
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }

  return explicit ?? "codex";
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function formatCommandValue(command: unknown): string {
  if (typeof command === "string") return command.trim();
  if (Array.isArray(command)) {
    return command.map((part) => String(part)).join(" ").trim();
  }
  return "command";
}

function formatApprovalSummary(method: string, params: Record<string, unknown>): {
  summary: string;
  detail?: string;
} {
  if (method === "mcpServer/elicitation/request") {
    const serverName = typeof params.serverName === "string" ? params.serverName : "mcp";
    const meta =
      params._meta && typeof params._meta === "object"
        ? (params._meta as Record<string, unknown>)
        : undefined;
    const toolName = meta && typeof meta.tool_name === "string" ? meta.tool_name : "tool";
    const rawMessage = typeof params.message === "string" ? params.message.trim() : "";
    const summary = (rawMessage || `Allow MCP ${serverName}.${toolName}`).slice(0, 120);
    const detail =
      meta && typeof meta.tool_description === "string"
        ? meta.tool_description.slice(0, 4000)
        : undefined;
    return { summary, detail };
  }

  const reason = typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : undefined;
  if (method === "item/commandExecution/requestApproval") {
    const cmd = formatCommandValue(params.command);
    const summary = `Run command: ${cmd}`.slice(0, 120);
    const detail = [cmd ? `Command: ${cmd}` : "", reason ? `Reason: ${reason}` : ""]
      .filter(Boolean)
      .join("\n");
    return { summary, detail: detail || undefined };
  }

  const grantRoot =
    typeof params.grantRoot === "string" && params.grantRoot.trim()
      ? params.grantRoot.trim()
      : undefined;
  const target = grantRoot ?? (typeof params.itemId === "string" ? params.itemId : "workspace files");
  const summary = `Approve file changes (${target})`.slice(0, 120);
  const detail = [grantRoot ? `Root: ${grantRoot}` : "", reason ? `Reason: ${reason}` : ""]
    .filter(Boolean)
    .join("\n");
  return { summary, detail: detail || undefined };
}

function formatTaskBriefPrompt(brief: TaskBrief): string {
  return [
    `You are collaborating in a coagent-room workspace on Card ${brief.cardId} (${brief.versionHash}).`,
    `Title: ${brief.title}`,
    `Goal: ${brief.goal}`,
    brief.interfaceContract ? `Interface contract: ${brief.interfaceContract}` : "",
    `Allowed fileGlobs: ${brief.fileGlobs.join(", ")}`,
    brief.acceptanceCriteria.length > 0
      ? `Acceptance criteria:\n- ${brief.acceptanceCriteria.join("\n- ")}`
      : "",
    `Use the injected coagent room MCP tools: claim the card first with room_claim_card, check files with room_check_files, report concise progress with room_report_step, and submit your diff with room_submit_output.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Official Codex CLI driver (`codex app-server`, JSON-RPC 2.0 over stdio).
 * Inspired by T3 Code (MIT, pingdotgg/t3code): spawns the user's already-logged-in
 * official CLI as a child process so subscriptions stay local and emergency stop
 * can cleanly terminate the running process.
 */
export class CodexDriver implements AgentDriver {
  readonly name = "codex";
  private readonly cwd: string;
  private readonly explicitCommand?: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly approvalPolicy?: ApprovalPolicy;
  private readonly sandbox?: CodexSandboxMode;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly stepListeners = new Set<(step: DriverStepEvent) => void>();
  private readonly turnCompletedListeners = new Set<(event: DriverTurnCompletedEvent) => void>();
  private readonly approvalListeners = new Set<(req: DriverApprovalRequest) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private readonly pendingApprovals = new Set<() => void>();

  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private lastAssistantText = "";
  private hasFinalAnswer = false;

  constructor(options: CodexDriverOptions) {
    this.cwd = options.cwd;
    this.explicitCommand = options.command;
    this.args = options.args ?? ["app-server"];
    this.env = options.env;
    this.approvalPolicy = options.approvalPolicy;
    this.sandbox = options.sandbox;
  }

  onStep(fn: (step: DriverStepEvent) => void): () => void {
    this.stepListeners.add(fn);
    return () => this.stepListeners.delete(fn);
  }

  onTurnCompleted(fn: (event: DriverTurnCompletedEvent) => void): () => void {
    this.turnCompletedListeners.add(fn);
    return () => this.turnCompletedListeners.delete(fn);
  }

  onApprovalRequest(fn: (req: DriverApprovalRequest) => void): () => void {
    this.approvalListeners.add(fn);
    return () => this.approvalListeners.delete(fn);
  }

  onExit(fn: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.exitListeners.add(fn);
    return () => this.exitListeners.delete(fn);
  }

  isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;

    const resolvedCommand = resolveCodexCommand(this.explicitCommand);
    const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...this.env };
    if (path.isAbsolute(resolvedCommand)) {
      const binDir = path.dirname(resolvedCommand);
      const currentPath = mergedEnv.PATH ?? "";
      const pathParts = currentPath.split(path.delimiter).filter(Boolean);
      if (!pathParts.includes(binDir)) {
        mergedEnv.PATH = currentPath ? `${binDir}${path.delimiter}${currentPath}` : binDir;
      }
    }

    const child = spawn(resolvedCommand, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: mergedEnv,
    });
    this.proc = child;
    this.threadId = null;
    this.activeTurnId = null;
    this.lastAssistantText = "";
    this.hasFinalAnswer = false;

    // Ignore broken pipe writes if the child closes stdin while stopping
    child.stdin.on("error", () => {});

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.handleStdoutLine(trimmed);
    });

    child.on("error", (err) => {
      this.rejectAllPending(new Error(`Failed to spawn codex app-server (${resolvedCommand}): ${err.message}`));
      if (this.proc === child) {
        this.proc = null;
      }
    });

    child.on("exit", (code, signal) => {
      this.cancelAllApprovals();
      this.rejectAllPending(new Error(`codex app-server exited (code=${code}, signal=${signal})`));
      if (this.proc === child) {
        this.proc = null;
      }
      this.activeTurnId = null;
      this.threadId = null;
      for (const fn of this.exitListeners) {
        fn(code, signal);
      }
    });

    // Perform JSON-RPC initialize handshake with codex app-server
    await this.request("initialize", {
      clientInfo: { name: "coagent-room", version: "0.1.0" },
    });
    this.notify("initialized", {});
  }

  private async ensureThread(): Promise<string> {
    if (this.threadId) {
      return this.threadId;
    }
    const res = (await this.request("thread/start", {
      cwd: this.cwd,
      ...(this.approvalPolicy ? { approvalPolicy: this.approvalPolicy } : {}),
      ...(this.sandbox ? { sandbox: this.sandbox } : {}),
    })) as {
      thread?: { id?: string };
      threadId?: string;
    };
    this.threadId = res?.thread?.id ?? res?.threadId ?? "default";
    return this.threadId;
  }

  async dispatchDirective(prompt: string, options?: DirectiveOptions): Promise<void> {
    if (!this.isRunning()) {
      await this.start();
    }

    const threadId = await this.ensureThread();
    this.lastAssistantText = "";
    this.hasFinalAnswer = false;

    const res = (await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      ...(options?.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
    })) as {
      turn?: { id?: string };
      turnId?: string;
    };

    this.activeTurnId = res?.turn?.id ?? res?.turnId ?? null;
  }

  async dispatchTask(brief: TaskBrief): Promise<void> {
    await this.dispatchDirective(formatTaskBriefPrompt(brief));
  }

  async kill(_reason?: string): Promise<void> {
    const child = this.proc;
    this.cancelAllApprovals();

    if (!child) return;

    if (this.threadId && this.activeTurnId && this.isRunning()) {
      try {
        const interruptId = this.nextId++;
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: interruptId,
            method: "turn/interrupt",
            params: { threadId: this.threadId, turnId: this.activeTurnId },
          })}\n`,
        );
      } catch {
        // Best-effort interrupt before signal termination
      }
    }
    this.activeTurnId = null;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      if (child.exitCode !== null) {
        done();
        return;
      }

      child.once("exit", done);
      try {
        child.kill("SIGTERM");
      } catch {
        done();
        return;
      }

      const forceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        done();
      }, 2000);
      forceTimer.unref();
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  private cancelAllApprovals(): void {
    const cancels = Array.from(this.pendingApprovals);
    this.pendingApprovals.clear();
    for (const cancel of cancels) {
      try {
        cancel();
      } catch {
        // ignore
      }
    }
  }

  private writeJson(payload: Record<string, unknown>): void {
    if (!this.proc || !this.proc.stdin.writable) return;
    try {
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      // ignore closed pipe
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.proc) {
      return Promise.reject(new Error("codex app-server process is not running"));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(`${payload}\n`);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.writeJson({ jsonrpc: "2.0", method, params });
  }

  private handleStdoutLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    // 1. Server-initiated JSON-RPC requests MUST be checked before pending client IDs
    // because server request IDs can numerically collide with client request IDs.
    if (msg.id !== undefined && typeof msg.method === "string") {
      this.handleServerRequest(msg.id, msg.method, (msg.params ?? {}) as Record<string, unknown>);
      return;
    }

    // 2. Client RPC responses
    if (
      (typeof msg.id === "number" || typeof msg.id === "string") &&
      msg.method === undefined &&
      this.pending.has(Number(msg.id))
    ) {
      const numericId = Number(msg.id);
      const pending = this.pending.get(numericId)!;
      this.pending.delete(numericId);
      if (msg.error) {
        const errObj = msg.error as { message?: string };
        pending.reject(new Error(errObj.message ?? "JSON-RPC error from codex app-server"));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // 3. Server notifications -> translate to concise room work steps & turn completions
    if (msg.id === undefined && typeof msg.method === "string") {
      this.handleServerNotification(msg.method, (msg.params ?? {}) as Record<string, unknown>);
    }
  }

  private handleServerRequest(
    requestId: unknown,
    method: string,
    params: Record<string, unknown>,
  ): void {
    const isApprovalMethod =
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval" ||
      method === "mcpServer/elicitation/request";

    if (isApprovalMethod) {
      const { summary, detail } = formatApprovalSummary(method, params);
      let settled = false;
      const resolve = (decision: "accept" | "decline" | "cancel") => {
        if (settled) return;
        settled = true;
        this.pendingApprovals.delete(cancelHook);
        const result =
          method === "mcpServer/elicitation/request"
            ? { action: decision, content: null }
            : { decision };
        this.writeJson({
          jsonrpc: "2.0",
          id: requestId,
          result,
        });
      };
      const cancelHook = () => resolve("cancel");
      this.pendingApprovals.add(cancelHook);

      if (this.approvalListeners.size > 0) {
        for (const fn of this.approvalListeners) {
          fn({ method, summary, detail, resolve });
        }
      } else {
        resolve("decline");
      }
      return;
    }

    this.writeJson({
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: -32601,
        message: `Unsupported server request: ${method}`,
      },
    });
  }

  private handleServerNotification(method: string, params: Record<string, unknown>): void {
    if (method === "item/completed") {
      const item = params.item as Record<string, unknown> | undefined;
      if (item && typeof item === "object") {
        this.handleCompletedItem(item);
        return;
      }
      // Backward compatibility for simple mock notifications (`{ summary, detail }`)
      if (typeof params.summary === "string") {
        this.emitStep({
          summary: params.summary.slice(0, 120),
          detail: typeof params.detail === "string" ? params.detail.slice(0, 4000) : undefined,
        });
      }
      return;
    }

    if (method === "turn/completed") {
      this.activeTurnId = null;
      const turn = (params.turn ?? {}) as Record<string, unknown>;
      const rawStatus = typeof turn.status === "string" ? turn.status : "completed";
      const status: DriverTurnCompletedEvent["status"] =
        rawStatus === "completed" || rawStatus === "failed" || rawStatus === "interrupted"
          ? rawStatus
          : "unknown";
      const errObj = turn.error as Record<string, unknown> | null | undefined;
      const errorMessage =
        errObj && typeof errObj === "object" && typeof errObj.message === "string"
          ? errObj.message
          : undefined;

      if (!this.lastAssistantText && Array.isArray(turn.items)) {
        for (const rawItem of turn.items) {
          if (
            rawItem &&
            typeof rawItem === "object" &&
            (rawItem as Record<string, unknown>).type === "agentMessage" &&
            typeof (rawItem as Record<string, unknown>).text === "string"
          ) {
            this.lastAssistantText = String((rawItem as Record<string, unknown>).text).trim();
          }
        }
      }

      const completionEvent: DriverTurnCompletedEvent = {
        turnId: typeof turn.id === "string" ? turn.id : undefined,
        status,
        assistantText: this.lastAssistantText || undefined,
        errorMessage,
      };
      for (const fn of this.turnCompletedListeners) {
        fn(completionEvent);
      }

      this.emitStep({
        summary: (errorMessage ? `Codex turn failed: ${errorMessage}` : "Codex finished current turn").slice(
          0,
          120,
        ),
        source: "turn",
      });
      return;
    }

    if (method === "error") {
      const errObj = params.error as Record<string, unknown> | undefined;
      const errMsg =
        (errObj && typeof errObj.message === "string" ? errObj.message : undefined) ??
        (typeof params.message === "string" ? params.message : "Unknown error");
      this.emitStep({
        summary: `Codex error: ${errMsg}`.slice(0, 120),
        source: "error",
      });
    }
  }

  private handleCompletedItem(item: Record<string, unknown>): void {
    const itemType = typeof item.type === "string" ? item.type : "";
    switch (itemType) {
      case "agentMessage": {
        const text = typeof item.text === "string" ? item.text.trim() : "";
        if (!text) return;
        if (item.phase === "final_answer") {
          this.lastAssistantText = text;
          this.hasFinalAnswer = true;
        } else if (!this.hasFinalAnswer) {
          this.lastAssistantText = text;
        }
        const summary = (firstNonEmptyLine(text) || "Codex response").slice(0, 120);
        this.emitStep({
          summary,
          detail: text.slice(0, 4000),
          source: "agentMessage",
        });
        return;
      }

      case "mcpToolCall": {
        const server = typeof item.server === "string" ? item.server : "mcp";
        const tool = typeof item.tool === "string" ? item.tool : "tool";
        const status = typeof item.status === "string" ? item.status : "completed";
        this.emitStep({
          summary: `MCP ${server}.${tool} (${status})`.slice(0, 120),
          source: "mcpToolCall",
          mcpServer: server,
          mcpTool: tool,
        });
        return;
      }

      case "commandExecution": {
        const cmd = formatCommandValue(item.command);
        const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
        const suffix = exitCode !== undefined && exitCode !== 0 ? ` [exit ${exitCode}]` : "";
        const aggregated =
          typeof item.aggregatedOutput === "string" && item.aggregatedOutput.trim()
            ? item.aggregatedOutput.trim().slice(0, 4000)
            : undefined;
        this.emitStep({
          summary: `Ran: ${cmd}${suffix}`.slice(0, 120),
          detail: aggregated,
          source: "commandExecution",
        });
        return;
      }

      case "fileChange": {
        const changes = Array.isArray(item.changes) ? item.changes : [];
        const paths = changes
          .map((c) => {
            if (!c || typeof c !== "object") return "";
            const rec = c as Record<string, unknown>;
            return typeof rec.path === "string"
              ? rec.path
              : typeof rec.file === "string"
                ? rec.file
                : "";
          })
          .filter(Boolean);
        const summary =
          paths.length > 0
            ? `Edited ${paths.length} file(s): ${paths.slice(0, 3).join(", ")}`
            : `Updated ${changes.length || 1} file(s)`;
        this.emitStep({
          summary: summary.slice(0, 120),
          detail: paths.length > 0 ? paths.join("\n").slice(0, 4000) : undefined,
          source: "fileChange",
        });
        return;
      }

      case "userMessage":
      case "reasoning":
      case "hookPrompt":
      default:
        return;
    }
  }

  private emitStep(step: DriverStepEvent): void {
    for (const fn of this.stepListeners) {
      fn(step);
    }
  }
}

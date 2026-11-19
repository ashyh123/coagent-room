import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import readline from "node:readline";
import { AgentDriver, DriverStepEvent, TaskBrief } from "./types.js";

export interface CodexDriverOptions {
  cwd: string;
  /** Command to spawn (defaults to "codex"). Overridable for offline contract tests. */
  command?: string;
  /** Arguments (defaults to ["app-server"]). */
  args?: string[];
  /** Extra environment variables passed to the spawned process. */
  env?: Record<string, string>;
}

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
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
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly stepListeners = new Set<(step: DriverStepEvent) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private threadId: string | null = null;

  constructor(options: CodexDriverOptions) {
    this.cwd = options.cwd;
    this.command = options.command ?? "codex";
    this.args = options.args ?? ["app-server"];
    this.env = options.env;
  }

  onStep(fn: (step: DriverStepEvent) => void): () => void {
    this.stepListeners.add(fn);
    return () => this.stepListeners.delete(fn);
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

    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
    });

    const rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.handleStdoutLine(trimmed);
    });

    this.proc.on("exit", (code, signal) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`codex app-server exited (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      this.proc = null;
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

  async dispatchTask(brief: TaskBrief): Promise<void> {
    if (!this.isRunning()) {
      await this.start();
    }

    if (!this.threadId) {
      const res = (await this.request("thread/start", { cwd: this.cwd })) as {
        thread?: { id?: string };
        threadId?: string;
      };
      this.threadId = res?.thread?.id ?? res?.threadId ?? "default";
    }

    const prompt = [
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

    await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
    });
  }

  async kill(_reason?: string): Promise<void> {
    const child = this.proc;
    if (!child) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

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
    if (!this.proc) return;
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleStdoutLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        const errObj = msg.error as { message?: string };
        pending.reject(new Error(errObj.message ?? "JSON-RPC error from codex app-server"));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Handle server notifications -> translate to concise room work steps
    if (typeof msg.method === "string") {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      if (msg.method === "turn/completed") {
        this.emitStep({ summary: "Codex finished current turn" });
      } else if (msg.method === "item/completed") {
        const summary = typeof params.summary === "string" ? params.summary : "Completed step";
        this.emitStep({
          summary: summary.slice(0, 120),
          detail: typeof params.detail === "string" ? params.detail : undefined,
        });
      }
    }
  }

  private emitStep(step: DriverStepEvent): void {
    for (const fn of this.stepListeners) {
      fn(step);
    }
  }
}

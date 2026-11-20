import readline from "node:readline";
import { Readable, Writable } from "node:stream";
import { McpToolName } from "@coagent/protocol";
import { captureLocalGitDiff, RoomHttpClient } from "./room-client.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOL_DEFINITIONS = [
  {
    name: "room_get_context",
    description:
      "Read confirmed consensus cards, active file-scope locks, and room metadata before claiming or editing files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        includeDrafts: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "room_claim_card",
    description:
      "Claim a confirmed consensus card and lock its fileGlobs. Host rejects overlapping locks held by other agents.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      required: ["cardId", "versionHash", "fileGlobs"],
      properties: {
        cardId: { type: "string" },
        versionHash: { type: "string" },
        fileGlobs: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "room_check_files",
    description:
      "Check whether target file paths are within your claimed scope or locked by another collaborator's agent.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      required: ["paths"],
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "room_report_step",
    description: "Report a concise milestone step (<= 120 chars) to the room board.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      required: ["cardId", "summary"],
      properties: {
        cardId: { type: "string" },
        summary: { type: "string", maxLength: 120 },
        detail: { type: "string" },
      },
    },
  },
  {
    name: "room_ask_human",
    description: "Ask human collaborators one focused clarification question when blocked.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      required: ["cardId", "question"],
      properties: {
        cardId: { type: "string" },
        question: { type: "string", maxLength: 500 },
      },
    },
  },
  {
    name: "room_submit_output",
    description:
      "Submit your completed git diff or artifact bound to the card versionHash for human review. If diff is omitted, captures local `git diff HEAD` automatically.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      required: ["cardId", "cardVersionHash", "summary"],
      properties: {
        cardId: { type: "string" },
        cardVersionHash: { type: "string" },
        kind: { type: "string", enum: ["git_diff", "preview_url", "markdown"], default: "git_diff" },
        summary: { type: "string" },
        diff: { type: "string" },
        previewUrl: { type: "string" },
        branch: { type: "string" },
      },
    },
  },
];

export interface LocalMcpServerOptions {
  client: RoomHttpClient;
  cwd: string;
  input?: Readable;
  output?: Writable;
}

export class LocalMcpServer {
  private readonly client: RoomHttpClient;
  private readonly cwd: string;
  private readonly input: Readable;
  private readonly output: Writable;
  private rl?: readline.Interface;

  constructor(options: LocalMcpServerOptions) {
    this.client = options.client;
    this.cwd = options.cwd;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  start(): void {
    this.rl = readline.createInterface({ input: this.input, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      void this.handleLine(trimmed);
    });
  }

  stop(): void {
    this.rl?.close();
  }

  private write(payload: Record<string, unknown>): void {
    this.output.write(`${JSON.stringify(payload)}\n`);
  }

  private async handleLine(line: string): Promise<void> {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      this.write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    // Notifications (no id) require no response
    if (req.id === undefined) return;

    try {
      switch (req.method) {
        case "initialize": {
          this.write({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "coagent-room-mcp", version: "0.1.0" },
            },
          });
          return;
        }
        case "tools/list": {
          this.write({
            jsonrpc: "2.0",
            id: req.id,
            result: { tools: TOOL_DEFINITIONS },
          });
          return;
        }
        case "tools/call": {
          const name = String(req.params?.name ?? "") as McpToolName;
          const args = ((req.params?.arguments ?? {}) as Record<string, unknown>);
          const payload = { ...args };

          if (name === "room_submit_output" && !payload.diff && (payload.kind ?? "git_diff") === "git_diff") {
            const captured = captureLocalGitDiff(this.cwd);
            if (captured.diff) payload.diff = captured.diff;
            if (!payload.branch && captured.branch) payload.branch = captured.branch;
          }

          const toolResult = await this.client.callMcpTool(name, payload);
          this.write({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }],
              structuredContent: toolResult,
            },
          });
          return;
        }
        default: {
          this.write({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          });
        }
      }
    } catch (err) {
      this.write({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : "Internal MCP bridge error",
        },
      });
    }
  }
}

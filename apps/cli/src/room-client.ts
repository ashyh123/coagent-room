import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { McpToolName, WsServerMessage, WsServerMessageSchema } from "@coagent/protocol";

export interface RegisteredAgent {
  agentId: string;
  agentSessionToken: string;
  ownerId: string;
  roomId: string;
  roomName: string;
}

export class RoomHttpClient {
  readonly baseUrl: string;
  private agentToken?: string;

  constructor(baseUrl: string, agentToken?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.agentToken = agentToken;
  }

  setAgentToken(token: string): void {
    this.agentToken = token;
  }

  async registerAgent(
    inviteToken: string,
    agentName: string,
    driver: "codex" | "claude-code" | "pi" | "mcp-only",
  ): Promise<RegisteredAgent> {
    const res = await fetch(`${this.baseUrl}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteToken, agentName, driver }),
    });
    const data = (await res.json()) as RegisteredAgent & { message?: string };
    if (!res.ok) {
      throw new Error(data.message ?? `Failed to register agent (${res.status})`);
    }
    this.agentToken = data.agentSessionToken;
    return data;
  }

  async callMcpTool(toolName: McpToolName, args: Record<string, unknown>): Promise<unknown> {
    if (!this.agentToken) {
      throw new Error("Agent session token not set");
    }
    const res = await fetch(`${this.baseUrl}/api/mcp/${toolName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.agentToken}`,
      },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof data === "object" && data && "message" in data
          ? String((data as { message: unknown }).message)
          : `MCP call ${toolName} failed (${res.status})`,
      );
    }
    return data;
  }

  connectWs(handlers: {
    onMessage?: (msg: WsServerMessage) => void;
    onKill?: (signal: { agentId: string; stoppedBy: string; reason?: string }) => void;
    onClose?: () => void;
  }): WebSocket {
    if (!this.agentToken) {
      throw new Error("Agent session token not set");
    }
    const wsUrl = `${this.baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(this.agentToken)}`;
    const ws = new WebSocket(wsUrl);

    ws.on("message", (raw) => {
      try {
        const parsed = WsServerMessageSchema.parse(JSON.parse(raw.toString("utf8")));
        handlers.onMessage?.(parsed);
        if (parsed.type === "agent_kill") {
          handlers.onKill?.({
            agentId: parsed.agentId,
            stoppedBy: parsed.stoppedBy,
            reason: parsed.reason,
          });
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on("close", () => handlers.onClose?.());
    return ws;
  }
}

export function captureLocalGitDiff(cwd: string): { diff: string; branch?: string } {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const diff = execFileSync("git", ["diff", "HEAD"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { diff, branch };
  } catch {
    return { diff: "" };
  }
}

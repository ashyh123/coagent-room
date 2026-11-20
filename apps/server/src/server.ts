import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  AvatarSchema,
  RoomAskHumanInputSchema,
  RoomCheckFilesInputSchema,
  RoomClaimCardInputSchema,
  RoomGetContextInputSchema,
  RoomReportStepInputSchema,
  RoomSubmitOutputInputSchema,
  WsClientMessageSchema,
  WsServerMessage,
} from "@coagent/protocol";
import { RoomError, RoomService } from "./room.js";

export interface RoomServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  roomName?: string;
  passcode?: string;
  minConfirmations?: number;
  webDistDir?: string;
}

interface AuthedSocket {
  ws: WebSocket;
  memberId: string;
  kind: "human" | "agent";
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 5 * 1024 * 1024) {
      throw new RoomError("PAYLOAD_TOO_LARGE", "Request body exceeds 5MB limit", 413);
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new RoomError("INVALID_JSON", "Malformed JSON body", 400);
  }
}

function getBearerToken(req: http.IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return undefined;
  return auth.slice("Bearer ".length).trim();
}

export interface RunningRoomServer {
  service: RoomService;
  httpServer: http.Server;
  wss: WebSocketServer;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function createRoomServer(options: RoomServerOptions = {}): Promise<RunningRoomServer> {
  const service = new RoomService({
    dbPath: options.dbPath ?? ":memory:",
    roomName: options.roomName,
    passcode: options.passcode,
    minConfirmations: options.minConfirmations,
  });

  const sockets = new Set<AuthedSocket>();

  function sendWs(ws: WebSocket, msg: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  service.onEvent((event) => {
    for (const client of sockets) {
      sendWs(client.ws, { type: "event", event });
    }
  });

  service.onAgentKill((signal) => {
    for (const client of sockets) {
      if (client.kind === "agent" && client.memberId === signal.agentId) {
        sendWs(client.ws, {
          type: "agent_kill",
          agentId: signal.agentId,
          stoppedBy: signal.stoppedBy,
          reason: signal.reason,
        });
      }
    }
  });

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        });
        res.end();
        return;
      }

      const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = urlObj.pathname;

      if (req.method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, { ok: true, roomId: service.room.id, roomName: service.room.name });
        return;
      }

      if (req.method === "GET" && pathname === "/api/room") {
        sendJson(res, 200, {
          id: service.room.id,
          name: service.room.name,
          minConfirmations: service.room.minConfirmations,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/join") {
        const body = await readJsonBody(req);
        const avatar = body.avatar === undefined ? undefined : AvatarSchema.parse(body.avatar);
        const result = service.joinHuman(String(body.passcode ?? ""), String(body.nickname ?? ""), avatar);
        sendJson(res, 200, {
          ...result,
          roomId: service.room.id,
          roomName: service.room.name,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/snapshot") {
        const token = getBearerToken(req);
        const session = token ? service.getSession(token) : undefined;
        if (!session) {
          throw new RoomError("UNAUTHORIZED", "Valid Bearer token required", 401);
        }
        sendJson(res, 200, {
          memberId: session.memberId,
          state: service.getState(),
          events: service.getEventsAfter(0),
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/agent-invite") {
        const token = getBearerToken(req);
        const session = token ? service.getSession(token) : undefined;
        if (!session || session.kind !== "human") {
          throw new RoomError("UNAUTHORIZED", "Human session token required", 401);
        }
        const invite = service.createAgentInvite(session.memberId);
        sendJson(res, 200, invite);
        return;
      }

      if (req.method === "POST" && pathname === "/api/agent/register") {
        const body = await readJsonBody(req);
        const driver = (body.driver ?? "codex") as "codex" | "claude-code" | "pi" | "mcp-only";
        const resData = service.registerAgent(
          String(body.inviteToken ?? ""),
          String(body.agentName ?? ""),
          driver,
        );
        sendJson(res, 200, {
          ...resData,
          roomId: service.room.id,
          roomName: service.room.name,
        });
        return;
      }

      if (req.method === "POST" && pathname.startsWith("/api/mcp/")) {
        const token = getBearerToken(req);
        const session = token ? service.getSession(token) : undefined;
        if (!session || session.kind !== "agent") {
          throw new RoomError("UNAUTHORIZED", "Valid agent Bearer token required", 401);
        }
        const toolName = pathname.slice("/api/mcp/".length);
        const body = await readJsonBody(req);

        switch (toolName) {
          case "room_get_context": {
            const input = RoomGetContextInputSchema.parse(body);
            sendJson(res, 200, service.mcpGetContext(input.includeDrafts));
            return;
          }
          case "room_claim_card": {
            const input = RoomClaimCardInputSchema.parse(body);
            sendJson(
              res,
              200,
              service.mcpClaimCard(session.memberId, input.cardId, input.versionHash, input.fileGlobs),
            );
            return;
          }
          case "room_check_files": {
            const input = RoomCheckFilesInputSchema.parse(body);
            sendJson(res, 200, service.mcpCheckFiles(session.memberId, input.paths));
            return;
          }
          case "room_report_step": {
            const input = RoomReportStepInputSchema.parse(body);
            sendJson(
              res,
              200,
              service.mcpReportStep(session.memberId, input.cardId, input.summary, input.detail),
            );
            return;
          }
          case "room_ask_human": {
            const input = RoomAskHumanInputSchema.parse(body);
            sendJson(res, 200, service.mcpAskHuman(session.memberId, input.cardId, input.question));
            return;
          }
          case "room_submit_output": {
            const input = RoomSubmitOutputInputSchema.parse(body);
            sendJson(
              res,
              200,
              service.mcpSubmitOutput(
                session.memberId,
                input.cardId,
                input.cardVersionHash,
                input.kind,
                input.summary,
                input.diff,
                input.previewUrl,
                input.branch,
              ),
            );
            return;
          }
          default:
            throw new RoomError("UNKNOWN_TOOL", `Unknown MCP tool: ${toolName}`, 404);
        }
      }

      // Serve static built web frontend if configured
      if (req.method === "GET" && options.webDistDir && fs.existsSync(options.webDistDir)) {
        const cleanPath = pathname === "/" ? "/index.html" : pathname;
        const candidate = path.resolve(options.webDistDir, `.${cleanPath}`);
        const rootResolved = path.resolve(options.webDistDir);
        const filePath =
          candidate.startsWith(rootResolved) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
            ? candidate
            : path.join(rootResolved, "index.html");

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      sendJson(res, 404, { code: "NOT_FOUND", message: `Route not found: ${pathname}` });
    } catch (err) {
      if (err instanceof RoomError) {
        sendJson(res, err.statusCode, { code: err.code, message: err.message });
        return;
      }
      if (err && typeof err === "object" && "issues" in err) {
        sendJson(res, 400, { code: "VALIDATION_ERROR", message: String(err) });
        return;
      }
      sendJson(res, 500, {
        code: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Unknown server error",
      });
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const urlObj = new URL(req.url ?? "/ws", `http://${req.headers.host ?? "localhost"}`);
    const token = urlObj.searchParams.get("token") ?? "";
    const session = service.getSession(token);
    if (!session) {
      ws.close(4001, "Unauthorized");
      return;
    }

    const client: AuthedSocket = {
      ws,
      memberId: session.memberId,
      kind: session.kind,
    };
    sockets.add(client);

    ws.on("message", (raw) => {
      try {
        const parsed = WsClientMessageSchema.parse(JSON.parse(raw.toString("utf8")));
        switch (parsed.type) {
          case "sync_from": {
            const events = service.getEventsAfter(parsed.afterSeq);
            sendWs(ws, { type: "events_batch", events });
            break;
          }
          case "post_message": {
            service.postMessage(
              session.memberId,
              parsed.text,
              parsed.mentions,
              parsed.refCardId,
              parsed.meta,
            );
            break;
          }
          case "create_card": {
            service.createCard(session.memberId, parsed.spec);
            break;
          }
          case "update_card": {
            service.updateCard(session.memberId, parsed.cardId, parsed.spec);
            break;
          }
          case "confirm_card": {
            service.confirmCard(session.memberId, parsed.cardId, parsed.versionHash);
            break;
          }
          case "review_card": {
            service.reviewCard(
              session.memberId,
              parsed.cardId,
              parsed.outputId,
              parsed.decision,
              parsed.comment,
            );
            break;
          }
          case "stop_agent": {
            service.stopAgent(session.memberId, parsed.agentId, parsed.reason);
            break;
          }
        }
      } catch (err) {
        sendWs(ws, {
          type: "error",
          code: err instanceof RoomError ? err.code : "BAD_MESSAGE",
          message: err instanceof Error ? err.message : "Invalid WebSocket message",
        });
      }
    });

    ws.on("close", () => {
      sockets.delete(client);
      const stillConnected = Array.from(sockets).some((s) => s.memberId === client.memberId);
      if (!stillConnected) {
        service.markMemberOffline(client.memberId);
      }
    });
  });

  const listenHost = options.host ?? "127.0.0.1";
  const listenPort = options.port ?? 3000;

  await new Promise<void>((resolve) => {
    httpServer.listen(listenPort, listenHost, () => resolve());
  });

  const addr = httpServer.address() as AddressInfo;
  const boundPort = addr.port;
  const displayHost = listenHost === "0.0.0.0" ? "127.0.0.1" : listenHost;

  return {
    service,
    httpServer,
    wss,
    port: boundPort,
    url: `http://${displayHost}:${boundPort}`,
    close: async () => {
      for (const client of sockets) {
        client.ws.terminate();
      }
      sockets.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      service.close();
    },
  };
}

#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoomServer } from "@coagent/server";
import { CodexDriver } from "./drivers/codex.js";
import { LocalMcpServer } from "./mcp-server.js";
import { RoomHttpClient } from "./room-client.js";

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getLanIps(): string[] {
  const ips: string[] = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}

async function runHost(args: string[]): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const defaultWebDist = path.resolve(__dirname, "../../web/dist");

  const port = Number(getFlag(args, "--port") ?? 3000);
  const name = getFlag(args, "--name") ?? "coagent-room";
  const passcode = getFlag(args, "--passcode");
  const dbPath = getFlag(args, "--db") ?? "./coagent-room.sqlite";
  const minConfirmations = Number(getFlag(args, "--min-confirmations") ?? 1);

  const server = await createRoomServer({
    port,
    host: "0.0.0.0",
    dbPath,
    roomName: name,
    passcode,
    minConfirmations,
    webDistDir: defaultWebDist,
  });

  console.log(`\ncoagent-room host started!`);
  console.log(`  Room:     ${server.service.room.name} (${server.service.room.id})`);
  console.log(`  Passcode: ${server.service.room.passcode}`);
  console.log(`  Local:    http://127.0.0.1:${server.port}`);
  for (const ip of getLanIps()) {
    console.log(`  LAN:      http://${ip}:${server.port}`);
  }
  console.log("");
}

async function runMcp(args: string[]): Promise<void> {
  const roomUrl = getFlag(args, "--room-url");
  const agentToken = getFlag(args, "--agent-token");
  const cwd = path.resolve(getFlag(args, "--cwd") ?? process.cwd());
  if (!roomUrl || !agentToken) {
    console.error("Usage: coagent mcp --room-url <url> --agent-token <token> [--cwd <dir>]");
    process.exit(1);
  }
  const client = new RoomHttpClient(roomUrl, agentToken);
  const mcp = new LocalMcpServer({ client, cwd });
  mcp.start();
}

async function runJoin(args: string[]): Promise<void> {
  const roomUrl = args.find((a) => !a.startsWith("--"));
  const inviteToken = getFlag(args, "--token");
  const driverKind = (getFlag(args, "--agent") ?? "codex") as "codex" | "mcp-only";
  const agentName = getFlag(args, "--name") ?? `${os.userInfo().username} · ${driverKind}`;
  const cwd = path.resolve(getFlag(args, "--cwd") ?? process.cwd());

  if (!roomUrl || !inviteToken) {
    console.error(
      "Usage: coagent join <roomUrl> --token <inviteToken> [--agent codex|mcp-only] [--name <name>] [--cwd <dir>]",
    );
    process.exit(1);
  }

  const client = new RoomHttpClient(roomUrl);
  const reg = await client.registerAgent(inviteToken, agentName, driverKind);
  console.log(`Connected to room "${reg.roomName}" as ${agentName} (${reg.agentId})`);

  let driver: CodexDriver | null = null;
  if (driverKind === "codex") {
    const mcpCommand = process.execPath;
    const cliEntry = fileURLToPath(import.meta.url);
    const mcpConfig = JSON.stringify({
      command: mcpCommand,
      args: [cliEntry, "mcp", "--room-url", roomUrl, "--agent-token", reg.agentSessionToken, "--cwd", cwd],
    });
    driver = new CodexDriver({
      cwd,
      args: ["app-server", "-c", `mcp_servers.coagent=${mcpConfig}`],
    });
    await driver.start();
    console.log("Codex app-server driver started with room MCP tools injected.");
  } else {
    console.log("MCP-only mode. Add this stdio MCP server to your coding agent:");
    console.log(
      `  coagent mcp --room-url ${roomUrl} --agent-token ${reg.agentSessionToken} --cwd ${cwd}`,
    );
  }

  client.connectWs({
    onKill: async (signal) => {
      console.error(`\n[EMERGENCY STOP] Stopped by ${signal.stoppedBy}: ${signal.reason ?? "No reason"}`);
      if (driver) {
        await driver.kill(signal.reason);
      }
      process.exit(0);
    },
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === "host") {
    void runHost(rest);
  } else if (sub === "join") {
    void runJoin(rest);
  } else if (sub === "mcp") {
    void runMcp(rest);
  } else {
    console.log("coagent CLI v0.1");
    console.log("  coagent host [--port 3000] [--name <room>] [--passcode <code>] [--db <file>]");
    console.log("  coagent join <roomUrl> --token <inviteToken> [--agent codex|mcp-only] [--cwd <dir>]");
    console.log("  coagent mcp --room-url <url> --agent-token <token> [--cwd <dir>]");
  }
}

export * from "./room-client.js";
export * from "./mcp-server.js";
export * from "./drivers/types.js";
export * from "./drivers/codex.js";

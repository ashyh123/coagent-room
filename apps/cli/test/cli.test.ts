import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createRoomServer, RunningRoomServer } from "@coagent/server";
import { CodexDriver, LocalMcpServer, RoomHttpClient } from "../src/index.js";

function sendRpc(
  input: PassThrough,
  output: PassThrough,
  payload: Record<string, unknown>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("RPC timeout")), 3000);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx !== -1) {
        const line = buffer.slice(0, idx);
        clearTimeout(timer);
        output.off("data", onData);
        resolve(JSON.parse(line));
      }
    };
    output.on("data", onData);
    input.write(`${JSON.stringify(payload)}\n`);
  });
}

describe("apps/cli: LocalMcpServer & CodexDriver contract tests", () => {
  const servers: RunningRoomServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.close();
    }
  });

  it("exposes all 6 room MCP tools over stdio JSON-RPC and enforces file locks end-to-end", async () => {
    const server = await createRoomServer({
      port: 0,
      dbPath: ":memory:",
      roomName: "CLI Test Room",
      passcode: "pass123",
      minConfirmations: 1,
    });
    servers.push(server);

    const human = server.service.joinHuman("pass123", "Evan");
    const c1 = server.service.createCard(human.memberId, {
      title: "Build Room API",
      goal: "Add room endpoints",
      interfaceContract: "GET /api/room",
      fileGlobs: ["apps/server/src/**"],
      acceptanceCriteria: ["Server tests pass"],
    });
    const cardId = (c1.payload as any).cardId;
    const versionHash = (c1.payload as any).versionHash;
    server.service.confirmCard(human.memberId, cardId, versionHash);

    const invite = server.service.createAgentInvite(human.memberId);
    const client = new RoomHttpClient(server.url);
    await client.registerAgent(invite.inviteToken, "Evan · Codex", "codex");

    const input = new PassThrough();
    const output = new PassThrough();
    const mcp = new LocalMcpServer({ client, cwd: process.cwd(), input, output });
    mcp.start();

    // 1. initialize
    const initRes = await sendRpc(input, output, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    expect(initRes.result.serverInfo.name).toBe("coagent-room-mcp");

    // 2. tools/list
    const listRes = await sendRpc(input, output, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(listRes.result.tools).toHaveLength(6);

    // 3. room_get_context
    const ctxRes = await sendRpc(input, output, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "room_get_context", arguments: { includeDrafts: false } },
    });
    expect(ctxRes.result.structuredContent.cards).toHaveLength(1);

    // 4. room_claim_card
    const claimRes = await sendRpc(input, output, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "room_claim_card",
        arguments: { cardId, versionHash, fileGlobs: ["apps/server/src/**"] },
      },
    });
    expect(claimRes.result.structuredContent.ok).toBe(true);

    // 5. room_report_step
    const stepRes = await sendRpc(input, output, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "room_report_step",
        arguments: { cardId, summary: "Implemented room server routes" },
      },
    });
    expect(stepRes.result.structuredContent.ok).toBe(true);

    // 6. room_submit_output
    const outRes = await sendRpc(input, output, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "room_submit_output",
        arguments: {
          cardId,
          cardVersionHash: versionHash,
          kind: "git_diff",
          summary: "Done with room routes",
          diff: "diff --git a/apps/server/src/room.ts b/apps/server/src/room.ts\n+// ok",
        },
      },
    });
    expect(outRes.result.structuredContent.ok).toBe(true);
    expect(server.service.getState().cards[cardId].status).toBe("pending_review");

    mcp.stop();
  });

  it("drives codex app-server over JSON-RPC stdio, streams steps, and terminates cleanly on emergency stop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coagent-codex-fake-"));
    const fakeScript = path.join(tmpDir, "fake-codex.mjs");
    fs.writeFileSync(
      fakeScript,
      `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { server: "fake-codex" } }) + "\\n");
  } else if (msg.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "thr_1" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turnId: "turn_1" } }) + "\\n");
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { summary: "Edited auth.ts" } }) + "\\n");
    }, 30);
  }
});
setInterval(() => {}, 10000);
`,
      "utf8",
    );

    const driver = new CodexDriver({
      cwd: tmpDir,
      command: process.execPath,
      args: [fakeScript],
    });

    const steps: string[] = [];
    const stepPromise = new Promise<void>((resolve) => {
      driver.onStep((s) => {
        steps.push(s.summary);
        resolve();
      });
    });

    await driver.start();
    expect(driver.isRunning()).toBe(true);

    await driver.dispatchTask({
      cardId: "card_1",
      versionHash: "v_1234567890abcdef",
      title: "Fix auth",
      goal: "Add passcode validation",
      interfaceContract: "POST /api/join",
      fileGlobs: ["apps/server/src/auth.ts"],
      acceptanceCriteria: ["Unit tests pass"],
    });

    await stepPromise;
    expect(steps).toContain("Edited auth.ts");

    // Emergency stop must terminate the real child process
    await driver.kill("Emergency stop triggered");
    expect(driver.isRunning()).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

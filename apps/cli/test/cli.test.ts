import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRoomServer, RunningRoomServer } from "@coagent/server";
import { MCP_TOOL_NAMES } from "@coagent/protocol";
import {
  buildCodexMcpArgs,
  CodexDriver,
  DriverStepEvent,
  DriverTurnCompletedEvent,
  LocalMcpServer,
  RoomAgentBridge,
  RoomHttpClient,
} from "../src/index.js";

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
  const tmpDirs: string[] = [];
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
    while (servers.length > 0) {
      await servers.pop()!.close();
    }
    while (tmpDirs.length > 0) {
      fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
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

  it("builds dotted TOML -c arguments for codex mcp_servers injection", () => {
    const args = buildCodexMcpArgs({
      command: "/usr/local/bin/node",
      args: ["/path/to/cli.js", "mcp", "--room-url", "http://127.0.0.1:3000"],
    });
    expect(args).toEqual([
      "app-server",
      "-c",
      'mcp_servers.coagent.command="/usr/local/bin/node"',
      "-c",
      'mcp_servers.coagent.args=["/path/to/cli.js","mcp","--room-url","http://127.0.0.1:3000"]',
      ...MCP_TOOL_NAMES.flatMap((toolName) => [
        "-c",
        `mcp_servers.coagent.tools.${toolName}.approval_mode="approve"`,
      ]),
    ]);
    expect(args.some((arg) => arg.startsWith("mcp_servers.coagent={"))).toBe(false);
  });

  it("handles Codex v2 item/completed, turn/completed, and server approval requests cleanly", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coagent-codex-v2-"));
    tmpDirs.push(tmpDir);
    const fakeScript = path.join(tmpDir, "fake-codex-v2.mjs");
    fs.writeFileSync(
      fakeScript,
      `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
let cmdDecision = "";
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { userAgent: "codex-cli/0.171.0" } }) + "\\n");
  } else if (msg.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "thr_v2" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "turn_v2" } } }) + "\\n");
    // Deliberately reuse numeric server request id=2 to verify ServerRequest takes precedence over RPC IDs
    setTimeout(() => {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "item/commandExecution/requestApproval",
        params: { command: "pnpm test", reason: "Run verification suite", itemId: "item_ap", threadId: "thr_v2", turnId: "turn_v2", startedAtMs: Date.now() },
      }) + "\\n");
    }, 15);
  } else if (msg.id === 2 && msg.result) {
    cmdDecision = msg.result.decision;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thr_v2",
        turnId: "turn_v2",
        serverName: "external_mcp",
        mode: "form",
        message: "Allow external_mcp to query?",
        _meta: { codex_approval_kind: "mcp_tool_call", tool_name: "lookup", tool_description: "Lookup metadata" },
      },
    }) + "\\n");
  } else if (msg.id === 3 && msg.result) {
    const elicitationReply = msg.result;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "thr_v2",
        turnId: "turn_v2",
        completedAtMs: Date.now(),
        item: { type: "agentMessage", id: "item_0", phase: "commentary", text: "Commentary update should be superseded by final answer." },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "thr_v2",
        turnId: "turn_v2",
        completedAtMs: Date.now(),
        item: { type: "mcpToolCall", id: "item_1", server: "coagent", tool: "room_get_context", status: "completed", arguments: {} },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "thr_v2",
        turnId: "turn_v2",
        completedAtMs: Date.now(),
        item: { type: "commandExecution", id: "item_2", command: "pnpm test", exitCode: 0, aggregatedOutput: "All passed" },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "thr_v2",
        turnId: "turn_v2",
        completedAtMs: Date.now(),
        item: {
          type: "agentMessage",
          id: "item_3",
          phase: "final_answer",
          text: "Approved cmd=" + cmdDecision + " mcpAction=" + elicitationReply.action + " content=" + String(elicitationReply.content),
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId: "thr_v2", turn: { id: "turn_v2", status: "completed", error: null, items: [] } },
    }) + "\\n");
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
    cleanups.push(() => driver.kill("test cleanup"));

    const steps: DriverStepEvent[] = [];
    driver.onStep((step) => steps.push(step));

    const approvalSummaries: Array<{ method: string; summary: string }> = [];
    driver.onApprovalRequest((req) => {
      approvalSummaries.push({ method: req.method, summary: req.summary });
      req.resolve("accept");
    });

    const completedPromise = new Promise<DriverTurnCompletedEvent>((resolve) => {
      driver.onTurnCompleted((evt) => resolve(evt));
    });

    await driver.start();
    await driver.dispatchDirective("Run tests and summarize.");

    const completed = await completedPromise;
    expect(approvalSummaries).toEqual([
      { method: "item/commandExecution/requestApproval", summary: "Run command: pnpm test" },
      { method: "mcpServer/elicitation/request", summary: "Allow external_mcp to query?" },
    ]);
    expect(completed.status).toBe("completed");
    expect(completed.assistantText).toBe("Approved cmd=accept mcpAction=accept content=null");
    expect(steps.some((s) => s.mcpServer === "coagent" && s.mcpTool === "room_get_context")).toBe(true);
    expect(steps.some((s) => s.source === "commandExecution" && s.summary.includes("pnpm test"))).toBe(true);
  });

  it("bridges room directives, approval prompts, assistant replies, and kill switch end-to-end", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coagent-bridge-e2e-"));
    tmpDirs.push(tmpDir);
    const fakeScript = path.join(tmpDir, "fake-codex-bridge.mjs");
    fs.writeFileSync(
      fakeScript,
      `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { server: "fake-codex-bridge" } }) + "\\n");
  } else if (msg.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "thr_bridge" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    const promptText = msg.params?.input?.[0]?.text ?? "";
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "turn_bridge" } } }) + "\\n");
    setTimeout(() => {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "item/commandExecution/requestApproval",
        params: { command: "git status", reason: "Inspect workspace", itemId: "it_1", threadId: "thr_bridge", turnId: "turn_bridge", startedAtMs: Date.now() },
      }) + "\\n");
    }, 20);
    globalThis.__lastPrompt = promptText;
  } else if (msg.id === 99 && msg.result) {
    const decision = msg.result.decision;
    const seenPrompt = String(globalThis.__lastPrompt || "");
    const replyText = seenPrompt.includes("检查状态")
      ? "Received directive and ran with decision: " + decision
      : "Unexpected prompt";
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/completed",
      params: { threadId: "thr_bridge", turnId: "turn_bridge", completedAtMs: Date.now(), item: { type: "agentMessage", id: "msg_out", text: replyText } },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId: "thr_bridge", turn: { id: "turn_bridge", status: "completed", error: null, items: [] } },
    }) + "\\n");
  }
});
setInterval(() => {}, 10000);
`,
      "utf8",
    );

    const server = await createRoomServer({
      port: 0,
      dbPath: ":memory:",
      roomName: "Bridge Test Room",
      passcode: "pass123",
      minConfirmations: 1,
    });
    servers.push(server);

    const human = server.service.joinHuman("pass123", "Evan");
    // Historical message before bridge starts must NOT be dispatched
    server.service.postMessage(human.memberId, "@CodexBot 历史消息不该重复触发");

    const invite = server.service.createAgentInvite(human.memberId);
    const client = new RoomHttpClient(server.url);
    const reg = await client.registerAgent(invite.inviteToken, "CodexBot", "codex");

    const driver = new CodexDriver({
      cwd: tmpDir,
      command: process.execPath,
      args: [fakeScript],
    });
    await driver.start();

    let killCalled = false;
    const bridge = new RoomAgentBridge({
      client,
      driver,
      agentId: reg.agentId,
      agentName: "CodexBot",
      onKill: () => {
        killCalled = true;
      },
    });
    cleanups.push(() => bridge.stop());
    await bridge.start();

    // Listen to room events to coordinate approval & reply assertions cleanly
    const humanWs = new WebSocket(`${server.url.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(human.sessionToken)}`);
    cleanups.push(() => {
      try {
        humanWs.close();
      } catch {}
    });
    await new Promise<void>((resolve) => humanWs.once("open", () => resolve()));

    const seenTexts: Array<{ actorId: string; text: string }> = [];
    const waitForMessage = (predicate: (m: { actorId: string; text: string }) => boolean) =>
      new Promise<{ actorId: string; text: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for room message")), 4000);
        const check = () => {
          const hit = seenTexts.find(predicate);
          if (hit) {
            clearTimeout(timer);
            resolve(hit);
          }
        };
        humanWs.on("message", (raw) => {
          try {
            const parsed = JSON.parse(raw.toString("utf8"));
            if (parsed.type === "event" && parsed.event?.payload?.type === "message_posted") {
              seenTexts.push({ actorId: parsed.event.actorId, text: parsed.event.payload.text });
              check();
            }
          } catch {}
        });
        check();
      });

    // Send live directive mentioning agent -> should trigger approval prompt in room
    server.service.postMessage(human.memberId, "@CodexBot 请帮我检查状态", [reg.agentId]);

    const approvalMsg = await waitForMessage(
      (m) => m.actorId === reg.agentId && m.text.includes("需要确认操作") && m.text.includes("git status"),
    );
    expect(approvalMsg.text).toContain("@CodexBot 允许继续");

    // Human approves -> Codex receives decision="accept" and replies back to the room
    server.service.postMessage(human.memberId, "@CodexBot 允许继续", [reg.agentId]);

    const replyMsg = await waitForMessage(
      (m) => m.actorId === reg.agentId && m.text.includes("Received directive and ran with decision: accept"),
    );
    expect(replyMsg.actorId).toBe(reg.agentId);

    // Ensure historical message was never echoed/dispatched
    expect(seenTexts.some((m) => m.actorId === reg.agentId && m.text.includes("Unexpected prompt"))).toBe(false);

    // Emergency Stop (Kill Switch) must terminate driver process cleanly
    server.service.stopAgent(human.memberId, reg.agentId, "Stop now");
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const poll = () => {
        if (!driver.isRunning() && killCalled) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Kill switch did not terminate CodexDriver in time"));
          return;
        }
        setTimeout(poll, 25);
      };
      poll();
    });

    expect(driver.isRunning()).toBe(false);
    expect(killCalled).toBe(true);
  });
});

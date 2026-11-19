import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRoomServer, RunningRoomServer } from "../src/index.js";

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS message")), timeoutMs);
    const handler = (raw: WebSocket.RawData) => {
      const parsed = JSON.parse(raw.toString("utf8"));
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(parsed);
      }
    };
    ws.on("message", handler);
  });
}

describe("coagent-room server (v0.1 integration)", () => {
  const runningServers: RunningRoomServer[] = [];

  afterEach(async () => {
    while (runningServers.length > 0) {
      const s = runningServers.pop()!;
      await s.close();
    }
  });

  it("enforces passcode auth, dual-client WS cursor sync, file-lock conflicts, emergency stop, and diff acceptance", async () => {
    const server = await createRoomServer({
      port: 0,
      dbPath: ":memory:",
      roomName: "Test Room",
      passcode: "secret42",
      minConfirmations: 2,
    });
    runningServers.push(server);

    // 1. Wrong passcode rejected
    const badJoin = await fetch(`${server.url}/api/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: "wrong", nickname: "Evan" }),
    });
    expect(badJoin.status).toBe(401);

    // 2. Two humans join
    const evan = await (
      await fetch(`${server.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "secret42", nickname: "Evan" }),
      })
    ).json();
    const alex = await (
      await fetch(`${server.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "secret42", nickname: "Alex" }),
      })
    ).json();

    // 3. Connect two WebSockets and test cursor sync
    const wsEvan = new WebSocket(`${server.url.replace("http", "ws")}/ws?token=${evan.sessionToken}`);
    const wsAlex = new WebSocket(`${server.url.replace("http", "ws")}/ws?token=${alex.sessionToken}`);
    await Promise.all([
      new Promise<void>((r) => wsEvan.once("open", () => r())),
      new Promise<void>((r) => wsAlex.once("open", () => r())),
    ]);

    const batchPromise = waitForMessage(wsEvan, (m) => m.type === "events_batch");
    wsEvan.send(JSON.stringify({ type: "sync_from", afterSeq: 0 }));
    const batch = await batchPromise;
    expect(batch.events.length).toBe(2);

    // 4. Create 2 cards and confirm both by Evan and Alex
    const card1CreatedP = waitForMessage(wsAlex, (m) => m.type === "event" && m.event.payload.type === "card_created");
    wsEvan.send(
      JSON.stringify({
        type: "create_card",
        spec: {
          title: "Auth Backend",
          goal: "Implement room passcode auth",
          interfaceContract: "POST /api/join",
          fileGlobs: ["apps/server/src/**"],
          acceptanceCriteria: ["Passes server auth tests"],
        },
      }),
    );
    const card1Evt = (await card1CreatedP).event;
    const card1Id = card1Evt.payload.cardId;
    const card1Hash = card1Evt.payload.versionHash;

    const card2CreatedP = waitForMessage(wsAlex, (m) => m.type === "event" && m.event.payload.type === "card_created");
    wsEvan.send(
      JSON.stringify({
        type: "create_card",
        spec: {
          title: "Auth Validation",
          goal: "Tighten auth file checks",
          interfaceContract: "validatePasscode()",
          fileGlobs: ["apps/server/src/auth.ts"],
          acceptanceCriteria: ["Rejects empty passcode"],
        },
      }),
    );
    const card2Evt = (await card2CreatedP).event;
    const card2Id = card2Evt.payload.cardId;
    const card2Hash = card2Evt.payload.versionHash;

    // Both Evan and Alex confirm both cards (minConfirmations = 2)
    for (const [cardId, versionHash] of [
      [card1Id, card1Hash],
      [card2Id, card2Hash],
    ]) {
      const c1 = waitForMessage(wsEvan, (m) => m.type === "event" && m.event.payload.type === "card_confirmed");
      wsEvan.send(JSON.stringify({ type: "confirm_card", cardId, versionHash }));
      await c1;
      const c2 = waitForMessage(wsEvan, (m) => m.type === "event" && m.event.payload.type === "card_confirmed");
      wsAlex.send(JSON.stringify({ type: "confirm_card", cardId, versionHash }));
      await c2;
    }

    expect(server.service.getState().cards[card1Id].status).toBe("confirmed");
    expect(server.service.getState().cards[card2Id].status).toBe("confirmed");

    // 5. Invite & register two Codex agents
    const inv1 = await (
      await fetch(`${server.url}/api/agent-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${evan.sessionToken}` },
      })
    ).json();
    const inv2 = await (
      await fetch(`${server.url}/api/agent-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${alex.sessionToken}` },
      })
    ).json();

    const agent1 = await (
      await fetch(`${server.url}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken: inv1.inviteToken, agentName: "Evan · Codex", driver: "codex" }),
      })
    ).json();
    const agent2 = await (
      await fetch(`${server.url}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken: inv2.inviteToken, agentName: "Alex · Codex", driver: "codex" }),
      })
    ).json();

    const wsAgent1 = new WebSocket(`${server.url.replace("http", "ws")}/ws?token=${agent1.agentSessionToken}`);
    await new Promise<void>((r) => wsAgent1.once("open", () => r()));

    // 6. Agent 1 claims card 1 (apps/server/src/**) -> succeeds
    const claim1 = await (
      await fetch(`${server.url}/api/mcp/room_claim_card`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent1.agentSessionToken}`,
        },
        body: JSON.stringify({
          cardId: card1Id,
          versionHash: card1Hash,
          fileGlobs: ["apps/server/src/**"],
        }),
      })
    ).json();
    expect(claim1.ok).toBe(true);

    // 7. Agent 2 tries to claim card 2 (apps/server/src/auth.ts) -> BLOCKED by FILE_LOCK_CONFLICT
    const claim2Conflict = await (
      await fetch(`${server.url}/api/mcp/room_claim_card`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent2.agentSessionToken}`,
        },
        body: JSON.stringify({
          cardId: card2Id,
          versionHash: card2Hash,
          fileGlobs: ["apps/server/src/auth.ts"],
        }),
      })
    ).json();
    expect(claim2Conflict.ok).toBe(false);
    expect(claim2Conflict.code).toBe("FILE_LOCK_CONFLICT");
    expect(claim2Conflict.conflicts[0].heldByAgentName).toBe("Evan · Codex");

    // 8. Agent 1 checks files & reports a work step
    const checkRes = await (
      await fetch(`${server.url}/api/mcp/room_check_files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent1.agentSessionToken}`,
        },
        body: JSON.stringify({ paths: ["apps/server/src/room.ts", "README.md"] }),
      })
    ).json();
    expect(checkRes.results[0].status).toBe("allowed");
    expect(checkRes.results[1].status).toBe("out_of_scope");

    const stepRes = await (
      await fetch(`${server.url}/api/mcp/room_report_step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent1.agentSessionToken}`,
        },
        body: JSON.stringify({ cardId: card1Id, summary: "Added passcode auth check and unit tests" }),
      })
    ).json();
    expect(stepRes.ok).toBe(true);

    // 9. Emergency stop Agent 1 -> Agent 1 receives WS agent_kill AND subsequent MCP writes fail
    const killPromise = waitForMessage(wsAgent1, (m) => m.type === "agent_kill");
    wsAlex.send(JSON.stringify({ type: "stop_agent", agentId: agent1.agentId, reason: "Scope drift" }));
    const killMsg = await killPromise;
    expect(killMsg.agentId).toBe(agent1.agentId);

    const blockedAfterStop = await (
      await fetch(`${server.url}/api/mcp/room_report_step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent1.agentSessionToken}`,
        },
        body: JSON.stringify({ cardId: card1Id, summary: "Should be blocked" }),
      })
    ).json();
    expect(blockedAfterStop.ok).toBe(false);

    // 10. Now that Agent 1's lock was released by emergency stop, Agent 2 can claim card 2 and submit diff
    const claim2Ok = await (
      await fetch(`${server.url}/api/mcp/room_claim_card`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent2.agentSessionToken}`,
        },
        body: JSON.stringify({
          cardId: card2Id,
          versionHash: card2Hash,
          fileGlobs: ["apps/server/src/auth.ts"],
        }),
      })
    ).json();
    expect(claim2Ok.ok).toBe(true);

    const submitRes = await (
      await fetch(`${server.url}/api/mcp/room_submit_output`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent2.agentSessionToken}`,
        },
        body: JSON.stringify({
          cardId: card2Id,
          cardVersionHash: card2Hash,
          kind: "git_diff",
          summary: "Implemented passcode validation",
          diff: "diff --git a/apps/server/src/auth.ts b/apps/server/src/auth.ts\n+export const ok = true;",
        }),
      })
    ).json();
    expect(submitRes.ok).toBe(true);

    const reviewedP = waitForMessage(wsAlex, (m) => m.type === "event" && m.event.payload.type === "card_reviewed");
    wsEvan.send(
      JSON.stringify({
        type: "review_card",
        cardId: card2Id,
        outputId: submitRes.outputId,
        decision: "accepted",
      }),
    );
    await reviewedP;
    expect(server.service.getState().cards[card2Id].status).toBe("accepted");

    wsEvan.close();
    wsAlex.close();
    wsAgent1.close();
  });

  it("persists room state across restarts in SQLite", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coagent-room-test-"));
    const dbPath = path.join(tmpDir, "room.sqlite");

    const s1 = await createRoomServer({ port: 0, dbPath, roomName: "Persist Room", passcode: "abc" });
    const evan = s1.service.joinHuman("abc", "Evan");
    s1.service.postMessage(evan.memberId, "Hello persistent world");
    await s1.close();

    const s2 = await createRoomServer({ port: 0, dbPath });
    runningServers.push(s2);
    expect(s2.service.room.name).toBe("Persist Room");
    expect(s2.service.getState().messages).toHaveLength(1);
    expect(s2.service.getState().messages[0].text).toBe("Hello persistent world");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

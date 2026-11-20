import fs from "node:fs";
import http from "node:http";
import { AddressInfo } from "node:net";
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

  it("persists and broadcasts optional member avatar and message metadata", async () => {
    const server = await createRoomServer({
      port: 0,
      dbPath: ":memory:",
      roomName: "Meta Room",
      passcode: "meta42",
    });
    runningServers.push(server);

    const avatar = { kind: "preset", value: "terminal" };
    const lin = await (
      await fetch(`${server.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "meta42", nickname: "Lin", avatar }),
      })
    ).json();

    const wsLin = new WebSocket(`${server.url.replace("http", "ws")}/ws?token=${lin.sessionToken}`);
    await new Promise<void>((r) => wsLin.once("open", () => r()));

    const msgPromise = waitForMessage(
      wsLin,
      (m) => m.type === "event" && m.event.payload.type === "message_posted",
    );
    wsLin.send(
      JSON.stringify({
        type: "post_message",
        text: "Check auth refactor",
        mentions: [],
        refCardId: "card_04",
        meta: {
          model: "Claude 4.5",
          permissionMode: "ask",
          attachments: [{ name: "guard.ts", size: 512 }],
        },
      }),
    );
    const evtMsg = await msgPromise;
    expect(evtMsg.event.payload.refCardId).toBe("card_04");
    expect(evtMsg.event.payload.meta).toEqual({
      model: "Claude 4.5",
      permissionMode: "ask",
      attachments: [{ name: "guard.ts", size: 512 }],
    });

    const state = server.service.getState();
    expect(state.members[lin.memberId].avatar).toEqual(avatar);
    expect(state.messages[0].meta?.model).toBe("Claude 4.5");

    wsLin.close();
  });

  it("supports WS topic creation, topicId messages, and SQLite topic persistence across restart", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coagent-room-topic-"));
    const dbPath = path.join(tmpDir, "room.sqlite");

    const s1 = await createRoomServer({ port: 0, dbPath, roomName: "Topic Room", passcode: "topic99" });
    const lin = await (
      await fetch(`${s1.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "topic99", nickname: "Lin" }),
      })
    ).json();

    const wsLin = new WebSocket(`${s1.url.replace("http", "ws")}/ws?token=${lin.sessionToken}`);
    await new Promise<void>((r) => wsLin.once("open", () => r()));

    const topicCreatedP = waitForMessage(
      wsLin,
      (m) => m.type === "event" && m.event.payload.type === "topic_created",
    );
    wsLin.send(
      JSON.stringify({
        type: "create_topic",
        title: "API 设计讨论",
        anchor: {
          kind: "selection",
          quote: "GET /api/inbox returns 4 categories",
        },
      }),
    );
    const topicEvt = (await topicCreatedP).event;
    const topicId = topicEvt.payload.topicId;
    expect(topicId).toBeTruthy();

    // Unknown topicId returns WS error without crashing
    const errP = waitForMessage(wsLin, (m) => m.type === "error");
    wsLin.send(
      JSON.stringify({
        type: "post_message",
        text: "Should fail",
        topicId: "topic_nonexistent",
      }),
    );
    const errMsg = await errP;
    expect(errMsg.code).toBe("NOT_FOUND");

    // Valid topic message succeeds and updates topic.messageCount
    const msgPostedP = waitForMessage(
      wsLin,
      (m) => m.type === "event" && m.event.payload.type === "message_posted",
    );
    wsLin.send(
      JSON.stringify({
        type: "post_message",
        text: "Agree on Bearer auth for /api/inbox",
        topicId,
      }),
    );
    const msgEvt = (await msgPostedP).event;
    expect(msgEvt.payload.topicId).toBe(topicId);

    wsLin.close();
    await s1.close();

    // Restart and verify SQLite rehydration
    const s2 = await createRoomServer({ port: 0, dbPath });
    runningServers.push(s2);
    const rehydrated = s2.service.getState();
    expect(rehydrated.topics[topicId]).toMatchObject({
      id: topicId,
      title: "API 设计讨论",
      messageCount: 1,
      anchor: {
        kind: "selection",
        quote: "GET /api/inbox returns 4 categories",
      },
    });
    expect(rehydrated.messages).toHaveLength(1);
    expect(rehydrated.messages[0].topicId).toBe(topicId);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("computes GET /api/inbox 4 categories and auto-clears resolved items", async () => {
    const server = await createRoomServer({
      port: 0,
      dbPath: ":memory:",
      roomName: "Inbox Room",
      passcode: "inbox42",
      minConfirmations: 1,
    });
    runningServers.push(server);

    // Unauthenticated rejected
    const unauth = await fetch(`${server.url}/api/inbox`);
    expect(unauth.status).toBe(401);

    const lin = await (
      await fetch(`${server.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "inbox42", nickname: "Lin" }),
      })
    ).json();
    const evan = await (
      await fetch(`${server.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "inbox42", nickname: "Evan" }),
      })
    ).json();

    const inv = await (
      await fetch(`${server.url}/api/agent-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${evan.sessionToken}` },
      })
    ).json();
    const agent = await (
      await fetch(`${server.url}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken: inv.inviteToken, agentName: "Codex-A", driver: "codex" }),
      })
    ).json();

    // 1. Draft card -> confirm_card
    const draftCardEvt = server.service.createCard(evan.memberId, {
      title: "Draft Card",
      goal: "Needs confirmation",
      interfaceContract: "POST /x",
      fileGlobs: ["apps/server/src/x.ts"],
      acceptanceCriteria: ["Ok"],
    });
    const draftCardId = draftCardEvt.payload.type === "card_created" ? draftCardEvt.payload.cardId : "";
    const draftHash = draftCardEvt.payload.type === "card_created" ? draftCardEvt.payload.versionHash : "";

    // 2. Pending review card -> review_output
    const revCardEvt = server.service.createCard(evan.memberId, {
      title: "Review Card",
      goal: "Needs review",
      interfaceContract: "GET /y",
      fileGlobs: ["apps/server/src/y.ts"],
      acceptanceCriteria: ["Ok"],
    });
    const revCardId = revCardEvt.payload.type === "card_created" ? revCardEvt.payload.cardId : "";
    const revHash = revCardEvt.payload.type === "card_created" ? revCardEvt.payload.versionHash : "";
    server.service.confirmCard(evan.memberId, revCardId, revHash);
    server.service.mcpClaimCard(agent.agentId, revCardId, revHash, ["apps/server/src/y.ts"]);
    const outRes = server.service.mcpSubmitOutput(
      agent.agentId,
      revCardId,
      revHash,
      "git_diff",
      "Ready for review",
    );
    const outId = outRes.outputId!;

    // 3. Agent asking human -> agent_help
    const helpCardEvt = server.service.createCard(evan.memberId, {
      title: "Help Card",
      goal: "Ask human",
      interfaceContract: "GET /z",
      fileGlobs: ["apps/server/src/z.ts"],
      acceptanceCriteria: ["Ok"],
    });
    const helpCardId = helpCardEvt.payload.type === "card_created" ? helpCardEvt.payload.cardId : "";
    const helpHash = helpCardEvt.payload.type === "card_created" ? helpCardEvt.payload.versionHash : "";
    server.service.confirmCard(evan.memberId, helpCardId, helpHash);
    server.service.mcpClaimCard(agent.agentId, helpCardId, helpHash, ["apps/server/src/z.ts"]);
    server.service.mcpAskHuman(agent.agentId, helpCardId, "Should endpoint allow pagination?");

    // 4. Mention -> mention
    const topicEvt = server.service.createTopic(evan.memberId, "Inbox Thread");
    const topicId = topicEvt.payload.type === "topic_created" ? topicEvt.payload.topicId : "";
    const msgEvt = server.service.postMessage(
      evan.memberId,
      "Hey @lin please check",
      [],
      undefined,
      undefined,
      topicId,
    );
    const mentionMsgId =
      msgEvt.payload.type === "message_posted" ? msgEvt.payload.messageId : "";

    const inbox1 = await (
      await fetch(`${server.url}/api/inbox`, {
        headers: { Authorization: `Bearer ${lin.sessionToken}` },
      })
    ).json();
    expect(inbox1.items.map((i: any) => i.kind).sort()).toEqual([
      "agent_help",
      "confirm_card",
      "mention",
      "review_output",
    ]);

    // Auto-clear all items
    server.service.confirmCard(lin.memberId, draftCardId, draftHash);
    server.service.reviewCard(lin.memberId, revCardId, outId, "accepted");
    server.service.mcpReportStep(agent.agentId, helpCardId, "Added pagination support");

    const inbox2 = await (
      await fetch(`${server.url}/api/inbox?dismissed=${encodeURIComponent(mentionMsgId)}`, {
        headers: { Authorization: `Bearer ${lin.sessionToken}` },
      })
    ).json();
    expect(inbox2.items).toEqual([]);
  });

  it("serves POST /api/private-ask strictly privately (0 SQLite events, 0 WS frames) and supports LLM + offline fallback", async () => {
    const server = await createRoomServer({
      port: 0,
      dbPath: ":memory:",
      roomName: "Private Ask Room",
      passcode: "priv42",
    });
    runningServers.push(server);

    const lin = await (
      await fetch(`${server.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "priv42", nickname: "Lin" }),
      })
    ).json();
    const alex = await (
      await fetch(`${server.url}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "priv42", nickname: "Alex" }),
      })
    ).json();

    const inv = await (
      await fetch(`${server.url}/api/agent-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lin.sessionToken}` },
      })
    ).json();
    const agent = await (
      await fetch(`${server.url}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken: inv.inviteToken, agentName: "Codex", driver: "codex" }),
      })
    ).json();

    const cardEvt = server.service.createCard(lin.memberId, {
      title: "Private Ask Spec",
      goal: "Verify zero side effects",
      interfaceContract: "POST /api/private-ask",
      fileGlobs: ["apps/server/src/private-assistant.ts"],
      acceptanceCriteria: ["Zero WS broadcast"],
    });
    const cardId = cardEvt.payload.type === "card_created" ? cardEvt.payload.cardId : "";
    const topicEvt = server.service.createTopic(lin.memberId, "Private Context Topic");
    const topicId = topicEvt.payload.type === "topic_created" ? topicEvt.payload.topicId : "";
    server.service.postMessage(lin.memberId, "Discussing private ask contract", [], cardId, undefined, topicId);

    // Connect another client (Alex) via WS and record all frames
    const wsAlex = new WebSocket(`${server.url.replace("http", "ws")}/ws?token=${alex.sessionToken}`);
    await new Promise<void>((r) => wsAlex.once("open", () => r()));
    const alexFrames: string[] = [];
    wsAlex.on("message", (data) => {
      alexFrames.push(data.toString("utf8"));
    });

    // Unauth & agent token rejected
    const unauthRes = await fetch(`${server.url}/api/private-ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Status?" }),
    });
    expect(unauthRes.status).toBe(401);

    const agentRes = await fetch(`${server.url}/api/private-ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agent.agentSessionToken}`,
      },
      body: JSON.stringify({ question: "Status?" }),
    });
    expect(agentRes.status).toBe(401);

    const eventsBefore = server.service.getEventsAfter(0).length;

    // 1. Offline local_context mode
    const prevUrl = process.env.COAGENT_LLM_BASE_URL;
    delete process.env.COAGENT_LLM_BASE_URL;
    try {
      const privRes = await fetch(`${server.url}/api/private-ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lin.sessionToken}`,
        },
        body: JSON.stringify({
          question: "这张卡片现在是什么状态？",
          quote: "Verify zero side effects",
          activeCardId: cardId,
          topicId,
        }),
      });
      expect(privRes.status).toBe(200);
      const privJson = await privRes.json();
      expect(privJson.source).toBe("local_context");
      expect(privJson.answer).toContain("Private Ask Spec");
      expect(privJson.answer).toContain("Verify zero side effects");
    } finally {
      if (prevUrl !== undefined) process.env.COAGENT_LLM_BASE_URL = prevUrl;
    }

    // Wait briefly to confirm zero WS frames arrive at Alex
    await new Promise((r) => setTimeout(r, 80));
    expect(server.service.getEventsAfter(0).length).toBe(eventsBefore);
    expect(alexFrames).toHaveLength(0);

    // 2. Local mock LLM endpoint + fallback on 500
    let failMode = false;
    const mockLlm = http.createServer((req, res) => {
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        if (failMode) {
          res.writeHead(500);
          res.end("err");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: "test-llm",
            choices: [{ message: { content: "来自 Mock LLM 的私密分析结论" } }],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => mockLlm.listen(0, "127.0.0.1", () => resolve()));
    const llmPort = (mockLlm.address() as AddressInfo).port;
    process.env.COAGENT_LLM_BASE_URL = `http://127.0.0.1:${llmPort}/v1`;

    try {
      const llmOk = await (
        await fetch(`${server.url}/api/private-ask`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lin.sessionToken}`,
          },
          body: JSON.stringify({ question: "Summarize", model: "test-llm" }),
        })
      ).json();
      expect(llmOk).toEqual({
        answer: "来自 Mock LLM 的私密分析结论",
        source: "llm",
        model: "test-llm",
      });

      failMode = true;
      const llmFallback = await (
        await fetch(`${server.url}/api/private-ask`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lin.sessionToken}`,
          },
          body: JSON.stringify({ question: "Fallback check", activeCardId: cardId }),
        })
      ).json();
      expect(llmFallback.source).toBe("local_context");
      expect(llmFallback.answer).toContain("Private Ask Spec");
    } finally {
      delete process.env.COAGENT_LLM_BASE_URL;
      await new Promise<void>((resolve) => mockLlm.close(() => resolve()));
    }

    expect(server.service.getEventsAfter(0).length).toBe(eventsBefore);
    expect(alexFrames).toHaveLength(0);
    wsAlex.close();
  });
});

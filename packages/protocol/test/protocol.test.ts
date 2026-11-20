import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canTransitionCard,
  checkClaimConflicts,
  checkFileAccess,
  computeCardVersionHash,
  computeInboxItems,
  globsMayOverlap,
  matchesGlob,
  MCP_TOOL_NAMES,
  MemberSchema,
  reduceRoomEvents,
  RoomClaimCardInputSchema,
  RoomEventSchema,
  RoomReportStepInputSchema,
  sha256Hex,
  TopicAnchorSchema,
  TopicSchema,
  WsClientMessageSchema,
} from "../src/index.js";

describe("sha256Hex (cross-environment pure JS)", () => {
  it("matches Node crypto sha256 exactly including UTF-8 CJK text", () => {
    const samples = ["", "hello world", "共识卡片 Card-as-Spec 版本哈希 🚀"];
    for (const sample of samples) {
      const expected = createHash("sha256").update(sample, "utf8").digest("hex");
      expect(sha256Hex(sample)).toBe(expected);
    }
  });
});

describe("Card version hash & 5-state lifecycle", () => {
  it("computes deterministic hash independent of fileGlob ordering or leading ./", () => {
    const hashA = computeCardVersionHash({
      title: "Login API",
      goal: "Add passcode auth",
      interfaceContract: "POST /api/auth",
      fileGlobs: ["./apps/server/src/auth.ts", "packages/protocol/src/types.ts"],
      acceptanceCriteria: ["Passes unit tests"],
    });
    const hashB = computeCardVersionHash({
      title: "  Login API ",
      goal: "Add passcode auth",
      interfaceContract: "POST /api/auth",
      fileGlobs: ["packages/protocol/src/types.ts", "apps/server/src/auth.ts"],
      acceptanceCriteria: ["Passes unit tests"],
    });
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^v_[0-9a-f]{16}$/);
  });

  it("changes hash when any semantic spec field changes", () => {
    const base = {
      title: "Login API",
      goal: "Add passcode auth",
      interfaceContract: "POST /api/auth",
      fileGlobs: ["apps/server/src/auth.ts"],
      acceptanceCriteria: ["Passes unit tests"],
    };
    const h1 = computeCardVersionHash(base);
    const h2 = computeCardVersionHash({ ...base, fileGlobs: ["apps/server/src/room.ts"] });
    expect(h1).not.toBe(h2);
  });

  it("enforces valid 5-state card transitions", () => {
    expect(canTransitionCard("draft", "confirmed")).toBe(true);
    expect(canTransitionCard("confirmed", "claimed")).toBe(true);
    expect(canTransitionCard("claimed", "pending_review")).toBe(true);
    expect(canTransitionCard("pending_review", "accepted")).toBe(true);
    expect(canTransitionCard("draft", "claimed")).toBe(false);
    expect(canTransitionCard("draft", "accepted")).toBe(false);
  });
});

describe("File-scope lock & conflict detection", () => {
  it("matches globs accurately with path normalization", () => {
    expect(matchesGlob("./src/api/auth.ts", "src/api/**")).toBe(true);
    expect(matchesGlob("src/api/v1/auth.ts", "src/api/**")).toBe(true);
    expect(matchesGlob("src/api/v1/auth.ts", "src/api/*.ts")).toBe(false);
    expect(matchesGlob("src\\web\\App.tsx", "src/web/**")).toBe(true);
  });

  it("detects overlapping globs and avoids false positives across sibling dirs", () => {
    expect(globsMayOverlap("src/api/**", "src/api/auth.ts")).toBe(true);
    expect(globsMayOverlap("src/api/*.ts", "src/api/auth.ts")).toBe(true);
    expect(globsMayOverlap("src/api/**", "src/api/v2/**")).toBe(true);
    expect(globsMayOverlap("src/api/**", "src/web/**")).toBe(false);
    expect(globsMayOverlap("apps/server/src/auth.ts", "apps/web/src/App.tsx")).toBe(false);
  });

  it("blocks another agent from claiming overlapping file globs but allows same agent", () => {
    const activeClaims = [
      {
        cardId: "card_1",
        agentId: "agent_codex_a",
        agentName: "Evan · Codex",
        fileGlobs: ["src/api/**"],
      },
    ];

    const conflictsOther = checkClaimConflicts(["src/api/auth.ts"], activeClaims, "agent_codex_b");
    expect(conflictsOther).toHaveLength(1);
    expect(conflictsOther[0]).toMatchObject({
      heldByCardId: "card_1",
      heldByAgentId: "agent_codex_a",
      heldByAgentName: "Evan · Codex",
    });

    const conflictsSelf = checkClaimConflicts(["src/api/auth.ts"], activeClaims, "agent_codex_a");
    expect(conflictsSelf).toHaveLength(0);

    const noConflicts = checkClaimConflicts(["src/web/Board.tsx"], activeClaims, "agent_codex_b");
    expect(noConflicts).toHaveLength(0);
  });

  it("classifies file access as allowed, conflict, or out_of_scope", () => {
    const activeClaims = [
      {
        cardId: "card_1",
        agentId: "agent_a",
        agentName: "Evan · Codex",
        fileGlobs: ["apps/server/src/**"],
      },
      {
        cardId: "card_2",
        agentId: "agent_b",
        agentName: "Alex · Codex",
        fileGlobs: ["apps/web/src/**"],
      },
    ];

    expect(checkFileAccess("apps/server/src/room.ts", "agent_a", activeClaims)).toEqual({
      status: "allowed",
      cardId: "card_1",
    });

    expect(checkFileAccess("apps/web/src/App.tsx", "agent_a", activeClaims)).toMatchObject({
      status: "conflict",
      heldByAgentId: "agent_b",
    });

    expect(checkFileAccess("README.md", "agent_a", activeClaims)).toEqual({
      status: "out_of_scope",
    });
  });
});

describe("MCP tool & Event schemas", () => {
  it("defines all 6 standard room MCP tools", () => {
    expect(MCP_TOOL_NAMES).toHaveLength(6);
  });

  it("enforces host guardrail <= 120 chars on room_report_step summary", () => {
    expect(
      RoomReportStepInputSchema.safeParse({
        cardId: "card_1",
        summary: "Implemented auth endpoint and passed 12 unit tests",
      }).success,
    ).toBe(true);

    expect(
      RoomReportStepInputSchema.safeParse({
        cardId: "card_1",
        summary: "x".repeat(121),
      }).success,
    ).toBe(false);
  });

  it("validates RoomEvent and RoomClaimCardInput schemas", () => {
    const claimRes = RoomClaimCardInputSchema.safeParse({
      cardId: "card_1",
      versionHash: "v_1234567890abcdef",
      fileGlobs: ["apps/server/src/room.ts"],
    });
    expect(claimRes.success).toBe(true);

    const eventRes = RoomEventSchema.safeParse({
      seq: 1,
      id: "evt_1",
      roomId: "room_1",
      actorId: "member_evan",
      createdAt: "2026-11-19T15:10:00.000Z",
      payload: {
        type: "card_claimed",
        cardId: "card_1",
        versionHash: "v_1234567890abcdef",
        agentId: "agent_codex_1",
        agentName: "Evan · Codex",
        fileGlobs: ["apps/server/src/room.ts"],
      },
    });
    expect(eventRes.success).toBe(true);
  });

  it("supports optional member avatar and message meta while preserving backward compatibility", () => {
    expect(
      MemberSchema.safeParse({
        id: "hum_1",
        name: "Lin",
        kind: "human",
        online: true,
      }).success,
    ).toBe(true);

    const avatar = { kind: "preset" as const, value: "sparkles" };
    expect(
      MemberSchema.safeParse({
        id: "hum_2",
        name: "Evan",
        kind: "human",
        online: true,
        avatar,
      }).success,
    ).toBe(true);

    const meta = {
      model: "Claude 4.5",
      permissionMode: "ask" as const,
      attachments: [{ name: "guard.ts", size: 1024 }],
    };

    expect(
      WsClientMessageSchema.safeParse({
        type: "post_message",
        text: "Check guard.ts",
        mentions: [],
        refCardId: "card_1",
        meta,
      }).success,
    ).toBe(true);

    expect(
      WsClientMessageSchema.safeParse({
        type: "post_message",
        text: "Legacy message without meta",
      }).success,
    ).toBe(true);

    const state = reduceRoomEvents("room_1", "Demo", [
      {
        seq: 1,
        id: "evt_1",
        roomId: "room_1",
        actorId: "hum_2",
        createdAt: "2026-11-20T12:00:00.000Z",
        payload: {
          type: "member_joined",
          member: { id: "hum_2", name: "Evan", kind: "human", online: true, avatar },
        },
      },
      {
        seq: 2,
        id: "evt_2",
        roomId: "room_1",
        actorId: "hum_2",
        createdAt: "2026-11-20T12:01:00.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_1",
          text: "Review this",
          mentions: [],
          refCardId: "card_1",
          meta,
        },
      },
    ]);

    expect(state.members.hum_2.avatar).toEqual(avatar);
    expect(state.messages[0].meta).toEqual(meta);
    expect(state.messages[0].refCardId).toBe("card_1");
  });
});

describe("Topics reducer & 4-category Inbox", () => {
  it("validates topic schemas and reduces topic_created + topic messages", () => {
    const anchor = {
      kind: "selection" as const,
      targetId: "msg_0",
      quote: "Use pure TS protocol for browser compatibility",
    };
    expect(TopicAnchorSchema.safeParse(anchor).success).toBe(true);
    expect(
      TopicSchema.safeParse({
        id: "topic_1",
        title: "Protocol boundary",
        anchor,
        createdBy: "hum_1",
        createdAt: "2026-11-20T13:00:00.000Z",
        updatedAt: "2026-11-20T13:00:00.000Z",
        messageCount: 0,
      }).success,
    ).toBe(true);

    expect(
      WsClientMessageSchema.safeParse({
        type: "create_topic",
        title: "Protocol boundary",
        anchor,
      }).success,
    ).toBe(true);

    expect(
      WsClientMessageSchema.safeParse({
        type: "post_message",
        text: "Follow up inside topic",
        topicId: "topic_1",
      }).success,
    ).toBe(true);

    const state = reduceRoomEvents("room_1", "Demo", [
      {
        seq: 1,
        id: "evt_1",
        roomId: "room_1",
        actorId: "hum_1",
        createdAt: "2026-11-20T13:00:00.000Z",
        payload: {
          type: "topic_created",
          topicId: "topic_1",
          title: "Protocol boundary",
          anchor,
        },
      },
      {
        seq: 2,
        id: "evt_2",
        roomId: "room_1",
        actorId: "hum_1",
        createdAt: "2026-11-20T13:05:00.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_1",
          text: "First topic reply",
          mentions: [],
          topicId: "topic_1",
        },
      },
      {
        seq: 3,
        id: "evt_3",
        roomId: "room_1",
        actorId: "hum_1",
        createdAt: "2026-11-20T13:06:00.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_2",
          text: "Main room message",
          mentions: [],
        },
      },
    ]);

    expect(state.topics.topic_1).toEqual({
      id: "topic_1",
      title: "Protocol boundary",
      anchor,
      createdBy: "hum_1",
      createdAt: "2026-11-20T13:00:00.000Z",
      updatedAt: "2026-11-20T13:05:00.000Z",
      messageCount: 1,
    });
    expect(state.messages[0].topicId).toBe("topic_1");
    expect(state.messages[1].topicId).toBeUndefined();
  });

  it("computes all 4 inbox categories sorted desc and auto-clears resolved items", () => {
    const specA = {
      title: "Draft Auth Card",
      goal: "Add bearer token verification",
      interfaceContract: "GET /api/inbox",
      fileGlobs: ["apps/server/src/server.ts"],
      acceptanceCriteria: ["200 OK with valid token"],
    };
    const hashA = computeCardVersionHash(specA);

    const specB = {
      title: "Review Output Card",
      goal: "Build topic reducer",
      interfaceContract: "TopicSchema",
      fileGlobs: ["packages/protocol/src/reducer.ts"],
      acceptanceCriteria: ["Unit tests pass"],
    };
    const hashB = computeCardVersionHash(specB);

    const specC = {
      title: "Agent Help Card",
      goal: "Migrate SQLite schema",
      interfaceContract: "events table",
      fileGlobs: ["apps/server/src/db.ts"],
      acceptanceCriteria: ["No data loss"],
    };
    const hashC = computeCardVersionHash(specC);

    const events: Parameters<typeof reduceRoomEvents>[2] = [
      {
        seq: 1,
        id: "e1",
        roomId: "r1",
        actorId: "hum_lin",
        createdAt: "2026-11-20T10:00:00.000Z",
        payload: {
          type: "member_joined",
          member: { id: "hum_lin", name: "Lin", kind: "human", online: true },
        },
      },
      {
        seq: 2,
        id: "e2",
        roomId: "r1",
        actorId: "hum_evan",
        createdAt: "2026-11-20T10:00:01.000Z",
        payload: {
          type: "member_joined",
          member: { id: "hum_evan", name: "Evan", kind: "human", online: true },
        },
      },
      {
        seq: 3,
        id: "e3",
        roomId: "r1",
        actorId: "agent_codex",
        createdAt: "2026-11-20T10:00:02.000Z",
        payload: {
          type: "member_joined",
          member: {
            id: "agent_codex",
            name: "Codex",
            kind: "agent",
            ownerId: "hum_evan",
            driver: "codex",
            online: true,
            status: "idle",
          },
        },
      },
      // Card A stays draft -> confirm_card for hum_lin
      {
        seq: 4,
        id: "e4",
        roomId: "r1",
        actorId: "hum_evan",
        createdAt: "2026-11-20T10:01:00.000Z",
        payload: { type: "card_created", cardId: "card_a", spec: specA, versionHash: hashA },
      },
      // Card B goes pending_review -> review_output
      {
        seq: 5,
        id: "e5",
        roomId: "r1",
        actorId: "hum_evan",
        createdAt: "2026-11-20T10:02:00.000Z",
        payload: { type: "card_created", cardId: "card_b", spec: specB, versionHash: hashB },
      },
      {
        seq: 6,
        id: "e6",
        roomId: "r1",
        actorId: "hum_lin",
        createdAt: "2026-11-20T10:02:10.000Z",
        payload: { type: "card_confirmed", cardId: "card_b", versionHash: hashB, memberId: "hum_lin" },
      },
      {
        seq: 7,
        id: "e7",
        roomId: "r1",
        actorId: "agent_codex",
        createdAt: "2026-11-20T10:02:20.000Z",
        payload: {
          type: "card_claimed",
          cardId: "card_b",
          versionHash: hashB,
          agentId: "agent_codex",
          agentName: "Codex",
          fileGlobs: specB.fileGlobs,
        },
      },
      {
        seq: 8,
        id: "e8",
        roomId: "r1",
        actorId: "agent_codex",
        createdAt: "2026-11-20T10:03:00.000Z",
        payload: {
          type: "output_submitted",
          outputId: "out_b",
          cardId: "card_b",
          cardVersionHash: hashB,
          kind: "git_diff",
          summary: "Implemented topics reducer",
        },
      },
      // Card C with waiting_human agent
      {
        seq: 9,
        id: "e9",
        roomId: "r1",
        actorId: "hum_evan",
        createdAt: "2026-11-20T10:04:00.000Z",
        payload: { type: "card_created", cardId: "card_c", spec: specC, versionHash: hashC },
      },
      {
        seq: 10,
        id: "e10",
        roomId: "r1",
        actorId: "hum_lin",
        createdAt: "2026-11-20T10:04:10.000Z",
        payload: { type: "card_confirmed", cardId: "card_c", versionHash: hashC, memberId: "hum_lin" },
      },
      {
        seq: 11,
        id: "e11",
        roomId: "r1",
        actorId: "agent_codex",
        createdAt: "2026-11-20T10:04:20.000Z",
        payload: {
          type: "card_claimed",
          cardId: "card_c",
          versionHash: hashC,
          agentId: "agent_codex",
          agentName: "Codex",
          fileGlobs: specC.fileGlobs,
        },
      },
      {
        seq: 12,
        id: "e12",
        roomId: "r1",
        actorId: "agent_codex",
        createdAt: "2026-11-20T10:05:00.000Z",
        payload: {
          type: "agent_asked_human",
          cardId: "card_c",
          agentId: "agent_codex",
          question: "Should we keep backward-compatible column defaults?",
        },
      },
      // Topic + mention by @lin (case-insensitive) + self message + unrelated @linda
      {
        seq: 13,
        id: "e13",
        roomId: "r1",
        actorId: "hum_evan",
        createdAt: "2026-11-20T10:06:00.000Z",
        payload: {
          type: "topic_created",
          topicId: "topic_1",
          title: "Auth Review",
        },
      },
      {
        seq: 14,
        id: "e14",
        roomId: "r1",
        actorId: "hum_evan",
        createdAt: "2026-11-20T10:06:10.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_mention_text",
          text: "请 @lin 看一下鉴权逻辑",
          mentions: [],
          topicId: "topic_1",
        },
      },
      {
        seq: 15,
        id: "e15",
        roomId: "r1",
        actorId: "hum_lin",
        createdAt: "2026-11-20T10:06:20.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_self",
          text: "@Lin self note",
          mentions: ["hum_lin"],
        },
      },
      {
        seq: 16,
        id: "e16",
        roomId: "r1",
        actorId: "hum_evan",
        createdAt: "2026-11-20T10:06:30.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_linda",
          text: "Hi @Linda please check",
          mentions: [],
        },
      },
    ];

    const state = reduceRoomEvents("r1", "Demo", events, 2);
    const items = computeInboxItems(state, "hum_lin");

    expect(items.map((i) => i.kind)).toEqual([
      "mention",
      "agent_help",
      "review_output",
      "confirm_card",
    ]);
    expect(items[0]).toMatchObject({
      kind: "mention",
      targetType: "message",
      targetId: "msg_mention_text",
      topicId: "topic_1",
    });
    expect(items[1]).toMatchObject({
      kind: "agent_help",
      targetType: "card",
      targetId: "card_c",
      summary: "Should we keep backward-compatible column defaults?",
    });
    expect(items[2]).toMatchObject({
      kind: "review_output",
      targetType: "card",
      targetId: "card_b",
      summary: "Implemented topics reducer",
    });
    expect(items[3]).toMatchObject({
      kind: "confirm_card",
      targetType: "card",
      targetId: "card_a",
    });

    // Dismissing mention hides it
    const afterDismiss = computeInboxItems(state, "hum_lin", new Set(["msg_mention_text"]));
    expect(afterDismiss.map((i) => i.kind)).toEqual([
      "agent_help",
      "review_output",
      "confirm_card",
    ]);

    // Resolving card_a confirmation, card_b review, and agent work step auto-clears them
    const resolvedState = reduceRoomEvents("r1", "Demo", [
      ...events,
      {
        seq: 17,
        id: "e17",
        roomId: "r1",
        actorId: "hum_lin",
        createdAt: "2026-11-20T10:07:00.000Z",
        payload: {
          type: "card_confirmed",
          cardId: "card_a",
          versionHash: hashA,
          memberId: "hum_lin",
        },
      },
      {
        seq: 18,
        id: "e18",
        roomId: "r1",
        actorId: "hum_lin",
        createdAt: "2026-11-20T10:08:00.000Z",
        payload: {
          type: "card_reviewed",
          cardId: "card_b",
          outputId: "out_b",
          decision: "accepted",
        },
      },
      {
        seq: 19,
        id: "e19",
        roomId: "r1",
        actorId: "agent_codex",
        createdAt: "2026-11-20T10:09:00.000Z",
        payload: {
          type: "work_step_reported",
          stepId: "step_2",
          cardId: "card_c",
          agentId: "agent_codex",
          summary: "Resumed migration after confirmation",
        },
      },
    ], 2);

    expect(computeInboxItems(resolvedState, "hum_lin", new Set(["msg_mention_text"]))).toEqual([]);
  });
});

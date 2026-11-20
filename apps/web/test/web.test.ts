import { describe, expect, it } from "vitest";
import {
  CardSpecSchema,
  computeCardVersionHash,
  computeInboxItems,
  reduceRoomEvents,
  RoomEvent,
} from "@coagent/protocol";
import {
  ActiveChannel,
  isSameChannel,
  partitionAgents,
} from "../src/utils/channels.js";
import {
  buildCardNumberMap,
  formatFileSize,
  getInitials,
  shouldGroupMessages,
} from "../src/utils/chat.js";
import { classifyDiffLine, parseDiff } from "../src/utils/diff.js";
import {
  buildDraftSpecFromText,
  buildTopicTitleFromText,
  getDismissedMentionsStorageKey,
  loadDismissedMentions,
  saveDismissedMentions,
} from "../src/utils/inbox.js";
import {
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_CARD_LIST_WIDTH,
  DEFAULT_CHAT_WIDTH,
  DEFAULT_LAYOUT,
  DEFAULT_SIDEBAR_WIDTH,
  LAYOUT_STORAGE_KEY,
  MAX_CARD_LIST_WIDTH,
  MAX_COMPOSER_HEIGHT,
  MAX_SIDEBAR_WIDTH,
  MIN_CARD_LIST_WIDTH,
  MIN_CHAT_WIDTH,
  MIN_COMPOSER_HEIGHT,
  MIN_SIDEBAR_WIDTH,
  clampCardListWidth,
  clampChatWidth,
  clampComposerHeight,
  clampSidebarWidth,
  loadLayout,
  sanitizeLayout,
  saveLayout,
} from "../src/utils/layout.js";

describe("apps/web helpers & shared event projection", () => {
  it("classifies git diff lines accurately", () => {
    expect(classifyDiffLine("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(classifyDiffLine("+const x = 1;")).toBe("add");
    expect(classifyDiffLine("+++ b/src/a.ts")).toBe("ctx");
    expect(classifyDiffLine("-const old = 0;")).toBe("del");
    expect(classifyDiffLine("--- a/src/a.ts")).toBe("ctx");
    expect(classifyDiffLine(" unchanged")).toBe("ctx");
  });

  it("projects card lifecycle and emergency stop identically to server", () => {
    const spec = {
      title: "Frontend Board",
      goal: "Render diff review",
      interfaceContract: "",
      fileGlobs: ["apps/web/src/**"],
      acceptanceCriteria: ["Highlights + and - lines"],
    };
    const versionHash = computeCardVersionHash(spec);
    const events: RoomEvent[] = [
      {
        seq: 1,
        id: "e1",
        roomId: "r1",
        actorId: "hum_1",
        createdAt: "2026-11-19T15:00:00.000Z",
        payload: { type: "card_created", cardId: "c1", spec, versionHash },
      },
      {
        seq: 2,
        id: "e2",
        roomId: "r1",
        actorId: "hum_1",
        createdAt: "2026-11-19T15:00:01.000Z",
        payload: { type: "card_confirmed", cardId: "c1", versionHash, memberId: "hum_1" },
      },
    ];
    const state = reduceRoomEvents("r1", "Test", events, 1);
    expect(state.cards.c1.status).toBe("confirmed");
    expect(state.lastSeq).toBe(2);
  });
});

describe("apps/web layout helpers & persistence", () => {
  it("clamps chat pane width across normal and narrow containers", () => {
    expect(clampChatWidth(420, 1200)).toBe(420);
    expect(clampChatWidth(120, 1200)).toBe(MIN_CHAT_WIDTH);
    expect(clampChatWidth(1000, 1200)).toBe(840);
    expect(clampChatWidth(380, 500)).toBe(200);
    expect(clampChatWidth(Number.NaN, 1200)).toBe(DEFAULT_CHAT_WIDTH);
    expect(clampChatWidth(Number.NaN)).toBe(DEFAULT_CHAT_WIDTH);
  });

  it("clamps card list sidebar width across normal and narrow boards", () => {
    expect(clampCardListWidth(320, 900)).toBe(320);
    expect(clampCardListWidth(100, 900)).toBe(MIN_CARD_LIST_WIDTH);
    expect(clampCardListWidth(700, 900)).toBe(MAX_CARD_LIST_WIDTH);
    expect(clampCardListWidth(400, 420)).toBe(147);
    expect(clampCardListWidth(Number.NaN, 900)).toBe(DEFAULT_CARD_LIST_WIDTH);
  });

  it("clamps composer height against min and 60% pane height cap", () => {
    expect(clampComposerHeight(160, 600)).toBe(160);
    expect(clampComposerHeight(10, 600)).toBe(MIN_COMPOSER_HEIGHT);
    expect(clampComposerHeight(450, 500)).toBe(300);
    expect(clampComposerHeight(999)).toBe(MAX_COMPOSER_HEIGHT);
    expect(clampComposerHeight(Number.NaN, 600)).toBe(MIN_COMPOSER_HEIGHT);
  });

  it("clamps sidebar width across normal and narrow containers", () => {
    expect(COLLAPSED_SIDEBAR_WIDTH).toBe(48);
    expect(clampSidebarWidth(228, 1200)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(100, 1200)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(500, 1200)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(300, 500)).toBe(240);
    expect(clampSidebarWidth(300, 400)).toBe(140);
    expect(clampSidebarWidth(Number.NaN, 1200)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("sanitizes invalid layout payloads and preserves valid values", () => {
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout("bad")).toEqual(DEFAULT_LAYOUT);

    // Backward-compatible migration for legacy payloads without sidebarWidth/sidebarCollapsed
    expect(
      sanitizeLayout({
        viewMode: "split",
        chatWidth: 420,
        cardListWidth: 260,
        cardListCollapsed: true,
        composerHeight: null,
      }),
    ).toEqual({
      viewMode: "split",
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarCollapsed: false,
      chatWidth: 420,
      cardListWidth: 260,
      cardListCollapsed: true,
      composerHeight: null,
    });

    expect(
      sanitizeLayout({
        viewMode: "unknown",
        sidebarWidth: 50,
        sidebarCollapsed: "nope",
        chatWidth: 50,
        cardListWidth: 9999,
        cardListCollapsed: "yes",
        composerHeight: 9999,
      }),
    ).toEqual({
      viewMode: "split",
      sidebarWidth: MIN_SIDEBAR_WIDTH,
      sidebarCollapsed: false,
      chatWidth: MIN_CHAT_WIDTH,
      cardListWidth: MAX_CARD_LIST_WIDTH,
      cardListCollapsed: DEFAULT_LAYOUT.cardListCollapsed,
      composerHeight: MAX_COMPOSER_HEIGHT,
    });

    expect(
      sanitizeLayout({
        viewMode: "chat",
        sidebarWidth: 260,
        sidebarCollapsed: true,
        chatWidth: 450,
        cardListWidth: 260,
        cardListCollapsed: true,
        composerHeight: null,
      }),
    ).toEqual({
      viewMode: "chat",
      sidebarWidth: 260,
      sidebarCollapsed: true,
      chatWidth: 450,
      cardListWidth: 260,
      cardListCollapsed: true,
      composerHeight: null,
    });
  });

  it("loads and saves layout via Storage safely", () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
    };

    expect(loadLayout(mockStorage)).toEqual(DEFAULT_LAYOUT);

    store.set(LAYOUT_STORAGE_KEY, "{broken json");
    expect(loadLayout(mockStorage)).toEqual(DEFAULT_LAYOUT);

    const next = {
      viewMode: "board" as const,
      sidebarWidth: 256,
      sidebarCollapsed: true,
      chatWidth: 410,
      cardListWidth: 240,
      cardListCollapsed: true,
      composerHeight: 180,
    };
    saveLayout(next, mockStorage);
    expect(loadLayout(mockStorage)).toEqual(next);
  });
});

describe("apps/web v0.2 diff parser & chat grouping helpers", () => {
  it("parses unified diff filename, counts, and hunk line numbers", () => {
    const raw = [
      "diff --git a/src/auth/guard.ts b/src/auth/guard.ts",
      "--- a/src/auth/guard.ts",
      "+++ b/src/auth/guard.ts",
      "@@ -20,3 +20,4 @@ export function guard(req: Request) {",
      " export function guard(req: Request) {",
      "-  return checkLegacySession(req);",
      "+  const jwt = parseBearer(req);",
      "+  return verifyJwt(jwt) ?? checkSession(req);",
      " }",
    ].join("\n");

    const parsed = parseDiff(raw);
    expect(parsed.fileName).toBe("src/auth/guard.ts");
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(1);
    expect(parsed.lines[0]).toMatchObject({ kind: "hunk", oldLine: null, newLine: null });
    expect(parsed.lines[1]).toMatchObject({ kind: "ctx", oldLine: 20, newLine: 20 });
    expect(parsed.lines[2]).toMatchObject({ kind: "del", oldLine: 21, newLine: null });
    expect(parsed.lines[3]).toMatchObject({ kind: "add", oldLine: null, newLine: 21 });
    expect(parsed.lines[4]).toMatchObject({ kind: "add", oldLine: null, newLine: 22 });
    expect(parsed.lines[5]).toMatchObject({ kind: "ctx", oldLine: 22, newLine: 23 });
  });

  it("groups consecutive messages within 2 minutes from the same actor only", () => {
    const base = { actorId: "hum_1", createdAt: "2026-11-20T12:00:00.000Z" };
    expect(shouldGroupMessages(null, base)).toBe(false);
    expect(shouldGroupMessages(base, { actorId: "hum_1", createdAt: "2026-11-20T12:01:59.000Z" })).toBe(
      true,
    );
    expect(shouldGroupMessages(base, { actorId: "hum_1", createdAt: "2026-11-20T12:02:01.000Z" })).toBe(
      false,
    );
    expect(shouldGroupMessages(base, { actorId: "hum_2", createdAt: "2026-11-20T12:00:30.000Z" })).toBe(
      false,
    );
  });

  it("builds deterministic card numbers and formats file sizes & initials", () => {
    const spec = {
      title: "Card A",
      goal: "Goal",
      interfaceContract: "",
      fileGlobs: ["src/**"],
      acceptanceCriteria: [],
    };
    const events: RoomEvent[] = [
      {
        seq: 1,
        id: "e1",
        roomId: "r1",
        actorId: "hum_1",
        createdAt: "2026-11-20T12:00:00.000Z",
        payload: { type: "card_created", cardId: "c1", spec, versionHash: "v_1" },
      },
      {
        seq: 2,
        id: "e2",
        roomId: "r1",
        actorId: "hum_1",
        createdAt: "2026-11-20T12:01:00.000Z",
        payload: { type: "card_created", cardId: "c2", spec, versionHash: "v_2" },
      },
    ];
    const map = buildCardNumberMap(events, {});
    expect(map).toEqual({ c1: "#01", c2: "#02" });

    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");

    expect(getInitials("Evan Huang")).toBe("EH");
    expect(getInitials("Lin")).toBe("LI");
    expect(getInitials("小明")).toBe("小");
  });
});

describe("apps/web v0.2 inbox persistence & draft spec conversion", () => {
  it("loads and saves dismissed mention IDs scoped by room and member", () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
    };

    expect(loadDismissedMentions("room_1", "mem_1", mockStorage).size).toBe(0);
    expect(loadDismissedMentions("", "mem_1", mockStorage).size).toBe(0);
    expect(loadDismissedMentions("room_1", "mem_1", null).size).toBe(0);

    store.set(getDismissedMentionsStorageKey("room_1", "mem_1"), "{broken json");
    expect(loadDismissedMentions("room_1", "mem_1", mockStorage).size).toBe(0);

    store.set(getDismissedMentionsStorageKey("room_1", "mem_1"), JSON.stringify({ bad: true }));
    expect(loadDismissedMentions("room_1", "mem_1", mockStorage).size).toBe(0);

    saveDismissedMentions("room_1", "mem_1", ["msg_1", "msg_2", "msg_1", ""], mockStorage);
    const loaded = loadDismissedMentions("room_1", "mem_1", mockStorage);
    expect(Array.from(loaded)).toEqual(["msg_1", "msg_2"]);

    // Isolated across rooms and members
    expect(loadDismissedMentions("room_2", "mem_1", mockStorage).size).toBe(0);
    expect(loadDismissedMentions("room_1", "mem_2", mockStorage).size).toBe(0);

    // Works seamlessly with protocol computeInboxItems
    const events: RoomEvent[] = [
      {
        seq: 1,
        id: "e1",
        roomId: "room_1",
        actorId: "mem_1",
        createdAt: "2026-11-20T12:00:00.000Z",
        payload: {
          type: "member_joined",
          member: { id: "mem_1", name: "Evan", kind: "human", online: true },
        },
      },
      {
        seq: 2,
        id: "e2",
        roomId: "room_1",
        actorId: "mem_2",
        createdAt: "2026-11-20T12:00:01.000Z",
        payload: {
          type: "member_joined",
          member: { id: "mem_2", name: "Alice", kind: "human", online: true },
        },
      },
      {
        seq: 3,
        id: "e3",
        roomId: "room_1",
        actorId: "mem_2",
        createdAt: "2026-11-20T12:00:02.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_1",
          text: "@Evan 请确认协议字段",
          mentions: ["mem_1"],
        },
      },
      {
        seq: 4,
        id: "e4",
        roomId: "room_1",
        actorId: "mem_2",
        createdAt: "2026-11-20T12:00:03.000Z",
        payload: {
          type: "message_posted",
          messageId: "msg_3",
          text: "@Evan 还有一条新提醒",
          mentions: ["mem_1"],
        },
      },
    ];
    const state = reduceRoomEvents("room_1", "Demo", events, 1);
    const items = computeInboxItems(state, "mem_1", loaded);
    expect(items.map((item) => item.targetId)).toEqual(["msg_3"]);
  });

  it("converts selected text and private Q&A into valid Partial<CardSpec> drafts", () => {
    const fromMarkdown = buildDraftSpecFromText(
      [
        "## 实现 Inbox 聚合与跳转",
        "修改 apps/web/src/components/topbar/InboxPopover.tsx 与 packages/protocol/src/inbox.ts",
        "- [ ] 支持 5 个过滤标签与清空 @ 提醒",
        "验收：pnpm verify 全绿",
      ].join("\n"),
      "私密问答",
    );

    expect(fromMarkdown.title).toBe("实现 Inbox 聚合与跳转");
    expect(fromMarkdown.goal).toContain("修改 apps/web/src/components/topbar/InboxPopover.tsx");
    expect(fromMarkdown.goal).toContain("来源：私密问答");
    expect(fromMarkdown.fileGlobs).toEqual([
      "apps/web/src/components/topbar/InboxPopover.tsx",
      "packages/protocol/src/inbox.ts",
    ]);
    expect(fromMarkdown.acceptanceCriteria).toEqual([
      "支持 5 个过滤标签与清空 @ 提醒",
      "pnpm verify 全绿",
    ]);
    expect(CardSpecSchema.safeParse(fromMarkdown).success).toBe(true);

    const longText = "非常长的讨论文本 ".repeat(30);
    const fromLong = buildDraftSpecFromText(longText);
    expect(fromLong.title && fromLong.title.length <= 120).toBe(true);
    expect(fromLong.fileGlobs).toEqual(["src/**"]);
    expect(CardSpecSchema.safeParse(fromLong).success).toBe(true);

    const fromEmpty = buildDraftSpecFromText("   \n  ", "选中片段");
    expect(CardSpecSchema.safeParse(fromEmpty).success).toBe(true);

    expect(buildTopicTitleFromText("- #02 话题线程与私密助手联调\n更多细节")).toBe(
      "#02 话题线程与私密助手联调",
    );
  });
});

describe("apps/web v0.2.1 sidebar channels & agent partitioning", () => {
  it("compares ActiveChannel values accurately across all kinds", () => {
    const channels: ActiveChannel[] = [
      { kind: "room" },
      { kind: "topic", topicId: "t1" },
      { kind: "topic", topicId: "t2" },
      { kind: "private_bot" },
      { kind: "agent", agentId: "ag_1" },
      { kind: "agent", agentId: "ag_2" },
    ];

    expect(isSameChannel(channels[0], { kind: "room" })).toBe(true);
    expect(isSameChannel(channels[1], { kind: "topic", topicId: "t1" })).toBe(true);
    expect(isSameChannel(channels[1], channels[2])).toBe(false);
    expect(isSameChannel(channels[3], { kind: "private_bot" })).toBe(true);
    expect(isSameChannel(channels[4], { kind: "agent", agentId: "ag_1" })).toBe(true);
    expect(isSameChannel(channels[4], channels[5])).toBe(false);
    expect(isSameChannel(channels[0], channels[3])).toBe(false);
    expect(isSameChannel(channels[1], channels[4])).toBe(false);
  });

  it("partitions agents into myAgents (owned or unowned) and otherAgents", () => {
    const members = {
      hum_me: { id: "hum_me", name: "Evan", kind: "human" as const, online: true },
      hum_other: { id: "hum_other", name: "Lin", kind: "human" as const, online: true },
      ag_mine: {
        id: "ag_mine",
        name: "Codex-Mine",
        kind: "agent" as const,
        ownerId: "hum_me",
        driver: "codex" as const,
        online: true,
        status: "working" as const,
      },
      ag_legacy: {
        id: "ag_legacy",
        name: "Agent-Legacy",
        kind: "agent" as const,
        driver: "claude-code" as const,
        online: false,
        status: "idle" as const,
      },
      ag_theirs: {
        id: "ag_theirs",
        name: "Lin-Codex",
        kind: "agent" as const,
        ownerId: "hum_other",
        driver: "codex" as const,
        online: true,
        status: "idle" as const,
      },
    };

    const { myAgents, otherAgents } = partitionAgents(members, "hum_me");
    expect(myAgents.map((a) => a.id)).toEqual(["ag_mine", "ag_legacy"]);
    expect(otherAgents.map((a) => a.id)).toEqual(["ag_theirs"]);
  });
});

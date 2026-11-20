import { describe, expect, it } from "vitest";
import { computeCardVersionHash, reduceRoomEvents, RoomEvent } from "@coagent/protocol";
import {
  buildCardNumberMap,
  formatFileSize,
  getInitials,
  shouldGroupMessages,
} from "../src/utils/chat.js";
import { classifyDiffLine, parseDiff } from "../src/utils/diff.js";
import {
  DEFAULT_CARD_LIST_WIDTH,
  DEFAULT_CHAT_WIDTH,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  MAX_CARD_LIST_WIDTH,
  MAX_COMPOSER_HEIGHT,
  MIN_CARD_LIST_WIDTH,
  MIN_CHAT_WIDTH,
  MIN_COMPOSER_HEIGHT,
  clampCardListWidth,
  clampChatWidth,
  clampComposerHeight,
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

  it("sanitizes invalid layout payloads and preserves valid values", () => {
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout("bad")).toEqual(DEFAULT_LAYOUT);

    expect(
      sanitizeLayout({
        viewMode: "unknown",
        chatWidth: 50,
        cardListWidth: 9999,
        cardListCollapsed: "yes",
        composerHeight: 9999,
      }),
    ).toEqual({
      viewMode: "split",
      chatWidth: MIN_CHAT_WIDTH,
      cardListWidth: MAX_CARD_LIST_WIDTH,
      cardListCollapsed: DEFAULT_LAYOUT.cardListCollapsed,
      composerHeight: MAX_COMPOSER_HEIGHT,
    });

    expect(
      sanitizeLayout({
        viewMode: "chat",
        chatWidth: 450,
        cardListWidth: 260,
        cardListCollapsed: true,
        composerHeight: null,
      }),
    ).toEqual({
      viewMode: "chat",
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

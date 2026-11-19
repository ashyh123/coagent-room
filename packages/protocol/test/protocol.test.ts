import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canTransitionCard,
  checkClaimConflicts,
  checkFileAccess,
  computeCardVersionHash,
  globsMayOverlap,
  matchesGlob,
  MCP_TOOL_NAMES,
  RoomClaimCardInputSchema,
  RoomEventSchema,
  RoomReportStepInputSchema,
  sha256Hex,
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
});

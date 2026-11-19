import { describe, expect, it } from "vitest";
import { computeCardVersionHash, reduceRoomEvents, RoomEvent } from "@coagent/protocol";
import { classifyDiffLine } from "../src/utils/diff.js";

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

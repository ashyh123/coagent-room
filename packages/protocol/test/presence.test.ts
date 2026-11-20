import { describe, expect, it } from "vitest";
import { reduceRoomEvents, RoomEvent, RoomEventSchema } from "../src/index.js";

function evt(seq: number, payload: RoomEvent["payload"]): RoomEvent {
  return {
    seq,
    id: `e${seq}`,
    roomId: "r1",
    actorId: "hum_lin",
    createdAt: `2026-11-21T10:00:0${seq}.000Z`,
    payload,
  };
}

describe("member presence", () => {
  it("member_online brings an offline member back online without touching other fields", () => {
    const events = [
      evt(1, {
        type: "member_joined",
        member: { id: "hum_lin", name: "Lin", kind: "human", online: true },
      }),
      evt(2, { type: "member_left", memberId: "hum_lin" }),
      evt(3, { type: "member_online", memberId: "hum_lin" }),
    ];
    for (const e of events) expect(RoomEventSchema.parse(e)).toEqual(e);

    const afterLeft = reduceRoomEvents("r1", "Demo", events.slice(0, 2));
    expect(afterLeft.members.hum_lin.online).toBe(false);

    const state = reduceRoomEvents("r1", "Demo", events);
    expect(state.members.hum_lin).toEqual({
      id: "hum_lin",
      name: "Lin",
      kind: "human",
      online: true,
    });
  });

  it("member_online does not clear an emergency stop on an agent", () => {
    const state = reduceRoomEvents("r1", "Demo", [
      evt(1, {
        type: "member_joined",
        member: { id: "agt_a", name: "Codex", kind: "agent", online: true, status: "idle" },
      }),
      evt(2, { type: "agent_stopped", agentId: "agt_a", stoppedBy: "hum_lin", reason: "test" }),
      evt(3, { type: "member_left", memberId: "agt_a" }),
      evt(4, { type: "member_online", memberId: "agt_a" }),
    ]);
    expect(state.members.agt_a.online).toBe(true);
    expect(state.stoppedAgentIds).toContain("agt_a");
  });

  it("member_online for an unknown member is a no-op", () => {
    const state = reduceRoomEvents("r1", "Demo", [evt(1, { type: "member_online", memberId: "ghost" })]);
    expect(state.members.ghost).toBeUndefined();
  });
});

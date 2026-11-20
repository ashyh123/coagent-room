import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRoomServer, RunningRoomServer } from "../src/index.js";

async function join(server: RunningRoomServer, nickname: string) {
  const res = await fetch(`${server.url}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode: "pres42", nickname }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { memberId: string; sessionToken: string };
}

async function connect(server: RunningRoomServer, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws?token=${token}`);
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  return ws;
}

async function disconnect(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
    ws.close();
  });
  // Let the server process the close event.
  await new Promise((r) => setTimeout(r, 30));
}

describe("member presence and rejoin", () => {
  const servers: RunningRoomServer[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop()!.close();
  });

  async function start() {
    const server = await createRoomServer({
      port: 0,
      dbPath: ":memory:",
      roomName: "Presence Room",
      passcode: "pres42",
    });
    servers.push(server);
    return server;
  }

  it("marks a member online again when its session reconnects", async () => {
    const server = await start();
    const lin = await join(server, "Lin");
    const ws1 = await connect(server, lin.sessionToken);
    await disconnect(ws1);
    expect(server.service.getState().members[lin.memberId].online).toBe(false);

    const ws2 = await connect(server, lin.sessionToken);
    await new Promise((r) => setTimeout(r, 30));
    expect(server.service.getState().members[lin.memberId].online).toBe(true);
    ws2.close();
  });

  it("reuses an offline member with the same name instead of creating a duplicate", async () => {
    const server = await start();
    const first = await join(server, "Evan");
    const ws = await connect(server, first.sessionToken);
    await disconnect(ws);

    const again = await join(server, " evan ");
    expect(again.memberId).toBe(first.memberId);
    expect(again.sessionToken).not.toBe(first.sessionToken);

    const members = Object.values(server.service.getState().members);
    expect(members.filter((m) => m.name.trim().toLowerCase() === "evan")).toHaveLength(1);
    expect(server.service.getState().members[first.memberId].online).toBe(true);
  });

  it("creates a separate member when the same name is still online", async () => {
    const server = await start();
    const first = await join(server, "Evan");
    const ws = await connect(server, first.sessionToken);

    const second = await join(server, "Evan");
    expect(second.memberId).not.toBe(first.memberId);
    ws.close();
  });
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoomServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultWebDist = path.resolve(__dirname, "../../web/dist");

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const dbPath = process.env.DB_PATH ?? "./coagent-room.sqlite";
const roomName = process.env.ROOM_NAME ?? "coagent-room";
const passcode = process.env.ROOM_PASSCODE;

const running = await createRoomServer({
  port,
  host,
  dbPath,
  roomName,
  passcode,
  webDistDir: defaultWebDist,
});

console.log(`coagent-room host listening on ${running.url}`);
console.log(`Room: ${running.service.room.name} (${running.service.room.id})`);
console.log(`Passcode: ${running.service.room.passcode}`);

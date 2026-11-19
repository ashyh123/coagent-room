import { DatabaseSync } from "node:sqlite";
import { EventPayload, RoomEvent, RoomEventSchema } from "@coagent/protocol";

export interface RoomRecord {
  id: string;
  name: string;
  passcode: string;
  minConfirmations: number;
  createdAt: string;
}

export interface SessionRecord {
  token: string;
  roomId: string;
  memberId: string;
  kind: "human" | "agent";
  createdAt: string;
}

export interface AgentInviteRecord {
  token: string;
  roomId: string;
  ownerId: string;
  expiresAt: string;
  used: boolean;
}

export class RoomDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        passcode TEXT NOT NULL,
        min_confirmations INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_room_seq ON events(room_id, seq);

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_invites (
        token TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  getOrCreateRoom(defaults: RoomRecord): RoomRecord {
    const existing = this.db
      .prepare("SELECT id, name, passcode, min_confirmations, created_at FROM rooms LIMIT 1")
      .get() as
      | {
          id: string;
          name: string;
          passcode: string;
          min_confirmations: number;
          created_at: string;
        }
      | undefined;

    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        passcode: existing.passcode,
        minConfirmations: existing.min_confirmations,
        createdAt: existing.created_at,
      };
    }

    this.db
      .prepare(
        "INSERT INTO rooms (id, name, passcode, min_confirmations, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        defaults.id,
        defaults.name,
        defaults.passcode,
        defaults.minConfirmations,
        defaults.createdAt,
      );

    return defaults;
  }

  appendEvent(roomId: string, id: string, actorId: string, createdAt: string, payload: EventPayload): RoomEvent {
    const stmt = this.db.prepare(
      "INSERT INTO events (id, room_id, actor_id, created_at, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    const res = stmt.run(id, roomId, actorId, createdAt, JSON.stringify(payload));
    const seq = Number(res.lastInsertRowid);
    return RoomEventSchema.parse({
      seq,
      id,
      roomId,
      actorId,
      createdAt,
      payload,
    });
  }

  listEventsAfter(roomId: string, afterSeq = 0): RoomEvent[] {
    const rows = this.db
      .prepare(
        "SELECT seq, id, room_id, actor_id, created_at, payload_json FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC",
      )
      .all(roomId, afterSeq) as Array<{
      seq: number;
      id: string;
      room_id: string;
      actor_id: string;
      created_at: string;
      payload_json: string;
    }>;

    return rows.map((row) =>
      RoomEventSchema.parse({
        seq: row.seq,
        id: row.id,
        roomId: row.room_id,
        actorId: row.actor_id,
        createdAt: row.created_at,
        payload: JSON.parse(row.payload_json),
      }),
    );
  }

  saveSession(session: SessionRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO sessions (token, room_id, member_id, kind, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(session.token, session.roomId, session.memberId, session.kind, session.createdAt);
  }

  getSession(token: string): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT token, room_id, member_id, kind, created_at FROM sessions WHERE token = ?")
      .get(token) as
      | {
          token: string;
          room_id: string;
          member_id: string;
          kind: "human" | "agent";
          created_at: string;
        }
      | undefined;

    if (!row) return undefined;
    return {
      token: row.token,
      roomId: row.room_id,
      memberId: row.member_id,
      kind: row.kind,
      createdAt: row.created_at,
    };
  }

  saveAgentInvite(invite: AgentInviteRecord): void {
    this.db
      .prepare(
        "INSERT INTO agent_invites (token, room_id, owner_id, expires_at, used) VALUES (?, ?, ?, ?, ?)",
      )
      .run(invite.token, invite.roomId, invite.ownerId, invite.expiresAt, invite.used ? 1 : 0);
  }

  consumeAgentInvite(token: string): AgentInviteRecord | undefined {
    const row = this.db
      .prepare("SELECT token, room_id, owner_id, expires_at, used FROM agent_invites WHERE token = ?")
      .get(token) as
      | {
          token: string;
          room_id: string;
          owner_id: string;
          expires_at: string;
          used: number;
        }
      | undefined;

    if (!row || row.used !== 0) return undefined;
    if (Date.parse(row.expires_at) < Date.now()) return undefined;

    this.db.prepare("UPDATE agent_invites SET used = 1 WHERE token = ?").run(token);
    return {
      token: row.token,
      roomId: row.room_id,
      ownerId: row.owner_id,
      expiresAt: row.expires_at,
      used: true,
    };
  }

  close(): void {
    this.db.close();
  }
}

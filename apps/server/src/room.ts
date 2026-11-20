import crypto from "node:crypto";
import {
  applyRoomEvent,
  CardSpec,
  CardSpecSchema,
  checkClaimConflicts,
  checkFileAccess,
  computeCardVersionHash,
  EventPayload,
  getActiveClaims,
  MemberAvatar,
  MessageMeta,
  OutputKind,
  reduceRoomEvents,
  RoomEvent,
  RoomState,
} from "@coagent/protocol";
import { RoomDatabase, RoomRecord, SessionRecord } from "./db.js";

export interface RoomServiceOptions {
  dbPath: string;
  roomName?: string;
  passcode?: string;
  minConfirmations?: number;
}

export interface AgentKillSignal {
  agentId: string;
  stoppedBy: string;
  reason?: string;
}

function randomId(prefix: string, bytes = 6): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString("hex")}`;
}

export class RoomService {
  readonly db: RoomDatabase;
  readonly room: RoomRecord;
  private state: RoomState;
  private readonly eventListeners = new Set<(event: RoomEvent) => void>();
  private readonly killListeners = new Set<(signal: AgentKillSignal) => void>();

  constructor(options: RoomServiceOptions) {
    this.db = new RoomDatabase(options.dbPath);
    this.room = this.db.getOrCreateRoom({
      id: randomId("room", 4),
      name: options.roomName?.trim() || "coagent-room",
      passcode: options.passcode?.trim() || crypto.randomBytes(3).toString("hex"),
      minConfirmations: options.minConfirmations ?? 1,
      createdAt: new Date().toISOString(),
    });
    const history = this.db.listEventsAfter(this.room.id, 0);
    this.state = reduceRoomEvents(
      this.room.id,
      this.room.name,
      history,
      this.room.minConfirmations,
    );
  }

  onEvent(fn: (event: RoomEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onAgentKill(fn: (signal: AgentKillSignal) => void): () => void {
    this.killListeners.add(fn);
    return () => this.killListeners.delete(fn);
  }

  getState(): RoomState {
    return this.state;
  }

  getEventsAfter(afterSeq = 0): RoomEvent[] {
    return this.db.listEventsAfter(this.room.id, afterSeq);
  }

  getSession(token: string): SessionRecord | undefined {
    return this.db.getSession(token);
  }

  private emit(actorId: string, payload: EventPayload): RoomEvent {
    const event = this.db.appendEvent(
      this.room.id,
      randomId("evt", 8),
      actorId,
      new Date().toISOString(),
      payload,
    );
    this.state = applyRoomEvent(this.state, event);
    for (const listener of this.eventListeners) {
      listener(event);
    }
    return event;
  }

  joinHuman(
    passcode: string,
    nickname: string,
    avatar?: MemberAvatar,
  ): { memberId: string; sessionToken: string } {
    if (passcode.trim() !== this.room.passcode) {
      throw new RoomError("INVALID_PASSCODE", "Invalid room passcode", 401);
    }
    const cleanName = nickname.trim();
    if (!cleanName || cleanName.length > 64) {
      throw new RoomError("INVALID_NAME", "Nickname must be 1-64 characters", 400);
    }

    const memberId = randomId("hum", 5);
    const sessionToken = randomId("sess", 16);
    this.db.saveSession({
      token: sessionToken,
      roomId: this.room.id,
      memberId,
      kind: "human",
      createdAt: new Date().toISOString(),
    });

    this.emit(memberId, {
      type: "member_joined",
      member: {
        id: memberId,
        name: cleanName,
        kind: "human",
        online: true,
        ...(avatar ? { avatar } : {}),
      },
    });

    return { memberId, sessionToken };
  }

  createAgentInvite(ownerId: string): { inviteToken: string; expiresAt: string } {
    const owner = this.state.members[ownerId];
    if (!owner || owner.kind !== "human") {
      throw new RoomError("FORBIDDEN", "Only human room members can invite agents", 403);
    }
    const inviteToken = randomId("inv", 12);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    this.db.saveAgentInvite({
      token: inviteToken,
      roomId: this.room.id,
      ownerId,
      expiresAt,
      used: false,
    });
    return { inviteToken, expiresAt };
  }

  registerAgent(
    inviteToken: string,
    agentName: string,
    driver: "codex" | "claude-code" | "pi" | "mcp-only",
  ): { agentId: string; agentSessionToken: string; ownerId: string } {
    const invite = this.db.consumeAgentInvite(inviteToken);
    if (!invite) {
      throw new RoomError("INVALID_INVITE", "Agent invite token is invalid, used, or expired", 401);
    }
    const cleanName = agentName.trim() || `Agent (${driver})`;
    const agentId = randomId("agt", 5);
    const agentSessionToken = randomId("agtsess", 16);

    this.db.saveSession({
      token: agentSessionToken,
      roomId: this.room.id,
      memberId: agentId,
      kind: "agent",
      createdAt: new Date().toISOString(),
    });

    this.emit(agentId, {
      type: "member_joined",
      member: {
        id: agentId,
        name: cleanName,
        kind: "agent",
        ownerId: invite.ownerId,
        driver,
        online: true,
        status: "idle",
      },
    });

    return { agentId, agentSessionToken, ownerId: invite.ownerId };
  }

  markMemberOffline(memberId: string): void {
    const m = this.state.members[memberId];
    if (m && m.online) {
      this.emit(memberId, { type: "member_left", memberId });
    }
  }

  postMessage(
    actorId: string,
    text: string,
    mentions: string[] = [],
    refCardId?: string,
    meta?: MessageMeta,
  ): RoomEvent {
    const member = this.state.members[actorId];
    if (!member) {
      throw new RoomError("UNAUTHORIZED", "Unknown room member", 401);
    }
    if (member.kind === "agent" && this.state.stoppedAgentIds.includes(actorId)) {
      throw new RoomError("AGENT_STOPPED", "Agent has been emergency-stopped by a collaborator", 403);
    }
    const trimmed = text.trim();
    if (!trimmed) {
      throw new RoomError("INVALID_MESSAGE", "Message cannot be empty", 400);
    }
    return this.emit(actorId, {
      type: "message_posted",
      messageId: randomId("msg", 6),
      text: trimmed,
      mentions,
      refCardId,
      ...(meta ? { meta } : {}),
    });
  }

  createCard(actorId: string, rawSpec: CardSpec): RoomEvent {
    const spec = CardSpecSchema.parse(rawSpec);
    const versionHash = computeCardVersionHash(spec);
    return this.emit(actorId, {
      type: "card_created",
      cardId: randomId("card", 5),
      spec,
      versionHash,
    });
  }

  updateCard(actorId: string, cardId: string, rawSpec: CardSpec): RoomEvent {
    const existing = this.state.cards[cardId];
    if (!existing) {
      throw new RoomError("NOT_FOUND", `Card ${cardId} not found`, 404);
    }
    const spec = CardSpecSchema.parse(rawSpec);
    const versionHash = computeCardVersionHash(spec);
    return this.emit(actorId, {
      type: "card_updated",
      cardId,
      spec,
      versionHash,
    });
  }

  confirmCard(actorId: string, cardId: string, versionHash: string): RoomEvent {
    const member = this.state.members[actorId];
    if (!member || member.kind !== "human") {
      throw new RoomError("FORBIDDEN", "Only human collaborators can confirm cards", 403);
    }
    const card = this.state.cards[cardId];
    if (!card) {
      throw new RoomError("NOT_FOUND", `Card ${cardId} not found`, 404);
    }
    if (card.versionHash !== versionHash) {
      throw new RoomError(
        "VERSION_MISMATCH",
        `Card hash changed (expected ${card.versionHash}, got ${versionHash})`,
        409,
      );
    }
    return this.emit(actorId, {
      type: "card_confirmed",
      cardId,
      versionHash,
      memberId: actorId,
    });
  }

  // --- 6 Standard Room MCP Tool Handlers (Host-Enforced Guardrails) ---

  mcpGetContext(includeDrafts = false) {
    const cards = Object.values(this.state.cards).filter((c) =>
      includeDrafts ? true : c.status !== "draft",
    );
    return {
      roomId: this.room.id,
      roomName: this.room.name,
      cards,
      activeLocks: getActiveClaims(this.state),
    };
  }

  mcpClaimCard(agentId: string, cardId: string, versionHash: string, fileGlobs: string[]) {
    const agent = this.state.members[agentId];
    if (!agent || agent.kind !== "agent") {
      return { ok: false as const, code: "AGENT_STOPPED" as const, message: "Invalid agent session" };
    }
    if (this.state.stoppedAgentIds.includes(agentId)) {
      return {
        ok: false as const,
        code: "AGENT_STOPPED" as const,
        message: "Agent is emergency-stopped and cannot claim cards",
      };
    }

    const card = this.state.cards[cardId];
    if (!card) {
      return { ok: false as const, code: "NOT_FOUND" as const, message: `Card ${cardId} not found` };
    }
    if (card.status === "draft") {
      return {
        ok: false as const,
        code: "NOT_CONFIRMED" as const,
        message: "Card must be confirmed by collaborators before claiming",
      };
    }
    if (card.versionHash !== versionHash) {
      return {
        ok: false as const,
        code: "VERSION_MISMATCH" as const,
        message: `Stale versionHash (current is ${card.versionHash})`,
      };
    }
    if (card.status === "claimed" && card.claimedByAgentId !== agentId) {
      return {
        ok: false as const,
        code: "ALREADY_CLAIMED" as const,
        message: `Card already claimed by ${card.claimedByAgentName ?? card.claimedByAgentId}`,
      };
    }

    const targetGlobs = fileGlobs.length > 0 ? fileGlobs : card.spec.fileGlobs;
    const conflicts = checkClaimConflicts(targetGlobs, getActiveClaims(this.state), agentId);
    if (conflicts.length > 0) {
      const first = conflicts[0];
      return {
        ok: false as const,
        code: "FILE_LOCK_CONFLICT" as const,
        message: `File scope conflict: ${first.requestedGlob} overlaps ${first.heldGlob} held by ${first.heldByAgentName} (${first.heldByCardId})`,
        conflicts,
      };
    }

    this.emit(agentId, {
      type: "card_claimed",
      cardId,
      versionHash,
      agentId,
      agentName: agent.name,
      fileGlobs: targetGlobs,
    });

    return {
      ok: true as const,
      cardId,
      versionHash,
      lockedGlobs: targetGlobs,
    };
  }

  mcpCheckFiles(agentId: string, paths: string[]) {
    const activeClaims = getActiveClaims(this.state);
    return {
      results: paths.map((p) => {
        const res = checkFileAccess(p, agentId, activeClaims);
        if (res.status === "allowed") {
          return { path: p, status: "allowed" as const, cardId: res.cardId };
        }
        if (res.status === "conflict") {
          return {
            path: p,
            status: "conflict" as const,
            cardId: res.heldByCardId,
            heldByAgentName: res.heldByAgentName,
            heldGlob: res.heldGlob,
          };
        }
        return { path: p, status: "out_of_scope" as const };
      }),
    };
  }

  mcpReportStep(agentId: string, cardId: string, summary: string, detail?: string) {
    if (this.state.stoppedAgentIds.includes(agentId)) {
      return { ok: false, message: "Agent is emergency-stopped" };
    }
    const card = this.state.cards[cardId];
    if (!card || card.claimedByAgentId !== agentId) {
      return { ok: false, message: "Agent must hold the active claim on this card to report steps" };
    }
    const trimmed = summary.trim();
    if (!trimmed || trimmed.length > 120) {
      return { ok: false, message: "Host guardrail: step summary must be 1-120 characters" };
    }
    const stepId = randomId("step", 5);
    this.emit(agentId, {
      type: "work_step_reported",
      stepId,
      cardId,
      agentId,
      summary: trimmed,
      detail,
    });
    return { ok: true, stepId };
  }

  mcpAskHuman(agentId: string, cardId: string, question: string) {
    if (this.state.stoppedAgentIds.includes(agentId)) {
      return { ok: false, message: "Agent is emergency-stopped" };
    }
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > 500) {
      return { ok: false, message: "Question must be 1-500 characters" };
    }
    this.emit(agentId, {
      type: "agent_asked_human",
      cardId,
      agentId,
      question: trimmed,
    });
    return { ok: true };
  }

  mcpSubmitOutput(
    agentId: string,
    cardId: string,
    cardVersionHash: string,
    kind: OutputKind,
    summary: string,
    diff?: string,
    previewUrl?: string,
    branch?: string,
  ) {
    if (this.state.stoppedAgentIds.includes(agentId)) {
      return { ok: false, message: "Agent is emergency-stopped" };
    }
    const card = this.state.cards[cardId];
    if (!card) {
      return { ok: false, message: `Card ${cardId} not found` };
    }
    if (card.versionHash !== cardVersionHash) {
      return {
        ok: false,
        message: `Version hash mismatch (card is ${card.versionHash}, output bound to ${cardVersionHash})`,
      };
    }
    const outputId = randomId("out", 5);
    this.emit(agentId, {
      type: "output_submitted",
      outputId,
      cardId,
      cardVersionHash,
      kind,
      summary: summary.trim(),
      diff,
      previewUrl,
      branch,
    });
    return { ok: true, outputId };
  }

  reviewCard(
    actorId: string,
    cardId: string,
    outputId: string,
    decision: "accepted" | "changes_requested",
    comment?: string,
  ): RoomEvent {
    const member = this.state.members[actorId];
    if (!member || member.kind !== "human") {
      throw new RoomError("FORBIDDEN", "Only human collaborators can review outputs", 403);
    }
    const card = this.state.cards[cardId];
    if (!card) {
      throw new RoomError("NOT_FOUND", `Card ${cardId} not found`, 404);
    }
    if (!this.state.outputs[outputId]) {
      throw new RoomError("NOT_FOUND", `Output ${outputId} not found`, 404);
    }
    return this.emit(actorId, {
      type: "card_reviewed",
      cardId,
      outputId,
      decision,
      comment,
    });
  }

  stopAgent(actorId: string, agentId: string, reason?: string): RoomEvent {
    const actor = this.state.members[actorId];
    if (!actor || actor.kind !== "human") {
      throw new RoomError("FORBIDDEN", "Only human collaborators can trigger emergency stop", 403);
    }
    const target = this.state.members[agentId];
    if (!target || target.kind !== "agent") {
      throw new RoomError("NOT_FOUND", `Agent ${agentId} not found`, 404);
    }
    const event = this.emit(actorId, {
      type: "agent_stopped",
      agentId,
      stoppedBy: actorId,
      reason,
    });
    const signal: AgentKillSignal = { agentId, stoppedBy: actorId, reason };
    for (const listener of this.killListeners) {
      listener(signal);
    }
    return event;
  }

  close(): void {
    this.db.close();
  }
}

export class RoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

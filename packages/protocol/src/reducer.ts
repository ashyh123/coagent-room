import { Card } from "./cards.js";
import { RoomEvent } from "./events.js";
import { ActiveClaim } from "./locks.js";
import { Member, Output, WorkStep } from "./types.js";

export interface ChatMessage {
  id: string;
  actorId: string;
  text: string;
  mentions: string[];
  refCardId?: string;
  createdAt: string;
  seq: number;
}

export interface RoomState {
  roomId: string;
  roomName: string;
  minConfirmations: number;
  lastSeq: number;
  members: Record<string, Member>;
  messages: ChatMessage[];
  cards: Record<string, Card>;
  workSteps: WorkStep[];
  outputs: Record<string, Output>;
  stoppedAgentIds: string[];
}

export function createInitialRoomState(
  roomId: string,
  roomName: string,
  minConfirmations = 1,
): RoomState {
  return {
    roomId,
    roomName,
    minConfirmations,
    lastSeq: 0,
    members: {},
    messages: [],
    cards: {},
    workSteps: [],
    outputs: {},
    stoppedAgentIds: [],
  };
}

export function getActiveClaims(state: RoomState): ActiveClaim[] {
  const claims: ActiveClaim[] = [];
  for (const card of Object.values(state.cards)) {
    if (
      (card.status === "claimed" || card.status === "pending_review") &&
      card.claimedByAgentId &&
      card.claimedByAgentName &&
      card.claimedGlobs.length > 0
    ) {
      claims.push({
        cardId: card.id,
        agentId: card.claimedByAgentId,
        agentName: card.claimedByAgentName,
        fileGlobs: card.claimedGlobs,
      });
    }
  }
  return claims;
}

export function applyRoomEvent(prev: RoomState, event: RoomEvent): RoomState {
  if (event.seq <= prev.lastSeq) {
    return prev;
  }

  const next: RoomState = {
    ...prev,
    lastSeq: event.seq,
    members: { ...prev.members },
    messages: prev.messages,
    cards: { ...prev.cards },
    workSteps: prev.workSteps,
    outputs: { ...prev.outputs },
    stoppedAgentIds: prev.stoppedAgentIds,
  };

  const p = event.payload;
  switch (p.type) {
    case "member_joined": {
      next.members[p.member.id] = { ...p.member, online: true };
      // If a stopped agent re-joins with fresh session, clear stopped flag
      if (p.member.kind === "agent" && next.stoppedAgentIds.includes(p.member.id)) {
        next.stoppedAgentIds = next.stoppedAgentIds.filter((id) => id !== p.member.id);
      }
      break;
    }

    case "member_left": {
      const existing = next.members[p.memberId];
      if (existing) {
        next.members[p.memberId] = { ...existing, online: false };
      }
      break;
    }

    case "message_posted": {
      next.messages = [
        ...prev.messages,
        {
          id: p.messageId,
          actorId: event.actorId,
          text: p.text,
          mentions: p.mentions,
          refCardId: p.refCardId,
          createdAt: event.createdAt,
          seq: event.seq,
        },
      ];
      break;
    }

    case "card_created": {
      next.cards[p.cardId] = {
        id: p.cardId,
        spec: p.spec,
        versionHash: p.versionHash,
        status: "draft",
        confirmations: [],
        claimedGlobs: [],
        createdBy: event.actorId,
        updatedAt: event.createdAt,
      };
      break;
    }

    case "card_updated": {
      const existing = next.cards[p.cardId];
      if (existing) {
        next.cards[p.cardId] = {
          ...existing,
          spec: p.spec,
          versionHash: p.versionHash,
          status: "draft",
          confirmations: [],
          claimedByAgentId: undefined,
          claimedByAgentName: undefined,
          claimedGlobs: [],
          updatedAt: event.createdAt,
        };
      }
      break;
    }

    case "card_confirmed": {
      const card = next.cards[p.cardId];
      if (card && card.versionHash === p.versionHash) {
        const alreadyConfirmed = card.confirmations.some(
          (c) => c.memberId === p.memberId && c.versionHash === p.versionHash,
        );
        const confirmations = alreadyConfirmed
          ? card.confirmations
          : [
              ...card.confirmations,
              {
                memberId: p.memberId,
                versionHash: p.versionHash,
                confirmedAt: event.createdAt,
              },
            ];
        const status =
          card.status === "draft" && confirmations.length >= next.minConfirmations
            ? "confirmed"
            : card.status;
        next.cards[p.cardId] = {
          ...card,
          confirmations,
          status,
          updatedAt: event.createdAt,
        };
      }
      break;
    }

    case "card_claimed": {
      const card = next.cards[p.cardId];
      if (card && card.versionHash === p.versionHash) {
        next.cards[p.cardId] = {
          ...card,
          status: "claimed",
          claimedByAgentId: p.agentId,
          claimedByAgentName: p.agentName,
          claimedGlobs: p.fileGlobs,
          updatedAt: event.createdAt,
        };
      }
      const agent = next.members[p.agentId];
      if (agent) {
        next.members[p.agentId] = {
          ...agent,
          status: "working",
          activeCardId: p.cardId,
        };
      }
      break;
    }

    case "work_step_reported": {
      next.workSteps = [
        ...prev.workSteps,
        {
          id: p.stepId,
          cardId: p.cardId,
          agentId: p.agentId,
          summary: p.summary,
          detail: p.detail,
          createdAt: event.createdAt,
        },
      ];
      const agent = next.members[p.agentId];
      if (agent && agent.status !== "stopped") {
        next.members[p.agentId] = { ...agent, status: "working", activeCardId: p.cardId };
      }
      break;
    }

    case "agent_asked_human": {
      next.workSteps = [
        ...prev.workSteps,
        {
          id: `ask_${event.seq}`,
          cardId: p.cardId,
          agentId: p.agentId,
          summary: `[需要确认] ${p.question.slice(0, 108)}`,
          detail: p.question,
          createdAt: event.createdAt,
        },
      ];
      const agent = next.members[p.agentId];
      if (agent && agent.status !== "stopped") {
        next.members[p.agentId] = { ...agent, status: "waiting_human", activeCardId: p.cardId };
      }
      break;
    }

    case "output_submitted": {
      next.outputs[p.outputId] = {
        id: p.outputId,
        cardId: p.cardId,
        cardVersionHash: p.cardVersionHash,
        submittedBy: event.actorId,
        kind: p.kind,
        summary: p.summary,
        diff: p.diff,
        previewUrl: p.previewUrl,
        branch: p.branch,
        createdAt: event.createdAt,
      };
      const card = next.cards[p.cardId];
      if (card) {
        next.cards[p.cardId] = {
          ...card,
          status: "pending_review",
          updatedAt: event.createdAt,
        };
      }
      const agent = next.members[event.actorId];
      if (agent && agent.kind === "agent") {
        next.members[event.actorId] = { ...agent, status: "idle", activeCardId: undefined };
      }
      break;
    }

    case "card_reviewed": {
      const card = next.cards[p.cardId];
      if (card) {
        if (p.decision === "accepted") {
          next.cards[p.cardId] = {
            ...card,
            status: "accepted",
            claimedGlobs: [],
            updatedAt: event.createdAt,
          };
        } else {
          next.cards[p.cardId] = {
            ...card,
            status: card.claimedByAgentId ? "claimed" : "confirmed",
            updatedAt: event.createdAt,
          };
        }
      }
      break;
    }

    case "agent_stopped": {
      if (!next.stoppedAgentIds.includes(p.agentId)) {
        next.stoppedAgentIds = [...next.stoppedAgentIds, p.agentId];
      }
      const agent = next.members[p.agentId];
      if (agent) {
        next.members[p.agentId] = {
          ...agent,
          status: "stopped",
          activeCardId: undefined,
        };
      }
      // Release any active locks held by the stopped agent and return claimed cards to confirmed
      for (const [cardId, card] of Object.entries(next.cards)) {
        if (card.claimedByAgentId === p.agentId && card.status === "claimed") {
          next.cards[cardId] = {
            ...card,
            status: "confirmed",
            claimedByAgentId: undefined,
            claimedByAgentName: undefined,
            claimedGlobs: [],
            updatedAt: event.createdAt,
          };
        }
      }
      break;
    }
  }

  return next;
}

export function reduceRoomEvents(
  roomId: string,
  roomName: string,
  events: readonly RoomEvent[],
  minConfirmations = 1,
): RoomState {
  let state = createInitialRoomState(roomId, roomName, minConfirmations);
  for (const event of events) {
    state = applyRoomEvent(state, event);
  }
  return state;
}

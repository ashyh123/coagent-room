import { RoomState } from "./reducer.js";

export type InboxItemKind = "confirm_card" | "review_output" | "mention" | "agent_help";

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  title: string;
  summary: string;
  createdAt: string;
  targetType: "card" | "message" | "topic";
  targetId: string;
  topicId?: string;
  actorId?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textMentionsMember(text: string, memberName: string): boolean {
  const trimmed = memberName.trim();
  if (!trimmed) return false;
  const escaped = escapeRegExp(trimmed);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?=$|[^A-Za-z0-9_])`, "i");
  return pattern.test(text);
}

/**
 * Computes the 4-category action inbox for a room member:
 * - confirm_card: draft cards awaiting this member's confirmation for current versionHash
 * - review_output: cards currently in pending_review
 * - mention: messages from other actors mentioning this member (unless dismissed)
 * - agent_help: online agents currently waiting_human
 */
export function computeInboxItems(
  state: RoomState,
  memberId: string,
  dismissedMentionIds?: ReadonlySet<string>,
): InboxItem[] {
  const items: InboxItem[] = [];
  const member = state.members[memberId];
  const memberName = member?.name?.trim() ?? "";

  for (const card of Object.values(state.cards)) {
    if (
      card.status === "draft" &&
      !card.confirmations.some((c) => c.memberId === memberId && c.versionHash === card.versionHash)
    ) {
      items.push({
        id: `confirm_card:${card.id}:${card.versionHash}`,
        kind: "confirm_card",
        title: card.spec.title,
        summary: card.spec.goal.trim().slice(0, 140),
        createdAt: card.updatedAt,
        targetType: "card",
        targetId: card.id,
        actorId: card.createdBy,
      });
    } else if (card.status === "pending_review") {
      const latestOutput = Object.values(state.outputs)
        .filter((o) => o.cardId === card.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      items.push({
        id: `review_output:${card.id}:${latestOutput?.id ?? card.versionHash}`,
        kind: "review_output",
        title: card.spec.title,
        summary: (latestOutput?.summary ?? card.spec.goal).trim().slice(0, 140),
        createdAt: latestOutput?.createdAt ?? card.updatedAt,
        targetType: "card",
        targetId: card.id,
        actorId: latestOutput?.submittedBy ?? card.claimedByAgentId,
      });
    }
  }

  for (const msg of state.messages) {
    if (msg.actorId === memberId) continue;
    if (dismissedMentionIds?.has(msg.id)) continue;

    const mentionedById = msg.mentions.includes(memberId);
    const mentionedByName = memberName ? textMentionsMember(msg.text, memberName) : false;
    if (!mentionedById && !mentionedByName) continue;

    const actorName = state.members[msg.actorId]?.name ?? msg.actorId;
    items.push({
      id: `mention:${msg.id}`,
      kind: "mention",
      title: `${actorName} @了你`,
      summary: msg.text.trim().slice(0, 140),
      createdAt: msg.createdAt,
      targetType: "message",
      targetId: msg.id,
      ...(msg.topicId ? { topicId: msg.topicId } : {}),
      actorId: msg.actorId,
    });
  }

  for (const agent of Object.values(state.members)) {
    if (agent.kind !== "agent" || !agent.online || agent.status !== "waiting_human") continue;

    const agentSteps = state.workSteps.filter((s) => s.agentId === agent.id);
    const latestStep = agentSteps[agentSteps.length - 1];
    const targetCardId = agent.activeCardId ?? latestStep?.cardId;
    const card = targetCardId ? state.cards[targetCardId] : undefined;

    items.push({
      id: `agent_help:${agent.id}:${latestStep?.id ?? targetCardId ?? "waiting"}`,
      kind: "agent_help",
      title: card ? `${agent.name} · ${card.spec.title}` : `${agent.name} 请求确认`,
      summary: (latestStep?.detail ?? latestStep?.summary ?? "Agent 正在等待协作者确认").trim().slice(0, 140),
      createdAt: latestStep?.createdAt ?? card?.updatedAt ?? new Date(0).toISOString(),
      targetType: targetCardId ? "card" : "message",
      targetId: targetCardId ?? agent.id,
      actorId: agent.id,
    });
  }

  items.sort((a, b) => {
    const cmp = b.createdAt.localeCompare(a.createdAt);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });

  return items;
}

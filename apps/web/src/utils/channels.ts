import { Member } from "@coagent/protocol";

export type ActiveChannel =
  | { kind: "room" }
  | { kind: "topic"; topicId: string }
  | { kind: "private_bot" }
  | { kind: "agent"; agentId: string };

export function isSameChannel(a: ActiveChannel, b: ActiveChannel): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "topic" && b.kind === "topic") {
    return a.topicId === b.topicId;
  }
  if (a.kind === "agent" && b.kind === "agent") {
    return a.agentId === b.agentId;
  }
  return true;
}

function compareAgents(a: Member, b: Member): number {
  if (a.online !== b.online) return a.online ? -1 : 1;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Splits room agents into the current human's own controllable agents
 * (owned by currentMemberId or legacy unowned) and collaborators' agents.
 */
export function partitionAgents(
  members: Record<string, Member>,
  currentMemberId: string,
): { myAgents: Member[]; otherAgents: Member[] } {
  const myAgents: Member[] = [];
  const otherAgents: Member[] = [];

  for (const member of Object.values(members)) {
    if (member.kind !== "agent") continue;
    if (!member.ownerId || member.ownerId === currentMemberId) {
      myAgents.push(member);
    } else {
      otherAgents.push(member);
    }
  }

  myAgents.sort(compareAgents);
  otherAgents.sort(compareAgents);

  return { myAgents, otherAgents };
}

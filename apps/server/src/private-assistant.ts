import { Card, CardStatus, getActiveClaims, redactRoomSecrets, RoomState } from "@coagent/protocol";
import { z } from "zod";

export const PrivateAskInputSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  quote: z.string().trim().min(1).max(1000).optional(),
  activeCardId: z.string().trim().min(1).optional(),
  topicId: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).max(100).optional(),
});
export type PrivateAskInput = z.infer<typeof PrivateAskInputSchema>;

export interface PrivateAskResult {
  answer: string;
  source: "llm" | "local_context";
  model?: string;
}

const CARD_STATUS_ZH: Record<CardStatus, string> = {
  draft: "草稿（待确认）",
  confirmed: "已确认（待认领）",
  claimed: "开发中（已锁范围）",
  pending_review: "待验收",
  accepted: "已验收",
};

// Every room-derived string passes through here, so credentials pasted into chat
// never reach the private answer or the external LLM.
function truncate(text: string, maxLen: number): string {
  const clean = redactRoomSecrets(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function buildContextSummary(state: RoomState, memberId: string, input: PrivateAskInput): string {
  const requester = state.members[memberId];
  const cards = Object.values(state.cards);
  const claims = getActiveClaims(state);
  const outputs = Object.values(state.outputs).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const activeCard = input.activeCardId ? state.cards[input.activeCardId] : undefined;
  const activeTopic = input.topicId ? state.topics[input.topicId] : undefined;
  const topicMessages = input.topicId
    ? state.messages.filter((m) => m.topicId === input.topicId)
    : state.messages;
  const recentMessages = topicMessages.slice(-8);

  const lines: string[] = [
    `房间: ${state.roomName} (${state.roomId}), 最小确认人数: ${state.minConfirmations}`,
    `提问成员: ${requester?.name ?? memberId}`,
  ];

  if (activeTopic) {
    lines.push(
      `当前话题: ${activeTopic.title} (${activeTopic.id}, 消息数: ${activeTopic.messageCount})`,
    );
    if (activeTopic.anchor?.quote) {
      lines.push(`话题锚点引用: "${truncate(activeTopic.anchor.quote, 200)}"`);
    }
  }

  if (input.quote) {
    lines.push(`用户选中片段: "${truncate(input.quote, 300)}"`);
  }

  if (activeCard) {
    lines.push(
      `聚焦卡片: ${activeCard.spec.title} [${activeCard.id}] 状态=${activeCard.status}, versionHash=${activeCard.versionHash}, fileGlobs=${activeCard.spec.fileGlobs.join(", ")}`,
    );
    lines.push(`卡片目标: ${truncate(activeCard.spec.goal, 240)}`);
    if (activeCard.spec.interfaceContract) {
      lines.push(`接口约定: ${truncate(activeCard.spec.interfaceContract, 240)}`);
    }
  } else if (cards.length > 0) {
    lines.push(
      `卡片列表 (${cards.length}): ${cards
        .slice(0, 6)
        .map((c) => `${c.spec.title}[${c.status}]`)
        .join("；")}`,
    );
  }

  if (claims.length > 0) {
    lines.push(
      `活跃文件锁: ${claims
        .map((c) => `${c.agentName} -> ${c.cardId} (${c.fileGlobs.join(", ")})`)
        .join("；")}`,
    );
  }

  if (outputs.length > 0) {
    lines.push(
      `最新产出: ${outputs
        .slice(0, 4)
        .map((o) => `[${o.cardId}/${o.kind}] ${truncate(o.summary, 120)}`)
        .join("；")}`,
    );
  }

  if (recentMessages.length > 0) {
    lines.push("近期消息:");
    for (const msg of recentMessages) {
      const sender = state.members[msg.actorId]?.name ?? msg.actorId;
      lines.push(`- ${sender}: ${truncate(msg.text, 160)}`);
    }
  }

  return lines.join("\n");
}

function findRelevantCards(state: RoomState, input: PrivateAskInput): Card[] {
  const all = Object.values(state.cards);
  if (input.activeCardId && state.cards[input.activeCardId]) {
    return [state.cards[input.activeCardId]];
  }
  const haystack = `${input.question} ${input.quote ?? ""}`.toLowerCase();
  const scored = all
    .map((card) => {
      let score = 0;
      const fields = [
        card.spec.title,
        card.spec.goal,
        card.spec.interfaceContract,
        ...card.spec.fileGlobs,
      ];
      for (const f of fields) {
        const token = f.toLowerCase().trim();
        if (token && haystack.includes(token)) score += 3;
      }
      if (card.status === "claimed" || card.status === "pending_review") score += 1;
      return { card, score };
    })
    .sort((a, b) => b.score - a.score || b.card.updatedAt.localeCompare(a.card.updatedAt));
  return scored.slice(0, 3).map((s) => s.card);
}

function buildLocalContextAnswer(
  state: RoomState,
  memberId: string,
  input: PrivateAskInput,
): string {
  const sections: string[] = [];
  const activeCard = input.activeCardId ? state.cards[input.activeCardId] : undefined;
  const activeTopic = input.topicId ? state.topics[input.topicId] : undefined;
  const claims = getActiveClaims(state);
  const relevantCards = findRelevantCards(state, input);
  const allOutputs = Object.values(state.outputs).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const relevantOutputs = activeCard
    ? allOutputs.filter((o) => o.cardId === activeCard.id)
    : allOutputs.slice(0, 3);

  const scopeParts: string[] = [];
  if (activeTopic) scopeParts.push(`话题「${activeTopic.title}」`);
  if (activeCard) scopeParts.push(`卡片「${activeCard.spec.title}」`);
  const scopeLabel = scopeParts.length > 0 ? scopeParts.join(" / ") : `房间「${state.roomName}」`;

  // No visibility label here: the UI already marks the private bubble, and the
  // answer may later be shared to the room, where such a label would be false.
  sections.push(`针对你在${scopeLabel}的提问：「${truncate(input.question, 100)}」`);

  if (input.quote) {
    sections.push(`引用片段：「${truncate(input.quote, 220)}」`);
  }

  if (relevantCards.length > 0) {
    const cardLines = relevantCards.map((c) => {
      const lockInfo = c.claimedByAgentName ? `，认领者：${c.claimedByAgentName}` : "";
      return `- ${c.spec.title}（${CARD_STATUS_ZH[c.status]}，确认 ${c.confirmations.length}/${state.minConfirmations}，范围：${c.spec.fileGlobs.join(", ")}${lockInfo}）`;
    });
    sections.push(`相关卡片：\n${cardLines.join("\n")}`);
  } else {
    sections.push("相关卡片：当前房间暂无共识卡片。");
  }

  if (claims.length > 0) {
    const lockLines = claims.map(
      (c) => `- ${c.agentName} 持有 ${c.cardId} 锁：${c.fileGlobs.join(", ")}`,
    );
    sections.push(`活跃文件锁：\n${lockLines.join("\n")}`);
  } else {
    sections.push("活跃文件锁：当前无占用中的文件范围锁。");
  }

  if (relevantOutputs.length > 0) {
    const outLines = relevantOutputs.slice(0, 3).map((o) => {
      const submitter = state.members[o.submittedBy]?.name ?? o.submittedBy;
      return `- [${o.kind}] ${truncate(o.summary, 120)}（提交者：${submitter}）`;
    });
    sections.push(`产出摘要：\n${outLines.join("\n")}`);
  }

  const nextHints: string[] = [];
  const waitingAgents = Object.values(state.members).filter(
    (m) => m.kind === "agent" && m.online && m.status === "waiting_human",
  );
  if (waitingAgents.length > 0) {
    nextHints.push(`有 ${waitingAgents.length} 个 Agent 正在等待人工确认`);
  }
  const pendingReview = Object.values(state.cards).filter((c) => c.status === "pending_review");
  if (pendingReview.length > 0) {
    nextHints.push(`有 ${pendingReview.length} 张卡片待验收（${pendingReview.map((c) => c.spec.title).join("、")}）`);
  }
  const unconfirmedDrafts = Object.values(state.cards).filter(
    (c) =>
      c.status === "draft" &&
      !c.confirmations.some((cf) => cf.memberId === memberId && cf.versionHash === c.versionHash),
  );
  if (unconfirmedDrafts.length > 0) {
    nextHints.push(`有 ${unconfirmedDrafts.length} 张草稿卡片待你确认`);
  }
  if (nextHints.length > 0) {
    sections.push(`下一步建议：${nextHints.join("；")}。`);
  }

  return sections.join("\n\n");
}

/**
 * Answers a collaborator's private side-question strictly from a read-only RoomState snapshot.
 * Never mutates room state, emits events, writes SQLite, or broadcasts WebSocket frames.
 */
export async function answerPrivateQuestion(
  state: RoomState,
  memberId: string,
  rawInput: PrivateAskInput,
): Promise<PrivateAskResult> {
  const input = PrivateAskInputSchema.parse(rawInput);
  const baseUrl = process.env.COAGENT_LLM_BASE_URL?.trim();

  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const endpoint = `${cleanBase}/chat/completions`;
    const targetModel =
      input.model?.trim() || process.env.COAGENT_LLM_MODEL?.trim() || "gpt-4o-mini";
    const apiKey = process.env.COAGENT_LLM_API_KEY?.trim();
    const contextSummary = buildContextSummary(state, memberId, input);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: targetModel,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "你是 coagent-room 的私密协作助手，仅面向当前提问的协作者回答，回答不会发到群聊。请结合房间上下文、卡片约定、文件锁与产出摘要，用简洁准确的中文作答。",
            },
            {
              role: "user",
              content: `【房间上下文】\n${contextSummary}\n\n【我的私密问题】\n${redactRoomSecrets(input.question)}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content?.trim();
        if (content) {
          return {
            answer: content,
            source: "llm",
            model: data.model ?? targetModel,
          };
        }
      }
    } catch {
      // Fall back cleanly to offline local context analyzer
    }
  }

  return {
    answer: buildLocalContextAnswer(state, memberId, input),
    source: "local_context",
  };
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  Member,
  MessageMeta,
  Output,
  RoomEvent,
  RoomState,
  WorkStep,
} from "@coagent/protocol";
import {
  AlertCircle,
  ArrowDown,
  ArrowUpRight,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  Maximize2,
  Minimize2,
  OctagonX,
  RefreshCw,
  Terminal,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  buildCardNumberMap,
  formatMessageTime,
  shouldGroupMessages,
} from "../../utils/chat.js";
import { WorkspaceViewMode } from "../../utils/layout.js";
import { buildMemberLabels } from "../../utils/members.js";
import { Avatar } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";
import { FloatingComposer } from "./FloatingComposer.js";
import { MessageBubble } from "./MessageBubble.js";

export interface AgentSessionPaneProps {
  state: RoomState;
  events: readonly RoomEvent[];
  agent: Member;
  currentMemberId: string;
  selectedCardId: string | null;
  viewMode: WorkspaceViewMode;
  composerHeight: number | null;
  onSendDirective: (
    text: string,
    options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta },
  ) => void;
  onSelectCard: (cardId: string) => void;
  onStopAgent: (agentId: string, reason?: string) => void;
  onOpenInviteAgent: () => void;
  onChangeComposerHeight: (height: number | null) => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  style?: React.CSSProperties;
}

type MessagePayload = Extract<RoomEvent["payload"], { type: "message_posted" }>;

type TimelineItem =
  | {
      kind: "message";
      key: string;
      createdAt: string;
      seq: number;
      event: RoomEvent;
      payload: MessagePayload;
    }
  | {
      kind: "step";
      key: string;
      createdAt: string;
      seq: number;
      step: WorkStep;
    }
  | {
      kind: "output";
      key: string;
      createdAt: string;
      seq: number;
      output: Output;
    };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAgentMention(text: string, agentName: string): boolean {
  const trimmed = agentName.trim();
  if (!trimmed) return false;
  const escaped = escapeRegExp(trimmed);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?=$|[^A-Za-z0-9_])`, "i");
  return pattern.test(text);
}

function getAgentStatusDisplay(
  agent: Member,
  stoppedIds: readonly string[],
): { label: string; dotColor: string; pulse?: boolean } {
  if (!agent.online) {
    return { label: "离线", dotColor: "var(--text-muted)" };
  }
  if (agent.status === "stopped" || stoppedIds.includes(agent.id)) {
    return { label: "已急停", dotColor: "var(--sem-red)" };
  }
  if (agent.status === "waiting_human") {
    return { label: "等待确认", dotColor: "var(--sem-amber)" };
  }
  if (agent.status === "working") {
    return { label: "执行中", dotColor: "var(--sem-green)", pulse: true };
  }
  return { label: "空闲", dotColor: "var(--sem-green)" };
}

const OUTPUT_KIND_LABELS: Record<Output["kind"], string> = {
  git_diff: "Diff 产出",
  preview_url: "预览链接",
  markdown: "文档产出",
};

export function AgentSessionPane({
  state,
  events,
  agent,
  currentMemberId,
  selectedCardId,
  viewMode,
  composerHeight,
  onSendDirective,
  onSelectCard,
  onStopAgent,
  onOpenInviteAgent,
  onChangeComposerHeight,
  onChangeViewMode,
  style,
}: AgentSessionPaneProps) {
  const paneRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
  const prevAgentIdRef = useRef<string>(agent.id);
  const prevItemCountRef = useRef(0);

  const membersList = useMemo(() => Object.values(state.members), [state.members]);
  const cards = useMemo(
    () =>
      Object.values(state.cards).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.cards],
  );
  const cardNumbers = useMemo(
    () => buildCardNumberMap(events, state.cards),
    [events, state.cards],
  );

  const activeCard = agent.activeCardId ? state.cards[agent.activeCardId] : undefined;
  const activeCardLockedCount = activeCard
    ? activeCard.claimedGlobs.length > 0
      ? activeCard.claimedGlobs.length
      : activeCard.spec.fileGlobs.length
    : 0;

  const isStopped = agent.status === "stopped" || state.stoppedAgentIds.includes(agent.id);
  const canStop = agent.online && !isStopped;
  const statusDisplay = getAgentStatusDisplay(agent, state.stoppedAgentIds);

  const workingAgents = useMemo(
    () =>
      agent.online && (agent.status === "working" || agent.status === "waiting_human")
        ? [agent]
        : [],
    [agent],
  );

  const timeline = useMemo<TimelineItem[]>(() => {
    const stepSeqMap = new Map<string, number>();
    const outputSeqMap = new Map<string, number>();
    const items: TimelineItem[] = [];

    for (const evt of events) {
      const p = evt.payload;
      if (p.type === "work_step_reported") {
        stepSeqMap.set(p.stepId, evt.seq);
      } else if (p.type === "agent_asked_human") {
        stepSeqMap.set(`ask_${evt.seq}`, evt.seq);
      } else if (p.type === "output_submitted") {
        outputSeqMap.set(p.outputId, evt.seq);
      } else if (p.type === "message_posted") {
        const involvesAgent =
          evt.actorId === agent.id ||
          p.mentions.includes(agent.id) ||
          matchesAgentMention(p.text, agent.name);
        if (involvesAgent) {
          items.push({
            kind: "message",
            key: `msg_${evt.id}`,
            createdAt: evt.createdAt,
            seq: evt.seq,
            event: evt,
            payload: p,
          });
        }
      }
    }

    for (const step of state.workSteps) {
      if (step.agentId === agent.id) {
        items.push({
          kind: "step",
          key: `step_${step.id}`,
          createdAt: step.createdAt,
          seq: stepSeqMap.get(step.id) ?? Number.MAX_SAFE_INTEGER,
          step,
        });
      }
    }

    for (const output of Object.values(state.outputs)) {
      if (output.submittedBy === agent.id) {
        items.push({
          kind: "output",
          key: `out_${output.id}`,
          createdAt: output.createdAt,
          seq: outputSeqMap.get(output.id) ?? Number.MAX_SAFE_INTEGER,
          output,
        });
      }
    }

    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq);
    return items;
  }, [events, state.workSteps, state.outputs, agent.id, agent.name]);

  const latestWaitingStep = useMemo(() => {
    if (agent.status !== "waiting_human") return undefined;
    return [...state.workSteps].reverse().find((s) => s.agentId === agent.id);
  }, [agent.id, agent.status, state.workSteps]);

  useEffect(() => {
    const el = feedRef.current;
    const agentChanged = prevAgentIdRef.current !== agent.id;
    const prevCount = prevItemCountRef.current;
    const countIncreased = timeline.length > prevCount;

    prevAgentIdRef.current = agent.id;
    prevItemCountRef.current = timeline.length;

    if (!el) return;
    if (agentChanged) {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
      setHasUnread(false);
      return;
    }
    if (atBottom && (countIncreased || prevCount === 0)) {
      el.scrollTop = el.scrollHeight;
      setHasUnread(false);
    } else if (!atBottom && countIncreased) {
      setHasUnread(true);
    }
  }, [timeline.length, agent.id, atBottom]);

  const handleFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance < 80;
    setAtBottom(nearBottom);
    if (nearBottom) {
      setHasUnread(false);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setAtBottom(true);
    setHasUnread(false);
  };

  const handleComposerSend = (
    text: string,
    options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta },
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const escaped = escapeRegExp(agent.name.trim());
    const hasPrefix =
      escaped.length > 0 && new RegExp(`^@${escaped}(?=$|\\s)`, "i").test(trimmed);
    const directiveText = hasPrefix ? trimmed : `@${agent.name} ${trimmed}`;
    const mentions = Array.from(new Set([...(options?.mentions ?? []), agent.id]));
    const refCardId = options?.refCardId ?? agent.activeCardId ?? selectedCardId ?? undefined;

    onSendDirective(directiveText, {
      ...options,
      mentions,
      ...(refCardId ? { refCardId } : {}),
    });
  };

  const quickDirectiveRefCardId = agent.activeCardId ?? selectedCardId ?? undefined;
  const memberName = (id: string) => state.members[id]?.name ?? id;
  const memberLabels = useMemo(
    () => buildMemberLabels(Object.values(state.members)),
    [state.members],
  );

  let lastMessageMeta: { actorId: string; createdAt: string } | null = null;

  return (
    <section
      ref={paneRef}
      className={`chat-pane flex min-h-0 min-w-0 flex-col ${viewMode === "chat" ? "solo" : ""}`}
      style={{ background: "var(--bg)", ...style }}
    >
      {/* Monochrome header */}
      <div
        className="flex h-11 shrink-0 items-center justify-between gap-2 px-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Avatar
            name={agent.name}
            avatar={agent.avatar}
            isAgent
            showAgentBadge
            size={28}
          />
          <span className="truncate text-[13px] font-semibold">{agent.name}</span>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] leading-[1.35]"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
            }}
          >
            {agent.driver ?? "codex"}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-[1.35] font-medium"
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDisplay.pulse ? "animate-pulse" : ""}`}
              style={{ background: statusDisplay.dotColor }}
            />
            <span>{statusDisplay.label}</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {canStop && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              title={`紧急停止 ${agent.name}`}
              onClick={() => onStopAgent(agent.id, "协作者在 Agent 会话页触发急停")}
            >
              <OctagonX size={12} />
              急停
            </Button>
          )}
          {viewMode === "split" && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="仅查看当前 Agent 会话"
                onClick={() => onChangeViewMode("chat")}
              >
                <Maximize2 size={12} />
                全屏
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="收起会话栏，仅查看卡片"
                onClick={() => onChangeViewMode("board")}
              >
                <Minimize2 size={12} />
                收起
              </Button>
            </>
          )}
          {viewMode === "chat" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="恢复分栏视图"
              className="max-md:hidden"
              onClick={() => onChangeViewMode("split")}
            >
              展开看板
            </Button>
          )}
        </div>
      </div>

      {/* Clickable card-lock status bar when agent has an active card */}
      {activeCard && (
        <div
          className="flex shrink-0 items-center justify-between gap-2 px-4 py-2"
          style={{
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={() => onSelectCard(activeCard.id)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-[12px] leading-[1.4] transition-opacity hover:opacity-80 cursor-pointer"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FileCode2 size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="truncate font-medium">
                正在处理{" "}
                <span className="font-mono">{cardNumbers[activeCard.id] ?? "#01"}</span> ·{" "}
                {activeCard.spec.title} · {activeCardLockedCount} files locked
              </span>
            </span>
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              定位卡片
              <ArrowUpRight size={11} />
            </span>
          </button>
        </div>
      )}

      {/* Scrollable timeline */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={feedRef}
          data-selectable-room-content="true"
          onScroll={handleFeedScroll}
          className="chat-feed flex-1 overflow-y-auto px-4 pt-3 pb-6"
        >
          <div
            className={`mx-auto flex w-full flex-col ${viewMode === "chat" ? "max-w-[820px]" : ""}`}
          >
            {timeline.length === 0 ? (
              <div
                className="my-8 flex flex-col items-center gap-3 p-6 text-center"
                style={{
                  background: "var(--surface)",
                  border: "1px dashed var(--border-strong)",
                  borderRadius: "var(--radius-card)",
                }}
              >
                <Avatar
                  name={agent.name}
                  avatar={agent.avatar}
                  isAgent
                  showAgentBadge
                  size={36}
                />
                <div className="flex flex-col gap-1">
                  <div className="text-[14px] font-semibold">
                    {agent.name} 专属交互通道
                  </div>
                  <p
                    className="m-0 max-w-[420px] text-[12.5px] leading-[1.5]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    这里聚合了与 {agent.name} 相关的指令消息、执行节点与产出记录。在下方发送消息会自动附上{" "}
                    <code>@{agent.name}</code> 并通知它响应。
                  </p>
                </div>
              </div>
            ) : (
              timeline.map((item) => {
                if (item.kind === "message") {
                  const evt = item.event;
                  const p = item.payload;
                  const grouped = shouldGroupMessages(lastMessageMeta, {
                    actorId: evt.actorId,
                    createdAt: evt.createdAt,
                  });
                  lastMessageMeta = { actorId: evt.actorId, createdAt: evt.createdAt };
                  const refTarget: Card | undefined = p.refCardId
                    ? state.cards[p.refCardId]
                    : undefined;

                  return (
                    <MessageBubble
                      key={item.key}
                      messageId={p.messageId}
                      isSelf={evt.actorId === currentMemberId}
                      member={state.members[evt.actorId]}
                      fallbackName={memberName(evt.actorId)}
                      displayLabel={memberLabels[evt.actorId]}
                      text={p.text}
                      timeLabel={formatMessageTime(evt.createdAt)}
                      grouped={grouped}
                      refCard={
                        refTarget
                          ? {
                              id: refTarget.id,
                              number: cardNumbers[refTarget.id] ?? "#01",
                              title: refTarget.spec.title,
                              status: refTarget.status,
                            }
                          : undefined
                      }
                      meta={p.meta}
                      onSelectCard={onSelectCard}
                    />
                  );
                }

                lastMessageMeta = null;

                if (item.kind === "step") {
                  const step = item.step;
                  const card = state.cards[step.cardId];
                  const isAsk =
                    step.id.startsWith("ask_") || step.summary.startsWith("[需要确认]");
                  const expanded = isAsk || Boolean(expandedStepIds[step.id]);
                  const timeLabel = formatMessageTime(step.createdAt);

                  return (
                    <div
                      key={item.key}
                      data-work-step-id={step.id}
                      className="mt-3 flex flex-col gap-2 p-3"
                      style={{
                        background: "var(--surface)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-card)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{
                              background: isAsk ? "var(--sem-amber-bg)" : "var(--surface-2)",
                              color: isAsk ? "var(--sem-amber)" : "var(--text-muted)",
                              border: "1px solid var(--border)",
                            }}
                          >
                            {isAsk ? <AlertCircle size={11} /> : <Terminal size={11} />}
                            {isAsk ? "请求确认" : "执行节点"}
                          </span>

                          {card && (
                            <button
                              type="button"
                              onClick={() => onSelectCard(card.id)}
                              className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80 cursor-pointer"
                              style={{
                                background: "var(--surface-2)",
                                color: "var(--text)",
                                border: "1px solid var(--border)",
                              }}
                            >
                              <span
                                className="font-mono"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {cardNumbers[card.id] ?? "#01"}
                              </span>
                              <span className="max-w-[180px] truncate">{card.spec.title}</span>
                            </button>
                          )}
                        </div>

                        <div
                          className="flex shrink-0 items-center gap-2 text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {step.detail && !isAsk && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedStepIds((prev) => ({
                                  ...prev,
                                  [step.id]: !prev[step.id],
                                }))
                              }
                              className="underline cursor-pointer"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {expanded ? "收起详情" : "查看详情"}
                            </button>
                          )}
                          {timeLabel && <span>{timeLabel}</span>}
                        </div>
                      </div>

                      <div className="text-[13px] leading-[1.45] font-medium break-words">
                        {step.summary}
                      </div>

                      {step.detail && expanded && (
                        <pre
                          className="m-0 max-h-48 overflow-auto p-2.5 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words"
                          style={{
                            background: "var(--surface-2)",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-card-inner)",
                          }}
                        >
                          {step.detail}
                        </pre>
                      )}
                    </div>
                  );
                }

                // Output card
                const output = item.output;
                const card = state.cards[output.cardId];
                const timeLabel = formatMessageTime(output.createdAt);
                const safePreviewUrl =
                  output.previewUrl && /^https?:\/\//i.test(output.previewUrl)
                    ? output.previewUrl
                    : undefined;

                return (
                  <div
                    key={item.key}
                    data-output-id={output.id}
                    className="mt-3 flex flex-col gap-2.5 p-3.5"
                    style={{
                      background: "var(--surface)",
                      color: "var(--text)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: "var(--radius-card)",
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          <GitCommitHorizontal size={11} />
                          {OUTPUT_KIND_LABELS[output.kind]}
                        </span>

                        {card && (
                          <button
                            type="button"
                            onClick={() => onSelectCard(card.id)}
                            className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80 cursor-pointer"
                            style={{
                              background: "var(--surface-2)",
                              color: "var(--text)",
                              border: "1px solid var(--border)",
                            }}
                          >
                            <span
                              className="font-mono"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {cardNumbers[card.id] ?? "#01"}
                            </span>
                            <span className="max-w-[180px] truncate">{card.spec.title}</span>
                          </button>
                        )}
                      </div>

                      <div
                        className="flex shrink-0 items-center gap-2 text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {output.branch && (
                          <code
                            className="rounded-[6px] px-1.5 py-0.5 text-[11px]"
                            style={{ background: "var(--surface-2)" }}
                          >
                            {output.branch}
                          </code>
                        )}
                        {timeLabel && <span>{timeLabel}</span>}
                      </div>
                    </div>

                    <div className="text-[13px] leading-[1.5] break-words whitespace-pre-wrap">
                      {output.summary}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {safePreviewUrl ? (
                        <a
                          href={safePreviewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] underline"
                          style={{ color: "var(--text)" }}
                        >
                          打开预览链接
                          <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span />
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onSelectCard(output.cardId)}
                      >
                        在看板中查看
                        <ArrowUpRight size={12} />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Soft bottom gradient mask */}
        <div className="chat-fade-mask -mt-6 h-6 shrink-0" />

        {/* Scroll-to-bottom floating capsule */}
        <AnimatePresence>
          {!atBottom && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              onClick={() => scrollToBottom("smooth")}
              className="absolute bottom-3 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium cursor-pointer"
              style={{
                background: "var(--primary-bg)",
                color: "var(--primary-text)",
                boxShadow: "var(--shadow-popover)",
              }}
            >
              <ArrowDown size={13} />
              {hasUnread ? "有新动态" : "回到底部"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Contextual quick action banners above composer */}
      <div className={`mx-auto w-full px-4 ${viewMode === "chat" ? "max-w-[852px]" : ""}`}>
        {agent.status === "waiting_human" && (
          <div
            className="mb-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-card-inner)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2 text-[12px]">
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--sem-amber)" }}
              />
              <span className="truncate font-medium">
                {latestWaitingStep?.detail ||
                  latestWaitingStep?.summary ||
                  `${agent.name} 正在等待你的确认继续执行`}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() =>
                  onSendDirective(`@${agent.name} 允许继续`, {
                    mentions: [agent.id],
                    ...(quickDirectiveRefCardId
                      ? { refCardId: quickDirectiveRefCardId }
                      : {}),
                  })
                }
              >
                允许继续
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onSendDirective(`@${agent.name} 拒绝此次操作请求`, {
                    mentions: [agent.id],
                    ...(quickDirectiveRefCardId
                      ? { refCardId: quickDirectiveRefCardId }
                      : {}),
                  })
                }
              >
                拒绝
              </Button>
            </div>
          </div>
        )}

        {!agent.online && (
          <div
            className="mb-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
              border: "1px dashed var(--border-strong)",
              borderRadius: "var(--radius-card-inner)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2 text-[12px]">
              <WifiOff size={13} className="shrink-0" />
              <span className="truncate">
                {agent.name} 当前已离线，可在本地终端重新接入该 Agent。
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onOpenInviteAgent}>
              <RefreshCw size={12} />
              重新接入
            </Button>
          </div>
        )}
      </div>

      {/* Directive FloatingComposer */}
      <div className={`mx-auto w-full ${viewMode === "chat" ? "max-w-[852px]" : ""}`}>
        <FloatingComposer
          paneRef={paneRef}
          composerHeight={composerHeight}
          cards={cards}
          cardNumbers={cardNumbers}
          workingAgents={workingAgents}
          members={membersList}
          hidePrivateToggle
          placeholderOverride={`向 @${agent.name} 发送指令…（提交时自动附带 @${agent.name}，# 引用卡片）`}
          onChangeComposerHeight={onChangeComposerHeight}
          onSendMessage={handleComposerSend}
          onAskPrivate={() => {}}
          onStopAgent={onStopAgent}
        />
      </div>
    </section>
  );
}

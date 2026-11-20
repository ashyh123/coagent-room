import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, MessageMeta, RoomEvent, RoomState, TopicAnchor } from "@coagent/protocol";
import { ArrowDown, ArrowUpRight, Hash, Maximize2, Minimize2, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  buildCardNumberMap,
  formatMessageTime,
  shouldGroupMessages,
} from "../../utils/chat.js";
import { WorkspaceViewMode } from "../../utils/layout.js";
import { buildMemberLabels } from "../../utils/members.js";
import { Button } from "../ui/Button.js";
import { FloatingComposer } from "./FloatingComposer.js";
import { MessageBubble } from "./MessageBubble.js";
import { PrivateBubble, PrivateQAItem } from "./PrivateBubble.js";
import { RefStripPill } from "./RefStripPill.js";
import { TopicBar } from "./TopicBar.js";

export interface ChatPaneProps {
  state: RoomState;
  events: readonly RoomEvent[];
  currentMemberId: string;
  viewMode: WorkspaceViewMode;
  composerHeight: number | null;
  activeTopicId: string | null;
  hideTopicPills?: boolean;
  privateItems: readonly PrivateQAItem[];
  focusMessageId?: string | null;
  onSendMessage: (
    text: string,
    options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta; topicId?: string },
  ) => void;
  onSelectCard: (cardId: string) => void;
  onOpenNewCard: () => void;
  onStopAgent: (agentId: string, reason?: string) => void;
  onChangeComposerHeight: (height: number | null) => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  onSelectTopic: (topicId: string | null) => void;
  onCreateTopic: (title: string, anchor?: TopicAnchor) => void;
  onAskPrivate: (input: { question: string; quote?: string; model?: string }) => void;
  onSharePrivateToRoom: (item: PrivateQAItem) => void;
  onTurnPrivateIntoCard: (item: PrivateQAItem) => void;
  onDismissPrivate: (id: string) => void;
  style?: React.CSSProperties;
}

export function ChatPane({
  state,
  events,
  currentMemberId,
  viewMode,
  composerHeight,
  activeTopicId,
  hideTopicPills,
  privateItems,
  focusMessageId,
  onSendMessage,
  onSelectCard,
  onOpenNewCard,
  onStopAgent,
  onChangeComposerHeight,
  onChangeViewMode,
  onSelectTopic,
  onCreateTopic,
  onAskPrivate,
  onSharePrivateToRoom,
  onTurnPrivateIntoCard,
  onDismissPrivate,
  style,
}: ChatPaneProps) {
  const paneRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const prevTopicIdRef = useRef<string | null>(activeTopicId);
  const prevFocusIdRef = useRef<string | null | undefined>(undefined);
  const prevFeedCountRef = useRef(0);
  const prevPrivateSigRef = useRef("");

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
  const workingAgents = useMemo(
    () =>
      Object.values(state.members).filter(
        (m) => m.kind === "agent" && m.online && (m.status === "working" || m.status === "waiting_human"),
      ),
    [state.members],
  );

  const activeTopic = activeTopicId ? state.topics[activeTopicId] : undefined;

  const filteredEvents = useMemo(() => {
    if (activeTopicId === null) {
      return events.filter((evt) => {
        const p = evt.payload;
        if (p.type === "message_posted") {
          return !p.topicId;
        }
        return (
          p.type === "topic_created" ||
          p.type === "card_created" ||
          p.type === "card_claimed" ||
          p.type === "output_submitted" ||
          p.type === "agent_stopped"
        );
      });
    }
    return events.filter(
      (evt) => evt.payload.type === "message_posted" && evt.payload.topicId === activeTopicId,
    );
  }, [events, activeTopicId]);

  const filteredPrivateItems = useMemo(
    () =>
      privateItems
        .filter((p) => (p.topicId ?? null) === activeTopicId)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [privateItems, activeTopicId],
  );

  const feedItemCount = filteredEvents.length + filteredPrivateItems.length;
  const privateSig = useMemo(
    () => filteredPrivateItems.map((p) => `${p.id}:${p.pending ? "p" : "d"}`).join(","),
    [filteredPrivateItems],
  );

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setAtBottom(true);
    setHasUnread(false);
  };

  useEffect(() => {
    const el = feedRef.current;
    const topicChanged = prevTopicIdRef.current !== activeTopicId;
    const focusChanged = prevFocusIdRef.current !== focusMessageId;
    const prevCount = prevFeedCountRef.current;
    const countIncreased = feedItemCount > prevCount;
    const privateChanged = prevPrivateSigRef.current !== privateSig;

    prevTopicIdRef.current = activeTopicId;
    prevFocusIdRef.current = focusMessageId;
    prevFeedCountRef.current = feedItemCount;
    prevPrivateSigRef.current = privateSig;

    if (!el) return;
    if (focusChanged && focusMessageId) {
      return;
    }
    if (topicChanged) {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
      setHasUnread(false);
      return;
    }
    if (focusChanged && !focusMessageId) {
      return;
    }
    if (atBottom && (countIncreased || privateChanged || prevCount === 0)) {
      el.scrollTop = el.scrollHeight;
      setHasUnread(false);
    } else if (!atBottom && countIncreased) {
      setHasUnread(true);
    }
  }, [feedItemCount, privateSig, atBottom, activeTopicId, focusMessageId]);

  useEffect(() => {
    if (!focusMessageId) return;
    setHighlightedMessageId(focusMessageId);
    const timer = window.setTimeout(() => {
      setHighlightedMessageId((curr) => (curr === focusMessageId ? null : curr));
    }, 2200);

    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(focusMessageId)
        : focusMessageId.replace(/"/g, '\\"');
    const frame = requestAnimationFrame(() => {
      const target = feedRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${escaped}"]`,
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [focusMessageId, activeTopicId, filteredEvents.length]);

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

  const memberName = (id: string) => state.members[id]?.name ?? id;
  const memberLabels = useMemo(
    () => buildMemberLabels(Object.values(state.members)),
    [state.members],
  );

  const handleCreateTopicFromMessage = (messageId: string, actorId: string, text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    const quote = clean ? clean.slice(0, 300) : undefined;
    const title = clean
      ? clean.length > 36
        ? `${clean.slice(0, 36)}…`
        : clean
      : `${memberName(actorId)} 的消息`;
    onCreateTopic(title, {
      kind: "message",
      targetId: messageId,
      ...(quote ? { quote } : {}),
    });
  };

  const handleComposerSend = (
    text: string,
    options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta },
  ) => {
    onSendMessage(text, {
      ...options,
      ...(activeTopicId ? { topicId: activeTopicId } : {}),
    });
  };

  // Build renderable timeline items while tracking last message_posted for 2-min grouping
  let lastMessageMeta: { actorId: string; createdAt: string } | null = null;

  return (
    <section
      ref={paneRef}
      className={`chat-pane flex min-h-0 min-w-0 flex-col ${viewMode === "chat" ? "solo" : ""}`}
      style={{ background: "var(--bg)", ...style }}
    >
      {/* Subtle monochrome pane header */}
      <div
        className="flex h-11 shrink-0 items-center justify-between gap-2 px-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-[13px] font-semibold whitespace-nowrap">房间沟通</span>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={onOpenNewCard}>
            <Plus size={13} />
            新建 Spec
          </Button>
          {viewMode === "split" && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="仅查看沟通界面"
                onClick={() => onChangeViewMode("chat")}
              >
                <Maximize2 size={12} />
                全屏
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="收起沟通栏，仅查看卡片"
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

      {/* Topic pill bar & active topic anchored context strip */}
      <TopicBar
        topics={state.topics}
        activeTopicId={activeTopicId}
        cards={state.cards}
        cardNumbers={cardNumbers}
        hidePills={hideTopicPills}
        onSelectTopic={onSelectTopic}
        onCreateTopic={onCreateTopic}
        onSelectCard={onSelectCard}
      />

      {/* Scrollable chat feed */}
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
            {filteredEvents.length === 0 && filteredPrivateItems.length === 0 && (
              <div
                className="my-10 text-center text-[13px]"
                style={{ color: "var(--text-muted)" }}
              >
                {activeTopicId === null ? (
                  <>
                    房间已就绪。在下方发送指令、@Agent，或输入 <code>#</code> 引用卡片。
                  </>
                ) : (
                  <>
                    话题「{activeTopic?.title ?? activeTopicId}」暂无消息。在下方直接讨论，或点击「私下问 Agent」先梳理思路。
                  </>
                )}
              </div>
            )}

            {filteredEvents.map((evt) => {
              const p = evt.payload;
              if (p.type === "message_posted") {
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
                    key={evt.id}
                    messageId={p.messageId}
                    isSelf={evt.actorId === currentMemberId}
                    member={state.members[evt.actorId]}
                    fallbackName={memberName(evt.actorId)}
                    displayLabel={memberLabels[evt.actorId]}
                    text={p.text}
                    timeLabel={formatMessageTime(evt.createdAt)}
                    grouped={grouped}
                    highlighted={highlightedMessageId === p.messageId}
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
                    onStartTopic={() =>
                      handleCreateTopicFromMessage(p.messageId, evt.actorId, p.text)
                    }
                  />
                );
              }

              // Non-message activity breaks consecutive bubble grouping
              lastMessageMeta = null;

              if (p.type === "topic_created") {
                const topic = state.topics[p.topicId];
                const count = topic?.messageCount ?? 0;
                return (
                  <div key={evt.id} className="mt-3 flex justify-center">
                    <button
                      type="button"
                      onClick={() => onSelectTopic(p.topicId)}
                      className="inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-left text-[12px] leading-[1.4] transition-opacity hover:opacity-85 cursor-pointer"
                      style={{
                        background: "var(--surface-2)",
                        color: "var(--text)",
                        border: "1px solid var(--border-strong)",
                      }}
                    >
                      <Hash size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                      <span className="truncate font-medium">
                        {memberName(evt.actorId)} 开启话题：{p.title}
                      </span>
                      <span
                        className="shrink-0 font-mono text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {count} 条
                      </span>
                      <span
                        className="inline-flex shrink-0 items-center gap-0.5 text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        进入
                        <ArrowUpRight size={11} />
                      </span>
                    </button>
                  </div>
                );
              }

              if (p.type === "card_created") {
                const card = state.cards[p.cardId];
                return (
                  <div key={evt.id} className="mt-4 flex justify-center">
                    <RefStripPill
                      cardId={p.cardId}
                      cardNumber={cardNumbers[p.cardId] ?? "#01"}
                      title={`新建卡片：${p.spec.title}`}
                      status={card?.status ?? "draft"}
                      hint="查看"
                      onSelect={onSelectCard}
                    />
                  </div>
                );
              }

              if (p.type === "card_claimed") {
                const card = state.cards[p.cardId];
                return (
                  <div key={evt.id} className="mt-3 flex justify-center">
                    <RefStripPill
                      cardId={p.cardId}
                      cardNumber={cardNumbers[p.cardId] ?? "#01"}
                      title={`${p.agentName} 认领「${card?.spec.title ?? p.cardId}」`}
                      status={card?.status ?? "claimed"}
                      hint="查看"
                      onSelect={onSelectCard}
                    />
                  </div>
                );
              }

              if (p.type === "output_submitted") {
                const card = state.cards[p.cardId];
                return (
                  <div key={evt.id} className="mt-3 flex justify-center">
                    <RefStripPill
                      cardId={p.cardId}
                      cardNumber={cardNumbers[p.cardId] ?? "#01"}
                      title={`产出待验收：${card?.spec.title ?? p.cardId}`}
                      status={card?.status ?? "pending_review"}
                      hint="验收"
                      onSelect={onSelectCard}
                    />
                  </div>
                );
              }

              if (p.type === "agent_stopped") {
                return (
                  <div
                    key={evt.id}
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[12px]"
                    style={{
                      background: "var(--sem-red-bg)",
                      color: "var(--sem-red)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                    }}
                  >
                    <span>
                      [急停] {memberName(p.stoppedBy)} 暂停了 {memberName(p.agentId)}
                      {p.reason ? `：${p.reason}` : ""}
                    </span>
                  </div>
                );
              }

              return null;
            })}

            {filteredPrivateItems.map((item) => (
              <PrivateBubble
                key={item.id}
                item={item}
                onShareToRoom={onSharePrivateToRoom}
                onTurnIntoCard={onTurnPrivateIntoCard}
                onDismiss={onDismissPrivate}
              />
            ))}
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
              {hasUnread ? "有新消息" : "回到底部"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Centered Apple-style Floating Composer */}
      <div className={`mx-auto w-full ${viewMode === "chat" ? "max-w-[852px]" : ""}`}>
        <FloatingComposer
          paneRef={paneRef}
          composerHeight={composerHeight}
          cards={cards}
          cardNumbers={cardNumbers}
          workingAgents={workingAgents}
          activeTopicTitle={activeTopic?.title ?? null}
          members={membersList}
          onChangeComposerHeight={onChangeComposerHeight}
          onSendMessage={handleComposerSend}
          onAskPrivate={onAskPrivate}
          onStopAgent={onStopAgent}
        />
      </div>
    </section>
  );
}

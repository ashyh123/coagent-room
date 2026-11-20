import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, MessageMeta, RoomEvent, RoomState } from "@coagent/protocol";
import { ArrowDown, Maximize2, Minimize2, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  buildCardNumberMap,
  formatMessageTime,
  shouldGroupMessages,
} from "../../utils/chat.js";
import { WorkspaceViewMode } from "../../utils/layout.js";
import { Button } from "../ui/Button.js";
import { FloatingComposer } from "./FloatingComposer.js";
import { MessageBubble } from "./MessageBubble.js";
import { RefStripPill } from "./RefStripPill.js";

interface ChatPaneProps {
  state: RoomState;
  events: readonly RoomEvent[];
  currentMemberId: string;
  viewMode: WorkspaceViewMode;
  composerHeight: number | null;
  onSendMessage: (
    text: string,
    options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta },
  ) => void;
  onSelectCard: (cardId: string) => void;
  onOpenNewCard: () => void;
  onStopAgent: (agentId: string, reason?: string) => void;
  onChangeComposerHeight: (height: number | null) => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  style?: React.CSSProperties;
}

export function ChatPane({
  state,
  events,
  currentMemberId,
  viewMode,
  composerHeight,
  onSendMessage,
  onSelectCard,
  onOpenNewCard,
  onStopAgent,
  onChangeComposerHeight,
  onChangeViewMode,
  style,
}: ChatPaneProps) {
  const paneRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

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

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setAtBottom(true);
    setHasUnread(false);
  };

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
      setHasUnread(false);
    } else if (events.length > 0) {
      setHasUnread(true);
    }
  }, [events.length, atBottom]);

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
        <span className="text-[13px] font-semibold">房间沟通</span>
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
              onClick={() => onChangeViewMode("split")}
            >
              展开看板
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable chat feed */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={feedRef}
          onScroll={handleFeedScroll}
          className="chat-feed flex-1 overflow-y-auto px-4 pt-3 pb-6"
        >
          <div
            className={`mx-auto flex w-full flex-col ${viewMode === "chat" ? "max-w-[820px]" : ""}`}
          >
            {events.length === 0 && (
              <div
                className="my-10 text-center text-[13px]"
                style={{ color: "var(--text-muted)" }}
              >
                房间已就绪。在下方发送指令、@Agent，或输入 <code>#</code> 引用卡片。
              </div>
            )}

            {events.map((evt) => {
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
                    isSelf={evt.actorId === currentMemberId}
                    member={state.members[evt.actorId]}
                    fallbackName={memberName(evt.actorId)}
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

              // Non-message activity breaks consecutive bubble grouping
              lastMessageMeta = null;

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
          onChangeComposerHeight={onChangeComposerHeight}
          onSendMessage={onSendMessage}
          onStopAgent={onStopAgent}
        />
      </div>
    </section>
  );
}

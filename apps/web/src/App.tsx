import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, InboxItem, MessageMeta, TopicAnchor } from "@coagent/protocol";
import { MotionConfig } from "motion/react";
import { BoardPane } from "./components/cards/BoardPane.js";
import { AgentSessionPane } from "./components/chat/AgentSessionPane.js";
import { ChatPane } from "./components/chat/ChatPane.js";
import { PrivateBotPane } from "./components/chat/PrivateBotPane.js";
import { PrivateQAItem } from "./components/chat/PrivateBubble.js";
import { JoinScreen } from "./components/join/JoinScreen.js";
import { AgentInviteModal } from "./components/modals/AgentInviteModal.js";
import { CardEditorModal } from "./components/modals/CardEditorModal.js";
import { SessionSidebar } from "./components/sidebar/SessionSidebar.js";
import { Topbar } from "./components/topbar/Topbar.js";
import { SelectionActionBar, SelectionActionPayload } from "./components/ui/SelectionActionBar.js";
import { TooltipProvider } from "./components/ui/Tooltip.js";
import { useSplitPane } from "./hooks/useSplitPane.js";
import { useTheme } from "./hooks/useTheme.js";
import { SessionInfo, useRoom } from "./store/useRoom.js";
import { ActiveChannel } from "./utils/channels.js";
import { formatPrivateShareText } from "./utils/privateShare.js";
import {
  buildDraftSpecFromText,
  buildTopicTitleFromText,
  loadDismissedMentions,
  saveDismissedMentions,
} from "./utils/inbox.js";
import { DEFAULT_CHAT_WIDTH, DEFAULT_SIDEBAR_WIDTH } from "./utils/layout.js";

const SESSION_STORAGE_KEY = "coagent_room_session_v1";

function loadSavedSession(): SessionInfo | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(loadSavedSession);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const [showNewCard, setShowNewCard] = useState(false);
  const [draftCardInitial, setDraftCardInitial] = useState<
    ReturnType<typeof buildDraftSpecFromText> | undefined
  >(undefined);
  const [showInviteAgent, setShowInviteAgent] = useState(false);

  const [activeChannel, setActiveChannel] = useState<ActiveChannel>({ kind: "room" });
  const activeTopicId = activeChannel.kind === "topic" ? activeChannel.topicId : null;
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [privateItems, setPrivateItems] = useState<PrivateQAItem[]>([]);
  const [dismissedMentions, setDismissedMentions] = useState<Set<string>>(() => new Set());

  const highlightTimerRef = useRef<number | undefined>(undefined);
  const focusTimerRef = useRef<number | undefined>(undefined);
  const pendingTopicCreationRef = useRef<{ title: string; existingIds: Set<string> } | null>(null);
  const sessionEpochRef = useRef(0);

  const { theme, setTheme } = useTheme();
  const room = useRoom(session);
  const split = useSplitPane(Boolean(session && room.state));
  const { setViewMode, setSidebarCollapsed, toggleSidebar, compact, setDrawerOpen } = split;
  const viewMode = split.viewMode;

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
      if (focusTimerRef.current) {
        window.clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    sessionEpochRef.current += 1;
    if (!session) {
      setDismissedMentions(new Set());
      setPrivateItems([]);
      setActiveChannel({ kind: "room" });
      setFocusMessageId(null);
      pendingTopicCreationRef.current = null;
      return;
    }
    setDismissedMentions(loadDismissedMentions(session.roomId, session.memberId));
    setPrivateItems([]);
    setActiveChannel({ kind: "room" });
    setFocusMessageId(null);
    pendingTopicCreationRef.current = null;
  }, [session?.roomId, session?.memberId]);

  useEffect(() => {
    const pending = pendingTopicCreationRef.current;
    const topics = room.state?.topics;
    if (!pending || !topics) return;

    const candidates = Object.values(topics).filter((t) => !pending.existingIds.has(t.id));
    if (candidates.length === 0) return;

    const exact = candidates.find((t) => t.title === pending.title) ?? candidates[candidates.length - 1];
    if (!exact) return;

    pendingTopicCreationRef.current = null;
    setActiveChannel({ kind: "topic", topicId: exact.id });
    if (viewMode === "board") {
      setViewMode("split");
    }
  }, [room.state?.topics, viewMode, setViewMode]);

  const handleJoined = (info: SessionInfo) => {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(info));
    } catch {
      // ignore
    }
    setSession(info);
  };

  const handleLeave = () => {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setSession(null);
    setSelectedCardId(null);
    setHighlightedCardId(null);
    setShowNewCard(false);
    setDraftCardInitial(undefined);
    setShowInviteAgent(false);
    setPrivateItems([]);
    setActiveChannel({ kind: "room" });
    setFocusMessageId(null);
  };

  const triggerFocusMessage = useCallback((messageId: string) => {
    setFocusMessageId(messageId);
    if (focusTimerRef.current) {
      window.clearTimeout(focusTimerRef.current);
    }
    focusTimerRef.current = window.setTimeout(() => {
      setFocusMessageId(null);
    }, 2400);
  }, []);

  const handleSelectCardFromChat = useCallback(
    (cardId: string) => {
      setSelectedCardId(cardId);
      setHighlightedCardId(cardId);
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlightedCardId(null);
      }, 1800);

      if (viewMode === "chat") {
        setViewMode("split");
      }
      requestAnimationFrame(() => {
        document.getElementById(`card-panel-${cardId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    },
    [viewMode, setViewMode],
  );

  const dismissMentionIds = useCallback(
    (ids: readonly string[]) => {
      if (!session || ids.length === 0) return;
      setDismissedMentions((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of ids) {
          if (id && !next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        if (!changed) return prev;
        saveDismissedMentions(session.roomId, session.memberId, next);
        return next;
      });
    },
    [session],
  );

  const handleSelectInboxItem = useCallback(
    (item: InboxItem) => {
      if (item.kind === "mention") {
        dismissMentionIds([item.targetId]);
      }

      if (item.kind === "agent_help") {
        const agentId = item.actorId ?? (item.targetType !== "card" ? item.targetId : undefined);
        if (agentId) {
          setActiveChannel({ kind: "agent", agentId });
        }
        if (item.targetType === "card") {
          handleSelectCardFromChat(item.targetId);
        }
        if (viewMode === "board") {
          setViewMode("split");
        }
        return;
      }

      if (item.targetType === "card") {
        handleSelectCardFromChat(item.targetId);
        return;
      }

      if (item.targetType === "topic") {
        setActiveChannel({ kind: "topic", topicId: item.topicId ?? item.targetId });
        if (viewMode === "board") {
          setViewMode("split");
        }
        return;
      }

      // Message target (e.g. @mention)
      setActiveChannel(item.topicId ? { kind: "topic", topicId: item.topicId } : { kind: "room" });
      if (viewMode === "board") {
        setViewMode("split");
      }
      triggerFocusMessage(item.targetId);
    },
    [dismissMentionIds, handleSelectCardFromChat, viewMode, setViewMode, triggerFocusMessage],
  );

  const handleClearMentions = useCallback(
    (mentionMessageIds: string[]) => {
      dismissMentionIds(mentionMessageIds);
    },
    [dismissMentionIds],
  );

  const handleCreateTopic = useCallback(
    (title: string, anchor?: TopicAnchor) => {
      const cleanTitle = title.trim().slice(0, 120);
      if (!cleanTitle) return;
      pendingTopicCreationRef.current = {
        title: cleanTitle,
        existingIds: new Set(Object.keys(room.state?.topics ?? {})),
      };
      room.createTopic(cleanTitle, anchor);
    },
    [room],
  );

  const handleCreateTopicFromCard = useCallback(
    (card: Card) => {
      const title = card.spec.title.trim().slice(0, 120) || "卡片讨论";
      const quote = card.spec.goal.trim().slice(0, 300);
      handleCreateTopic(title, {
        kind: "card",
        targetId: card.id,
        ...(quote ? { quote } : {}),
      });
    },
    [handleCreateTopic],
  );

  const handleSendMessageFromChat = useCallback(
    (
      text: string,
      options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta; topicId?: string },
    ) => {
      const resolvedTopicId =
        options?.topicId !== undefined ? options.topicId : (activeTopicId ?? undefined);
      room.postMessage(text, {
        ...options,
        topicId: resolvedTopicId,
      });
    },
    [activeTopicId, room],
  );

  const handleAskPrivate = useCallback(
    async (input: { question: string; quote?: string; model?: string }) => {
      const question = input.question.trim().slice(0, 2000);
      if (!question) return;

      const quote = input.quote?.trim().slice(0, 1000) || undefined;
      const model = input.model?.trim().slice(0, 100) || undefined;
      const topicId = activeTopicId ?? undefined;
      const activeCardId = selectedCardId ?? undefined;
      const itemId = `priv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const optimistic: PrivateQAItem = {
        id: itemId,
        question,
        answer: "",
        ...(quote ? { quote } : {}),
        createdAt: new Date().toISOString(),
        ...(topicId ? { topicId } : {}),
        source: "local_context",
        ...(model ? { model } : {}),
        pending: true,
      };

      const epoch = sessionEpochRef.current;
      setPrivateItems((prev) => [...prev, optimistic]);
      setActiveChannel({ kind: "private_bot" });
      if (viewMode === "board") {
        setViewMode("split");
      }

      try {
        const result = await room.askPrivateAgent({
          question,
          quote,
          activeCardId,
          topicId,
          model,
        });
        if (sessionEpochRef.current !== epoch) return;
        setPrivateItems((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  answer: result.answer,
                  source: result.source,
                  model: result.model ?? item.model,
                  pending: false,
                  error: undefined,
                }
              : item,
          ),
        );
      } catch (err) {
        if (sessionEpochRef.current !== epoch) return;
        const message = err instanceof Error ? err.message : "私密问答请求失败";
        setPrivateItems((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  pending: false,
                  error: message,
                }
              : item,
          ),
        );
      }
    },
    [activeTopicId, room, selectedCardId, viewMode, setViewMode],
  );

  const handleSharePrivateToRoom = useCallback(
    (item: PrivateQAItem) => {
      const text = formatPrivateShareText(item);
      if (!text.trim()) return;

      room.postMessage(text, {
        topicId: item.topicId ?? activeTopicId ?? undefined,
        refCardId: selectedCardId ?? undefined,
      });
    },
    [activeTopicId, room, selectedCardId],
  );

  const handleTurnPrivateIntoCard = useCallback((item: PrivateQAItem) => {
    const combined = [
      item.question,
      item.quote ? `引用：${item.quote}` : "",
      item.answer,
    ]
      .filter(Boolean)
      .join("\n\n");
    setDraftCardInitial(buildDraftSpecFromText(combined, "私密问答"));
    setShowNewCard(true);
  }, []);

  const handleDismissPrivate = useCallback((id: string) => {
    setPrivateItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleClearAllPrivate = useCallback(() => {
    setPrivateItems([]);
  }, []);

  const handleSelectChannel = useCallback(
    (channel: ActiveChannel) => {
      setActiveChannel(channel);
      if (compact) setDrawerOpen(false);
      if (viewMode === "board") {
        setViewMode(compact ? "chat" : "split");
      }
    },
    [compact, setDrawerOpen, viewMode, setViewMode],
  );

  const handleSelectTopic = useCallback((topicId: string | null) => {
    setActiveChannel(topicId ? { kind: "topic", topicId } : { kind: "room" });
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (compact) {
      setDrawerOpen((open) => !open);
      return;
    }
    if (viewMode === "board") {
      setViewMode("split");
      setSidebarCollapsed(false);
      return;
    }
    toggleSidebar();
  }, [compact, setDrawerOpen, viewMode, setViewMode, setSidebarCollapsed, toggleSidebar]);

  const handleOpenBlankNewCard = useCallback(() => {
    setDraftCardInitial(undefined);
    setShowNewCard(true);
  }, []);

  const handleSelectionCreateTopic = useCallback(
    (payload: SelectionActionPayload) => {
      const title = buildTopicTitleFromText(payload.text);
      const quote = payload.text.trim().slice(0, 300);
      handleCreateTopic(title, {
        kind: payload.anchorKind,
        ...(payload.targetId ? { targetId: payload.targetId } : {}),
        ...(quote ? { quote } : {}),
      });
    },
    [handleCreateTopic],
  );

  const handleSelectionAskPrivate = useCallback(
    (payload: SelectionActionPayload) => {
      void handleAskPrivate({
        question: "请结合当前房间上下文，帮我解读并分析这段内容：",
        quote: payload.text.slice(0, 1000),
      });
    },
    [handleAskPrivate],
  );

  const handleSelectionCreateDraftCard = useCallback((payload: SelectionActionPayload) => {
    setDraftCardInitial(buildDraftSpecFromText(payload.text, payload.sourceLabel));
    setShowNewCard(true);
  }, []);

  const centerPaneStyle: React.CSSProperties =
    viewMode === "split"
      ? { width: split.effectiveChatWidth, flex: "0 0 auto" }
      : { flex: "1 1 0", minWidth: 0 };

  const activeAgent =
    activeChannel.kind === "agent" ? room.state?.members[activeChannel.agentId] : undefined;
  const validAgent = activeAgent && activeAgent.kind === "agent" ? activeAgent : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        {!session || !room.state ? (
          <JoinScreen theme={theme} onChangeTheme={setTheme} onJoined={handleJoined} />
        ) : (
          <div className="workspace flex h-full flex-col" style={{ background: "var(--bg)" }}>
            <Topbar
              state={room.state}
              roomName={room.state.roomName}
              connected={room.connected}
              members={Object.values(room.state.members)}
              currentMemberId={session.memberId}
              cards={room.state.cards}
              dismissedMentions={dismissedMentions}
              viewMode={viewMode}
              sidebarCollapsed={compact ? !split.drawerOpen : split.layout.sidebarCollapsed}
              compact={compact}
              theme={theme}
              onChangeViewMode={split.setViewMode}
              onToggleSidebar={handleToggleSidebar}
              onChangeTheme={setTheme}
              onOpenInviteAgent={() => setShowInviteAgent(true)}
              onStopAgent={room.stopAgent}
              onSelectInboxItem={handleSelectInboxItem}
              onClearMentions={handleClearMentions}
              onLeave={handleLeave}
            />

            {room.lastError && (
              <div
                className="error-banner px-4 py-2 text-[12px]"
                style={{
                  background: "var(--sem-red-bg)",
                  color: "var(--sem-red)",
                  borderBottom: "1px solid rgba(239, 68, 68, 0.25)",
                }}
              >
                {room.lastError}
              </div>
            )}

            <main
              ref={split.panesRef}
              className={`panes mode-${viewMode} flex min-h-0 flex-1 overflow-hidden`}
            >
              {viewMode !== "board" && (
                <>
                  {!compact && (
                    <SessionSidebar
                      state={room.state}
                      currentMemberId={session.memberId}
                      activeChannel={activeChannel}
                      privateCount={privateItems.length}
                      collapsed={split.layout.sidebarCollapsed}
                      width={split.effectiveSidebarWidth}
                      onSelectChannel={handleSelectChannel}
                      onCreateTopic={handleCreateTopic}
                      onOpenInviteAgent={() => setShowInviteAgent(true)}
                      onToggleCollapse={split.toggleSidebar}
                    />
                  )}

                  {!compact && !split.layout.sidebarCollapsed && (
                    <div
                      className={`split-handle-x ${split.draggingSidebar ? "dragging" : ""}`}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="调整左侧会话导航栏宽度"
                      title={`拖拽调整宽度，双击恢复默认 (${DEFAULT_SIDEBAR_WIDTH}px)`}
                      tabIndex={0}
                      onPointerDown={split.handleSidebarPointerDown}
                      onPointerMove={split.handleSidebarPointerMove}
                      onPointerUp={split.handleSidebarPointerEnd}
                      onPointerCancel={split.handleSidebarPointerEnd}
                      onDoubleClick={split.resetSidebarWidth}
                      onKeyDown={split.handleSidebarKeyDown}
                    />
                  )}

                  {activeChannel.kind === "private_bot" ? (
                    <PrivateBotPane
                      state={room.state}
                      selectedCardId={selectedCardId}
                      viewMode={viewMode}
                      composerHeight={split.layout.composerHeight}
                      privateItems={privateItems}
                      onAskPrivate={handleAskPrivate}
                      onSharePrivateToRoom={handleSharePrivateToRoom}
                      onTurnPrivateIntoCard={handleTurnPrivateIntoCard}
                      onDismissPrivate={handleDismissPrivate}
                      onClearAllPrivate={handleClearAllPrivate}
                      onChangeComposerHeight={split.setComposerHeight}
                      onChangeViewMode={split.setViewMode}
                      style={centerPaneStyle}
                    />
                  ) : activeChannel.kind === "agent" && validAgent ? (
                    <AgentSessionPane
                      state={room.state}
                      events={room.events}
                      agent={validAgent}
                      currentMemberId={session.memberId}
                      selectedCardId={selectedCardId}
                      viewMode={viewMode}
                      composerHeight={split.layout.composerHeight}
                      onSendDirective={room.postMessage}
                      onSelectCard={handleSelectCardFromChat}
                      onStopAgent={room.stopAgent}
                      onOpenInviteAgent={() => setShowInviteAgent(true)}
                      onChangeComposerHeight={split.setComposerHeight}
                      onChangeViewMode={split.setViewMode}
                      style={centerPaneStyle}
                    />
                  ) : (
                    <ChatPane
                      state={room.state}
                      events={room.events}
                      currentMemberId={session.memberId}
                      viewMode={viewMode}
                      composerHeight={split.layout.composerHeight}
                      activeTopicId={activeTopicId}
                      hideTopicPills
                      privateItems={[]}
                      focusMessageId={focusMessageId}
                      onSendMessage={handleSendMessageFromChat}
                      onSelectCard={handleSelectCardFromChat}
                      onOpenNewCard={handleOpenBlankNewCard}
                      onStopAgent={room.stopAgent}
                      onChangeComposerHeight={split.setComposerHeight}
                      onChangeViewMode={split.setViewMode}
                      onSelectTopic={handleSelectTopic}
                      onCreateTopic={handleCreateTopic}
                      onAskPrivate={handleAskPrivate}
                      onSharePrivateToRoom={handleSharePrivateToRoom}
                      onTurnPrivateIntoCard={handleTurnPrivateIntoCard}
                      onDismissPrivate={handleDismissPrivate}
                      style={centerPaneStyle}
                    />
                  )}
                </>
              )}

              {viewMode === "split" && (
                <div
                  className={`split-handle-x ${split.draggingSplit ? "dragging" : ""}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整沟通栏与卡片看板宽度"
                  title={`拖拽调整宽度，双击恢复默认 (${DEFAULT_CHAT_WIDTH}px)`}
                  tabIndex={0}
                  onPointerDown={split.handleSplitPointerDown}
                  onPointerMove={split.handleSplitPointerMove}
                  onPointerUp={split.handleSplitPointerEnd}
                  onPointerCancel={split.handleSplitPointerEnd}
                  onDoubleClick={split.resetChatWidth}
                  onKeyDown={split.handleSplitKeyDown}
                />
              )}

              {viewMode !== "chat" && (
                <BoardPane
                  state={room.state}
                  events={room.events}
                  currentMemberId={session.memberId}
                  selectedCardId={selectedCardId}
                  highlightedCardId={highlightedCardId}
                  viewMode={viewMode}
                  cardListWidth={split.layout.cardListWidth}
                  cardListCollapsed={split.layout.cardListCollapsed}
                  onSelectCard={setSelectedCardId}
                  onConfirmCard={room.confirmCard}
                  onUpdateCard={room.updateCard}
                  onReviewCard={room.reviewCard}
                  onSendMessage={room.postMessage}
                  onStopAgent={room.stopAgent}
                  onChangeCardListWidth={split.setCardListWidth}
                  onToggleCardList={split.toggleCardList}
                  onChangeViewMode={split.setViewMode}
                  onOpenNewCard={handleOpenBlankNewCard}
                  onCreateTopicFromCard={handleCreateTopicFromCard}
                  style={{ flex: "1 1 0", minWidth: 0 }}
                />
              )}
            </main>

            {compact && split.drawerOpen && (
              <div
                className="fixed inset-0 z-40 flex"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setDrawerOpen(false);
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{ background: "rgba(0, 0, 0, 0.32)" }}
                  aria-hidden="true"
                  onClick={() => setDrawerOpen(false)}
                />
                <div
                  className="relative flex h-full"
                  style={{ boxShadow: "var(--shadow-popover)" }}
                >
                  <SessionSidebar
                    state={room.state}
                    currentMemberId={session.memberId}
                    activeChannel={activeChannel}
                    privateCount={privateItems.length}
                    collapsed={false}
                    width={Math.min(300, Math.round(window.innerWidth * 0.85))}
                    onSelectChannel={handleSelectChannel}
                    onCreateTopic={handleCreateTopic}
                    onOpenInviteAgent={() => {
                      setDrawerOpen(false);
                      setShowInviteAgent(true);
                    }}
                    onToggleCollapse={() => setDrawerOpen(false)}
                  />
                </div>
              </div>
            )}

            <SelectionActionBar
              onCreateTopic={handleSelectionCreateTopic}
              onAskPrivate={handleSelectionAskPrivate}
              onCreateDraftCard={handleSelectionCreateDraftCard}
            />

            {showNewCard && (
              <CardEditorModal
                open={showNewCard}
                initial={draftCardInitial}
                titleText={
                  draftCardInitial ? "基于摘录生成卡片草案" : "新建共识卡片（Card-as-Spec）"
                }
                onClose={() => {
                  setShowNewCard(false);
                  setDraftCardInitial(undefined);
                }}
                onSave={room.createCard}
              />
            )}

            {showInviteAgent && (
              <AgentInviteModal
                open={showInviteAgent}
                sessionToken={session.sessionToken}
                onClose={() => setShowInviteAgent(false)}
              />
            )}
          </div>
        )}
      </TooltipProvider>
    </MotionConfig>
  );
}

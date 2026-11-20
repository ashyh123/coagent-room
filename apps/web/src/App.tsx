import React, { useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { BoardPane } from "./components/cards/BoardPane.js";
import { ChatPane } from "./components/chat/ChatPane.js";
import { JoinScreen } from "./components/join/JoinScreen.js";
import { AgentInviteModal } from "./components/modals/AgentInviteModal.js";
import { CardEditorModal } from "./components/modals/CardEditorModal.js";
import { Topbar } from "./components/topbar/Topbar.js";
import { TooltipProvider } from "./components/ui/Tooltip.js";
import { useSplitPane } from "./hooks/useSplitPane.js";
import { useTheme } from "./hooks/useTheme.js";
import { SessionInfo, useRoom } from "./store/useRoom.js";
import { DEFAULT_CHAT_WIDTH } from "./utils/layout.js";

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
  const [showInviteAgent, setShowInviteAgent] = useState(false);

  const highlightTimerRef = useRef<number | undefined>(undefined);

  const { theme, setTheme } = useTheme();
  const room = useRoom(session);
  const split = useSplitPane(Boolean(session && room.state));

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

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
  };

  const handleSelectCardFromChat = (cardId: string) => {
    setSelectedCardId(cardId);
    setHighlightedCardId(cardId);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedCardId(null);
    }, 1800);

    if (split.layout.viewMode === "chat") {
      split.setViewMode("split");
    }
    requestAnimationFrame(() => {
      document.getElementById(`card-panel-${cardId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  };

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        {!session || !room.state ? (
          <JoinScreen theme={theme} onChangeTheme={setTheme} onJoined={handleJoined} />
        ) : (
          <div className="workspace flex h-full flex-col" style={{ background: "var(--bg)" }}>
            <Topbar
              roomName={room.state.roomName}
              connected={room.connected}
              members={Object.values(room.state.members)}
              currentMemberId={session.memberId}
              cards={room.state.cards}
              viewMode={split.layout.viewMode}
              theme={theme}
              onChangeViewMode={split.setViewMode}
              onChangeTheme={setTheme}
              onOpenInviteAgent={() => setShowInviteAgent(true)}
              onStopAgent={room.stopAgent}
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
              className={`panes mode-${split.layout.viewMode} flex min-h-0 flex-1 overflow-hidden`}
            >
              {split.layout.viewMode !== "board" && (
                <ChatPane
                  state={room.state}
                  events={room.events}
                  currentMemberId={session.memberId}
                  viewMode={split.layout.viewMode}
                  composerHeight={split.layout.composerHeight}
                  onSendMessage={room.postMessage}
                  onSelectCard={handleSelectCardFromChat}
                  onOpenNewCard={() => setShowNewCard(true)}
                  onStopAgent={room.stopAgent}
                  onChangeComposerHeight={split.setComposerHeight}
                  onChangeViewMode={split.setViewMode}
                  style={
                    split.layout.viewMode === "split"
                      ? { width: split.effectiveChatWidth, flex: "0 0 auto" }
                      : { flex: "1 1 0", minWidth: 0 }
                  }
                />
              )}

              {split.layout.viewMode === "split" && (
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

              {split.layout.viewMode !== "chat" && (
                <BoardPane
                  state={room.state}
                  events={room.events}
                  currentMemberId={session.memberId}
                  selectedCardId={selectedCardId}
                  highlightedCardId={highlightedCardId}
                  viewMode={split.layout.viewMode}
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
                  onOpenNewCard={() => setShowNewCard(true)}
                  style={{ flex: "1 1 0", minWidth: 0 }}
                />
              )}
            </main>

            {showNewCard && (
              <CardEditorModal
                open={showNewCard}
                titleText="新建共识卡片（Card-as-Spec）"
                onClose={() => setShowNewCard(false)}
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

import React, { useState } from "react";
import { AgentInviteModal } from "./components/AgentInviteModal.js";
import { BoardPane } from "./components/BoardPane.js";
import { CardEditorModal } from "./components/CardEditorModal.js";
import { ChatPane } from "./components/ChatPane.js";
import { JoinScreen } from "./components/JoinScreen.js";
import { SessionInfo, useRoom } from "./store/useRoom.js";

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
  const [showNewCard, setShowNewCard] = useState(false);
  const [showInviteAgent, setShowInviteAgent] = useState(false);

  const room = useRoom(session);

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

  if (!session || !room.state) {
    return <JoinScreen onJoined={handleJoined} />;
  }

  const members = Object.values(room.state.members);

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-left">
          <span className={`dot ${room.connected ? "online" : "offline"}`} />
          <span className="room-title">{room.state.roomName}</span>
          <div className="member-pills">
            {members.map((m) => (
              <span
                key={m.id}
                className={`pill ${m.kind === "agent" ? "agent" : ""} ${m.status === "stopped" ? "stopped" : ""}`}
              >
                <span className={`dot ${m.online ? "online" : "offline"}`} />
                {m.name}
                {m.kind === "agent" && m.status ? ` · ${m.status}` : ""}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="primary" onClick={() => setShowInviteAgent(true)}>
            + 接入我的 Agent
          </button>
          <button type="button" onClick={handleLeave}>
            退出
          </button>
        </div>
      </header>

      {room.lastError && (
        <div className="error-banner" style={{ borderRadius: 0 }}>
          {room.lastError}
        </div>
      )}

      <main className="panes">
        <ChatPane
          state={room.state}
          events={room.events}
          onSendMessage={room.postMessage}
          onSelectCard={setSelectedCardId}
          onOpenNewCard={() => setShowNewCard(true)}
        />
        <BoardPane
          state={room.state}
          currentMemberId={session.memberId}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
          onConfirmCard={room.confirmCard}
          onUpdateCard={room.updateCard}
          onReviewCard={room.reviewCard}
          onStopAgent={room.stopAgent}
        />
      </main>

      {showNewCard && (
        <CardEditorModal
          titleText="新建共识卡片（Card-as-Spec）"
          onClose={() => setShowNewCard(false)}
          onSave={room.createCard}
        />
      )}

      {showInviteAgent && (
        <AgentInviteModal
          sessionToken={session.sessionToken}
          onClose={() => setShowInviteAgent(false)}
        />
      )}
    </div>
  );
}

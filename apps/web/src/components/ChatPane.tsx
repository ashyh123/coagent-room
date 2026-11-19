import React, { useState } from "react";
import { RoomEvent, RoomState } from "@coagent/protocol";

interface ChatPaneProps {
  state: RoomState;
  events: readonly RoomEvent[];
  onSendMessage: (text: string) => void;
  onSelectCard: (cardId: string) => void;
  onOpenNewCard: () => void;
}

export function ChatPane({
  state,
  events,
  onSendMessage,
  onSelectCard,
  onOpenNewCard,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSendMessage(draft);
    setDraft("");
  };

  const memberName = (id: string) => state.members[id]?.name ?? id;

  return (
    <section className="chat-pane">
      <div className="pane-header">
        <span>房间沟通</span>
        <button type="button" onClick={onOpenNewCard}>
          + 新建共识卡片
        </button>
      </div>

      <div className="chat-feed">
        {events.map((evt) => {
          const p = evt.payload;
          if (p.type === "message_posted") {
            return (
              <div key={evt.id} className="msg-item">
                <div className="msg-meta">
                  <span className="msg-author">{memberName(evt.actorId)}</span>
                  <span>#{evt.seq}</span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{p.text}</div>
              </div>
            );
          }

          // Rule #19: "Every item has one home" -> left pane shows a single clickable reference strip
          if (p.type === "card_created") {
            return (
              <div key={evt.id} className="ref-strip" onClick={() => onSelectCard(p.cardId)}>
                <span>新卡片：{p.spec.title} · 草稿</span>
                <code>{p.versionHash}</code>
              </div>
            );
          }
          if (p.type === "card_claimed") {
            const card = state.cards[p.cardId];
            return (
              <div key={evt.id} className="ref-strip" onClick={() => onSelectCard(p.cardId)}>
                <span>
                  {p.agentName} 认领了「{card?.spec.title ?? p.cardId}」
                </span>
                <span>查看 →</span>
              </div>
            );
          }
          if (p.type === "output_submitted") {
            const card = state.cards[p.cardId];
            return (
              <div key={evt.id} className="ref-strip" onClick={() => onSelectCard(p.cardId)}>
                <span>产出已提交：「{card?.spec.title ?? p.cardId}」· 待验收</span>
                <span>验收 →</span>
              </div>
            );
          }
          if (p.type === "agent_stopped") {
            return (
              <div
                key={evt.id}
                className="error-banner"
                style={{ display: "flex", justifyContent: "space-between" }}
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

      <form className="chat-composer" onSubmit={handleSubmit}>
        <div className="composer-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="讨论需求或约定接口，回车发送..."
          />
          <button type="submit" className="primary" disabled={!draft.trim()}>
            发送
          </button>
        </div>
      </form>
    </section>
  );
}

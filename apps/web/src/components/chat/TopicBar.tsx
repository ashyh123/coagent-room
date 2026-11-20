import React, { useMemo, useRef, useState } from "react";
import { Card, redactRoomSecrets, Topic, TopicAnchor, TopicAnchorKind } from "@coagent/protocol";
import { ArrowLeft, ArrowUpRight, Hash, Plus, X } from "lucide-react";

export interface TopicBarProps {
  topics: Record<string, Topic>;
  activeTopicId: string | null;
  cards?: Record<string, Card>;
  cardNumbers?: Record<string, string>;
  hidePills?: boolean;
  onSelectTopic: (topicId: string | null) => void;
  onCreateTopic: (title: string, anchor?: TopicAnchor) => void;
  onSelectCard?: (cardId: string) => void;
}

const ANCHOR_LABELS: Record<TopicAnchorKind, string> = {
  message: "引用消息",
  card: "锚定卡片",
  output: "锚定产出",
  selection: "锚定片段",
};

export function TopicBar({
  topics,
  activeTopicId,
  cards,
  cardNumbers,
  hidePills = false,
  onSelectTopic,
  onCreateTopic,
  onSelectCard,
}: TopicBarProps) {
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const isComposingRef = useRef(false);

  const sortedTopics = useMemo(
    () =>
      Object.values(topics).sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt),
      ),
    [topics],
  );

  const activeTopic = activeTopicId ? topics[activeTopicId] : undefined;

  const submitCreate = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    onCreateTopic(trimmed.slice(0, 120));
    setNewTitle("");
    setCreating(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCreate();
  };

  const renderAnchorBadge = (anchor: TopicAnchor) => {
    const kindLabel = ANCHOR_LABELS[anchor.kind];
    const cardTarget = anchor.kind === "card" && anchor.targetId ? cards?.[anchor.targetId] : undefined;
    const cardNum = anchor.kind === "card" && anchor.targetId ? cardNumbers?.[anchor.targetId] : undefined;
    const quoteText =
      (anchor.quote ? redactRoomSecrets(anchor.quote) : undefined) ??
      (cardTarget ? `${cardNum ? `${cardNum} ` : ""}${cardTarget.spec.title}` : undefined);

    const content = (
      <>
        <span className="shrink-0 font-semibold">{kindLabel}</span>
        {quoteText && (
          <span className="max-w-[220px] truncate" style={{ color: "var(--text-muted)" }}>
            · {quoteText}
          </span>
        )}
      </>
    );

    if (anchor.kind === "card" && anchor.targetId && onSelectCard) {
      return (
        <button
          type="button"
          onClick={() => onSelectCard(anchor.targetId!)}
          title={quoteText ? `跳转到卡片：${quoteText}` : "跳转到锚定卡片"}
          className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-[1.35] transition-opacity hover:opacity-80 cursor-pointer"
          style={{
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border-strong)",
          }}
        >
          {content}
          <ArrowUpRight size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        </button>
      );
    }

    return (
      <span
        title={quoteText}
        className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-[1.35]"
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
        }}
      >
        {content}
      </span>
    );
  };

  if (hidePills && activeTopicId === null) {
    return null;
  }

  return (
    <div
      className="shrink-0"
      style={{
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {!hidePills && (
        <>
          {/* Horizontal monochrome topic pill bar */}
          <div className="flex items-center gap-2 overflow-x-auto px-4 py-2">
        <button
          type="button"
          onClick={() => onSelectTopic(null)}
          aria-pressed={activeTopicId === null}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12px] leading-[1.4] font-medium transition-opacity hover:opacity-85 cursor-pointer"
          style={
            activeTopicId === null
              ? {
                  background: "var(--primary-bg)",
                  color: "var(--primary-text)",
                  border: "1px solid var(--primary-bg)",
                }
              : {
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }
          }
        >
          <span>全部对话</span>
        </button>

        {sortedTopics.map((topic) => {
          const active = activeTopicId === topic.id;
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => onSelectTopic(topic.id)}
              aria-pressed={active}
              title={topic.title}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] leading-[1.4] font-medium transition-opacity hover:opacity-85 cursor-pointer"
              style={
                active
                  ? {
                      background: "var(--primary-bg)",
                      color: "var(--primary-text)",
                      border: "1px solid var(--primary-bg)",
                    }
                  : {
                      background: "var(--surface-2)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                    }
              }
            >
              <Hash size={11} className="shrink-0 opacity-75" />
              <span className="max-w-[140px] truncate">{topic.title}</span>
              <span className="font-mono text-[11px] opacity-70">{topic.messageCount}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-[1.4] font-medium transition-opacity hover:opacity-85 cursor-pointer"
          style={{
            background: "transparent",
            color: "var(--text-muted)",
            border: "1px dashed var(--border-strong)",
          }}
        >
          <Plus size={12} />
          新建话题
        </button>
      </div>

      {/* Inline topic creation row */}
      {creating && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-4 py-2"
          style={{
            background: "var(--surface-2)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <Hash size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            autoFocus
            maxLength={120}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setCreating(false);
                setNewTitle("");
              } else if (
                e.key === "Enter" &&
                (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229)
              ) {
                e.preventDefault();
              }
            }}
            placeholder="输入话题标题（如：登录鉴权方案）…"
            className="min-w-0 flex-1 px-2.5 py-1 text-[12px] leading-[1.4]"
            style={{
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-input)",
            }}
          />
          <button
            type="submit"
            disabled={!newTitle.trim()}
            className="inline-flex h-7 shrink-0 items-center rounded-[8px] px-2.5 text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "var(--primary-bg)",
              color: "var(--primary-text)",
              border: "1px solid var(--primary-bg)",
            }}
          >
            创建
          </button>
          <button
            type="button"
            aria-label="取消新建话题"
            onClick={() => {
              setCreating(false);
              setNewTitle("");
            }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] cursor-pointer hover:opacity-80"
            style={{
              background: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
            }}
          >
            <X size={13} />
          </button>
        </form>
      )}
        </>
      )}

      {/* Active topic anchored context strip */}
      {activeTopicId !== null && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
          style={{
            background: "var(--surface-2)",
            borderTop: hidePills ? undefined : "1px solid var(--border)",
          }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex min-w-0 items-center gap-1 text-[12px] font-semibold">
              <Hash size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="truncate">{activeTopic?.title ?? activeTopicId}</span>
            </span>
            {activeTopic?.anchor && renderAnchorBadge(activeTopic.anchor)}
          </div>

          <button
            type="button"
            onClick={() => onSelectTopic(null)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] leading-[1.35] font-medium transition-opacity hover:opacity-85 cursor-pointer"
            style={{
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border-strong)",
            }}
          >
            <ArrowLeft size={11} />
            返回主对话
          </button>
        </div>
      )}
    </div>
  );
}

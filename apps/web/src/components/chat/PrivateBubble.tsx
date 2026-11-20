import React from "react";
import { redactRoomSecrets } from "@coagent/protocol";
import { FilePlus2, Loader2, Lock, Send, Trash2 } from "lucide-react";
import { formatMessageTime } from "../../utils/chat.js";
import { Button } from "../ui/Button.js";

export interface PrivateQAItem {
  id: string;
  question: string;
  answer: string;
  quote?: string;
  createdAt: string;
  topicId?: string;
  source: "llm" | "local_context";
  model?: string;
  pending?: boolean;
  error?: string;
}

interface PrivateBubbleProps {
  item: PrivateQAItem;
  onShareToRoom: (item: PrivateQAItem) => void;
  onTurnIntoCard: (item: PrivateQAItem) => void;
  onDismiss: (id: string) => void;
}

export function PrivateBubble({
  item,
  onShareToRoom,
  onTurnIntoCard,
  onDismiss,
}: PrivateBubbleProps) {
  const canPromote = !item.pending && !item.error && item.answer.trim().length > 0;
  const timeLabel = formatMessageTime(item.createdAt);
  const sourceLabel = item.source === "llm" ? item.model || "AI 助手" : "本地上下文分析";

  return (
    <div
      data-private-qa-id={item.id}
      className="mt-4 ml-auto flex w-full max-w-[92%] flex-col gap-3 p-4"
      style={{
        background: "var(--surface-2)",
        color: "var(--text)",
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-bubble)",
      }}
    >
      {/* Header badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-[1.35] font-medium"
          style={{
            background: "var(--surface)",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
          }}
        >
          <Lock size={11} />
          仅自己可见 · 不进房间事件流
        </span>

        <div
          className="flex items-center gap-2 text-[11px] leading-[1.35]"
          style={{ color: "var(--text-muted)" }}
        >
          {!item.pending && !item.error && <span>{sourceLabel}</span>}
          {timeLabel && <span>{timeLabel}</span>}
        </div>
      </div>

      {/* Optional quoted text */}
      {item.quote && (
        <div
          className="px-3 py-2 text-[12px] leading-[1.4] break-words whitespace-pre-wrap"
          style={{
            background: "var(--surface)",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--border-strong)",
            borderRadius: "var(--radius-card-inner)",
          }}
        >
          {redactRoomSecrets(item.quote)}
        </div>
      )}

      {/* Question */}
      <div className="flex items-start gap-2 text-[13px] leading-[1.45] font-medium break-words whitespace-pre-wrap">
        <span
          className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full px-1.5 py-0 text-[10px] font-semibold"
          style={{
            background: "var(--primary-bg)",
            color: "var(--primary-text)",
          }}
        >
          问
        </span>
        <span className="min-w-0 flex-1">{item.question}</span>
      </div>

      {/* Answer / Loading / Error */}
      {item.pending ? (
        <div
          className="flex items-center gap-2 px-3 py-2.5 text-[13px] leading-[1.45]"
          style={{
            background: "var(--surface)",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card-inner)",
          }}
        >
          <Loader2 size={14} className="shrink-0 animate-spin" />
          <span>正在结合房间上下文分析…</span>
        </div>
      ) : item.error ? (
        <div
          className="px-3 py-2.5 text-[12px] leading-[1.4] break-words"
          style={{
            background: "var(--sem-red-bg)",
            color: "var(--sem-red)",
            border: "1px solid rgba(239, 68, 68, 0.28)",
            borderRadius: "var(--radius-card-inner)",
          }}
        >
          {item.error}
        </div>
      ) : (
        <div
          className="px-3 py-2.5 text-[13px] leading-[1.55] break-words whitespace-pre-wrap"
          style={{
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card-inner)",
          }}
        >
          {redactRoomSecrets(item.answer)}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPromote}
          onClick={() => onShareToRoom(item)}
        >
          <Send size={12} />
          发到房间里
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPromote}
          onClick={() => onTurnIntoCard(item)}
        >
          <FilePlus2 size={12} />
          转为卡片草案
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onDismiss(item.id)}
        >
          <Trash2 size={12} />
          删除
        </Button>
      </div>
    </div>
  );
}

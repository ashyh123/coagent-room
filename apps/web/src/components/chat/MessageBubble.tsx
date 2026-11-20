import React from "react";
import { Card, Member, MessageMeta, redactRoomSecrets } from "@coagent/protocol";
import { MessageSquarePlus, Paperclip } from "lucide-react";
import { formatFileSize } from "../../utils/chat.js";
import { Avatar } from "../ui/Avatar.js";
import { RefStripPill } from "./RefStripPill.js";

interface MessageBubbleProps {
  messageId: string;
  isSelf: boolean;
  member?: Member;
  fallbackName: string;
  /** Disambiguated label from buildMemberLabels (e.g. "Evan · 2"). */
  displayLabel?: string;
  text: string;
  timeLabel: string;
  grouped: boolean;
  highlighted?: boolean;
  refCard?: {
    id: string;
    number: string;
    title: string;
    status: Card["status"];
  };
  meta?: MessageMeta;
  onSelectCard: (cardId: string) => void;
  onStartTopic?: () => void;
}

const PERMISSION_LABELS: Record<string, string> = {
  ask: "Ask",
  auto: "Auto",
  plan: "Plan",
};

export function MessageBubble({
  messageId,
  isSelf,
  member,
  fallbackName,
  displayLabel,
  text,
  timeLabel,
  grouped,
  highlighted = false,
  refCard,
  meta,
  onSelectCard,
  onStartTopic,
}: MessageBubbleProps) {
  const displayName = displayLabel ?? member?.name ?? fallbackName;
  const isAgent = member?.kind === "agent";

  const bubbleRadiusStyle: React.CSSProperties = isSelf
    ? {
        borderRadius: "var(--radius-bubble)",
        ...(grouped ? {} : { borderTopRightRadius: "var(--radius-bubble-tail)" }),
        background: "var(--bubble-self)",
        color: "var(--bubble-self-text)",
        border: highlighted ? "1.5px solid var(--text)" : "1px solid transparent",
        boxShadow: highlighted ? "var(--shadow-popover)" : "none",
      }
    : {
        borderRadius: "var(--radius-bubble)",
        ...(grouped ? {} : { borderTopLeftRadius: "var(--radius-bubble-tail)" }),
        background: "var(--surface)",
        color: "var(--text)",
        border: highlighted ? "1.5px solid var(--text)" : "1px solid var(--border)",
        boxShadow: highlighted ? "var(--shadow-popover)" : "none",
      };

  const contextTag = [
    meta?.model,
    meta?.permissionMode ? PERMISSION_LABELS[meta.permissionMode] ?? meta.permissionMode : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-message-id={messageId}
      data-selectable-kind="message"
      className={`group flex items-start gap-2.5 ${isSelf ? "justify-end" : "justify-start"}`}
      style={{ marginTop: grouped ? "var(--space-1)" : "var(--space-5)" }}
    >
      {!isSelf &&
        (grouped ? (
          <span className="w-7 shrink-0" aria-hidden="true" />
        ) : (
          <Avatar
            name={member?.name ?? fallbackName}
            label={displayName}
            seed={member?.id}
            avatar={member?.avatar}
            isAgent={isAgent}
            showAgentBadge
            size={28}
            className="mt-0.5"
          />
        ))}

      <div
        className={`relative flex max-w-[82%] flex-col ${isSelf ? "items-end" : "items-start"} gap-1`}
      >
        {!grouped && (
          <div
            className={`flex flex-wrap items-center gap-1.5 px-1 text-[12px] leading-[1.4] ${isSelf ? "flex-row-reverse" : ""}`}
          >
            <span className="font-semibold">{displayName}</span>
            {isSelf && (
              <span
                className="rounded-full px-1.5 py-0 text-[10px] font-medium"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
              >
                我
              </span>
            )}
            {isAgent && (
              <span
                className="rounded-full px-1.5 py-0 text-[10px] font-medium"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
              >
                Agent
              </span>
            )}
            {timeLabel && (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {timeLabel}
              </span>
            )}
            {onStartTopic && (
              <button
                type="button"
                onClick={onStartTopic}
                title="基于此消息开话题"
                className="inline-flex items-center gap-1 rounded-full px-2 py-0 text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
              >
                <MessageSquarePlus size={10} />
                开话题
              </button>
            )}
          </div>
        )}

        {grouped && onStartTopic && (
          <button
            type="button"
            onClick={onStartTopic}
            title="基于此消息开话题"
            className={`absolute -top-2.5 ${isSelf ? "left-2" : "right-2"} z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer`}
            style={{
              background: "var(--surface)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-strong)",
              boxShadow: "var(--shadow-popover)",
            }}
          >
            <MessageSquarePlus size={10} />
            开话题
          </button>
        )}

        <div
          className="flex flex-col gap-2 px-3 py-2.5 text-[14px] leading-[1.55] break-words whitespace-pre-wrap transition-[border-color,box-shadow] duration-200"
          style={bubbleRadiusStyle}
        >
          {refCard && (
            <div>
              <RefStripPill
                cardId={refCard.id}
                cardNumber={refCard.number}
                title={refCard.title}
                status={refCard.status}
                onSelect={onSelectCard}
              />
            </div>
          )}

          <div>{redactRoomSecrets(text)}</div>

          {meta?.attachments && meta.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {meta.attachments.map((file, idx) => (
                <span
                  key={`${file.name}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                  style={{
                    background: isSelf ? "var(--surface)" : "var(--surface-2)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Paperclip size={11} />
                  <span className="max-w-[140px] truncate">{file.name}</span>
                  <span style={{ color: "var(--text-muted)" }}>{formatFileSize(file.size)}</span>
                </span>
              ))}
            </div>
          )}

          {contextTag && (
            <div className="text-[11px] leading-[1.35]" style={{ color: "var(--text-muted)" }}>
              {contextTag}
            </div>
          )}
        </div>
      </div>

      {isSelf &&
        (grouped ? (
          <span className="w-7 shrink-0" aria-hidden="true" />
        ) : (
          <Avatar
            name={member?.name ?? fallbackName}
            label={displayName}
            seed={member?.id}
            avatar={member?.avatar}
            isAgent={isAgent}
            size={28}
            className="mt-0.5"
          />
        ))}
    </div>
  );
}

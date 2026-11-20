import React from "react";
import { Card, Member, MessageMeta } from "@coagent/protocol";
import { Paperclip } from "lucide-react";
import { formatFileSize } from "../../utils/chat.js";
import { Avatar } from "../ui/Avatar.js";
import { RefStripPill } from "./RefStripPill.js";

interface MessageBubbleProps {
  isSelf: boolean;
  member?: Member;
  fallbackName: string;
  text: string;
  timeLabel: string;
  grouped: boolean;
  refCard?: {
    id: string;
    number: string;
    title: string;
    status: Card["status"];
  };
  meta?: MessageMeta;
  onSelectCard: (cardId: string) => void;
}

const PERMISSION_LABELS: Record<string, string> = {
  ask: "Ask",
  auto: "Auto",
  plan: "Plan",
};

export function MessageBubble({
  isSelf,
  member,
  fallbackName,
  text,
  timeLabel,
  grouped,
  refCard,
  meta,
  onSelectCard,
}: MessageBubbleProps) {
  const displayName = member?.name ?? fallbackName;
  const isAgent = member?.kind === "agent";

  const bubbleRadiusStyle: React.CSSProperties = isSelf
    ? {
        borderRadius: "var(--radius-bubble)",
        ...(grouped ? {} : { borderTopRightRadius: "var(--radius-bubble-tail)" }),
        background: "var(--bubble-self)",
        color: "var(--bubble-self-text)",
      }
    : {
        borderRadius: "var(--radius-bubble)",
        ...(grouped ? {} : { borderTopLeftRadius: "var(--radius-bubble-tail)" }),
        background: "var(--surface)",
        color: "var(--text)",
        border: "1px solid var(--border)",
      };

  const contextTag = [
    meta?.model,
    meta?.permissionMode ? PERMISSION_LABELS[meta.permissionMode] ?? meta.permissionMode : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`flex items-start gap-2.5 ${isSelf ? "justify-end" : "justify-start"}`}
      style={{ marginTop: grouped ? "var(--space-1)" : "var(--space-5)" }}
    >
      {!isSelf &&
        (grouped ? (
          <span className="w-7 shrink-0" aria-hidden="true" />
        ) : (
          <Avatar
            name={displayName}
            avatar={member?.avatar}
            isAgent={isAgent}
            showAgentBadge
            size={28}
            className="mt-0.5"
          />
        ))}

      <div className={`flex max-w-[82%] flex-col ${isSelf ? "items-end" : "items-start"} gap-1`}>
        {!grouped && (
          <div
            className={`flex items-center gap-1.5 px-1 text-[12px] leading-[1.4] ${isSelf ? "flex-row-reverse" : ""}`}
          >
            <span className="font-semibold">{isSelf ? "Me" : displayName}</span>
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
          </div>
        )}

        <div
          className="flex flex-col gap-2 px-3 py-2.5 text-[14px] leading-[1.55] break-words whitespace-pre-wrap"
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

          <div>{text}</div>

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
            name={displayName}
            avatar={member?.avatar}
            isAgent={isAgent}
            size={28}
            className="mt-0.5"
          />
        ))}
    </div>
  );
}

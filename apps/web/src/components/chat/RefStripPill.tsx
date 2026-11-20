import React from "react";
import { Card } from "@coagent/protocol";
import { ArrowUpRight } from "lucide-react";

interface RefStripPillProps {
  cardId: string;
  cardNumber: string;
  title: string;
  status?: Card["status"];
  hint?: string;
  onSelect: (cardId: string) => void;
}

function getCardDotColor(status?: Card["status"]): string {
  switch (status) {
    case "confirmed":
    case "accepted":
      return "var(--sem-green)";
    case "claimed":
    case "pending_review":
      return "var(--sem-amber)";
    default:
      return "var(--text-muted)";
  }
}

export function RefStripPill({
  cardId,
  cardNumber,
  title,
  status,
  hint,
  onSelect,
}: RefStripPillProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(cardId)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-left text-[12px] leading-[1.4] transition-opacity hover:opacity-85 cursor-pointer"
      style={{
        background: "var(--surface-2)",
        color: "var(--text)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: getCardDotColor(status) }}
      />
      <span
        className="shrink-0 font-mono text-[11px] font-medium"
        style={{ color: "var(--text-muted)" }}
      >
        {cardNumber}
      </span>
      <span className="truncate font-medium">{title}</span>
      {hint && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          {hint}
          <ArrowUpRight size={11} />
        </span>
      )}
    </button>
  );
}

import React, { useMemo, useState } from "react";
import { Card, Member, Output } from "@coagent/protocol";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { parseDiff } from "../../utils/diff.js";
import { Button } from "../ui/Button.js";

interface DiffCardProps {
  output: Output;
  cardStatus: Card["status"];
  members: Record<string, Member>;
  defaultExpanded?: boolean;
  onAccept: () => void;
  onRequestChanges: () => void;
}

export function DiffCard({
  output,
  cardStatus,
  members,
  defaultExpanded = true,
  onAccept,
  onRequestChanges,
}: DiffCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const parsed = useMemo(
    () => (output.diff ? parseDiff(output.diff) : null),
    [output.diff],
  );

  const titleLabel =
    parsed?.fileName ?? (output.branch ? `branch:${output.branch}` : output.summary);
  const submitter = members[output.submittedBy]?.name ?? output.submittedBy;

  const statusBadge =
    cardStatus === "accepted"
      ? { label: "已批准", color: "var(--sem-green)", bg: "var(--sem-green-bg)" }
      : cardStatus === "pending_review"
        ? { label: "待审查", color: "var(--sem-amber)", bg: "var(--sem-amber-bg)" }
        : { label: "已记录", color: "var(--text-muted)", bg: "var(--surface-2)" };

  return (
    <article
      className="overflow-hidden"
      style={{
        background: "var(--surface)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer transition-opacity hover:opacity-85"
        style={{ background: "transparent", color: "var(--text)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown size={15} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronRight size={15} style={{ color: "var(--text-muted)" }} />
          )}
          <span className="truncate font-mono text-[13px] font-medium">{titleLabel}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {parsed && (parsed.additions > 0 || parsed.deletions > 0) && (
            <span className="flex items-center gap-1.5 font-mono text-[12px] font-medium">
              <span style={{ color: "var(--sem-green)" }}>+{parsed.additions}</span>
              <span style={{ color: "var(--sem-red)" }}>-{parsed.deletions}</span>
            </span>
          )}
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: statusBadge.bg, color: statusBadge.color }}
          >
            {statusBadge.label}
          </span>
        </div>
      </button>

      {/* Animated Expandable Diff Body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="overflow-hidden"
          >
            <div
              className="flex flex-col gap-3 px-4 pt-2 pb-4"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <div
                className="flex flex-wrap items-center justify-between gap-2 text-[12px]"
                style={{ color: "var(--text-muted)" }}
              >
                <span>
                  提交者 <strong style={{ color: "var(--text)" }}>{submitter}</strong> ·{" "}
                  {output.summary}
                </span>
                <div className="flex items-center gap-2">
                  {output.branch && (
                    <code
                      className="rounded-[6px] px-1.5 py-0.5 text-[11px]"
                      style={{ background: "var(--surface-2)" }}
                    >
                      {output.branch}
                    </code>
                  )}
                  <code
                    className="rounded-[6px] px-1.5 py-0.5 text-[11px]"
                    style={{ background: "var(--surface-2)" }}
                  >
                    {output.cardVersionHash}
                  </code>
                </div>
              </div>

              {output.previewUrl && (
                <a
                  href={output.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-[12px] underline"
                  style={{ color: "var(--text)" }}
                >
                  打开预览链接
                  <ExternalLink size={12} />
                </a>
              )}

              {parsed && parsed.lines.length > 0 && (
                <div
                  className="max-h-[340px] overflow-auto py-1"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-card-inner)",
                  }}
                >
                  {parsed.lines.map((row, idx) => (
                    <div key={idx} className={`diff-line ${row.kind} px-2`}>
                      <span
                        className="select-none pr-2 text-right"
                        style={{ color: "var(--text-muted)", opacity: 0.65 }}
                      >
                        {row.oldLine ?? ""}
                      </span>
                      <span
                        className="select-none pr-2 text-right"
                        style={{ color: "var(--text-muted)", opacity: 0.65 }}
                      >
                        {row.newLine ?? ""}
                      </span>
                      <span className="whitespace-pre">{row.content}</span>
                    </div>
                  ))}
                </div>
              )}

              {cardStatus === "pending_review" && (
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={onRequestChanges}>
                    退回修改
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={onAccept}>
                    批准
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

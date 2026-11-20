import React, { useState } from "react";
import { Card, Member, WorkStep } from "@coagent/protocol";
import { Check, ChevronDown, ChevronRight, Edit3, FileCode2 } from "lucide-react";
import { Avatar } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";

const STATUS_LABELS: Record<Card["status"], string> = {
  draft: "草案",
  confirmed: "已确认 · 待认领",
  claimed: "执行中",
  pending_review: "待审查",
  accepted: "已验收",
};

function getStatusDotColor(status: Card["status"]): string {
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

interface SpecCardProps {
  card: Card;
  cardNumber: string;
  members: Record<string, Member>;
  currentMemberId: string;
  minConfirmations: number;
  workSteps: readonly WorkStep[];
  highlighted: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}

export function SpecCard({
  card,
  cardNumber,
  members,
  currentMemberId,
  minConfirmations,
  workSteps,
  highlighted,
  onConfirm,
  onEdit,
}: SpecCardProps) {
  const [showGlobs, setShowGlobs] = useState(false);
  const [showSteps, setShowSteps] = useState(workSteps.length > 0);
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});

  const hasConfirmed = card.confirmations.some(
    (c) => c.memberId === currentMemberId && c.versionHash === card.versionHash,
  );

  // Deduplicated participants for micro avatar stack
  const participantIds = Array.from(
    new Set(
      [
        card.createdBy,
        ...card.confirmations.map((c) => c.memberId),
        card.claimedByAgentId,
      ].filter((id): id is string => Boolean(id)),
    ),
  );

  return (
    <article
      id={`card-panel-${card.id}`}
      className="flex flex-col gap-3 p-4 transition-[border-color,box-shadow] duration-200"
      style={{
        background: "var(--surface)",
        color: "var(--text)",
        border: highlighted ? "1.5px solid var(--text)" : "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: highlighted ? "var(--shadow-popover)" : "none",
      }}
    >
      {/* Top row: status dot + #ID + 2-line title + micro avatar stack */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: getStatusDotColor(card.status) }}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className="font-mono text-[12px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                {cardNumber}
              </span>
              <h2 className="m-0 line-clamp-2 text-[16px] leading-[1.35] font-semibold tracking-[-0.01em]">
                {card.spec.title}
              </h2>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          {participantIds.slice(0, 4).map((id, idx) => {
            const m = members[id];
            return (
              <Avatar
                key={id}
                name={m?.name ?? id}
                avatar={m?.avatar}
                isAgent={m?.kind === "agent"}
                size={20}
                style={{
                  marginLeft: idx === 0 ? 0 : -4,
                  border: "2px solid var(--surface)",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Meta & primary action row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowGlobs((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium cursor-pointer transition-opacity hover:opacity-80"
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            <FileCode2 size={12} style={{ color: "var(--text-muted)" }} />
            {card.spec.fileGlobs.length} files locked
          </button>

          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
            }}
          >
            {STATUS_LABELS[card.status]}
          </span>

          <code
            className="rounded-[6px] px-1.5 py-0.5 text-[11px]"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
            }}
          >
            {card.versionHash}
          </code>
        </div>

        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            <Edit3 size={12} />
            编辑
          </Button>
          {card.status === "accepted" || hasConfirmed ? (
            <span
              className="inline-flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[12px] font-medium"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
              }}
            >
              <Check size={12} />
              已确认 ({card.confirmations.length}/{minConfirmations})
            </span>
          ) : (
            <Button type="button" variant="primary" size="sm" onClick={onConfirm}>
              确认 Spec
            </Button>
          )}
        </div>
      </div>

      {/* Expandable locked file globs */}
      {showGlobs && (
        <div
          className="flex flex-wrap gap-1.5 p-2.5"
          style={{
            background: "var(--surface-2)",
            borderRadius: "var(--radius-card-inner)",
            border: "1px solid var(--border)",
          }}
        >
          {card.spec.fileGlobs.map((glob) => (
            <code
              key={glob}
              className="rounded-[6px] px-2 py-0.5 text-[12px]"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              {glob}
            </code>
          ))}
        </div>
      )}

      {/* Spec Description */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>
          Spec
        </span>
        <div className="text-[14px] leading-[1.55] whitespace-pre-wrap">{card.spec.goal}</div>
      </div>

      {card.spec.interfaceContract && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            接口约定
          </span>
          <pre
            className="m-0 overflow-x-auto p-3 text-[12.5px] leading-[1.55] whitespace-pre-wrap"
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              borderRadius: "var(--radius-card-inner)",
              border: "1px solid var(--border)",
            }}
          >
            {card.spec.interfaceContract}
          </pre>
        </div>
      )}

      {card.spec.acceptanceCriteria.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            验收标准
          </span>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-[1.45]">
            {card.spec.acceptanceCriteria.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Work steps log */}
      {workSteps.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="flex items-center gap-1 text-[12px] font-medium cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            {showSteps ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            执行节点（{workSteps.length}）
          </button>

          {showSteps && (
            <div className="mt-2 flex flex-col gap-2">
              {workSteps.map((step) => {
                const actor = members[step.agentId]?.name ?? step.agentId;
                const expanded = Boolean(expandedStepIds[step.id]);
                return (
                  <div
                    key={step.id}
                    className="pl-2.5 text-[13px] leading-[1.45]"
                    style={{ borderLeft: "2px solid var(--border-strong)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <strong className="font-semibold">{actor}</strong>：{step.summary}
                      </span>
                      {step.detail && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedStepIds((prev) => ({
                              ...prev,
                              [step.id]: !prev[step.id],
                            }))
                          }
                          className="shrink-0 text-[11px] underline cursor-pointer"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {expanded ? "收起" : "详情"}
                        </button>
                      )}
                    </div>
                    {step.detail && expanded && (
                      <pre
                        className="mt-1.5 mb-0 overflow-x-auto p-2 text-[12px] whitespace-pre-wrap"
                        style={{
                          background: "var(--surface-2)",
                          color: "var(--text-muted)",
                          borderRadius: "8px",
                        }}
                      >
                        {step.detail}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

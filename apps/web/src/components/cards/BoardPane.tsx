import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardSpec, MessageMeta, RoomEvent, RoomState } from "@coagent/protocol";
import { Maximize2, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { buildCardNumberMap } from "../../utils/chat.js";
import {
  DEFAULT_CARD_LIST_WIDTH,
  WorkspaceViewMode,
  clampCardListWidth,
} from "../../utils/layout.js";
import { Button } from "../ui/Button.js";
import { CardEditorModal } from "../modals/CardEditorModal.js";
import { AgentApprovalCard } from "./AgentApprovalCard.js";
import { DiffCard } from "./DiffCard.js";
import { SpecCard } from "./SpecCard.js";

type CardFilter = "all" | "spec" | "diff" | "approval";

const FILTER_OPTIONS: ReadonlyArray<{ id: CardFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "spec", label: "Spec" },
  { id: "diff", label: "Diff" },
  { id: "approval", label: "审批" },
];

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

interface BoardPaneProps {
  state: RoomState;
  events: readonly RoomEvent[];
  currentMemberId: string;
  selectedCardId: string | null;
  highlightedCardId: string | null;
  viewMode: WorkspaceViewMode;
  cardListWidth: number;
  cardListCollapsed: boolean;
  onSelectCard: (cardId: string) => void;
  onConfirmCard: (cardId: string, versionHash: string) => void;
  onUpdateCard: (cardId: string, spec: CardSpec) => void;
  onReviewCard: (
    cardId: string,
    outputId: string,
    decision: "accepted" | "changes_requested",
  ) => void;
  onSendMessage: (
    text: string,
    options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta },
  ) => void;
  onStopAgent: (agentId: string, reason?: string) => void;
  onChangeCardListWidth: (width: number) => void;
  onToggleCardList: () => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  onOpenNewCard: () => void;
  style?: React.CSSProperties;
}

export function BoardPane({
  state,
  events,
  currentMemberId,
  selectedCardId,
  highlightedCardId,
  viewMode,
  cardListWidth,
  cardListCollapsed,
  onSelectCard,
  onConfirmCard,
  onUpdateCard,
  onReviewCard,
  onSendMessage,
  onStopAgent,
  onChangeCardListWidth,
  onToggleCardList,
  onChangeViewMode,
  onOpenNewCard,
  style,
}: BoardPaneProps) {
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<CardFilter>("all");
  const [boardWidth, setBoardWidth] = useState<number | undefined>(undefined);
  const [draggingList, setDraggingList] = useState(false);

  const boardBodyRef = useRef<HTMLDivElement | null>(null);
  const listDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const el = boardBodyRef.current;
    if (!el) return;

    const updateWidth = () => setBoardWidth(el.clientWidth);
    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  const cards = useMemo(
    () =>
      Object.values(state.cards).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.cards],
  );
  const cardNumbers = useMemo(
    () => buildCardNumberMap(events, state.cards),
    [events, state.cards],
  );

  const selected = (selectedCardId ? state.cards[selectedCardId] : null) ?? cards[0] ?? null;

  const cardSteps = selected
    ? state.workSteps.filter((s) => s.cardId === selected.id)
    : [];
  const cardOutputs = selected
    ? Object.values(state.outputs)
        .filter((o) => o.cardId === selected.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  // Active agents needing attention or running (for selected card, or global if none selected)
  const activeAgents = useMemo(
    () =>
      Object.values(state.members).filter((m) => {
        if (m.kind !== "agent" || !m.online) return false;
        if (m.status !== "waiting_human" && m.status !== "working") return false;
        if (!selected) return true;
        return !m.activeCardId || m.activeCardId === selected.id;
      }),
    [state.members, selected],
  );

  const effectiveCardListWidth = clampCardListWidth(cardListWidth, boardWidth);

  const handleListPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }
    listDragRef.current = { startX: e.clientX, startWidth: effectiveCardListWidth };
    setDraggingList(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const handleListPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!listDragRef.current) return;
    const width = boardBodyRef.current?.clientWidth ?? boardWidth;
    const nextWidth = clampCardListWidth(
      listDragRef.current.startWidth + (e.clientX - listDragRef.current.startX),
      width,
    );
    onChangeCardListWidth(nextWidth);
  };

  const handleListPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!listDragRef.current) return;
    listDragRef.current = null;
    setDraggingList(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const width = boardBodyRef.current?.clientWidth ?? boardWidth;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onChangeCardListWidth(clampCardListWidth(effectiveCardListWidth - 20, width));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onChangeCardListWidth(clampCardListWidth(effectiveCardListWidth + 20, width));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChangeCardListWidth(clampCardListWidth(DEFAULT_CARD_LIST_WIDTH, width));
    }
  };

  return (
    <section
      className="board-pane flex min-h-0 min-w-0 flex-col"
      style={{ background: "var(--bg)", ...style }}
    >
      {/* Clean Monochrome Board Header */}
      <div
        className="flex h-11 shrink-0 items-center justify-between gap-2 px-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleCardList}
            title={cardListCollapsed ? "展开卡片列表侧边栏" : "收起卡片列表侧边栏"}
          >
            {cardListCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
            {cardListCollapsed ? `卡片列表 (${cards.length})` : "收起列表"}
          </Button>

          <div
            className="inline-flex items-center gap-0.5 p-0.5"
            style={{
              background: "var(--surface-2)",
              borderRadius: "8px",
              border: "1px solid var(--border)",
            }}
          >
            {FILTER_OPTIONS.map((opt) => {
              const active = filter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFilter(opt.id)}
                  className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium cursor-pointer"
                  style={
                    active
                      ? {
                          background: "var(--surface)",
                          color: "var(--text)",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                        }
                      : { background: "transparent", color: "var(--text-muted)" }
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {viewMode === "board" && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onOpenNewCard}>
                <Plus size={13} />
                新建 Spec
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="恢复分栏视图"
                onClick={() => onChangeViewMode("split")}
              >
                展开沟通
              </Button>
            </>
          )}
          {viewMode === "split" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="仅查看卡片界面"
              onClick={() => onChangeViewMode("board")}
            >
              <Maximize2 size={12} />
              全屏
            </Button>
          )}
        </div>
      </div>

      {/* Board Body: optional resizable card-list sidebar + stacked 3-card detail */}
      <div ref={boardBodyRef} className="board-body flex min-h-0 flex-1 overflow-hidden">
        {!cardListCollapsed && (
          <>
            <aside
              className="card-list flex flex-col gap-2 overflow-y-auto p-3"
              style={{
                width: effectiveCardListWidth,
                flex: "0 0 auto",
                background: "var(--bg)",
              }}
            >
              {cards.length === 0 ? (
                <div className="p-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
                  暂无 Spec 卡片
                </div>
              ) : (
                cards.map((card) => {
                  const active = selected?.id === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => onSelectCard(card.id)}
                      className="flex w-full flex-col gap-1.5 p-3 text-left cursor-pointer transition-colors"
                      style={{
                        background: active ? "var(--surface)" : "transparent",
                        border: active
                          ? "1px solid var(--border-strong)"
                          : "1px solid var(--border)",
                        borderRadius: "var(--radius-card-inner)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: getStatusDotColor(card.status) }}
                          />
                          <span
                            className="font-mono text-[11px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {cardNumbers[card.id] ?? "#01"}
                          </span>
                          <span className="truncate text-[13px] font-semibold">
                            {card.spec.title}
                          </span>
                        </span>
                      </div>
                      <div
                        className="flex items-center justify-between text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <span>{card.spec.fileGlobs.length} files</span>
                        <span>{card.claimedByAgentName ?? card.versionHash}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </aside>

            <div
              className={`split-handle-x ${draggingList ? "dragging" : ""}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整卡片列表侧边栏宽度"
              title="拖拽调整宽度，双击恢复默认"
              tabIndex={0}
              onPointerDown={handleListPointerDown}
              onPointerMove={handleListPointerMove}
              onPointerUp={handleListPointerEnd}
              onPointerCancel={handleListPointerEnd}
              onDoubleClick={() => onChangeCardListWidth(DEFAULT_CARD_LIST_WIDTH)}
              onKeyDown={handleListKeyDown}
            />
          </>
        )}

        {/* Right Detail Canvas */}
        <div className="card-detail flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Quick card switcher pill strip when sidebar is collapsed and multiple cards exist */}
          {cardListCollapsed && cards.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {cards.map((card) => {
                const active = selected?.id === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onSelectCard(card.id)}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium cursor-pointer"
                    style={{
                      background: active ? "var(--primary-bg)" : "var(--surface)",
                      color: active ? "var(--primary-text)" : "var(--text)",
                      border: active ? "1px solid var(--primary-bg)" : "1px solid var(--border)",
                    }}
                  >
                    <span className="font-mono text-[11px] opacity-75">
                      {cardNumbers[card.id]}
                    </span>
                    <span className="max-w-[160px] truncate">{card.spec.title}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {!selected && activeAgents.length === 0 ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
              style={{
                background: "var(--surface)",
                border: "1px dashed var(--border-strong)",
                borderRadius: "var(--radius-card)",
              }}
            >
              <div className="text-[16px] font-semibold">尚无共识卡片</div>
              <p
                className="m-0 max-w-[360px] text-[13px] leading-[1.5]"
                style={{ color: "var(--text-muted)" }}
              >
                用一张 Spec 卡片锁定目标、接口约定与 fileGlobs，多 Agent 将在各自锁定范围内安全并行交付。
              </p>
              <Button type="button" variant="primary" size="md" onClick={onOpenNewCard}>
                <Plus size={14} />
                新建第一张 Spec 卡片
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* 1. Spec Card */}
              {selected && (filter === "all" || filter === "spec") && (
                <SpecCard
                  card={selected}
                  cardNumber={cardNumbers[selected.id] ?? "#01"}
                  members={state.members}
                  currentMemberId={currentMemberId}
                  minConfirmations={state.minConfirmations}
                  workSteps={cardSteps}
                  highlighted={highlightedCardId === selected.id}
                  onConfirm={() => onConfirmCard(selected.id, selected.versionHash)}
                  onEdit={() => setEditing(true)}
                />
              )}

              {/* 2. Diff Review Cards */}
              {selected &&
                (filter === "all" || filter === "diff") &&
                cardOutputs.map((out, idx) => (
                  <DiffCard
                    key={out.id}
                    output={out}
                    cardStatus={selected.status}
                    members={state.members}
                    defaultExpanded={selected.status === "pending_review" || idx === 0}
                    onAccept={() => onReviewCard(selected.id, out.id, "accepted")}
                    onRequestChanges={() =>
                      onReviewCard(selected.id, out.id, "changes_requested")
                    }
                  />
                ))}

              {selected && filter === "diff" && cardOutputs.length === 0 && (
                <div
                  className="p-6 text-center text-[13px]"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-card)",
                    color: "var(--text-muted)",
                  }}
                >
                  此卡片尚无提交的 Diff 产出
                </div>
              )}

              {/* 3. Agent Running / Approval Cards */}
              {(filter === "all" || filter === "approval") &&
                activeAgents.map((agent) => {
                  const latestStep = [...state.workSteps]
                    .reverse()
                    .find(
                      (s) =>
                        s.agentId === agent.id &&
                        (!selected || s.cardId === selected.id),
                    );
                  return (
                    <AgentApprovalCard
                      key={agent.id}
                      agent={agent}
                      latestStep={latestStep}
                      onApprove={() =>
                        onSendMessage(`@${agent.name} 允许继续执行`, {
                          mentions: [agent.id],
                          refCardId: agent.activeCardId ?? selected?.id,
                        })
                      }
                      onDeny={() =>
                        onSendMessage(`@${agent.name} 拒绝此次操作请求`, {
                          mentions: [agent.id],
                          refCardId: agent.activeCardId ?? selected?.id,
                        })
                      }
                      onStop={() => onStopAgent(agent.id, "协作者在审批卡片触发急停")}
                    />
                  );
                })}

              {filter === "approval" && activeAgents.length === 0 && (
                <div
                  className="p-6 text-center text-[13px]"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-card)",
                    color: "var(--text-muted)",
                  }}
                >
                  当前没有运行中或等待权限审批的 Agent
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && selected && (
        <CardEditorModal
          open={editing}
          initial={selected.spec}
          titleText="编辑共识卡片（修改后将重置版本号并需重新确认）"
          onClose={() => setEditing(false)}
          onSave={(spec) => onUpdateCard(selected.id, spec)}
        />
      )}
    </section>
  );
}

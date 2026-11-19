import React, { useState } from "react";
import { Card, CardSpec, RoomState } from "@coagent/protocol";
import { classifyDiffLine } from "../utils/diff.js";
import { CardEditorModal } from "./CardEditorModal.js";

const STATUS_LABELS: Record<Card["status"], string> = {
  draft: "草案",
  confirmed: "已确认 · 待认领",
  claimed: "Agent 执行中",
  pending_review: "待验收产出",
  accepted: "已验收",
};

interface BoardPaneProps {
  state: RoomState;
  currentMemberId: string;
  selectedCardId: string | null;
  onSelectCard: (cardId: string) => void;
  onConfirmCard: (cardId: string, versionHash: string) => void;
  onUpdateCard: (cardId: string, spec: CardSpec) => void;
  onReviewCard: (cardId: string, outputId: string, decision: "accepted" | "changes_requested") => void;
  onStopAgent: (agentId: string, reason?: string) => void;
}

export function BoardPane({
  state,
  currentMemberId,
  selectedCardId,
  onSelectCard,
  onConfirmCard,
  onUpdateCard,
  onReviewCard,
  onStopAgent,
}: BoardPaneProps) {
  const [editing, setEditing] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  const cards = Object.values(state.cards).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selected = (selectedCardId ? state.cards[selectedCardId] : null) ?? cards[0] ?? null;

  const cardSteps = selected ? state.workSteps.filter((s) => s.cardId === selected.id) : [];
  const cardOutputs = selected
    ? Object.values(state.outputs)
        .filter((o) => o.cardId === selected.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  const memberName = (id: string) => state.members[id]?.name ?? id;

  const hasConfirmed =
    selected?.confirmations.some(
      (c) => c.memberId === currentMemberId && c.versionHash === selected.versionHash,
    ) ?? false;

  return (
    <section className="board-pane">
      <div className="pane-header">
        <span>卡片契约与交付看板（Card-as-Spec）</span>
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>{cards.length} 张卡片</span>
      </div>

      <div className="board-body">
        <div className="card-list">
          {cards.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 8 }}>
              暂无共识卡片，点击左栏「+ 新建共识卡片」锁定接口与文件范围。
            </div>
          ) : (
            cards.map((card) => (
              <div
                key={card.id}
                className={`card-tile ${selected?.id === card.id ? "selected" : ""}`}
                onClick={() => onSelectCard(card.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <strong style={{ fontSize: 13 }}>{card.spec.title}</strong>
                  <span className={`badge ${card.status}`}>{STATUS_LABELS[card.status]}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
                  <code>{card.versionHash}</code>
                  <span>{card.claimedByAgentName ?? `${card.spec.fileGlobs.length} 项范围`}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card-detail">
          {!selected ? (
            <div style={{ color: "var(--muted)" }}>在左侧选择一张卡片查看详情与验收产出。</div>
          ) : (
            <>
              {/* Platform-rendered confirmation skeleton (anti-forgery) */}
              <div className="skeleton-box">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{selected.spec.title}</h2>
                    <span className={`badge ${selected.status}`}>{STATUS_LABELS[selected.status]}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => setEditing(true)}>
                      编辑草案
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={hasConfirmed || selected.status === "accepted"}
                      onClick={() => onConfirmCard(selected.id, selected.versionHash)}
                    >
                      {hasConfirmed ? "已确认此版本" : "确认此版本"}
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "var(--muted)" }}>
                  <span>
                    版本哈希：<code>{selected.versionHash}</code>
                  </span>
                  <span>
                    已确认：{selected.confirmations.length} / {state.minConfirmations}（
                    {selected.confirmations.map((c) => memberName(c.memberId)).join("、") || "暂无"}）
                  </span>
                  {selected.claimedByAgentId && (
                    <span>
                      认领者：<strong style={{ color: "var(--purple)" }}>{selected.claimedByAgentName}</strong>
                    </span>
                  )}
                </div>

                {selected.claimedByAgentId && selected.status === "claimed" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "var(--red-bg)",
                      padding: "8px 12px",
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>
                      {selected.claimedByAgentName} 正在执行此卡片并持有文件锁
                    </span>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onStopAgent(selected.claimedByAgentId!, "协作者在看板触发急停")}
                    >
                      一键急停
                    </button>
                  </div>
                )}
              </div>

              {/* Spec Body */}
              <div className="skeleton-box">
                <div className="section-label">目标（Goal）</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{selected.spec.goal}</div>

                {selected.spec.interfaceContract && (
                  <>
                    <div className="section-label">接口约定（Interface Contract）</div>
                    <pre style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>
                      {selected.spec.interfaceContract}
                    </pre>
                  </>
                )}

                <div className="section-label">文件范围锁（fileGlobs）</div>
                <div className="glob-list">
                  {selected.spec.fileGlobs.map((g) => (
                    <code key={g}>{g}</code>
                  ))}
                </div>

                {selected.spec.acceptanceCriteria.length > 0 && (
                  <>
                    <div className="section-label">验收标准</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {selected.spec.acceptanceCriteria.map((c, idx) => (
                        <li key={idx}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* Work Steps */}
              <div className="skeleton-box">
                <div className="section-label">工作记录（{cardSteps.length} 条关键节点）</div>
                {cardSteps.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>尚无 Agent 执行记录</div>
                ) : (
                  cardSteps.map((step) => (
                    <div
                      key={step.id}
                      style={{
                        borderLeft: "2px solid var(--accent)",
                        paddingLeft: 10,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span>
                          <strong>{memberName(step.agentId)}</strong>：{step.summary}
                        </span>
                        {step.detail && (
                          <button
                            type="button"
                            style={{ padding: "2px 6px", fontSize: 11 }}
                            onClick={() =>
                              setExpandedSteps((prev) => ({ ...prev, [step.id]: !prev[step.id] }))
                            }
                          >
                            {expandedSteps[step.id] ? "收起" : "展开原文"}
                          </button>
                        )}
                      </div>
                      {step.detail && expandedSteps[step.id] && (
                        <pre
                          style={{
                            margin: "6px 0 0",
                            fontSize: 11,
                            color: "var(--muted)",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {step.detail}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Outputs & Diff Review */}
              <div className="skeleton-box">
                <div className="section-label">产出与验收（{cardOutputs.length}）</div>
                {cardOutputs.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>等待 Agent 提交 Diff 或产出</div>
                ) : (
                  cardOutputs.map((out) => (
                    <div key={out.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <strong>{memberName(out.submittedBy)}</strong> · 绑定哈希 <code>{out.cardVersionHash}</code>
                          {out.branch && (
                            <>
                              {" "}
                              · 分支 <code>{out.branch}</code>
                            </>
                          )}
                        </div>
                        {selected.status === "pending_review" && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => onReviewCard(selected.id, out.id, "changes_requested")}
                            >
                              打回修改
                            </button>
                            <button
                              type="button"
                              className="success"
                              onClick={() => onReviewCard(selected.id, out.id, "accepted")}
                            >
                              验收通过
                            </button>
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: 13 }}>{out.summary}</div>

                      {out.diff && (
                        <div className="diff-box">
                          {out.diff.split("\n").map((line, i) => (
                            <div key={i} className={`diff-line ${classifyDiffLine(line)}`}>
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {editing && selected && (
        <CardEditorModal
          initial={selected.spec}
          titleText="编辑共识卡片（修改后将重置版本号并需重新确认）"
          onClose={() => setEditing(false)}
          onSave={(spec) => onUpdateCard(selected.id, spec)}
        />
      )}
    </section>
  );
}

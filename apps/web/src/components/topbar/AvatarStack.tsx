import React from "react";
import { Card, Member } from "@coagent/protocol";
import { OctagonX } from "lucide-react";
import { Avatar } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover.js";

interface AvatarStackProps {
  members: readonly Member[];
  currentMemberId: string;
  cards: Record<string, Card>;
  onStopAgent: (agentId: string, reason?: string) => void;
}

function getStatusDisplay(m: Member): { color: string; label: string; pulse?: boolean } {
  if (!m.online) return { color: "var(--text-muted)", label: "离线" };
  if (m.kind === "agent") {
    if (m.status === "stopped") return { color: "var(--sem-red)", label: "已急停" };
    if (m.status === "waiting_human") return { color: "var(--sem-amber)", label: "请求确认" };
    if (m.status === "working") return { color: "var(--sem-green)", label: "执行中", pulse: true };
    return { color: "var(--sem-green)", label: "待命" };
  }
  return { color: "var(--sem-green)", label: "在线" };
}

export function AvatarStack({
  members,
  currentMemberId,
  cards,
  onStopAgent,
}: AvatarStackProps) {
  const sorted = [...members].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "human" ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const visible = sorted.slice(0, 5);
  const overflow = sorted.length - visible.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-full px-1.5 py-1 transition-colors cursor-pointer"
          style={{
            background: "transparent",
            border: "1px solid transparent",
          }}
          aria-label={`查看房间成员（${sorted.length} 位）`}
          title="点击查看成员与 Agent 运行状态"
        >
          <span className="flex items-center">
            {visible.map((m, idx) => (
              <Avatar
                key={m.id}
                name={m.name}
                avatar={m.avatar}
                isAgent={m.kind === "agent"}
                showAgentBadge
                size={28}
                style={{
                  marginLeft: idx === 0 ? 0 : -6,
                  border: "2px solid var(--bg)",
                  opacity: m.online ? 1 : 0.5,
                  zIndex: visible.length - idx,
                }}
              />
            ))}
            {overflow > 0 && (
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{
                  marginLeft: -6,
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  border: "2px solid var(--bg)",
                }}
              >
                +{overflow}
              </span>
            )}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[320px] p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[12px] font-semibold">房间成员（{sorted.length}）</span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {sorted.filter((m) => m.online).length} 位在线
          </span>
        </div>

        <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
          {sorted.map((m) => {
            const st = getStatusDisplay(m);
            const activeCard = m.activeCardId ? cards[m.activeCardId] : undefined;
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-[10px] px-2 py-2"
                style={{ background: "var(--surface-2)" }}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    name={m.name}
                    avatar={m.avatar}
                    isAgent={m.kind === "agent"}
                    showAgentBadge
                    size={28}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                      <span className="truncate">{m.name}</span>
                      {m.id === currentMemberId && (
                        <span
                          className="rounded-full px-1.5 py-0 text-[10px] font-medium"
                          style={{
                            background: "var(--surface)",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          我
                        </span>
                      )}
                    </div>
                    <div
                      className="flex items-center gap-1.5 text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${st.pulse ? "animate-pulse" : ""}`}
                        style={{ background: st.color }}
                      />
                      <span>
                        {m.kind === "agent" ? `Agent · ${m.driver ?? "codex"} · ${st.label}` : st.label}
                      </span>
                      {activeCard && (
                        <span className="truncate">· {activeCard.spec.title}</span>
                      )}
                    </div>
                  </div>
                </div>

                {m.kind === "agent" && m.online && m.status !== "stopped" && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => onStopAgent(m.id, "协作者从成员浮层触发急停")}
                  >
                    <OctagonX size={12} />
                    急停
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

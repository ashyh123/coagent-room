import React from "react";
import { Member, WorkStep } from "@coagent/protocol";
import { OctagonX } from "lucide-react";
import { Avatar } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";

interface AgentApprovalCardProps {
  agent: Member;
  latestStep?: WorkStep;
  onApprove: () => void;
  onDeny: () => void;
  onStop: () => void;
}

export function AgentApprovalCard({
  agent,
  latestStep,
  onApprove,
  onDeny,
  onStop,
}: AgentApprovalCardProps) {
  const isWaiting = agent.status === "waiting_human";
  const detailText =
    latestStep?.detail ||
    latestStep?.summary ||
    (isWaiting ? "等待人类协作者确认继续执行" : "正在锁定的文件范围内执行任务…");

  return (
    <article
      className="flex flex-col gap-3 p-4"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={agent.name} avatar={agent.avatar} isAgent showAgentBadge size={28} />
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold">
              {agent.name} {isWaiting ? "请求确认" : "正在运行"}
            </span>
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${!isWaiting ? "animate-pulse" : ""}`}
              style={{
                background: isWaiting ? "var(--sem-amber)" : "var(--sem-green)",
              }}
            />
          </div>
        </div>

        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {agent.driver ?? "codex"}
        </span>
      </div>

      <div
        className="overflow-x-auto px-3 py-2 font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap"
        style={{
          background: "var(--surface-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card-inner)",
        }}
      >
        {detailText}
      </div>

      {isWaiting ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="md" className="flex-1" onClick={onApprove}>
            允许
          </Button>
          <Button type="button" variant="outline" size="md" className="flex-1" onClick={onDeny}>
            拒绝
          </Button>
          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={onStop}
            aria-label="急停 Agent"
            title="急停 Agent"
          >
            <OctagonX size={14} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            已持有文件锁，可随时触发进程级急停
          </span>
          <Button type="button" variant="danger" size="sm" onClick={onStop}>
            <OctagonX size={13} />
            急停 Agent
          </Button>
        </div>
      )}
    </article>
  );
}

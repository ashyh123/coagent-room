import React, { useMemo, useRef, useState } from "react";
import { Member, RoomState, TopicAnchor } from "@coagent/protocol";
import {
  Hash,
  Lock,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
} from "lucide-react";
import { ActiveChannel, isSameChannel, partitionAgents } from "../../utils/channels.js";
import { COLLAPSED_SIDEBAR_WIDTH } from "../../utils/layout.js";
import { Avatar } from "../ui/Avatar.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/Tooltip.js";

export interface SessionSidebarProps {
  state: RoomState;
  currentMemberId: string;
  activeChannel: ActiveChannel;
  privateCount: number;
  collapsed: boolean;
  width: number;
  onSelectChannel: (channel: ActiveChannel) => void;
  onCreateTopic: (title: string, anchor?: TopicAnchor) => void;
  onOpenInviteAgent: () => void;
  onToggleCollapse: () => void;
}

function getAgentStatusMeta(agent: Member): { color: string; label: string; pulse: boolean } {
  if (!agent.online) {
    return { color: "var(--text-muted)", label: "离线", pulse: false };
  }
  switch (agent.status) {
    case "stopped":
      return { color: "var(--sem-red)", label: "已急停", pulse: false };
    case "waiting_human":
      return { color: "var(--sem-amber)", label: "等待确认", pulse: false };
    case "working":
      return { color: "var(--sem-green)", label: "执行中", pulse: true };
    default:
      return { color: "var(--sem-green)", label: "空闲", pulse: false };
  }
}

interface SidebarAgentRowProps {
  agent: Member;
  active: boolean;
  ownerName?: string;
  activeCardTitle?: string;
  compact?: boolean;
  onSelect: () => void;
}

function SidebarAgentRow({
  agent,
  active,
  ownerName,
  activeCardTitle,
  compact = false,
  onSelect,
}: SidebarAgentRowProps) {
  const st = getAgentStatusMeta(agent);
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-[8px] border px-2 py-1.5 text-left transition-colors cursor-pointer ${
        active
          ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--border-strong)]"
          : "bg-transparent text-[var(--text-muted)] border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      }`}
    >
      <Avatar
        name={agent.name}
        avatar={agent.avatar}
        isAgent
        size={20}
        style={{ opacity: agent.online ? 1 : 0.55 }}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate ${compact ? "text-[12px]" : "text-[13px]"} leading-[1.35] ${
            active ? "font-semibold" : "font-medium"
          }`}
          style={{ color: active ? "var(--text)" : undefined }}
        >
          {agent.name}
          {ownerName ? ` · ${ownerName}` : ""}
        </div>
        <div
          className="flex items-center gap-1.5 text-[11px] leading-[1.35]"
          style={{ color: "var(--text-muted)" }}
        >
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${st.pulse ? "animate-pulse" : ""}`}
            style={{ background: st.color }}
          />
          <span className="truncate">
            {st.label}
            {activeCardTitle ? ` · ${activeCardTitle}` : ""}
          </span>
        </div>
      </div>
    </button>
  );
}

export function SessionSidebar({
  state,
  currentMemberId,
  activeChannel,
  privateCount,
  collapsed,
  width,
  onSelectChannel,
  onCreateTopic,
  onOpenInviteAgent,
  onToggleCollapse,
}: SessionSidebarProps) {
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const isComposingRef = useRef(false);

  const sortedTopics = useMemo(
    () =>
      Object.values(state.topics).sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt),
      ),
    [state.topics],
  );

  const mainMessageCount = useMemo(
    () => state.messages.filter((m) => !m.topicId).length,
    [state.messages],
  );

  const { myAgents, otherAgents } = useMemo(
    () => partitionAgents(state.members, currentMemberId),
    [state.members, currentMemberId],
  );

  const submitTopicCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTopicTitle.trim();
    if (!trimmed) return;
    onCreateTopic(trimmed.slice(0, 120));
    setNewTopicTitle("");
    setCreatingTopic(false);
  };

  if (collapsed) {
    const allAgents = [...myAgents, ...otherAgents];
    const roomActive = isSameChannel(activeChannel, { kind: "room" });
    const privateActive = isSameChannel(activeChannel, { kind: "private_bot" });

    return (
      <aside
        aria-label="会话导航"
        className="session-sidebar flex min-h-0 shrink-0 flex-col"
        style={{
          width: COLLAPSED_SIDEBAR_WIDTH,
          flex: "0 0 auto",
          background: "var(--bg)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <div
          className="flex h-11 shrink-0 items-center justify-center"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="展开左侧会话栏"
                onClick={onToggleCollapse}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
              >
                <PanelLeftOpen size={15} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">展开会话导航</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden px-1.5 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="全部对话"
                aria-current={roomActive ? "page" : undefined}
                onClick={() => onSelectChannel({ kind: "room" })}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors cursor-pointer ${
                  roomActive
                    ? "bg-[var(--primary-bg)] text-[var(--primary-text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                }`}
              >
                <Hash size={15} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              全部对话{mainMessageCount > 0 ? ` (${mainMessageCount})` : ""}
            </TooltipContent>
          </Tooltip>

          {sortedTopics.map((topic) => {
            const active = isSameChannel(activeChannel, { kind: "topic", topicId: topic.id });
            return (
              <Tooltip key={topic.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={topic.title}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelectChannel({ kind: "topic", topicId: topic.id })}
                    className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors cursor-pointer ${
                      active
                        ? "bg-[var(--primary-bg)] text-[var(--primary-text)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                    }`}
                  >
                    <MessageSquare size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  # {topic.title} ({topic.messageCount})
                </TooltipContent>
              </Tooltip>
            );
          })}

          <div className="my-1 h-px w-5 shrink-0" style={{ background: "var(--border)" }} />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="私有参谋"
                aria-current={privateActive ? "page" : undefined}
                onClick={() => onSelectChannel({ kind: "private_bot" })}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors cursor-pointer ${
                  privateActive
                    ? "bg-[var(--primary-bg)] text-[var(--primary-text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                }`}
              >
                <Lock size={14} />
                {privateCount > 0 && !privateActive && (
                  <span
                    className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--text)" }}
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              私有参谋（仅自己可见）{privateCount > 0 ? ` · ${privateCount}` : ""}
            </TooltipContent>
          </Tooltip>

          {allAgents.map((agent) => {
            const active = isSameChannel(activeChannel, { kind: "agent", agentId: agent.id });
            const st = getAgentStatusMeta(agent);
            const ownerName =
              agent.ownerId && agent.ownerId !== currentMemberId
                ? state.members[agent.ownerId]?.name
                : undefined;

            return (
              <Tooltip key={agent.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={agent.name}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelectChannel({ kind: "agent", agentId: agent.id })}
                    className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border transition-colors cursor-pointer ${
                      active
                        ? "bg-[var(--surface-2)] border-[var(--border-strong)]"
                        : "border-transparent hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    <Avatar
                      name={agent.name}
                      avatar={agent.avatar}
                      isAgent
                      size={24}
                      style={{ opacity: agent.online ? 1 : 0.55 }}
                    />
                    <span
                      className={`absolute right-0.5 bottom-0.5 h-1.5 w-1.5 rounded-full ${st.pulse ? "animate-pulse" : ""}`}
                      style={{
                        background: st.color,
                        border: "1px solid var(--bg)",
                      }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {agent.name} · {st.label}
                  {ownerName ? ` (${ownerName})` : ""}
                </TooltipContent>
              </Tooltip>
            );
          })}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="接入本地 Agent"
                onClick={onOpenInviteAgent}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
              >
                <Plus size={15} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">接入本地 Agent</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    );
  }

  const roomActive = isSameChannel(activeChannel, { kind: "room" });
  const privateActive = isSameChannel(activeChannel, { kind: "private_bot" });

  return (
    <aside
      aria-label="会话导航"
      className="session-sidebar flex min-h-0 shrink-0 flex-col"
      style={{
        width,
        flex: "0 0 auto",
        background: "var(--bg)",
      }}
    >
      {/* Header matching ChatPane & BoardPane 44px height */}
      <div
        className="flex h-11 shrink-0 items-center justify-between gap-2 px-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="truncate text-[13px] font-semibold">会话导航</span>
        <button
          type="button"
          aria-label="收起左侧会话栏"
          title="收起左侧会话栏"
          onClick={onToggleCollapse}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* Scrollable Navigation Groups */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
        {/* Group 1: Public Room & Topics */}
        <div className="flex flex-col gap-1">
          <div
            className="px-2 pb-1 text-[11px] leading-[1.35] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            房间（公共）
          </div>

          <button
            type="button"
            aria-current={roomActive ? "page" : undefined}
            onClick={() => onSelectChannel({ kind: "room" })}
            className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2 py-1.5 text-left text-[13px] leading-[1.4] transition-colors cursor-pointer ${
              roomActive
                ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--border-strong)] font-semibold"
                : "bg-transparent text-[var(--text-muted)] border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text)] font-medium"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Hash size={13} className="shrink-0 opacity-80" />
              <span className="truncate">全部对话</span>
            </span>
            {mainMessageCount > 0 && (
              <span
                className="shrink-0 rounded-full px-1.5 py-0 font-mono text-[11px] leading-[1.4]"
                style={{
                  background: roomActive ? "var(--surface)" : "var(--surface-2)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
              >
                {mainMessageCount}
              </span>
            )}
          </button>

          {sortedTopics.map((topic) => {
            const active = isSameChannel(activeChannel, { kind: "topic", topicId: topic.id });
            return (
              <button
                key={topic.id}
                type="button"
                title={topic.title}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelectChannel({ kind: "topic", topicId: topic.id })}
                className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2 py-1.5 text-left text-[13px] leading-[1.4] transition-colors cursor-pointer ${
                  active
                    ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--border-strong)] font-semibold"
                    : "bg-transparent text-[var(--text-muted)] border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text)] font-medium"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Hash size={12} className="shrink-0 opacity-70" />
                  <span className="truncate">{topic.title}</span>
                </span>
                <span
                  className="shrink-0 rounded-full px-1.5 py-0 font-mono text-[11px] leading-[1.4]"
                  style={{
                    background: active ? "var(--surface)" : "var(--surface-2)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {topic.messageCount}
                </span>
              </button>
            );
          })}

          {!creatingTopic ? (
            <button
              type="button"
              onClick={() => setCreatingTopic(true)}
              className="mt-0.5 flex w-full items-center gap-2 rounded-[8px] border border-dashed px-2 py-1.5 text-left text-[12px] leading-[1.4] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
              style={{ borderColor: "var(--border)" }}
            >
              <Plus size={12} className="shrink-0" />
              <span className="truncate">新建话题</span>
            </button>
          ) : (
            <form
              onSubmit={submitTopicCreate}
              className="mt-1 flex flex-col gap-1.5 rounded-[8px] p-2"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border-strong)",
              }}
            >
              <input
                type="text"
                autoFocus
                maxLength={120}
                value={newTopicTitle}
                onChange={(e) => setNewTopicTitle(e.target.value)}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCreatingTopic(false);
                    setNewTopicTitle("");
                  } else if (
                    e.key === "Enter" &&
                    (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229)
                  ) {
                    e.preventDefault();
                  }
                }}
                placeholder="输入话题标题…"
                className="w-full px-2 py-1 text-[12px] leading-[1.4]"
                style={{
                  background: "var(--surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "6px",
                }}
              />
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  aria-label="取消新建话题"
                  onClick={() => {
                    setCreatingTopic(false);
                    setNewTopicTitle("");
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-muted)] hover:bg-[var(--surface)] cursor-pointer"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <X size={12} />
                </button>
                <button
                  type="submit"
                  disabled={!newTopicTitle.trim()}
                  className="inline-flex h-6 items-center rounded-[6px] px-2 text-[11px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--primary-bg)",
                    color: "var(--primary-text)",
                  }}
                >
                  创建
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Group 2: Private Personal Advisor & Own Local Agents */}
        <div className="flex flex-col gap-1">
          <div
            className="px-2 pb-1 text-[11px] leading-[1.35] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            我的（仅我可见）
          </div>

          <button
            type="button"
            aria-current={privateActive ? "page" : undefined}
            onClick={() => onSelectChannel({ kind: "private_bot" })}
            className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2 py-1.5 text-left text-[13px] leading-[1.4] transition-colors cursor-pointer ${
              privateActive
                ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--border-strong)] font-semibold"
                : "bg-transparent text-[var(--text-muted)] border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text)] font-medium"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Lock size={13} className="shrink-0 opacity-80" />
              <span className="truncate">私有参谋</span>
            </span>
            {privateCount > 0 && (
              <span
                className="shrink-0 rounded-full px-1.5 py-0 font-mono text-[11px] leading-[1.4]"
                style={{
                  background: privateActive ? "var(--surface)" : "var(--surface-2)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
              >
                {privateCount}
              </span>
            )}
          </button>

          {myAgents.map((agent) => {
            const activeCard = agent.activeCardId ? state.cards[agent.activeCardId] : undefined;
            return (
              <SidebarAgentRow
                key={agent.id}
                agent={agent}
                active={isSameChannel(activeChannel, { kind: "agent", agentId: agent.id })}
                activeCardTitle={activeCard?.spec.title}
                onSelect={() => onSelectChannel({ kind: "agent", agentId: agent.id })}
              />
            );
          })}

          <button
            type="button"
            onClick={onOpenInviteAgent}
            className="mt-0.5 flex w-full items-center gap-2 rounded-[8px] border border-dashed px-2 py-1.5 text-left text-[12px] leading-[1.4] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
            style={{ borderColor: "var(--border)" }}
          >
            <Plus size={12} className="shrink-0" />
            <span className="truncate">接入本地 Agent</span>
          </button>
        </div>

        {/* Group 3: Room Collaborator Agents (only shown when > 0) */}
        {otherAgents.length > 0 && (
          <div className="flex flex-col gap-1">
            <div
              className="px-2 pb-1 text-[11px] leading-[1.35] font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              房间协作 Agent
            </div>

            {otherAgents.map((agent) => {
              const ownerName = agent.ownerId ? state.members[agent.ownerId]?.name : undefined;
              const activeCard = agent.activeCardId ? state.cards[agent.activeCardId] : undefined;
              return (
                <SidebarAgentRow
                  key={agent.id}
                  agent={agent}
                  active={isSameChannel(activeChannel, { kind: "agent", agentId: agent.id })}
                  ownerName={ownerName}
                  activeCardTitle={activeCard?.spec.title}
                  compact
                  onSelect={() => onSelectChannel({ kind: "agent", agentId: agent.id })}
                />
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

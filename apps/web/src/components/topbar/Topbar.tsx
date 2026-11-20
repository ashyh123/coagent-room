import React from "react";
import { Card, InboxItem, Member, RoomState } from "@coagent/protocol";
import { LogOut, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Sun } from "lucide-react";
import { ThemeMode } from "../../hooks/useTheme.js";
import { WorkspaceViewMode } from "../../utils/layout.js";
import { Button } from "../ui/Button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover.js";
import { AvatarStack } from "./AvatarStack.js";
import { InboxPopover } from "./InboxPopover.js";

const VIEW_OPTIONS: ReadonlyArray<{ mode: WorkspaceViewMode; label: string }> = [
  { mode: "chat", label: "仅沟通" },
  { mode: "split", label: "分栏" },
  { mode: "board", label: "仅卡片" },
];

// Phones have no room for a split view: just switch between the two panes.
const COMPACT_VIEW_OPTIONS: ReadonlyArray<{ mode: WorkspaceViewMode; label: string }> = [
  { mode: "chat", label: "沟通" },
  { mode: "board", label: "卡片" },
];

interface TopbarProps {
  state: RoomState;
  roomName: string;
  connected: boolean;
  members: readonly Member[];
  currentMemberId: string;
  cards: Record<string, Card>;
  dismissedMentions: ReadonlySet<string>;
  viewMode: WorkspaceViewMode;
  sidebarCollapsed: boolean;
  /** Phone-width layout: hide the brand mark and move secondary actions into a menu. */
  compact?: boolean;
  theme: ThemeMode;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  onToggleSidebar: () => void;
  onChangeTheme: (theme: ThemeMode) => void;
  onOpenInviteAgent: () => void;
  onStopAgent: (agentId: string, reason?: string) => void;
  onSelectInboxItem: (item: InboxItem) => void;
  onClearMentions: (mentionMessageIds: string[]) => void;
  onLeave: () => void;
}

export function Topbar({
  state,
  roomName,
  connected,
  members,
  currentMemberId,
  cards,
  dismissedMentions,
  viewMode,
  sidebarCollapsed,
  compact = false,
  theme,
  onChangeViewMode,
  onToggleSidebar,
  onChangeTheme,
  onOpenInviteAgent,
  onStopAgent,
  onSelectInboxItem,
  onClearMentions,
  onLeave,
}: TopbarProps) {
  return (
    <header
      className={`flex h-14 shrink-0 items-center justify-between ${compact ? "gap-2 px-3" : "gap-3 px-4"}`}
      style={{
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Left: Sidebar toggle + Brand mark + Room name + Connection dot */}
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          aria-label="切换左侧会话栏"
          aria-pressed={viewMode !== "board" && !sidebarCollapsed}
          title={viewMode === "board" || sidebarCollapsed ? "展开左侧会话栏" : "收起左侧会话栏"}
          onClick={onToggleSidebar}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
          style={{ border: "1px solid var(--border)" }}
        >
          {viewMode === "board" || sidebarCollapsed ? (
            <PanelLeftOpen size={14} />
          ) : (
            <PanelLeftClose size={14} />
          )}
        </button>

        <span
          className={`${compact ? "hidden" : "flex"} h-7 w-7 shrink-0 items-center justify-center rounded-[8px]`}
          style={{
            background: "var(--primary-bg)",
            color: "var(--primary-text)",
          }}
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.9" />
            <circle cx="11.2" cy="11.2" r="1.4" fill="currentColor" />
          </svg>
        </span>
        <span
          className={`truncate leading-[1.35] font-semibold tracking-[-0.01em] ${compact ? "text-[14px]" : "text-[16px]"}`}
        >
          {roomName}
        </span>
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: connected ? "var(--sem-green)" : "var(--sem-amber)" }}
          title={connected ? "实时同步已连接" : "正在重连房间服务"}
        />
        {!connected && !compact && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: "var(--sem-amber-bg)",
              color: "var(--sem-amber)",
            }}
          >
            重连中…
          </span>
        )}
      </div>

      {/* Center: Monochrome Segmented View Switcher */}
      <div
        className="inline-flex shrink-0 items-center gap-0.5 p-0.5"
        role="group"
        aria-label="视图切换"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
        }}
      >
        {(compact ? COMPACT_VIEW_OPTIONS : VIEW_OPTIONS).map((opt) => {
          const active = viewMode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              aria-pressed={active}
              onClick={() => onChangeViewMode(opt.mode)}
              className="view-tab rounded-[8px] px-2.5 py-1 text-[12px] leading-[1.4] font-medium whitespace-nowrap transition-all cursor-pointer"
              style={
                active
                  ? {
                      background: "var(--surface)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    }
                  : {
                      background: "transparent",
                      color: "var(--text-muted)",
                      border: "1px solid transparent",
                    }
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Right: AvatarStack + InboxPopover + Theme Pill + Invite Agent + Leave */}
      <div className={`flex shrink-0 items-center ${compact ? "gap-1.5" : "gap-2"}`}>
        <AvatarStack
          members={members}
          currentMemberId={currentMemberId}
          cards={cards}
          onStopAgent={onStopAgent}
          maxVisible={compact ? 1 : 5}
        />

        <InboxPopover
          state={state}
          currentMemberId={currentMemberId}
          dismissedMentions={dismissedMentions}
          onSelectInboxItem={onSelectInboxItem}
          onClearMentions={onClearMentions}
        />

        {compact ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="更多操作"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
                style={{ border: "1px solid var(--border)" }}
              >
                <MoreHorizontal size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-[180px] flex-col gap-0.5 p-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="!justify-start"
                onClick={onOpenInviteAgent}
              >
                <Plus size={13} />
                接入 Agent
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="!justify-start"
                onClick={() => onChangeTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
                {theme === "dark" ? "浅色模式" : "深色模式"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="!justify-start"
                onClick={onLeave}
              >
                <LogOut size={13} />
                退出房间
              </Button>
            </PopoverContent>
          </Popover>
        ) : (
          <>
          <div
            className="inline-flex items-center rounded-full p-0.5"
            role="group"
            aria-label="深浅主题切换"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              aria-label="浅色模式"
              aria-pressed={theme === "light"}
              onClick={() => onChangeTheme("light")}
              className="flex h-6 w-6 items-center justify-center rounded-full cursor-pointer transition-colors"
              style={
                theme === "light"
                  ? {
                      background: "var(--surface)",
                      color: "var(--text)",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                    }
                  : { color: "var(--text-muted)", background: "transparent" }
              }
            >
              <Sun size={13} />
            </button>
            <button
              type="button"
              aria-label="深色模式"
              aria-pressed={theme === "dark"}
              onClick={() => onChangeTheme("dark")}
              className="flex h-6 w-6 items-center justify-center rounded-full cursor-pointer transition-colors"
              style={
                theme === "dark"
                  ? {
                      background: "var(--surface)",
                      color: "var(--text)",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
                    }
                  : { color: "var(--text-muted)", background: "transparent" }
              }
            >
              <Moon size={13} />
            </button>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={onOpenInviteAgent}>
            <Plus size={13} />
            接入 Agent
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLeave}
            aria-label="退出房间"
            title="退出房间"
          >
            <LogOut size={13} />
            退出
          </Button>
          </>
        )}
      </div>
    </header>
  );
}

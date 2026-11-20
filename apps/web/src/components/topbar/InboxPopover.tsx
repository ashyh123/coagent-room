import React, { useMemo, useState } from "react";
import { computeInboxItems, InboxItem, InboxItemKind, RoomState } from "@coagent/protocol";
import { Bell, CheckCheck } from "lucide-react";
import { formatMessageTime } from "../../utils/chat.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover.js";

type InboxFilter = "all" | InboxItemKind;

const FILTER_PILLS: ReadonlyArray<{ id: InboxFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "confirm_card", label: "待确认" },
  { id: "review_output", label: "待验收" },
  { id: "mention", label: "@我" },
  { id: "agent_help", label: "求助" },
];

const KIND_META: Record<InboxItemKind, { label: string; dotColor: string }> = {
  confirm_card: { label: "待确认", dotColor: "var(--text-muted)" },
  review_output: { label: "待验收", dotColor: "var(--sem-amber)" },
  mention: { label: "@我", dotColor: "var(--text)" },
  agent_help: { label: "求助", dotColor: "var(--sem-amber)" },
};

interface InboxPopoverProps {
  state: RoomState;
  currentMemberId: string;
  dismissedMentions: ReadonlySet<string>;
  onSelectInboxItem: (item: InboxItem) => void;
  onClearMentions: (mentionMessageIds: string[]) => void;
}

export function InboxPopover({
  state,
  currentMemberId,
  dismissedMentions,
  onSelectInboxItem,
  onClearMentions,
}: InboxPopoverProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");

  const items = useMemo(
    () => computeInboxItems(state, currentMemberId, dismissedMentions),
    [state, currentMemberId, dismissedMentions],
  );

  const counts = useMemo(() => {
    const map: Record<InboxFilter, number> = {
      all: items.length,
      confirm_card: 0,
      review_output: 0,
      mention: 0,
      agent_help: 0,
    };
    for (const item of items) {
      map[item.kind] += 1;
    }
    return map;
  }, [items]);

  const mentionMessageIds = useMemo(
    () => items.filter((item) => item.kind === "mention").map((item) => item.targetId),
    [items],
  );

  const filteredItems = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.kind === filter)),
    [items, filter],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer transition-colors hover:opacity-85"
          style={{
            background: open ? "var(--surface-2)" : "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
          }}
          aria-label={`行动收件箱（${items.length} 条待办）`}
          title={items.length > 0 ? `行动收件箱（${items.length} 条待办）` : "行动收件箱（暂无待办）"}
        >
          <Bell size={15} />
          {items.length > 0 && (
            <span
              className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold"
              style={{
                background: "var(--primary-bg)",
                color: "var(--primary-text)",
                border: "1.5px solid var(--bg)",
              }}
            >
              {items.length > 99 ? "99+" : items.length}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[368px] max-w-[calc(100vw-24px)] p-3">
        <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold">行动收件箱</span>
            <span
              className="rounded-full px-1.5 py-0 text-[11px] font-medium"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-muted)",
              }}
            >
              {items.length}
            </span>
          </div>

          <button
            type="button"
            disabled={mentionMessageIds.length === 0}
            onClick={() => onClearMentions(mentionMessageIds)}
            className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-medium transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80"
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            <CheckCheck size={12} />
            清空 @ 提醒
          </button>
        </div>

        {/* 5 Filter Pills */}
        <div
          className="mb-2.5 flex items-center gap-1 overflow-x-auto p-1"
          role="tablist"
          aria-label="收件箱分类筛选"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
          }}
        >
          {FILTER_PILLS.map((pill) => {
            const active = filter === pill.id;
            const count = counts[pill.id];
            return (
              <button
                key={pill.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(pill.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-medium transition-all cursor-pointer"
                style={
                  active
                    ? {
                        background: "var(--primary-bg)",
                        color: "var(--primary-text)",
                      }
                    : {
                        background: "transparent",
                        color: "var(--text-muted)",
                      }
                }
              >
                <span>{pill.label}</span>
                {count > 0 && <span className="opacity-75">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Items List */}
        {filteredItems.length === 0 ? (
          <div
            className="rounded-[10px] px-3 py-7 text-center text-[12px]"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
              border: "1px dashed var(--border)",
            }}
          >
            {filter === "all" ? "当前没有待处理的确认、验收或 @ 提醒" : "该分类下暂无待办事项"}
          </div>
        ) : (
          <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-0.5">
            {filteredItems.map((item) => {
              const meta = KIND_META[item.kind];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectInboxItem(item);
                    setOpen(false);
                  }}
                  className="flex w-full flex-col gap-1 rounded-[10px] px-3 py-2.5 text-left transition-colors cursor-pointer hover:opacity-90"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: meta.dotColor }}
                      />
                      <span style={{ color: "var(--text-muted)" }}>{meta.label}</span>
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {formatMessageTime(item.createdAt)}
                    </span>
                  </div>

                  <div className="truncate text-[13px] leading-[1.4] font-semibold">
                    {item.title}
                  </div>

                  {item.summary && (
                    <div
                      className="line-clamp-2 text-[12px] leading-[1.4]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {item.summary}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

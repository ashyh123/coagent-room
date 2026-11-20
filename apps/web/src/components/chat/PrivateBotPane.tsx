import React, { useEffect, useMemo, useRef, useState } from "react";
import { RoomState } from "@coagent/protocol";
import {
  ArrowDown,
  ArrowUpRight,
  Lock,
  Maximize2,
  Minimize2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { buildCardNumberMap } from "../../utils/chat.js";
import { WorkspaceViewMode } from "../../utils/layout.js";
import { Button } from "../ui/Button.js";
import { FloatingComposer } from "./FloatingComposer.js";
import { PrivateBubble, PrivateQAItem } from "./PrivateBubble.js";

export interface PrivateBotPaneProps {
  state: RoomState;
  selectedCardId: string | null;
  viewMode: WorkspaceViewMode;
  composerHeight: number | null;
  privateItems: readonly PrivateQAItem[];
  onAskPrivate: (input: { question: string; quote?: string; model?: string }) => void;
  onSharePrivateToRoom: (item: PrivateQAItem) => void;
  onTurnPrivateIntoCard: (item: PrivateQAItem) => void;
  onDismissPrivate: (id: string) => void;
  onClearAllPrivate: () => void;
  onChangeComposerHeight: (height: number | null) => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  style?: React.CSSProperties;
}

const STARTER_PROMPTS: ReadonlyArray<{ title: string; desc: string }> = [
  {
    title: "总结当前房间已确认卡片与分工",
    desc: "梳理各成员与 Agent 认领范围、fileGlobs 锁与待办项",
  },
  {
    title: "检查当前卡片接口与潜在边界风险",
    desc: "对照选中 Spec 检查类型约定、并发冲突与遗漏验收条件",
  },
  {
    title: "把我的思路整理为 Spec 卡片草案",
    desc: "快速沉淀为可确认的卡片目标、接口与验收标准",
  },
];

export function PrivateBotPane({
  state,
  selectedCardId,
  viewMode,
  composerHeight,
  privateItems,
  onAskPrivate,
  onSharePrivateToRoom,
  onTurnPrivateIntoCard,
  onDismissPrivate,
  onClearAllPrivate,
  onChangeComposerHeight,
  onChangeViewMode,
  style,
}: PrivateBotPaneProps) {
  const paneRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

  const membersList = useMemo(() => Object.values(state.members), [state.members]);
  const cards = useMemo(
    () =>
      Object.values(state.cards).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.cards],
  );
  const cardNumbers = useMemo(
    () => buildCardNumberMap([], state.cards),
    [state.cards],
  );
  const selectedCard = selectedCardId ? state.cards[selectedCardId] : undefined;

  const sortedItems = useMemo(
    () =>
      [...privateItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [privateItems],
  );

  const itemSig = useMemo(
    () => sortedItems.map((p) => `${p.id}:${p.pending ? "p" : "d"}`).join(","),
    [sortedItems],
  );
  const prevCountRef = useRef(0);
  const prevSigRef = useRef("");

  useEffect(() => {
    const el = feedRef.current;
    const prevCount = prevCountRef.current;
    const countIncreased = sortedItems.length > prevCount;
    const sigChanged = prevSigRef.current !== itemSig;
    prevCountRef.current = sortedItems.length;
    prevSigRef.current = itemSig;

    if (!el) return;
    if (atBottom && (countIncreased || sigChanged || prevCount === 0)) {
      el.scrollTop = el.scrollHeight;
      setHasUnread(false);
    } else if (!atBottom && countIncreased) {
      setHasUnread(true);
    }
  }, [sortedItems.length, itemSig, atBottom]);

  const handleFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance < 80;
    setAtBottom(nearBottom);
    if (nearBottom) {
      setHasUnread(false);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setAtBottom(true);
    setHasUnread(false);
  };

  return (
    <section
      ref={paneRef}
      className={`chat-pane flex min-h-0 min-w-0 flex-col ${viewMode === "chat" ? "solo" : ""}`}
      style={{ background: "var(--bg)", ...style }}
    >
      {/* Monochrome header */}
      <div
        className="flex h-11 shrink-0 items-center justify-between gap-2 px-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px]"
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            <Lock size={13} />
          </span>
          <span className="truncate text-[13px] font-semibold">私有参谋</span>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-[1.35] font-medium"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
              border: "1px dashed var(--border-strong)",
            }}
          >
            仅自己可见 · 不进房间事件流
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {sortedItems.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="清空本地私有问答记录"
              onClick={onClearAllPrivate}
            >
              <Trash2 size={12} />
              清空
            </Button>
          )}
          {viewMode === "split" && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="仅查看私有参谋"
                onClick={() => onChangeViewMode("chat")}
              >
                <Maximize2 size={12} />
                全屏
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="收起沟通栏，仅查看卡片"
                onClick={() => onChangeViewMode("board")}
              >
                <Minimize2 size={12} />
                收起
              </Button>
            </>
          )}
          {viewMode === "chat" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="恢复分栏视图"
              className="max-md:hidden"
              onClick={() => onChangeViewMode("split")}
            >
              展开看板
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable private Q&A feed */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={feedRef}
          data-selectable-room-content="true"
          onScroll={handleFeedScroll}
          className="chat-feed flex-1 overflow-y-auto px-4 pt-3 pb-6"
        >
          <div
            className={`mx-auto flex w-full flex-col ${viewMode === "chat" ? "max-w-[820px]" : ""}`}
          >
            {sortedItems.length === 0 ? (
              <div
                className="my-6 flex flex-col gap-4 p-5"
                style={{
                  background: "var(--surface)",
                  border: "1px dashed var(--border-strong)",
                  borderRadius: "var(--radius-card)",
                }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <Lock size={16} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="text-[14px] font-semibold">
                      你的私有参谋已就绪
                    </div>
                    <p
                      className="m-0 text-[12.5px] leading-[1.5]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      我会结合当前房间卡片、文件锁与近期沟通上下文为你提供只读分析。所有提问与回答仅留存在你本人的当前会话，可按需一键分享到房间或转为 Spec 草案。
                    </p>
                  </div>
                </div>

                {selectedCard && (
                  <div
                    className="flex items-center gap-2 px-3 py-2 text-[12px]"
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-card-inner)",
                    }}
                  >
                    <Sparkles size={12} className="shrink-0" />
                    <span className="truncate">
                      当前上下文焦点：{cardNumbers[selectedCard.id] ?? "#01"}{" "}
                      <strong style={{ color: "var(--text)" }}>{selectedCard.spec.title}</strong>
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <div
                    className="text-[11px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    快速开始
                  </div>
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt.title}
                      type="button"
                      onClick={() => onAskPrivate({ question: prompt.title })}
                      className="group flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer hover:opacity-90"
                      style={{
                        background: "var(--surface-2)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-card-inner)",
                      }}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[13px] font-medium">
                          {prompt.title}
                        </span>
                        <span
                          className="truncate text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {prompt.desc}
                        </span>
                      </div>
                      <ArrowUpRight
                        size={14}
                        className="shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
                        style={{ color: "var(--text-muted)" }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              sortedItems.map((item) => (
                <PrivateBubble
                  key={item.id}
                  item={item}
                  onShareToRoom={onSharePrivateToRoom}
                  onTurnIntoCard={onTurnPrivateIntoCard}
                  onDismiss={onDismissPrivate}
                />
              ))
            )}
          </div>
        </div>

        {/* Soft bottom gradient mask */}
        <div className="chat-fade-mask -mt-6 h-6 shrink-0" />

        {/* Scroll-to-bottom floating capsule */}
        <AnimatePresence>
          {!atBottom && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              onClick={() => scrollToBottom("smooth")}
              className="absolute bottom-3 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium cursor-pointer"
              style={{
                background: "var(--primary-bg)",
                color: "var(--primary-text)",
                boxShadow: "var(--shadow-popover)",
              }}
            >
              <ArrowDown size={13} />
              {hasUnread ? "有新回复" : "回到底部"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Locked private FloatingComposer */}
      <div className={`mx-auto w-full ${viewMode === "chat" ? "max-w-[852px]" : ""}`}>
        <FloatingComposer
          paneRef={paneRef}
          composerHeight={composerHeight}
          cards={cards}
          cardNumbers={cardNumbers}
          workingAgents={[]}
          members={membersList}
          lockedPrivateMode
          hidePrivateToggle
          placeholderOverride="私下向私有参谋提问（仅自己可见 · 不进房间事件流，# 引用卡片）…"
          onChangeComposerHeight={onChangeComposerHeight}
          onSendMessage={() => {}}
          onAskPrivate={onAskPrivate}
          onStopAgent={() => {}}
        />
      </div>
    </section>
  );
}

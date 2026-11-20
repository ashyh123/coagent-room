import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Card,
  containsRoomSecret,
  Member,
  MessageAttachment,
  MessageMeta,
  PermissionMode,
  redactRoomSecrets,
} from "@coagent/protocol";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Lock,
  Maximize2,
  Minimize2,
  OctagonX,
  Paperclip,
  Plus,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { formatFileSize } from "../../utils/chat.js";
import {
  AUTO_COMPOSER_MAX_HEIGHT,
  EXPANDED_COMPOSER_HEIGHT,
  MIN_COMPOSER_HEIGHT,
  clampComposerHeight,
} from "../../utils/layout.js";
import { Button } from "../ui/Button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover.js";

const MODEL_STORAGE_KEY = "coagent_room_composer_model_v1";
const PERMISSION_STORAGE_KEY = "coagent_room_composer_perm_v1";

const MODEL_OPTIONS = ["Claude 4.5", "GPT-5.2 Codex", "Gemini 2.5 Pro", "Auto"] as const;

const PERMISSION_OPTIONS: ReadonlyArray<{
  id: PermissionMode;
  label: string;
  desc: string;
}> = [
  { id: "ask", label: "Ask 权限", desc: "执行改文件或命令行前先弹窗请求协作确认" },
  { id: "auto", label: "Auto 自动", desc: "在已锁定 fileGlobs 范围内自动执行并上报节点" },
  { id: "plan", label: "Plan 规划", desc: "只输出分析与方案草案，不修改工作区文件" },
];

export interface FloatingComposerProps {
  paneRef: React.RefObject<HTMLElement | null>;
  composerHeight: number | null;
  cards: Card[];
  cardNumbers: Record<string, string>;
  workingAgents: Member[];
  activeTopicTitle?: string | null;
  members: readonly Member[];
  lockedPrivateMode?: boolean;
  hidePrivateToggle?: boolean;
  placeholderOverride?: string;
  onChangeComposerHeight: (height: number | null) => void;
  onSendMessage: (
    text: string,
    options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta },
  ) => void;
  onAskPrivate: (input: { question: string; quote?: string; model?: string }) => void;
  onStopAgent: (agentId: string, reason?: string) => void;
}

const PRIVATE_PREFIX_RE = /^(?:@我的agent|@自己的agent|\/ask)(?=\s|$)/i;
const PRIVATE_MENTION_NAMES = new Set(["我的agent", "自己的agent"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseComposerSubmission(
  raw: string,
  privateMode: boolean,
  allowPrivatePrefixes = true,
): { isPrivate: boolean; question: string } {
  const trimmed = raw.trim();
  if (allowPrivatePrefixes) {
    const match = trimmed.match(PRIVATE_PREFIX_RE);
    if (match) {
      return {
        isPrivate: true,
        question: trimmed.slice(match[0].length).trim(),
      };
    }
  }
  return {
    isPrivate: privateMode,
    question: trimmed,
  };
}

function resolveMentions(text: string, members: readonly Member[]): string[] {
  const mentions: string[] = [];
  for (const member of members) {
    const trimmed = member.name.trim();
    if (!trimmed || PRIVATE_MENTION_NAMES.has(trimmed.toLowerCase())) continue;
    const escaped = escapeRegExp(trimmed);
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?=$|[^A-Za-z0-9_])`, "i");
    if (pattern.test(text)) {
      mentions.push(member.id);
    }
  }
  return mentions;
}

function readStoredString(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function FloatingComposer({
  paneRef,
  composerHeight,
  cards,
  cardNumbers,
  workingAgents,
  activeTopicTitle,
  members,
  lockedPrivateMode = false,
  hidePrivateToggle = false,
  placeholderOverride,
  onChangeComposerHeight,
  onSendMessage,
  onAskPrivate,
  onStopAgent,
}: FloatingComposerProps) {
  const [draft, setDraft] = useState("");
  const [privateMode, setPrivateMode] = useState(false);
  const [secretWarning, setSecretWarning] = useState(false);
  const [model, setModel] = useState<string>(() => readStoredString(MODEL_STORAGE_KEY, "Claude 4.5"));
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const raw = readStoredString(PERMISSION_STORAGE_KEY, "ask");
    return raw === "auto" || raw === "plan" ? raw : "ask";
  });
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [refCardId, setRefCardId] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [draggingComposer, setDraggingComposer] = useState(false);
  const [dragOverFiles, setDragOverFiles] = useState(false);

  // `#` inline card reference autocomplete
  const [hashQuery, setHashQuery] = useState<string | null>(null);
  const [hashIndex, setHashIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const composerDragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, model);
    } catch {
      // ignore
    }
  }, [model]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PERMISSION_STORAGE_KEY, permissionMode);
    } catch {
      // ignore
    }
  }, [permissionMode]);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    if (composerHeight === null) {
      el.style.height = "auto";
      const next = Math.min(Math.max(el.scrollHeight, MIN_COMPOSER_HEIGHT), AUTO_COMPOSER_MAX_HEIGHT);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > AUTO_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
    } else {
      const clamped = clampComposerHeight(composerHeight, paneRef.current?.clientHeight);
      el.style.height = `${clamped}px`;
      el.style.overflowY = "auto";
    }
  }, [draft, composerHeight, paneRef]);

  const matchingCards =
    hashQuery === null
      ? []
      : cards.filter((c) => {
          const q = hashQuery.toLowerCase();
          const num = (cardNumbers[c.id] ?? "").toLowerCase();
          return c.spec.title.toLowerCase().includes(q) || num.includes(q);
        });

  const handleDraftChange = (value: string) => {
    setDraft(value);
    setSecretWarning(false);
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)#([^\s#]*)$/);
    if (match && cards.length > 0) {
      setHashQuery(match[1]);
      setHashIndex(0);
    } else {
      setHashQuery(null);
    }
  };

  const applyCardReference = (card: Card) => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor).replace(/(?:^|\s)#([^\s#]*)$/, (full) =>
      full.startsWith(" ") || full.startsWith("\n") ? full[0] : "",
    );
    const after = draft.slice(cursor);
    setDraft(`${before}${after}`);
    setRefCardId(card.id);
    setHashQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const nextItems: MessageAttachment[] = Array.from(fileList).map((f) => ({
      name: f.name,
      size: f.size,
    }));
    setAttachments((prev) => [...prev, ...nextItems].slice(0, 10));
  };

  const effectivePrivateMode = lockedPrivateMode || privateMode;
  const allowPrivatePrefixes = !hidePrivateToggle || lockedPrivateMode;
  const submission = parseComposerSubmission(draft, effectivePrivateMode, allowPrivatePrefixes);
  const canSubmit = submission.isPrivate
    ? submission.question.length > 0
    : draft.trim().length > 0;
  const selectedRefCard = refCardId ? cards.find((c) => c.id === refCardId) : undefined;

  const submitDraft = (options?: { redactSecrets?: boolean }) => {
    const parsed = parseComposerSubmission(draft, effectivePrivateMode, allowPrivatePrefixes);
    if (parsed.isPrivate) {
      if (!parsed.question) return;
      const quote = selectedRefCard
        ? `引用卡片 ${cardNumbers[selectedRefCard.id] ?? ""} ${selectedRefCard.spec.title}`.trim()
        : undefined;
      onAskPrivate({
        question: parsed.question,
        ...(quote ? { quote } : {}),
        ...(model && model !== "Auto" ? { model } : {}),
      });
      setDraft("");
      setRefCardId(null);
      setHashQuery(null);
      return;
    }

    if (!draft.trim()) return;
    if (containsRoomSecret(draft) && !options?.redactSecrets) {
      setSecretWarning(true);
      return;
    }
    setSecretWarning(false);
    const outgoing = options?.redactSecrets ? redactRoomSecrets(draft) : draft;
    onSendMessage(outgoing, {
      mentions: resolveMentions(draft, members),
      refCardId: refCardId ?? undefined,
      meta: {
        model,
        permissionMode,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    });
    setDraft("");
    setAttachments([]);
    setRefCardId(null);
    setHashQuery(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitDraft();
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (hashQuery !== null && matchingCards.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHashIndex((i) => (i + 1) % matchingCards.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHashIndex((i) => (i - 1 + matchingCards.length) % matchingCards.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applyCardReference(matchingCards[hashIndex] ?? matchingCards[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setHashQuery(null);
        return;
      }
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !isComposingRef.current &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      submitDraft();
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer
    }
    const currentHeight =
      textareaRef.current?.getBoundingClientRect().height ?? MIN_COMPOSER_HEIGHT;
    composerDragRef.current = { startY: e.clientY, startHeight: currentHeight };
    setDraggingComposer(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!composerDragRef.current) return;
    const next = clampComposerHeight(
      composerDragRef.current.startHeight + (composerDragRef.current.startY - e.clientY),
      paneRef.current?.clientHeight,
    );
    onChangeComposerHeight(next);
  };

  const handleResizePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!composerDragRef.current) return;
    composerDragRef.current = null;
    setDraggingComposer(false);
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

  const handleResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const baseHeight =
      composerHeight ?? textareaRef.current?.getBoundingClientRect().height ?? MIN_COMPOSER_HEIGHT;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onChangeComposerHeight(clampComposerHeight(baseHeight + 24, paneRef.current?.clientHeight));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onChangeComposerHeight(clampComposerHeight(baseHeight - 24, paneRef.current?.clientHeight));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChangeComposerHeight(null);
    }
  };

  const isExpanded =
    composerHeight !== null && composerHeight >= EXPANDED_COMPOSER_HEIGHT - 10;

  const handleToggleExpandComposer = () => {
    if (isExpanded) {
      onChangeComposerHeight(null);
    } else {
      onChangeComposerHeight(
        clampComposerHeight(EXPANDED_COMPOSER_HEIGHT, paneRef.current?.clientHeight),
      );
    }
  };

  const activePermOption =
    PERMISSION_OPTIONS.find((p) => p.id === permissionMode) ?? PERMISSION_OPTIONS[0];
  const defaultPlaceholder = submission.isPrivate
    ? "私下向你的 Agent 提问（仅自己可见 · 不进房间事件流）…"
    : activeTopicTitle
      ? `在话题「${activeTopicTitle}」中发送消息…（# 引用卡片，@ 提及成员）`
      : "向房间成员或 @Agent 发送指令…（# 引用卡片，@ 提及成员，/ask 私下问）";
  const placeholderText =
    placeholderOverride && (lockedPrivateMode || !submission.isPrivate)
      ? placeholderOverride
      : defaultPlaceholder;

  return (
    <div className="relative z-20 w-full px-4 pb-4">
      {/* Inline # card selector popover */}
      {hashQuery !== null && matchingCards.length > 0 && (
        <div
          className="mb-2 max-h-44 overflow-y-auto p-1.5"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-popover)",
          }}
        >
          <div className="px-2 py-1 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            引用卡片（↑↓ 选择，Enter 插入）
          </div>
          {matchingCards.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => applyCardReference(c)}
              className="flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] cursor-pointer"
              style={{
                background: idx === hashIndex ? "var(--surface-2)" : "transparent",
                color: "var(--text)",
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {cardNumbers[c.id] ?? "#"}
                </span>
                <span className="truncate font-medium">{c.spec.title}</span>
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {c.spec.fileGlobs.length} files
              </span>
            </button>
          ))}
        </div>
      )}

      <form
        className="floating-composer flex flex-col gap-1.5 transition-shadow"
        onSubmit={handleSubmit}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverFiles(true);
        }}
        onDragLeave={() => setDragOverFiles(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverFiles(false);
          addFiles(e.dataTransfer.files);
        }}
        style={{
          background: "var(--surface)",
          border: dragOverFiles
            ? "1.5px dashed var(--text)"
            : submission.isPrivate
              ? "1px dashed var(--border-strong)"
              : "1px solid var(--border-strong)",
          borderRadius: "var(--radius-composer)",
          padding: "var(--composer-pad)",
          boxShadow: "var(--shadow-composer)",
        }}
      >
        {secretWarning && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-[12px] leading-[1.45]"
            style={{
              background: "var(--sem-amber-bg)",
              color: "var(--sem-amber)",
              border: "1px solid var(--border)",
            }}
          >
            <span className="min-w-0 flex-1">
              这条消息里有接入凭证（Token）。发到房间后所有成员都能看到并拿它接入 Agent。
              要给队友接入方式，请让对方自己点「接入 Agent」生成。
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={() => setSecretWarning(false)}>
                返回修改
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => submitDraft({ redactSecrets: true })}
              >
                打码后发送
              </Button>
            </span>
          </div>
        )}

        {/* Top drag handle for vertical resizing */}
        <div
          className={`composer-resize-handle ${draggingComposer ? "dragging" : ""}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整输入框高度"
          title="上下拖拽调整输入框高度，双击恢复自动高度"
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onDoubleClick={() => onChangeComposerHeight(null)}
          onKeyDown={handleResizeKeyDown}
        >
          <span className="composer-resize-grip" />
        </div>

        {/* Attached files + Referenced card pills */}
        {(selectedRefCard || attachments.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            {selectedRefCard && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-composer-inner)",
                }}
              >
                <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {cardNumbers[selectedRefCard.id]}
                </span>
                <span className="max-w-[180px] truncate">{selectedRefCard.spec.title}</span>
                <button
                  type="button"
                  onClick={() => setRefCardId(null)}
                  aria-label="移除卡片引用"
                  className="cursor-pointer opacity-70 hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </span>
            )}

            {attachments.map((file, idx) => (
              <span
                key={`${file.name}-${idx}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px]"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-composer-inner)",
                }}
              >
                <Paperclip size={12} />
                <span className="max-w-[160px] truncate font-medium">{file.name}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {formatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label={`移除文件 ${file.name}`}
                  className="cursor-pointer opacity-70 hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Auto-growing / manually resizable textarea */}
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={draft}
          rows={1}
          onChange={(e) => handleDraftChange(e.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={handleComposerKeyDown}
          placeholder={placeholderText}
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Bottom Toolbar (14px concentric pills + circular send button) */}
        <div className="flex items-center justify-between gap-1.5 pt-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-7 items-center gap-1 px-2 text-[12px] font-medium cursor-pointer transition-opacity hover:opacity-85"
              style={{
                background: "var(--surface-2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-composer-inner)",
              }}
            >
              <Plus size={12} />
              文件
            </button>

            {/* Model Popover */}
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="选择模型"
                  className="inline-flex h-7 items-center gap-1 px-2 text-[12px] font-medium cursor-pointer transition-opacity hover:opacity-85"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-composer-inner)",
                  }}
                >
                  <Sparkles size={12} style={{ color: "var(--text-muted)" }} />
                  <span className="max-w-[100px] truncate">{model}</span>
                  <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="top" className="w-[210px] p-1.5">
                <div
                  className="px-2 py-1 text-[11px] font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  目标模型上下文
                </div>
                {MODEL_OPTIONS.map((opt) => {
                  const active = model === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setModel(opt);
                        setModelOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[13px] cursor-pointer"
                      style={{
                        background: active ? "var(--surface-2)" : "transparent",
                        color: "var(--text)",
                      }}
                    >
                      <span className="font-medium">{opt}</span>
                      {active && <Check size={13} />}
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>

            {/* Permission Mode Popover */}
            <Popover open={permOpen} onOpenChange={setPermOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="选择权限模式"
                  className="inline-flex h-7 items-center gap-1 px-2 text-[12px] font-medium cursor-pointer transition-opacity hover:opacity-85"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-composer-inner)",
                  }}
                >
                  <Shield size={12} style={{ color: "var(--text-muted)" }} />
                  <span>{activePermOption.label}</span>
                  <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="top" className="w-[260px] p-1.5">
                <div
                  className="px-2 py-1 text-[11px] font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Agent 执行权限策略
                </div>
                {PERMISSION_OPTIONS.map((opt) => {
                  const active = permissionMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setPermissionMode(opt.id);
                        setPermOpen(false);
                      }}
                      className="flex w-full flex-col gap-0.5 rounded-[10px] px-2.5 py-2 text-left cursor-pointer"
                      style={{
                        background: active ? "var(--surface-2)" : "transparent",
                        color: "var(--text)",
                      }}
                    >
                      <div className="flex items-center justify-between text-[13px] font-medium">
                        <span>{opt.label}</span>
                        {active && <Check size={13} />}
                      </div>
                      <span className="text-[11px] leading-[1.35]" style={{ color: "var(--text-muted)" }}>
                        {opt.desc}
                      </span>
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>

            {/* Private Side-Ask Lock Indicator or Toggle Pill */}
            {lockedPrivateMode ? (
              <span
                className="inline-flex h-7 items-center gap-1 px-2 text-[12px] font-medium"
                title="当前频道仅自己可见，不会写入房间事件流"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-muted)",
                  border: "1px dashed var(--border-strong)",
                  borderRadius: "var(--radius-composer-inner)",
                }}
              >
                <Lock size={12} />
                <span>仅自己可见</span>
              </span>
            ) : (
              !hidePrivateToggle && (
                <button
                  type="button"
                  aria-pressed={privateMode}
                  onClick={() => {
                    setPrivateMode((prev) => !prev);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  title="开启后仅自己可见，不会写入房间事件流（也可用 @我的agent 或 /ask 触发）"
                  className="inline-flex h-7 items-center gap-1 px-2 text-[12px] font-medium cursor-pointer transition-opacity hover:opacity-85"
                  style={
                    privateMode
                      ? {
                          background: "var(--primary-bg)",
                          color: "var(--primary-text)",
                          border: "1px solid var(--primary-bg)",
                          borderRadius: "var(--radius-composer-inner)",
                        }
                      : {
                          background: "var(--surface-2)",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-composer-inner)",
                        }
                  }
                >
                  <Lock size={12} style={privateMode ? undefined : { color: "var(--text-muted)" }} />
                  <span>私下问 Agent</span>
                </button>
              )
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {workingAgents.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  onStopAgent(workingAgents[0].id, "协作者在底部控制台触发急停")
                }
                title={`紧急停止 ${workingAgents[0].name}`}
                className="inline-flex h-7 items-center gap-1 px-2 text-[12px] font-medium cursor-pointer"
                style={{
                  background: "var(--sem-red-bg)",
                  color: "var(--sem-red)",
                  border: "1px solid rgba(239, 68, 68, 0.28)",
                  borderRadius: "var(--radius-composer-inner)",
                }}
              >
                <OctagonX size={12} />
                急停
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleExpandComposer}
              aria-label={isExpanded ? "还原高度" : "放大输入"}
              title={isExpanded ? "还原输入框高度" : "放大输入框"}
              className="flex h-7 w-7 items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
              style={{
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-composer-inner)",
              }}
            >
              {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>

            <button
              type="submit"
              disabled={!canSubmit}
              aria-label={submission.isPrivate ? "私下提问" : "发送消息"}
              className="flex h-8 w-8 items-center justify-center rounded-full cursor-pointer transition-opacity disabled:opacity-35 disabled:cursor-not-allowed hover:opacity-90"
              style={{
                background: "var(--primary-bg)",
                color: "var(--primary-text)",
                border: "1px solid var(--primary-bg)",
              }}
            >
              <ArrowUp size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

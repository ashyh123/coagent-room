import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TopicAnchorKind } from "@coagent/protocol";
import { FilePlus2, Lock, MessageSquarePlus } from "lucide-react";

export interface SelectionActionPayload {
  text: string;
  anchorKind: TopicAnchorKind;
  targetId?: string;
  sourceLabel: string;
}

interface SelectionActionBarProps {
  onCreateTopic: (payload: SelectionActionPayload) => void;
  onAskPrivate: (payload: SelectionActionPayload) => void;
  onCreateDraftCard: (payload: SelectionActionPayload) => void;
}

interface SelectionSnapshot {
  payload: SelectionActionPayload;
  rect: {
    top: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  };
}

const IGNORED_ANCESTOR_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]';
const SELECTABLE_ROOT_SELECTOR = '[data-selectable-room-content="true"]';

function toElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  return node.parentElement;
}

function isIgnoredElement(el: Element | null): boolean {
  if (!el) return false;
  return Boolean(el.closest(IGNORED_ANCESTOR_SELECTOR));
}

function resolveAnchorMeta(
  startEl: Element,
  endEl: Element,
): Pick<SelectionActionPayload, "anchorKind" | "targetId" | "sourceLabel"> {
  const msgEl = startEl.closest("[data-message-id]") ?? endEl.closest("[data-message-id]");
  const messageId = msgEl?.getAttribute("data-message-id");
  if (messageId) {
    return {
      anchorKind: "message",
      targetId: messageId,
      sourceLabel: "消息摘录",
    };
  }

  const outputEl = startEl.closest("[data-output-id]") ?? endEl.closest("[data-output-id]");
  const outputId = outputEl?.getAttribute("data-output-id");
  if (outputId) {
    return {
      anchorKind: "output",
      targetId: outputId,
      sourceLabel: "产出 Diff",
    };
  }

  const cardEl = startEl.closest("[data-card-id]") ?? endEl.closest("[data-card-id]");
  const cardId = cardEl?.getAttribute("data-card-id");
  if (cardId) {
    return {
      anchorKind: "card",
      targetId: cardId,
      sourceLabel: "卡片 Spec",
    };
  }

  return {
    anchorKind: "selection",
    sourceLabel: "选中片段",
  };
}

function readCurrentSelection(): SelectionSnapshot | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;

  const activeEl = document.activeElement;
  if (isIgnoredElement(activeEl)) return null;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString().trim();
  if (text.length < 2) return null;

  const range = selection.getRangeAt(0);
  const startEl = toElement(range.startContainer);
  const endEl = toElement(range.endContainer);
  if (!startEl || !endEl) return null;

  if (isIgnoredElement(startEl) || isIgnoredElement(endEl)) return null;

  const startRoot = startEl.closest(SELECTABLE_ROOT_SELECTOR);
  const endRoot = endEl.closest(SELECTABLE_ROOT_SELECTOR);
  if (!startRoot || !endRoot || startRoot !== endRoot) {
    return null;
  }

  let rawRect = range.getBoundingClientRect();
  if (rawRect.width === 0 && rawRect.height === 0) {
    const firstClientRect = range.getClientRects()[0];
    if (!firstClientRect) return null;
    rawRect = firstClientRect;
  }
  if (rawRect.width === 0 && rawRect.height === 0) return null;

  const rootRect = startRoot.getBoundingClientRect();
  if (
    rawRect.bottom < Math.max(0, rootRect.top) ||
    rawRect.top > Math.min(window.innerHeight, rootRect.bottom) ||
    rawRect.right < 0 ||
    rawRect.left > window.innerWidth
  ) {
    return null;
  }

  const anchorMeta = resolveAnchorMeta(startEl, endEl);

  return {
    payload: {
      text,
      ...anchorMeta,
    },
    rect: {
      top: rawRect.top,
      bottom: rawRect.bottom,
      left: rawRect.left,
      width: rawRect.width,
      height: rawRect.height,
    },
  };
}

export function SelectionActionBar({
  onCreateTopic,
  onAskPrivate,
  onCreateDraftCard,
}: SelectionActionBarProps) {
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 12, top: 64 });
  const barRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const syncSelection = useCallback(() => {
    setSnapshot(readCurrentSelection());
  }, []);

  const scheduleSync = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      syncSelection();
    });
  }, [syncSelection]);

  useEffect(() => {
    const handlePointerOrKey = (e: Event) => {
      const target = e.target instanceof Node ? e.target : null;
      if (target && barRef.current?.contains(target)) {
        return;
      }
      scheduleSync();
    };

    const handleSelectionChange = () => {
      scheduleSync();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSnapshot(null);
      }
    };

    const handleScrollOrResize = () => {
      scheduleSync();
    };

    document.addEventListener("mouseup", handlePointerOrKey);
    document.addEventListener("keyup", handlePointerOrKey);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      document.removeEventListener("mouseup", handlePointerOrKey);
      document.removeEventListener("keyup", handlePointerOrKey);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [scheduleSync]);

  useLayoutEffect(() => {
    if (!snapshot || typeof window === "undefined") return;

    const el = barRef.current;
    const width = el?.offsetWidth ?? 308;
    const height = el?.offsetHeight ?? 36;
    const margin = 12;

    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const desiredLeft = snapshot.rect.left + snapshot.rect.width / 2 - width / 2;
    const left = Math.round(Math.min(maxLeft, Math.max(margin, desiredLeft)));

    const preferredTop = snapshot.rect.top - height - 10;
    const fallbackTop = snapshot.rect.bottom + 10;
    const rawTop = preferredTop >= 60 ? preferredTop : fallbackTop;
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const top = Math.round(Math.min(maxTop, Math.max(margin, rawTop)));

    setCoords((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [snapshot]);

  if (!snapshot || typeof document === "undefined") {
    return null;
  }

  const runAction = (handler: (payload: SelectionActionPayload) => void) => {
    const current = snapshot.payload;
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
    setSnapshot(null);
    handler(current);
  };

  return createPortal(
    <div
      ref={barRef}
      role="toolbar"
      aria-label="选中文本协作操作"
      className="fixed inline-flex items-center p-1"
      style={{
        zIndex: 60,
        left: coords.left,
        top: coords.top,
        background: "var(--primary-bg)",
        color: "var(--primary-text)",
        borderRadius: 9999,
        boxShadow: "var(--shadow-popover)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => runAction(onCreateTopic)}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium whitespace-nowrap transition-opacity cursor-pointer hover:opacity-80"
      >
        <MessageSquarePlus size={12} />
        开话题
      </button>

      <span className="mx-0.5 h-3.5 w-px opacity-25" style={{ background: "currentColor" }} />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => runAction(onAskPrivate)}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium whitespace-nowrap transition-opacity cursor-pointer hover:opacity-80"
      >
        <Lock size={12} />
        问我的 Agent
      </button>

      <span className="mx-0.5 h-3.5 w-px opacity-25" style={{ background: "currentColor" }} />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => runAction(onCreateDraftCard)}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium whitespace-nowrap transition-opacity cursor-pointer hover:opacity-80"
      >
        <FilePlus2 size={12} />
        生成卡片草案
      </button>
    </div>,
    document.body,
  );
}

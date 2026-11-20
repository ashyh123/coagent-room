import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CHAT_WIDTH,
  WorkspaceLayout,
  WorkspaceViewMode,
  clampChatWidth,
  loadLayout,
  saveLayout,
} from "../utils/layout.js";

export function useSplitPane(active: boolean) {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadLayout());
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const [draggingSplit, setDraggingSplit] = useState(false);

  const panesRef = useRef<HTMLElement | null>(null);
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  useEffect(() => {
    if (!active) return;
    const el = panesRef.current;
    if (!el) return;

    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [active]);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  const effectiveChatWidth = clampChatWidth(layout.chatWidth, containerWidth);

  const setViewMode = useCallback((mode: WorkspaceViewMode) => {
    setLayout((prev) => (prev.viewMode === mode ? prev : { ...prev, viewMode: mode }));
  }, []);

  const setComposerHeight = useCallback((composerHeight: number | null) => {
    setLayout((prev) => ({ ...prev, composerHeight }));
  }, []);

  const setCardListWidth = useCallback((cardListWidth: number) => {
    setLayout((prev) => ({ ...prev, cardListWidth }));
  }, []);

  const toggleCardList = useCallback(() => {
    setLayout((prev) => ({ ...prev, cardListCollapsed: !prev.cardListCollapsed }));
  }, []);

  const resetChatWidth = useCallback(() => {
    const width = panesRef.current?.clientWidth ?? containerWidth;
    setLayout((prev) => ({ ...prev, chatWidth: clampChatWidth(DEFAULT_CHAT_WIDTH, width) }));
  }, [containerWidth]);

  const handleSplitPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic events
      }
      splitDragRef.current = { startX: e.clientX, startWidth: effectiveChatWidth };
      setDraggingSplit(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [effectiveChatWidth],
  );

  const handleSplitPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!splitDragRef.current) return;
      const width = panesRef.current?.clientWidth ?? containerWidth;
      const nextWidth = clampChatWidth(
        splitDragRef.current.startWidth + (e.clientX - splitDragRef.current.startX),
        width,
      );
      setLayout((prev) => ({ ...prev, chatWidth: nextWidth }));
    },
    [containerWidth],
  );

  const handleSplitPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current) return;
    splitDragRef.current = null;
    setDraggingSplit(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSplitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const width = panesRef.current?.clientWidth ?? containerWidth;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setLayout((prev) => ({
          ...prev,
          chatWidth: clampChatWidth(effectiveChatWidth - 24, width),
        }));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setLayout((prev) => ({
          ...prev,
          chatWidth: clampChatWidth(effectiveChatWidth + 24, width),
        }));
      } else if (e.key === "Home") {
        e.preventDefault();
        resetChatWidth();
      }
    },
    [containerWidth, effectiveChatWidth, resetChatWidth],
  );

  return {
    layout,
    panesRef,
    effectiveChatWidth,
    draggingSplit,
    setViewMode,
    setComposerHeight,
    setCardListWidth,
    toggleCardList,
    resetChatWidth,
    handleSplitPointerDown,
    handleSplitPointerMove,
    handleSplitPointerEnd,
    handleSplitKeyDown,
  };
}

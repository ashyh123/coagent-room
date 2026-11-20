import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_CHAT_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_BOARD_WIDTH,
  MIN_CHAT_WIDTH,
  WorkspaceLayout,
  WorkspaceViewMode,
  clampChatWidth,
  clampSidebarWidth,
  isCompactViewport,
  loadLayout,
  resolveViewMode,
  saveLayout,
} from "../utils/layout.js";

function computeRemainingChatBoardWidth(
  containerWidth: number | undefined,
  sidebarCollapsed: boolean,
  sidebarWidth: number,
): number | undefined {
  if (containerWidth === undefined) return undefined;
  const effectiveSidebar = clampSidebarWidth(sidebarWidth, containerWidth);
  const occupied = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : effectiveSidebar;
  return Math.max(MIN_CHAT_WIDTH + MIN_BOARD_WIDTH, containerWidth - occupied);
}

export function useSplitPane(active: boolean) {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadLayout());
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [draggingSidebar, setDraggingSidebar] = useState(false);
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && isCompactViewport(window.innerWidth),
  );
  // On compact screens the session sidebar is an overlay drawer; its open state is
  // transient and never persisted into the desktop layout.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const panesRef = useRef<HTMLElement | null>(null);
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

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
    if (typeof window === "undefined") return;
    const update = () => {
      const next = isCompactViewport(window.innerWidth);
      setCompact(next);
      if (!next) setDrawerOpen(false);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  const effectiveSidebarWidth = clampSidebarWidth(layout.sidebarWidth, containerWidth);
  const occupiedSidebarWidth = layout.sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : effectiveSidebarWidth;
  const remainingWidth =
    containerWidth !== undefined
      ? Math.max(MIN_CHAT_WIDTH + MIN_BOARD_WIDTH, containerWidth - occupiedSidebarWidth)
      : undefined;
  const effectiveChatWidth = clampChatWidth(layout.chatWidth, remainingWidth);

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

  const toggleSidebar = useCallback(() => {
    setLayout((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  }, []);

  const setSidebarCollapsed = useCallback((sidebarCollapsed: boolean) => {
    setLayout((prev) =>
      prev.sidebarCollapsed === sidebarCollapsed ? prev : { ...prev, sidebarCollapsed },
    );
  }, []);

  const setSidebarWidth = useCallback(
    (width: number) => {
      const totalWidth = panesRef.current?.clientWidth ?? containerWidth;
      setLayout((prev) => ({
        ...prev,
        sidebarWidth: clampSidebarWidth(width, totalWidth),
      }));
    },
    [containerWidth],
  );

  const resetSidebarWidth = useCallback(() => {
    const totalWidth = panesRef.current?.clientWidth ?? containerWidth;
    setLayout((prev) => ({
      ...prev,
      sidebarWidth: clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, totalWidth),
    }));
  }, [containerWidth]);

  const resetChatWidth = useCallback(() => {
    const width = panesRef.current?.clientWidth ?? containerWidth;
    setLayout((prev) => {
      const avail = computeRemainingChatBoardWidth(width, prev.sidebarCollapsed, prev.sidebarWidth);
      return { ...prev, chatWidth: clampChatWidth(DEFAULT_CHAT_WIDTH, avail) };
    });
  }, [containerWidth]);

  const handleSidebarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic events
      }
      sidebarDragRef.current = { startX: e.clientX, startWidth: effectiveSidebarWidth };
      setDraggingSidebar(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [effectiveSidebarWidth],
  );

  const handleSidebarPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!sidebarDragRef.current) return;
      const totalWidth = panesRef.current?.clientWidth ?? containerWidth;
      const nextWidth = clampSidebarWidth(
        sidebarDragRef.current.startWidth + (e.clientX - sidebarDragRef.current.startX),
        totalWidth,
      );
      setLayout((prev) => ({ ...prev, sidebarWidth: nextWidth }));
    },
    [containerWidth],
  );

  const handleSidebarPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarDragRef.current) return;
    sidebarDragRef.current = null;
    setDraggingSidebar(false);
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

  const handleSidebarKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const totalWidth = panesRef.current?.clientWidth ?? containerWidth;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setLayout((prev) => ({
          ...prev,
          sidebarWidth: clampSidebarWidth(effectiveSidebarWidth - 20, totalWidth),
        }));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setLayout((prev) => ({
          ...prev,
          sidebarWidth: clampSidebarWidth(effectiveSidebarWidth + 20, totalWidth),
        }));
      } else if (e.key === "Home") {
        e.preventDefault();
        resetSidebarWidth();
      }
    },
    [containerWidth, effectiveSidebarWidth, resetSidebarWidth],
  );

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
      const totalWidth = panesRef.current?.clientWidth ?? containerWidth;
      const targetWidth =
        splitDragRef.current.startWidth + (e.clientX - splitDragRef.current.startX);
      setLayout((prev) => {
        const avail = computeRemainingChatBoardWidth(
          totalWidth,
          prev.sidebarCollapsed,
          prev.sidebarWidth,
        );
        return { ...prev, chatWidth: clampChatWidth(targetWidth, avail) };
      });
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
      const totalWidth = panesRef.current?.clientWidth ?? containerWidth;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setLayout((prev) => {
          const avail = computeRemainingChatBoardWidth(
            totalWidth,
            prev.sidebarCollapsed,
            prev.sidebarWidth,
          );
          return { ...prev, chatWidth: clampChatWidth(effectiveChatWidth - 24, avail) };
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setLayout((prev) => {
          const avail = computeRemainingChatBoardWidth(
            totalWidth,
            prev.sidebarCollapsed,
            prev.sidebarWidth,
          );
          return { ...prev, chatWidth: clampChatWidth(effectiveChatWidth + 24, avail) };
        });
      } else if (e.key === "Home") {
        e.preventDefault();
        resetChatWidth();
      }
    },
    [containerWidth, effectiveChatWidth, resetChatWidth],
  );

  return {
    layout,
    /** View mode actually rendered: split collapses to chat on compact screens. */
    viewMode: resolveViewMode(layout.viewMode, compact),
    compact,
    drawerOpen,
    setDrawerOpen,
    panesRef,
    effectiveSidebarWidth,
    occupiedSidebarWidth,
    effectiveChatWidth,
    draggingSidebar,
    draggingSplit,
    setViewMode,
    setComposerHeight,
    setCardListWidth,
    toggleCardList,
    toggleSidebar,
    setSidebarCollapsed,
    setSidebarWidth,
    resetSidebarWidth,
    resetChatWidth,
    handleSidebarPointerDown,
    handleSidebarPointerMove,
    handleSidebarPointerEnd,
    handleSidebarKeyDown,
    handleSplitPointerDown,
    handleSplitPointerMove,
    handleSplitPointerEnd,
    handleSplitKeyDown,
  };
}

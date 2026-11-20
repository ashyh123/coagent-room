export type WorkspaceViewMode = "split" | "chat" | "board";

export interface WorkspaceLayout {
  viewMode: WorkspaceViewMode;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  chatWidth: number;
  cardListWidth: number;
  cardListCollapsed: boolean;
  composerHeight: number | null;
}

export const LAYOUT_STORAGE_KEY = "coagent_room_layout_v1";

export const DEFAULT_SIDEBAR_WIDTH = 228;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 320;
export const COLLAPSED_SIDEBAR_WIDTH = 48;

export const DEFAULT_CHAT_WIDTH = 496;
export const MIN_CHAT_WIDTH = 260;
export const MIN_BOARD_WIDTH = 360;

export const DEFAULT_CARD_LIST_WIDTH = 280;
export const MIN_CARD_LIST_WIDTH = 200;
export const MAX_CARD_LIST_WIDTH = 480;
export const MIN_CARD_DETAIL_WIDTH = 280;

export const MIN_COMPOSER_HEIGHT = 44;
export const AUTO_COMPOSER_MAX_HEIGHT = 220;
export const EXPANDED_COMPOSER_HEIGHT = 240;
export const MAX_COMPOSER_HEIGHT = 480;

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  viewMode: "split",
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsed: false,
  chatWidth: DEFAULT_CHAT_WIDTH,
  cardListWidth: DEFAULT_CARD_LIST_WIDTH,
  cardListCollapsed: true,
  composerHeight: null,
};

function isValidViewMode(value: unknown): value is WorkspaceViewMode {
  return value === "split" || value === "chat" || value === "board";
}

export function clampSidebarWidth(width: number, containerWidth?: number): number {
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH;
  if (containerWidth !== undefined && Number.isFinite(containerWidth) && containerWidth > 0) {
    const minAllowed =
      containerWidth < MIN_SIDEBAR_WIDTH + MIN_CHAT_WIDTH
        ? Math.floor(containerWidth * 0.35)
        : MIN_SIDEBAR_WIDTH;
    const maxAllowed = Math.max(
      minAllowed,
      Math.min(MAX_SIDEBAR_WIDTH, containerWidth - MIN_CHAT_WIDTH),
    );
    return Math.round(Math.min(maxAllowed, Math.max(minAllowed, safeWidth)));
  }
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, safeWidth)));
}

export function clampChatWidth(width: number, containerWidth?: number): number {
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_CHAT_WIDTH;
  if (containerWidth !== undefined && Number.isFinite(containerWidth) && containerWidth > 0) {
    const minAllowed =
      containerWidth < MIN_CHAT_WIDTH + MIN_BOARD_WIDTH
        ? Math.floor(containerWidth * 0.4)
        : MIN_CHAT_WIDTH;
    const maxAllowed = Math.max(minAllowed, containerWidth - MIN_BOARD_WIDTH);
    return Math.round(Math.min(maxAllowed, Math.max(minAllowed, safeWidth)));
  }
  return Math.round(Math.min(900, Math.max(MIN_CHAT_WIDTH, safeWidth)));
}

export function clampCardListWidth(width: number, boardWidth?: number): number {
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_CARD_LIST_WIDTH;
  if (boardWidth !== undefined && Number.isFinite(boardWidth) && boardWidth > 0) {
    const minAllowed =
      boardWidth < MIN_CARD_LIST_WIDTH + MIN_CARD_DETAIL_WIDTH
        ? Math.floor(boardWidth * 0.35)
        : MIN_CARD_LIST_WIDTH;
    const maxAllowed = Math.max(
      minAllowed,
      Math.min(MAX_CARD_LIST_WIDTH, boardWidth - MIN_CARD_DETAIL_WIDTH),
    );
    return Math.round(Math.min(maxAllowed, Math.max(minAllowed, safeWidth)));
  }
  return Math.round(Math.min(MAX_CARD_LIST_WIDTH, Math.max(MIN_CARD_LIST_WIDTH, safeWidth)));
}

export function clampComposerHeight(height: number, paneHeight?: number): number {
  const safeHeight = Number.isFinite(height) ? height : MIN_COMPOSER_HEIGHT;
  const dynamicMax =
    paneHeight !== undefined && Number.isFinite(paneHeight) && paneHeight > 0
      ? Math.max(
          MIN_COMPOSER_HEIGHT + 40,
          Math.min(MAX_COMPOSER_HEIGHT, Math.floor(paneHeight * 0.6)),
        )
      : MAX_COMPOSER_HEIGHT;
  return Math.round(Math.min(dynamicMax, Math.max(MIN_COMPOSER_HEIGHT, safeHeight)));
}

export function sanitizeLayout(raw: unknown): WorkspaceLayout {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_LAYOUT };
  }
  const obj = raw as Record<string, unknown>;
  return {
    viewMode: isValidViewMode(obj.viewMode) ? obj.viewMode : DEFAULT_LAYOUT.viewMode,
    sidebarWidth:
      typeof obj.sidebarWidth === "number" && Number.isFinite(obj.sidebarWidth)
        ? clampSidebarWidth(obj.sidebarWidth)
        : DEFAULT_LAYOUT.sidebarWidth,
    sidebarCollapsed:
      typeof obj.sidebarCollapsed === "boolean"
        ? obj.sidebarCollapsed
        : DEFAULT_LAYOUT.sidebarCollapsed,
    chatWidth:
      typeof obj.chatWidth === "number" && Number.isFinite(obj.chatWidth)
        ? clampChatWidth(obj.chatWidth)
        : DEFAULT_LAYOUT.chatWidth,
    cardListWidth:
      typeof obj.cardListWidth === "number" && Number.isFinite(obj.cardListWidth)
        ? clampCardListWidth(obj.cardListWidth)
        : DEFAULT_LAYOUT.cardListWidth,
    cardListCollapsed:
      typeof obj.cardListCollapsed === "boolean"
        ? obj.cardListCollapsed
        : DEFAULT_LAYOUT.cardListCollapsed,
    composerHeight:
      obj.composerHeight === null
        ? null
        : typeof obj.composerHeight === "number" && Number.isFinite(obj.composerHeight)
          ? clampComposerHeight(obj.composerHeight)
          : null,
  };
}

export function loadLayout(storage?: Pick<Storage, "getItem"> | null): WorkspaceLayout {
  const target =
    storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
  if (!target) return { ...DEFAULT_LAYOUT };
  try {
    const raw = target.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    return sanitizeLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(
  layout: WorkspaceLayout,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  const target =
    storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
  if (!target) return;
  try {
    target.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(sanitizeLayout(layout)));
  } catch {
    // ignore storage quota / privacy errors
  }
}

// Phone-width layout: below Tailwind's `md` breakpoint the workspace becomes a
// single column (no split view) and the session sidebar becomes a drawer.
export const COMPACT_MAX_WIDTH = 767;

export function isCompactViewport(width: number): boolean {
  return width <= COMPACT_MAX_WIDTH;
}

export function resolveViewMode(mode: WorkspaceViewMode, compact: boolean): WorkspaceViewMode {
  return compact && mode === "split" ? "chat" : mode;
}

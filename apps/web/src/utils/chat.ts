import { Card, RoomEvent } from "@coagent/protocol";

export function shouldGroupMessages(
  prev: { actorId: string; createdAt: string } | null,
  curr: { actorId: string; createdAt: string },
  windowMs = 120_000,
): boolean {
  if (!prev || prev.actorId !== curr.actorId) return false;
  const prevMs = Date.parse(prev.createdAt);
  const currMs = Date.parse(curr.createdAt);
  if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) return false;
  return currMs >= prevMs && currMs - prevMs <= windowMs;
}

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function buildCardNumberMap(
  events: readonly RoomEvent[],
  cards: Record<string, Card>,
): Record<string, string> {
  const map: Record<string, string> = {};
  let index = 1;
  for (const evt of events) {
    if (evt.payload.type === "card_created") {
      const id = evt.payload.cardId;
      if (!map[id]) {
        map[id] = `#${String(index).padStart(2, "0")}`;
        index += 1;
      }
    }
  }
  const remaining = Object.values(cards)
    .filter((c) => !map[c.id])
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const card of remaining) {
    map[card.id] = `#${String(index).padStart(2, "0")}`;
    index += 1;
  }
  return map;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  // For CJK single token, return first char; for Latin, up to 2 chars
  const first = trimmed[0] ?? "?";
  if (/[\u4e00-\u9fff]/.test(first)) {
    return first;
  }
  return trimmed.slice(0, 2).toUpperCase();
}

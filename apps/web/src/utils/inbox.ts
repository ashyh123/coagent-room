import { CardSpec } from "@coagent/protocol";

const DISMISSED_MENTIONS_KEY_PREFIX = "coagent_dismissed_mentions_v1";
const MAX_DISMISSED_MENTIONS = 500;

export function getDismissedMentionsStorageKey(roomId: string, memberId: string): string {
  return `${DISMISSED_MENTIONS_KEY_PREFIX}:${roomId}:${memberId}`;
}

export function loadDismissedMentions(
  roomId: string,
  memberId: string,
  storage?: Pick<Storage, "getItem"> | null,
): Set<string> {
  if (!roomId || !memberId) return new Set();
  const target =
    storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
  if (!target) return new Set();

  try {
    const raw = target.getItem(getDismissedMentionsStorageKey(roomId, memberId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0));
  } catch {
    return new Set();
  }
}

export function saveDismissedMentions(
  roomId: string,
  memberId: string,
  ids: Iterable<string>,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  if (!roomId || !memberId) return;
  const target =
    storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
  if (!target) return;

  const unique = Array.from(
    new Set(Array.from(ids).filter((id): id is string => typeof id === "string" && id.length > 0)),
  ).slice(-MAX_DISMISSED_MENTIONS);

  try {
    target.setItem(getDismissedMentionsStorageKey(roomId, memberId), JSON.stringify(unique));
  } catch {
    // ignore storage quota / privacy errors
  }
}

function stripLeadingMarkup(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:[-*•>]+|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .trim();
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 1) return text.slice(0, maxLen);
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

export function buildTopicTitleFromText(text: string, fallback = "新话题讨论"): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return fallback;

  const lines = normalized
    .split("\n")
    .map((line) => stripLeadingMarkup(line.trim()))
    .filter(Boolean);
  const first = lines[0] ?? normalized;
  return truncateText(first.replace(/\s+/g, " ").trim(), 60) || fallback;
}

const PATH_GLOB_PATTERN =
  /\b(?:apps|packages|src|docs|scripts|test)\/[A-Za-z0-9_.*\/-]+(?:\.[A-Za-z0-9]+|\*\*|\*)?/g;

function extractCandidateGlobs(text: string): string[] {
  const matches = text.match(PATH_GLOB_PATTERN) ?? [];
  const cleaned = matches
    .map((m) => m.replace(/[),.;:!?'"`]+$/, ""))
    .filter((m) => m.length > 0);
  return Array.from(new Set(cleaned)).slice(0, 6);
}

function extractAcceptanceCriteria(lines: readonly string[]): string[] {
  const criteria: string[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const checkboxMatch = trimmed.match(/^[-*]\s+\[[ xX]\]\s+(.+)$/);
    if (checkboxMatch && checkboxMatch[1]) {
      criteria.push(checkboxMatch[1].trim());
      continue;
    }
    const prefixMatch = trimmed.match(/^(?:验收|AC|Criteria)[:：]\s*(.+)$/i);
    if (prefixMatch && prefixMatch[1]) {
      criteria.push(prefixMatch[1].trim());
    }
  }
  return Array.from(new Set(criteria)).slice(0, 10);
}

/**
 * Converts selected room text or a private Q&A exchange into a valid Partial<CardSpec>
 * suitable for prefilling CardEditorModal.
 */
export function buildDraftSpecFromText(text: string, sourceLabel?: string): Partial<CardSpec> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const cleanSource = sourceLabel?.trim();

  if (!normalized) {
    return {
      title: cleanSource ? truncateText(`来自${cleanSource}的草案`, 120) : "新建卡片草案",
      goal: cleanSource ? `基于${cleanSource}整理的协作目标` : "请补充目标说明",
      interfaceContract: "",
      fileGlobs: ["src/**"],
      acceptanceCriteria: [],
    };
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rawTitle = stripLeadingMarkup(lines[0] ?? normalized).replace(/\s+/g, " ").trim();
  const title = truncateText(rawTitle || "新建卡片草案", 72);

  const goalBody = cleanSource ? `${normalized}\n\n（来源：${cleanSource}）` : normalized;
  const goal = truncateText(goalBody, 4000);

  const extractedGlobs = extractCandidateGlobs(normalized);
  const fileGlobs = extractedGlobs.length > 0 ? extractedGlobs : ["src/**"];
  const acceptanceCriteria = extractAcceptanceCriteria(lines);

  return {
    title,
    goal,
    interfaceContract: "",
    fileGlobs,
    acceptanceCriteria,
  };
}

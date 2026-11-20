export type DiffLineKind = "add" | "del" | "hunk" | "ctx";

export interface DiffLineRow {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface ParsedDiff {
  fileName: string | null;
  additions: number;
  deletions: number;
  lines: DiffLineRow[];
}

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return "ctx";
}

export function parseDiff(diff: string): ParsedDiff {
  const rawLines = diff.split(/\r?\n/);
  let fileName: string | null = null;
  let additions = 0;
  let deletions = 0;
  let oldCursor = 0;
  let newCursor = 0;
  let inHunk = false;
  const lines: DiffLineRow[] = [];

  for (const raw of rawLines) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/diff --git a\/(.+?) b\/(.+)$/);
      if (m) fileName = m[2];
      inHunk = false;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      if (target !== "/dev/null") {
        fileName = target.startsWith("b/") ? target.slice(2) : target;
      }
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("index ")) {
      continue;
    }

    const kind = classifyDiffLine(raw);
    if (kind === "hunk") {
      const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldCursor = Number(match[1]);
        newCursor = Number(match[2]);
        inHunk = true;
      }
      lines.push({ kind: "hunk", oldLine: null, newLine: null, content: raw });
      continue;
    }

    if (kind === "add") {
      additions += 1;
      lines.push({
        kind: "add",
        oldLine: null,
        newLine: inHunk ? newCursor++ : null,
        content: raw,
      });
      continue;
    }

    if (kind === "del") {
      deletions += 1;
      lines.push({
        kind: "del",
        oldLine: inHunk ? oldCursor++ : null,
        newLine: null,
        content: raw,
      });
      continue;
    }

    if (raw.length === 0 && lines.length === 0) {
      continue;
    }

    lines.push({
      kind: "ctx",
      oldLine: inHunk ? oldCursor++ : null,
      newLine: inHunk ? newCursor++ : null,
      content: raw,
    });
  }

  return { fileName, additions, deletions, lines };
}

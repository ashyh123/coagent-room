import { z } from "zod";

export const ActiveClaimSchema = z.object({
  cardId: z.string().min(1),
  agentId: z.string().min(1),
  agentName: z.string().min(1),
  fileGlobs: z.array(z.string().min(1)),
});
export type ActiveClaim = z.infer<typeof ActiveClaimSchema>;

export const LockConflictSchema = z.object({
  requestedGlob: z.string(),
  heldGlob: z.string(),
  heldByCardId: z.string(),
  heldByAgentId: z.string(),
  heldByAgentName: z.string(),
});
export type LockConflict = z.infer<typeof LockConflictSchema>;

export function normalizeGlob(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  const norm = normalizeGlob(glob);
  let re = "^";
  let i = 0;
  while (i < norm.length) {
    if (norm[i] === "*" && norm[i + 1] === "*") {
      if (norm[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (norm[i] === "*") {
      re += "[^/]*";
      i += 1;
    } else if (norm[i] === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += escapeRegex(norm[i]);
      i += 1;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function matchesGlob(filePath: string, glob: string): boolean {
  const normPath = normalizeGlob(filePath);
  const normGlob = normalizeGlob(glob);
  if (!normPath || !normGlob) return false;
  if (normPath === normGlob) return true;
  return globToRegExp(normGlob).test(normPath);
}

function staticDirPrefix(glob: string): string {
  const segments = normalizeGlob(glob).split("/");
  const prefix: string[] = [];
  for (const seg of segments) {
    if (seg.includes("*") || seg.includes("?")) break;
    prefix.push(seg);
  }
  return prefix.join("/");
}

function hasWildcard(glob: string): boolean {
  return glob.includes("*") || glob.includes("?");
}

/**
 * Conservative overlap check between two file globs.
 * Prefers warning over missing a real collision between two coding agents.
 */
export function globsMayOverlap(rawA: string, rawB: string): boolean {
  const a = normalizeGlob(rawA);
  const b = normalizeGlob(rawB);
  if (!a || !b) return false;
  if (a === b) return true;

  // Exact match or one matches the other directly
  if (!hasWildcard(a) && !hasWildcard(b)) {
    return a === b;
  }
  if (!hasWildcard(a) && hasWildcard(b)) {
    return matchesGlob(a, b);
  }
  if (hasWildcard(a) && !hasWildcard(b)) {
    return matchesGlob(b, a);
  }

  // Both contain wildcards: compare static directory prefixes and segment compatibility
  const segsA = a.split("/");
  const segsB = b.split("/");

  // If either has ** at root, it overlaps everything
  if (a === "**" || b === "**") return true;

  const prefA = staticDirPrefix(a);
  const prefB = staticDirPrefix(b);

  if (prefA && prefB) {
    const aStartsWithB = prefA === prefB || prefA.startsWith(`${prefB}/`);
    const bStartsWithA = prefB.startsWith(`${prefA}/`);
    if (!aStartsWithB && !bStartsWithA) {
      return false;
    }
  }

  // If neither uses **, different directory depths cannot match the same file
  const hasDoubleStarA = a.includes("**");
  const hasDoubleStarB = b.includes("**");
  if (!hasDoubleStarA && !hasDoubleStarB && segsA.length !== segsB.length) {
    return false;
  }

  // Check fixed non-wildcard segments at matching positions when neither has **
  if (!hasDoubleStarA && !hasDoubleStarB) {
    for (let i = 0; i < segsA.length; i++) {
      const sa = segsA[i];
      const sb = segsB[i];
      if (!hasWildcard(sa) && !hasWildcard(sb) && sa !== sb) {
        return false;
      }
      if (!hasWildcard(sa) && hasWildcard(sb) && !matchesGlob(sa, sb)) {
        return false;
      }
      if (hasWildcard(sa) && !hasWildcard(sb) && !matchesGlob(sb, sa)) {
        return false;
      }
    }
  }

  return true;
}

export function checkClaimConflicts(
  requestedGlobs: readonly string[],
  activeClaims: readonly ActiveClaim[],
  requesterAgentId: string,
): LockConflict[] {
  const conflicts: LockConflict[] = [];
  for (const claim of activeClaims) {
    if (claim.agentId === requesterAgentId) continue;
    for (const req of requestedGlobs) {
      for (const held of claim.fileGlobs) {
        if (globsMayOverlap(req, held)) {
          conflicts.push({
            requestedGlob: normalizeGlob(req),
            heldGlob: normalizeGlob(held),
            heldByCardId: claim.cardId,
            heldByAgentId: claim.agentId,
            heldByAgentName: claim.agentName,
          });
        }
      }
    }
  }
  return conflicts;
}

export type FileAccessResult =
  | { status: "allowed"; cardId: string }
  | { status: "conflict"; heldByCardId: string; heldByAgentId: string; heldByAgentName: string; heldGlob: string }
  | { status: "out_of_scope" };

export function checkFileAccess(
  filePath: string,
  agentId: string,
  activeClaims: readonly ActiveClaim[],
): FileAccessResult {
  const norm = normalizeGlob(filePath);

  // First check if another agent holds a lock on this path
  for (const claim of activeClaims) {
    if (claim.agentId === agentId) continue;
    for (const held of claim.fileGlobs) {
      if (matchesGlob(norm, held)) {
        return {
          status: "conflict",
          heldByCardId: claim.cardId,
          heldByAgentId: claim.agentId,
          heldByAgentName: claim.agentName,
          heldGlob: normalizeGlob(held),
        };
      }
    }
  }

  // Then verify the requesting agent actually claimed a matching scope
  for (const claim of activeClaims) {
    if (claim.agentId !== agentId) continue;
    for (const held of claim.fileGlobs) {
      if (matchesGlob(norm, held)) {
        return { status: "allowed", cardId: claim.cardId };
      }
    }
  }

  return { status: "out_of_scope" };
}

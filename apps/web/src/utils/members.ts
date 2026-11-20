import { Member } from "@coagent/protocol";

/**
 * Display label per member id. Members who share a name (e.g. the same person
 * rejoining, which creates a new member) get " · 2", " · 3" in join order.
 */
export function buildMemberLabels(members: readonly Member[]): Record<string, string> {
  const seen = new Map<string, number>();
  const labels: Record<string, string> = {};
  for (const m of members) {
    const key = m.name.trim().toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const name = m.name.trim();
    labels[m.id] = n === 1 ? name : `${name} · ${n}`;
  }
  return labels;
}

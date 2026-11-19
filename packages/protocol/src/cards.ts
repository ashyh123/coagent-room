import { z } from "zod";
import { canonicalJson, sha256Hex } from "./hash.js";
import { CardStatusSchema } from "./types.js";
import { normalizeGlob } from "./locks.js";

export const CardSpecSchema = z.object({
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(4000),
  interfaceContract: z.string().max(4000).default(""),
  fileGlobs: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
});
export type CardSpec = z.infer<typeof CardSpecSchema>;

export const CardConfirmationSchema = z.object({
  memberId: z.string().min(1),
  versionHash: z.string().min(1),
  confirmedAt: z.string().datetime(),
});
export type CardConfirmation = z.infer<typeof CardConfirmationSchema>;

export const CardSchema = z.object({
  id: z.string().min(1),
  spec: CardSpecSchema,
  versionHash: z.string().min(1),
  status: CardStatusSchema,
  confirmations: z.array(CardConfirmationSchema),
  claimedByAgentId: z.string().optional(),
  claimedByAgentName: z.string().optional(),
  claimedGlobs: z.array(z.string()).default([]),
  createdBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type Card = z.infer<typeof CardSchema>;

/**
 * Computes a deterministic short version hash for a CardSpec.
 * Any semantic change (goal, interfaceContract, fileGlobs, acceptanceCriteria, title)
 * produces a new hash and invalidates prior confirmations.
 */
export function computeCardVersionHash(spec: CardSpec): string {
  const normalized = {
    title: spec.title.trim(),
    goal: spec.goal.trim(),
    interfaceContract: spec.interfaceContract.trim(),
    fileGlobs: Array.from(new Set(spec.fileGlobs.map(normalizeGlob))).sort(),
    acceptanceCriteria: spec.acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
  };
  const digest = sha256Hex(canonicalJson(normalized));
  return `v_${digest.slice(0, 16)}`;
}

import { z } from "zod";
import { CardSchema } from "./cards.js";
import { ActiveClaimSchema, LockConflictSchema } from "./locks.js";
import { OutputKindSchema } from "./types.js";

/**
 * 6 Standard Room MCP Tools injected into local coding agents (Codex, Claude Code, etc.).
 */

export const RoomGetContextInputSchema = z.object({
  includeDrafts: z.boolean().default(false),
});
export const RoomGetContextOutputSchema = z.object({
  roomId: z.string(),
  roomName: z.string(),
  cards: z.array(CardSchema),
  activeLocks: z.array(ActiveClaimSchema),
});

export const RoomClaimCardInputSchema = z.object({
  cardId: z.string().min(1),
  versionHash: z.string().min(1),
  fileGlobs: z.array(z.string().min(1)).min(1),
});
export const RoomClaimCardOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    cardId: z.string(),
    versionHash: z.string(),
    lockedGlobs: z.array(z.string()),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      "NOT_FOUND",
      "NOT_CONFIRMED",
      "VERSION_MISMATCH",
      "ALREADY_CLAIMED",
      "FILE_LOCK_CONFLICT",
      "AGENT_STOPPED",
    ]),
    message: z.string(),
    conflicts: z.array(LockConflictSchema).optional(),
  }),
]);

export const RoomCheckFilesInputSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});
export const RoomCheckFilesOutputSchema = z.object({
  results: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["allowed", "conflict", "out_of_scope"]),
      cardId: z.string().optional(),
      heldByAgentName: z.string().optional(),
      heldGlob: z.string().optional(),
    }),
  ),
});

export const RoomReportStepInputSchema = z.object({
  cardId: z.string().min(1),
  summary: z.string().min(1).max(120, "Host guardrail: step summary must be <= 120 chars"),
  detail: z.string().max(4000).optional(),
});
export const RoomReportStepOutputSchema = z.object({
  ok: z.boolean(),
  stepId: z.string().optional(),
  message: z.string().optional(),
});

export const RoomAskHumanInputSchema = z.object({
  cardId: z.string().min(1),
  question: z.string().min(1).max(500, "Ask one focused question <= 500 chars"),
});
export const RoomAskHumanOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});

export const RoomSubmitOutputInputSchema = z.object({
  cardId: z.string().min(1),
  cardVersionHash: z.string().min(1),
  kind: OutputKindSchema.default("git_diff"),
  summary: z.string().min(1).max(2000),
  diff: z.string().optional(),
  previewUrl: z.string().url().optional(),
  branch: z.string().optional(),
});
export const RoomSubmitOutputOutputSchema = z.object({
  ok: z.boolean(),
  outputId: z.string().optional(),
  message: z.string().optional(),
});

export const MCP_TOOL_NAMES = [
  "room_get_context",
  "room_claim_card",
  "room_check_files",
  "room_report_step",
  "room_ask_human",
  "room_submit_output",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

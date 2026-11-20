import { z } from "zod";

// Five core UI domain nouns: Member, Room, Topic, Card, Output (plus WorkStep for session nodes)

export const MemberKindSchema = z.enum(["human", "agent"]);
export type MemberKind = z.infer<typeof MemberKindSchema>;

export const AgentStatusSchema = z.enum(["idle", "working", "waiting_human", "stopped"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AvatarKindSchema = z.enum(["initials", "preset", "image"]);
export type AvatarKind = z.infer<typeof AvatarKindSchema>;

export const AvatarSchema = z.object({
  kind: AvatarKindSchema,
  value: z.string().min(1).max(120_000),
});
export type MemberAvatar = z.infer<typeof AvatarSchema>;

export const MemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  kind: MemberKindSchema,
  ownerId: z.string().min(1).optional(), // For BYO agents: which human owns this agent
  driver: z.enum(["codex", "claude-code", "pi", "mcp-only"]).optional(),
  online: z.boolean(),
  status: AgentStatusSchema.optional(),
  activeCardId: z.string().optional(),
  avatar: AvatarSchema.optional(),
});
export type Member = z.infer<typeof MemberSchema>;

export const CardStatusSchema = z.enum([
  "draft",
  "confirmed",
  "claimed",
  "pending_review",
  "accepted",
]);
export type CardStatus = z.infer<typeof CardStatusSchema>;

export const CARD_TRANSITIONS: Record<CardStatus, readonly CardStatus[]> = {
  draft: ["draft", "confirmed"],
  confirmed: ["draft", "claimed"],
  claimed: ["confirmed", "pending_review"],
  pending_review: ["claimed", "confirmed", "accepted"],
  accepted: ["draft"], // Re-opening creates a new draft revision
};

export function canTransitionCard(from: CardStatus, to: CardStatus): boolean {
  return CARD_TRANSITIONS[from].includes(to);
}

export const OutputKindSchema = z.enum(["git_diff", "preview_url", "markdown"]);
export type OutputKind = z.infer<typeof OutputKindSchema>;

export const OutputSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  cardVersionHash: z.string().min(1),
  submittedBy: z.string().min(1),
  kind: OutputKindSchema,
  summary: z.string().min(1).max(2000),
  diff: z.string().optional(),
  previewUrl: z.string().url().optional(),
  branch: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Output = z.infer<typeof OutputSchema>;

export const WorkStepSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  agentId: z.string().min(1),
  summary: z.string().min(1).max(120),
  detail: z.string().max(4000).optional(),
  createdAt: z.string().datetime(),
});
export type WorkStep = z.infer<typeof WorkStepSchema>;

export const RoomSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type RoomSummary = z.infer<typeof RoomSummarySchema>;

export const TopicAnchorKindSchema = z.enum(["message", "card", "output", "selection"]);
export type TopicAnchorKind = z.infer<typeof TopicAnchorKindSchema>;

export const TopicAnchorSchema = z.object({
  kind: TopicAnchorKindSchema,
  targetId: z.string().min(1).optional(),
  quote: z.string().min(1).max(300).optional(),
});
export type TopicAnchor = z.infer<typeof TopicAnchorSchema>;

export const TopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  anchor: TopicAnchorSchema.optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messageCount: z.number().int().nonnegative().default(0),
});
export type Topic = z.infer<typeof TopicSchema>;

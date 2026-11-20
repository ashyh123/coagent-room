import { z } from "zod";
import { CardSpecSchema } from "./cards.js";
import { MemberSchema, OutputKindSchema, TopicAnchorSchema } from "./types.js";

export const PermissionModeSchema = z.enum(["ask", "auto", "plan"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const MessageAttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  size: z.number().int().nonnegative(),
  ref: z.string().max(500).optional(),
});
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const MessageMetaSchema = z.object({
  model: z.string().min(1).max(80).optional(),
  permissionMode: PermissionModeSchema.optional(),
  attachments: z.array(MessageAttachmentSchema).max(10).optional(),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;

export const EventPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("member_joined"),
    member: MemberSchema,
  }),
  z.object({
    type: z.literal("member_left"),
    memberId: z.string().min(1),
  }),
  z.object({
    type: z.literal("message_posted"),
    messageId: z.string().min(1),
    text: z.string().min(1).max(4000),
    mentions: z.array(z.string()).default([]),
    refCardId: z.string().optional(),
    topicId: z.string().min(1).optional(),
    meta: MessageMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("topic_created"),
    topicId: z.string().min(1),
    title: z.string().min(1).max(120),
    anchor: TopicAnchorSchema.optional(),
  }),
  z.object({
    type: z.literal("card_created"),
    cardId: z.string().min(1),
    spec: CardSpecSchema,
    versionHash: z.string().min(1),
  }),
  z.object({
    type: z.literal("card_updated"),
    cardId: z.string().min(1),
    spec: CardSpecSchema,
    versionHash: z.string().min(1),
  }),
  z.object({
    type: z.literal("card_confirmed"),
    cardId: z.string().min(1),
    versionHash: z.string().min(1),
    memberId: z.string().min(1),
  }),
  z.object({
    type: z.literal("card_claimed"),
    cardId: z.string().min(1),
    versionHash: z.string().min(1),
    agentId: z.string().min(1),
    agentName: z.string().min(1),
    fileGlobs: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("work_step_reported"),
    stepId: z.string().min(1),
    cardId: z.string().min(1),
    agentId: z.string().min(1),
    summary: z.string().min(1).max(120),
    detail: z.string().max(4000).optional(),
  }),
  z.object({
    type: z.literal("agent_asked_human"),
    cardId: z.string().min(1),
    agentId: z.string().min(1),
    question: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("output_submitted"),
    outputId: z.string().min(1),
    cardId: z.string().min(1),
    cardVersionHash: z.string().min(1),
    kind: OutputKindSchema,
    summary: z.string().min(1).max(2000),
    diff: z.string().optional(),
    previewUrl: z.string().url().optional(),
    branch: z.string().optional(),
  }),
  z.object({
    type: z.literal("card_reviewed"),
    cardId: z.string().min(1),
    outputId: z.string().min(1),
    decision: z.enum(["accepted", "changes_requested"]),
    comment: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal("agent_stopped"),
    agentId: z.string().min(1),
    stoppedBy: z.string().min(1),
    reason: z.string().max(240).optional(),
  }),
]);
export type EventPayload = z.infer<typeof EventPayloadSchema>;

export const RoomEventSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string().min(1),
  roomId: z.string().min(1),
  actorId: z.string().min(1),
  createdAt: z.string().datetime(),
  payload: EventPayloadSchema,
});
export type RoomEvent = z.infer<typeof RoomEventSchema>;

export const WsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sync_from"),
    afterSeq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("post_message"),
    text: z.string().min(1).max(4000),
    mentions: z.array(z.string()).default([]),
    refCardId: z.string().optional(),
    topicId: z.string().min(1).optional(),
    meta: MessageMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("create_topic"),
    title: z.string().min(1).max(120),
    anchor: TopicAnchorSchema.optional(),
  }),
  z.object({
    type: z.literal("create_card"),
    spec: CardSpecSchema,
  }),
  z.object({
    type: z.literal("update_card"),
    cardId: z.string().min(1),
    spec: CardSpecSchema,
  }),
  z.object({
    type: z.literal("confirm_card"),
    cardId: z.string().min(1),
    versionHash: z.string().min(1),
  }),
  z.object({
    type: z.literal("review_card"),
    cardId: z.string().min(1),
    outputId: z.string().min(1),
    decision: z.enum(["accepted", "changes_requested"]),
    comment: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal("stop_agent"),
    agentId: z.string().min(1),
    reason: z.string().max(240).optional(),
  }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const WsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("events_batch"),
    events: z.array(RoomEventSchema),
  }),
  z.object({
    type: z.literal("event"),
    event: RoomEventSchema,
  }),
  z.object({
    type: z.literal("agent_kill"),
    agentId: z.string().min(1),
    stoppedBy: z.string().min(1),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

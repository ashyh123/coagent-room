import WebSocket from "ws";
import { applyRoomEvent, Card, PermissionMode, RoomState, WsServerMessage } from "@coagent/protocol";
import {
  AgentDriver,
  DriverApprovalRequest,
  DriverTurnCompletedEvent,
  TaskBrief,
} from "./drivers/types.js";
import { RoomHttpClient } from "./room-client.js";

const MAX_CHAT_MESSAGE_LENGTH = 3800;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches `@<agentName>` with word boundaries consistent with the web UI (`AgentSessionPane`).
 */
export function matchesAgentMention(text: string, agentName: string): boolean {
  const trimmed = agentName.trim();
  if (!trimmed) return false;
  const escaped = escapeRegExp(trimmed);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?=$|[^A-Za-z0-9_])`, "i");
  return pattern.test(text);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

type QueuedTask =
  | {
      kind: "directive";
      requesterId: string;
      requesterName: string;
      text: string;
      refCardId?: string;
      topicId?: string;
      permissionMode?: PermissionMode;
    }
  | {
      kind: "card";
      card: Card;
    };

export interface RoomAgentBridgeOptions {
  client: RoomHttpClient;
  driver: AgentDriver;
  agentId: string;
  agentName: string;
  autoClaim?: boolean;
  autoApprove?: boolean;
  onKill?: (signal: { agentId: string; stoppedBy: string; reason?: string }) => void | Promise<void>;
  log?: (message: string) => void;
}

/**
 * Connects a local coding agent driver (`CodexDriver`, etc.) to a coagent-room WebSocket
 * and coordinates directives, approvals, step progress, replies, and Kill Switch shutdowns.
 */
export class RoomAgentBridge {
  private readonly client: RoomHttpClient;
  private readonly driver: AgentDriver;
  private readonly agentId: string;
  private readonly agentName: string;
  private readonly autoClaim: boolean;
  private readonly autoApprove: boolean;
  private readonly onKill?: RoomAgentBridgeOptions["onKill"];
  private readonly log: (message: string) => void;

  private ws: WebSocket | null = null;
  private state: RoomState | null = null;
  private stopped = false;
  private started = false;

  private readonly queue: QueuedTask[] = [];
  private processingQueue = false;
  private activeTask: QueuedTask | null = null;
  private turnWaiter: (() => void) | null = null;
  private pendingApproval: DriverApprovalRequest | null = null;
  private readonly dispatchedCardVersions = new Set<string>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: RoomAgentBridgeOptions) {
    this.client = options.client;
    this.driver = options.driver;
    this.agentId = options.agentId;
    this.agentName = options.agentName;
    this.autoClaim = options.autoClaim ?? false;
    this.autoApprove = options.autoApprove ?? false;
    this.onKill = options.onKill;
    this.log = options.log ?? ((msg) => console.error(`[coagent-bridge] ${msg}`));
  }

  getState(): RoomState | null {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    const snapshot = await this.client.getSnapshot();
    this.state = snapshot.state;

    this.unsubscribers.push(
      this.driver.onStep((step) => {
        void this.handleDriverStep(step);
      }),
    );

    if (this.driver.onTurnCompleted) {
      this.unsubscribers.push(
        this.driver.onTurnCompleted((event) => {
          this.handleTurnCompleted(event);
        }),
      );
    }

    if (this.driver.onApprovalRequest) {
      this.unsubscribers.push(
        this.driver.onApprovalRequest((req) => {
          void this.handleApprovalRequest(req);
        }),
      );
    }

    this.unsubscribers.push(
      this.driver.onExit(() => {
        this.cancelPendingApproval("cancel");
        this.settleTurnWaiter();
      }),
    );

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = this.client.connectWs({
        onOpen: () => {
          this.client.sendWsMessage(ws, {
            type: "sync_from",
            afterSeq: this.state?.lastSeq ?? 0,
          });
          if (!settled) {
            settled = true;
            resolve();
          }
        },
        onMessage: (msg) => {
          this.handleWsMessage(msg);
        },
        onKill: (signal) => {
          void this.handleKillSignal(signal);
        },
        onClose: () => {
          if (!settled) {
            settled = true;
            reject(new Error("WebSocket closed before opening"));
          }
          this.settleTurnWaiter();
        },
      });
      ws.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else if (!this.stopped) {
          this.log(`WebSocket error: ${err.message}`);
        }
      });
      this.ws = ws;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    this.cancelPendingApproval("cancel");
    this.settleTurnWaiter();
    this.cleanupListeners();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    await this.driver.kill("Bridge stopped");
  }

  private cleanupListeners(): void {
    while (this.unsubscribers.length > 0) {
      const unsub = this.unsubscribers.pop();
      try {
        unsub?.();
      } catch {
        // ignore
      }
    }
  }

  private settleTurnWaiter(): void {
    const waiter = this.turnWaiter;
    this.turnWaiter = null;
    waiter?.();
  }

  private cancelPendingApproval(decision: "decline" | "cancel"): void {
    const pending = this.pendingApproval;
    this.pendingApproval = null;
    if (pending) {
      try {
        pending.resolve(decision);
      } catch {
        // ignore
      }
    }
  }

  private getHeldCard(): Card | undefined {
    if (!this.state) return undefined;
    const activeCardId = this.state.members[this.agentId]?.activeCardId;
    if (!activeCardId) return undefined;
    const card = this.state.cards[activeCardId];
    if (!card || card.claimedByAgentId !== this.agentId) return undefined;
    return card;
  }

  private postRoomMessage(
    text: string,
    options?: { mentions?: string[]; refCardId?: string; topicId?: string },
  ): void {
    if (!this.ws || this.stopped) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.client.sendWsMessage(this.ws, {
      type: "post_message",
      text: truncateText(trimmed, MAX_CHAT_MESSAGE_LENGTH),
      mentions: options?.mentions ?? [],
      ...(options?.refCardId ? { refCardId: options.refCardId } : {}),
      ...(options?.topicId ? { topicId: options.topicId } : {}),
    });
  }

  private async handleDriverStep(step: {
    summary: string;
    detail?: string;
    source?: string;
    mcpServer?: string;
    mcpTool?: string;
  }): Promise<void> {
    if (this.stopped) return;
    if (step.mcpServer === "coagent" && step.mcpTool === "room_report_step") return;
    if (step.source === "agentMessage" || step.source === "turn") return;

    const card = this.getHeldCard();
    if (!card) return;

    try {
      await this.client.callMcpTool("room_report_step", {
        cardId: card.id,
        summary: step.summary.slice(0, 120),
        ...(step.detail ? { detail: step.detail.slice(0, 4000) } : {}),
      });
    } catch (err) {
      this.log(`Failed to report step: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private handleTurnCompleted(event: DriverTurnCompletedEvent): void {
    const task = this.activeTask;
    const context =
      task?.kind === "directive"
        ? {
            mentions: task.requesterId ? [task.requesterId] : [],
            refCardId: task.refCardId,
            topicId: task.topicId,
          }
        : task?.kind === "card"
          ? { refCardId: task.card.id }
          : undefined;

    if (!this.stopped) {
      if (event.errorMessage) {
        this.postRoomMessage(`[Codex error] ${event.errorMessage}`, context);
      } else if (event.assistantText?.trim()) {
        this.postRoomMessage(event.assistantText.trim(), context);
      }
    }

    this.settleTurnWaiter();
  }

  private async handleApprovalRequest(req: DriverApprovalRequest): Promise<void> {
    if (this.stopped) {
      req.resolve("cancel");
      return;
    }

    if (this.autoApprove) {
      req.resolve("accept");
      return;
    }

    this.pendingApproval = req;
    const heldCard = this.getHeldCard();
    if (heldCard) {
      const question = truncateText(
        `需要确认操作: ${req.summary}（请点击允许继续或拒绝）`,
        500,
      );
      try {
        await this.client.callMcpTool("room_ask_human", {
          cardId: heldCard.id,
          question,
        });
        return;
      } catch (err) {
        this.log(`room_ask_human failed, falling back to chat message: ${String(err)}`);
      }
    }

    const task = this.activeTask;
    const context =
      task?.kind === "directive"
        ? {
            mentions: task.requesterId ? [task.requesterId] : [],
            refCardId: task.refCardId,
            topicId: task.topicId,
          }
        : task?.kind === "card"
          ? { refCardId: task.card.id }
          : undefined;

    this.postRoomMessage(
      `需要确认操作: ${req.summary}\n请回复 @${this.agentName} 允许继续 或 @${this.agentName} 拒绝`,
      context,
    );
  }

  private handleWsMessage(msg: WsServerMessage): void {
    if (!this.state) return;

    if (msg.type === "events_batch") {
      for (const evt of msg.events) {
        this.state = applyRoomEvent(this.state, evt);
      }
      return;
    }

    if (msg.type !== "event") return;

    const event = msg.event;
    this.state = applyRoomEvent(this.state, event);
    if (this.stopped) return;

    const payload = event.payload;
    if (payload.type === "message_posted") {
      if (event.actorId === this.agentId) return;
      const actor = this.state.members[event.actorId];
      if (!actor || actor.kind !== "human") return;

      const targetsAgent =
        payload.mentions.includes(this.agentId) ||
        matchesAgentMention(payload.text, this.agentName);
      if (!targetsAgent) return;

      if (this.pendingApproval) {
        if (/允许|同意|继续|approve|accept|\byes\b/i.test(payload.text)) {
          const pending = this.pendingApproval;
          this.pendingApproval = null;
          pending.resolve("accept");
          return;
        }
        if (/拒绝|取消|停止|deny|decline|reject|cancel|\bno\b/i.test(payload.text)) {
          const pending = this.pendingApproval;
          this.pendingApproval = null;
          pending.resolve("decline");
          return;
        }
      }

      this.enqueueTask({
        kind: "directive",
        requesterId: event.actorId,
        requesterName: actor.name,
        text: payload.text,
        refCardId: payload.refCardId,
        topicId: payload.topicId,
        permissionMode: payload.meta?.permissionMode,
      });
      return;
    }

    if (this.autoClaim && payload.type === "card_confirmed") {
      const card = this.state.cards[payload.cardId];
      if (card && card.status === "confirmed" && !card.claimedByAgentId) {
        const dedupeKey = `${card.id}:${card.versionHash}`;
        if (this.dispatchedCardVersions.has(dedupeKey)) return;
        this.dispatchedCardVersions.add(dedupeKey);
        this.enqueueTask({ kind: "card", card });
      }
    }
  }

  private enqueueTask(task: QueuedTask): void {
    if (this.stopped) return;
    this.queue.push(task);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      while (!this.stopped && this.queue.length > 0) {
        const task = this.queue.shift()!;
        this.activeTask = task;

        const turnCompletedPromise = this.driver.onTurnCompleted
          ? new Promise<void>((resolve) => {
              this.turnWaiter = resolve;
            })
          : Promise.resolve();

        try {
          if (task.kind === "card") {
            const brief: TaskBrief = {
              cardId: task.card.id,
              versionHash: task.card.versionHash,
              title: task.card.spec.title,
              goal: task.card.spec.goal,
              interfaceContract: task.card.spec.interfaceContract,
              fileGlobs: task.card.spec.fileGlobs,
              acceptanceCriteria: task.card.spec.acceptanceCriteria,
            };
            await this.driver.dispatchTask(brief);
          } else {
            const prompt = this.buildDirectivePrompt(task);
            await this.driver.dispatchDirective(prompt);
          }

          await turnCompletedPromise;
        } catch (err) {
          this.settleTurnWaiter();
          const errMsg = err instanceof Error ? err.message : String(err);
          this.log(`Task dispatch failed: ${errMsg}`);
          if (!this.stopped && task.kind === "directive") {
            this.postRoomMessage(`[Codex error] ${errMsg}`, {
              mentions: task.requesterId ? [task.requesterId] : [],
              refCardId: task.refCardId,
              topicId: task.topicId,
            });
          }
        } finally {
          this.activeTask = null;
          this.settleTurnWaiter();
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private buildDirectivePrompt(task: Extract<QueuedTask, { kind: "directive" }>): string {
    const refCardId = task.refCardId ?? this.state?.members[this.agentId]?.activeCardId;
    const card = refCardId ? this.state?.cards[refCardId] : undefined;
    const topic = task.topicId ? this.state?.topics[task.topicId] : undefined;

    const lines = [
      `Directive from ${task.requesterName} (${task.requesterId}) in coagent-room as agent "${this.agentName}":`,
      topic ? `Topic: ${topic.title}` : "",
      `Message: ${task.text}`,
    ];

    if (card) {
      lines.push(
        `Referenced Card ${card.id} (${card.versionHash}, status=${card.status}):`,
        `Title: ${card.spec.title}`,
        `Goal: ${card.spec.goal}`,
        card.spec.interfaceContract ? `Interface contract: ${card.spec.interfaceContract}` : "",
        `Allowed fileGlobs: ${card.spec.fileGlobs.join(", ")}`,
        card.spec.acceptanceCriteria.length > 0
          ? `Acceptance criteria:\n- ${card.spec.acceptanceCriteria.join("\n- ")}`
          : "",
      );
    }

    if (task.permissionMode === "plan") {
      lines.push(
        "Permission mode guardrail (plan): Read-only analysis only. Do NOT modify files, apply patches, or execute state-changing commands.",
      );
    }

    lines.push(
      "Remember to use the injected coagent room MCP tools (room_get_context, room_claim_card, room_check_files, room_report_step, room_ask_human, room_submit_output) before editing files or submitting changes.",
    );

    return lines.filter(Boolean).join("\n\n");
  }

  private async handleKillSignal(signal: {
    agentId: string;
    stoppedBy: string;
    reason?: string;
  }): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    this.cancelPendingApproval("cancel");
    this.settleTurnWaiter();
    this.cleanupListeners();

    await this.driver.kill(signal.reason);

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    await this.onKill?.(signal);
  }
}

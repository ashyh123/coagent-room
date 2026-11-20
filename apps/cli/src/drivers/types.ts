export type ApprovalPolicy = "on-request" | "untrusted" | "never";

export interface DirectiveOptions {
  approvalPolicy?: ApprovalPolicy;
}

export interface TaskBrief {
  cardId: string;
  versionHash: string;
  title: string;
  goal: string;
  interfaceContract: string;
  fileGlobs: string[];
  acceptanceCriteria: string[];
}

export interface DriverStepEvent {
  summary: string;
  detail?: string;
  source?: string;
  mcpServer?: string;
  mcpTool?: string;
}

export interface DriverTurnCompletedEvent {
  turnId?: string;
  status: "completed" | "failed" | "interrupted" | "unknown";
  assistantText?: string;
  errorMessage?: string;
}

export interface DriverApprovalRequest {
  method: string;
  summary: string;
  detail?: string;
  resolve: (decision: "accept" | "decline" | "cancel") => void;
}

export interface AgentDriver {
  readonly name: string;
  start(): Promise<void>;
  dispatchTask(brief: TaskBrief): Promise<void>;
  dispatchDirective(prompt: string, options?: DirectiveOptions): Promise<void>;
  kill(reason?: string): Promise<void>;
  isRunning(): boolean;
  onStep(fn: (step: DriverStepEvent) => void): () => void;
  onTurnCompleted?(fn: (event: DriverTurnCompletedEvent) => void): () => void;
  onApprovalRequest?(fn: (req: DriverApprovalRequest) => void): () => void;
  onExit(fn: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
}

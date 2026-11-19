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
}

export interface AgentDriver {
  readonly name: string;
  start(): Promise<void>;
  dispatchTask(brief: TaskBrief): Promise<void>;
  kill(reason?: string): Promise<void>;
  isRunning(): boolean;
  onStep(fn: (step: DriverStepEvent) => void): () => void;
  onExit(fn: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
}

export type RunStatus = 'proposed' | 'refused' | 'unavailable' | 'accepted' | 'rejected';

/** The authorization unit. A run is bounded by one of these; an agent is not. */
export interface Envelope {
  envelopeId: string;
  task: string;
  scope: string;
  allowedEvidence: string[];
  allowedCommands: string[];
  budget: { tokens?: number; seconds?: number };
  deadline: Date | null;
  outputSchema: string;
  acceptanceCriteria: string[];
  escalationOwnerName: string;
  parentEnvelope: string | null;
  createdAt: Date;
}

export interface ToolCall {
  callId: string;
  tool: string;
  allowed: boolean;
  refusal: string | null;
  at: Date;
}

export interface Run {
  runId: string;
  envelope: Envelope;
  status: RunStatus;
  /** Pinned. Editing a prompt must not change what a finished run meant. */
  configHash: string;
  inputHash: string;
  promptHash: string;
  agentKind: string;
  output: Record<string, unknown> | null;
  rationale: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  toolCalls: ToolCall[];
  acceptedByName: string | null;
  acceptedAt: Date | null;
}

export interface EvalCase {
  caseId: string;
  name: string;
  input: Record<string, unknown>;
  expectation: string;
  fromFailure: string | null;
  protected: boolean;
  lastResult: { passed: boolean; detail: string; at: Date; promptHash: string } | null;
}

export interface CircuitBreaker {
  frozen: boolean;
  hoursThisWeek: number;
  budgetHours: number;
  /** Plain language, because "0.73 of budget" is not a sentence anyone acts on. */
  statement: string;
}

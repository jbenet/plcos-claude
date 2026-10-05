/**
 * Seam 5 of 5 — Agent.
 *
 * No-op locally unless an API key is present. Two rules from CLAUDE.md are encoded in the
 * types rather than left to discipline: a run is authorized by a work envelope, and no
 * tool sends anything or accepts its own proposed task — every result is a *proposal*.
 */

export interface WorkEnvelope {
  task: string;
  scope: string;
  allowedEvidence: string[];
  allowedCommands: string[];
  budget: { tokens?: number; seconds?: number };
  deadline: Date | null;
  outputSchema: string;
  acceptanceCriteria: string[];
  escalationOwner: string;
}

export type AgentOutcome<T> =
  | { status: 'proposed'; value: T; rationale: string; runId: string }
  | { status: 'refused'; why: string; runId: string }
  | { status: 'unavailable'; why: string; runId: string };

export interface AgentRequest<T> {
  envelope: WorkEnvelope;
  input: Record<string, unknown>;
  /** Validates the model's output before it is ever shown as a proposal. */
  parse: (raw: unknown) => T;
}

export interface Agent {
  readonly kind: 'stub' | 'claude';
  readonly available: boolean;
  /** Never mutates, never sends, never accepts. Returns something a human can accept. */
  propose<T>(req: AgentRequest<T>): Promise<AgentOutcome<T>>;
}

export async function agent(): Promise<Agent> {
  const { anthropicKey } = await import('@/lib/workflows/key');
  const key = anthropicKey();
  if (key) {
    const { claudeAgent } = await import('./claude');
    return claudeAgent(key);
  }
  const { stubAgent } = await import('./stub');
  return stubAgent();
}

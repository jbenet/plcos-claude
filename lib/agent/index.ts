/**
 * Seam 5 of 5 — Agent.
 *
 * No-op locally unless an API key is present. Two rules from CLAUDE.md are encoded in the
 * types rather than left to discipline: a run is authorized by a work envelope, and no
 * tool sends anything or accepts its own proposed task — every result is a *proposal*.
 */
import { config } from '@/config/deployment';

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
  if (config.agentRuntime.apiKey) {
    const { claudeAgent } = await import('./claude');
    return claudeAgent(config.agentRuntime.apiKey);
  }
  const { stubAgent } = await import('./stub');
  return stubAgent();
}

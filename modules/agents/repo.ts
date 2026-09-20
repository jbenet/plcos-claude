import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import type { CircuitBreaker, Envelope, EvalCase, Run, RunStatus, ToolCall } from './types';

export const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

type EnvelopeRow = {
  envelope_id: string; task: string; scope: string; allowed_evidence: string[];
  allowed_commands: string[]; budget: { tokens?: number; seconds?: number };
  deadline: Date | string | null; output_schema: string; acceptance_criteria: string[];
  escalation_owner_name: string; parent_envelope: string | null; created_at: Date | string;
};

const ENVELOPE_SELECT = `
  select e.envelope_id, e.task, e.scope, e.allowed_evidence, e.allowed_commands, e.budget,
         e.deadline, e.output_schema, e.acceptance_criteria, u.name as escalation_owner_name,
         e.parent_envelope, e.created_at
    from agents.envelope e join platform.app_user u on u.id = e.escalation_owner`;

const toEnvelope = (r: EnvelopeRow): Envelope => ({
  envelopeId: r.envelope_id, task: r.task, scope: r.scope,
  allowedEvidence: r.allowed_evidence, allowedCommands: r.allowed_commands,
  budget: r.budget, deadline: r.deadline ? new Date(r.deadline) : null,
  outputSchema: r.output_schema, acceptanceCriteria: r.acceptance_criteria,
  escalationOwnerName: r.escalation_owner_name, parentEnvelope: r.parent_envelope,
  createdAt: new Date(r.created_at),
});

export async function listEnvelopes(): Promise<Envelope[]> {
  const db = await getDb();
  return (await db.query<EnvelopeRow>(`${ENVELOPE_SELECT} order by e.created_at desc`)).map(toEnvelope);
}

export async function getEnvelope(id: string, q?: Queryable): Promise<Envelope | null> {
  const db = q ?? (await getDb());
  const row = await db.one<EnvelopeRow>(`${ENVELOPE_SELECT} where e.envelope_id = $1`, [id]);
  return row ? toEnvelope(row) : null;
}

export async function listRuns(limit = 20): Promise<Run[]> {
  const db = await getDb();
  const rows = await db.query<{
    run_id: string; envelope_id: string; status: RunStatus; config_hash: string;
    input_hash: string; prompt_hash: string; agent_kind: string;
    output: Record<string, unknown> | null; rationale: string | null;
    started_at: Date | string; finished_at: Date | string | null;
    accepted_by_name: string | null; accepted_at: Date | string | null;
  }>(
    `select r.run_id, r.envelope_id, r.status, r.config_hash, r.input_hash, r.prompt_hash,
            r.agent_kind, r.output, r.rationale, r.started_at, r.finished_at,
            u.name as accepted_by_name, a.accepted_at
       from agents.run r
       left join agents.acceptance a on a.run_id = r.run_id
       left join platform.app_user u on u.id = a.accepted_by
      order by r.started_at desc limit $1`,
    [limit],
  );
  if (rows.length === 0) return [];

  const calls = await db.query<{ run_id: string; call_id: string; tool: string; allowed: boolean; refusal: string | null; at: Date | string }>(
    'select run_id, call_id, tool, allowed, refusal, at from agents.tool_call where run_id = any($1::uuid[]) order by at',
    [rows.map((r) => r.run_id)],
  );
  const envelopes = new Map<string, Envelope>();
  for (const id of new Set(rows.map((r) => r.envelope_id))) {
    const env = await getEnvelope(id);
    if (env) envelopes.set(id, env);
  }

  return rows.map((r) => ({
    runId: r.run_id,
    envelope: envelopes.get(r.envelope_id)!,
    status: r.status, configHash: r.config_hash, inputHash: r.input_hash,
    promptHash: r.prompt_hash, agentKind: r.agent_kind, output: r.output,
    rationale: r.rationale, startedAt: new Date(r.started_at),
    finishedAt: r.finished_at ? new Date(r.finished_at) : null,
    toolCalls: calls
      .filter((c) => c.run_id === r.run_id)
      .map((c): ToolCall => ({
        callId: c.call_id, tool: c.tool, allowed: c.allowed, refusal: c.refusal, at: new Date(c.at),
      })),
    acceptedByName: r.accepted_by_name,
    acceptedAt: r.accepted_at ? new Date(r.accepted_at) : null,
  }));
}

export async function listEvalCases(): Promise<EvalCase[]> {
  const db = await getDb();
  const rows = await db.query<{
    case_id: string; name: string; input: Record<string, unknown>; expectation: string;
    from_failure: string | null; protected: boolean;
    passed: boolean | null; detail: string | null; at: Date | string | null; prompt_hash: string | null;
  }>(
    `select c.case_id, c.name, c.input, c.expectation, c.from_failure, c.protected,
            r.passed, r.detail, r.at, r.prompt_hash
       from agents.eval_case c
       left join lateral (
         select passed, detail, at, prompt_hash from agents.eval_result
          where case_id = c.case_id order by at desc limit 1
       ) r on true
      order by c.added_at`,
  );
  return rows.map((r) => ({
    caseId: r.case_id, name: r.name, input: r.input, expectation: r.expectation,
    fromFailure: r.from_failure, protected: r.protected,
    lastResult: r.passed === null ? null : {
      passed: r.passed, detail: r.detail ?? '', at: new Date(r.at!), promptHash: r.prompt_hash ?? '',
    },
  }));
}

/**
 * The circuit breaker. If correcting agent output costs more than the weekly budget,
 * new autonomy is frozen — measured from recorded corrections rather than a feeling.
 */
export async function circuitBreaker(): Promise<CircuitBreaker> {
  const db = await getDb();
  const row = await db.one<{ minutes: string }>(
    `select coalesce(sum(minutes), 0)::text as minutes from agents.correction
      where at > now() - interval '7 days'`,
  );
  const hours = Number(row?.minutes ?? 0) / 60;
  const budget = config.agents.correctionBudgetHoursPerWeek;
  const frozen = hours > budget;
  return {
    frozen,
    hoursThisWeek: hours,
    budgetHours: budget,
    statement: frozen
      ? `Correcting agent output has cost ${hours.toFixed(1)} hours this week against a budget of ` +
        `${budget}. New agent autonomy is frozen until that comes down. Existing runs still work; ` +
        'nothing new gets a wider envelope.'
      : `Correcting agent output has cost ${hours.toFixed(1)} hours this week against a budget of ` +
        `${budget}. Autonomy is not frozen. The budget is a guess and is labelled as one.`,
  };
}

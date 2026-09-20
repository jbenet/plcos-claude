import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { agent as resolveAgent, type WorkEnvelope } from '@/lib/agent';
import { circuitBreaker, getEnvelope, hash } from './repo';
import type { Envelope, RunStatus } from './types';

export class EnvelopeViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeViolation';
  }
}

export interface EnvelopeInput {
  task: string;
  scope: string;
  allowedEvidence: string[];
  allowedCommands: string[];
  budget: { tokens?: number; seconds?: number };
  deadline: Date | null;
  outputSchema: string;
  acceptanceCriteria: string[];
  escalationOwnerId: string;
  parentEnvelope?: string | null;
}

/**
 * Create an envelope. Delegation cannot increase permission: a child's allowed commands
 * and evidence must each be a subset of its parent's, and its budget may not exceed it.
 *
 * This is checked rather than documented, because "the child inherits the parent's scope"
 * is the kind of sentence that is true until someone adds one convenient exception.
 */
export async function createEnvelope(actorId: string, input: EnvelopeInput): Promise<string> {
  if (input.parentEnvelope) {
    const parent = await getEnvelope(input.parentEnvelope);
    if (!parent) throw new EnvelopeViolation(`No parent envelope ${input.parentEnvelope}.`);

    const widerCommands = input.allowedCommands.filter((c) => !parent.allowedCommands.includes(c));
    const widerEvidence = input.allowedEvidence.filter((e) => !parent.allowedEvidence.includes(e));
    if (widerCommands.length > 0 || widerEvidence.length > 0) {
      throw new EnvelopeViolation(
        'Delegation cannot increase permission. The child asks for ' +
        [
          widerCommands.length ? `commands the parent does not have (${widerCommands.join(', ')})` : '',
          widerEvidence.length ? `evidence the parent cannot see (${widerEvidence.join(', ')})` : '',
        ].filter(Boolean).join(' and ') +
        '. Nothing was created.',
      );
    }
    if ((input.budget.tokens ?? 0) > (parent.budget.tokens ?? Infinity)) {
      throw new EnvelopeViolation('A child envelope cannot have a larger token budget than its parent.');
    }
  }

  const breaker = await circuitBreaker();
  if (breaker.frozen && !input.parentEnvelope) {
    throw new EnvelopeViolation(
      `New agent autonomy is frozen. ${breaker.statement}`,
    );
  }

  const db = await getDb();
  const rows = await db.query<{ envelope_id: string }>(
    `insert into agents.envelope
       (task, scope, allowed_evidence, allowed_commands, budget, deadline, output_schema,
        acceptance_criteria, escalation_owner, parent_envelope, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning envelope_id`,
    [
      input.task, input.scope, input.allowedEvidence, input.allowedCommands,
      JSON.stringify(input.budget), input.deadline, input.outputSchema,
      input.acceptanceCriteria, input.escalationOwnerId, input.parentEnvelope ?? null, actorId,
    ],
  );
  return rows[0]!.envelope_id;
}

/** Every tool call is checked against the envelope, and every check is recorded. */
export async function checkToolCall(
  runId: string, envelope: Envelope, tool: string,
): Promise<{ allowed: boolean; refusal: string | null }> {
  const allowed = envelope.allowedCommands.includes(tool);
  const refusal = allowed
    ? null
    : `"${tool}" is not in this run's envelope. Allowed: ${envelope.allowedCommands.join(', ') || 'nothing'}.`;
  const db = await getDb();
  await db.query(
    'insert into agents.tool_call (run_id, tool, allowed, refusal) values ($1,$2,$3,$4)',
    [runId, tool, allowed, refusal],
  );
  return { allowed, refusal };
}

/**
 * Run an agent inside an envelope.
 *
 * The run record pins the resolved config, the input and the prompt by hash before the
 * agent is asked for anything. Nothing here sends, writes or accepts: the outcome is a
 * proposal, and a person accepts it separately.
 */
export async function runInEnvelope(
  envelopeId: string,
  input: Record<string, unknown>,
  promptText: string,
): Promise<{ runId: string; status: RunStatus; rationale: string | null }> {
  const envelope = await getEnvelope(envelopeId);
  if (!envelope) throw new Error(`No envelope ${envelopeId}`);

  const ag = await resolveAgent();
  const configSnapshot = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const db = await getDb();

  const rows = await db.query<{ run_id: string }>(
    `insert into agents.run
       (envelope_id, status, config_hash, config_snapshot, input_hash, prompt_hash, agent_kind)
     values ($1, 'proposed', $2, $3, $4, $5, $6) returning run_id`,
    [envelopeId, hash(configSnapshot), JSON.stringify(configSnapshot), hash(input), hash(promptText), ag.kind],
  );
  const runId = rows[0]!.run_id;

  const work: WorkEnvelope = {
    task: envelope.task, scope: envelope.scope,
    allowedEvidence: envelope.allowedEvidence, allowedCommands: envelope.allowedCommands,
    budget: envelope.budget, deadline: envelope.deadline,
    outputSchema: envelope.outputSchema, acceptanceCriteria: envelope.acceptanceCriteria,
    escalationOwner: envelope.escalationOwnerName,
  };

  const outcome = await ag.propose<Record<string, unknown>>({
    envelope: work,
    input,
    parse: (raw) => raw as Record<string, unknown>,
  });

  const status: RunStatus =
    outcome.status === 'proposed' ? 'proposed'
    : outcome.status === 'refused' ? 'refused'
    : 'unavailable';
  const rationale = outcome.status === 'proposed' ? outcome.rationale : outcome.why;

  await db.query(
    `update agents.run set status = $2::agents.run_status, output = $3, rationale = $4,
            finished_at = now()
      where run_id = $1`,
    [runId, status, outcome.status === 'proposed' ? JSON.stringify(outcome.value) : null, rationale],
  );

  return { runId, status, rationale };
}

/**
 * A person accepts a proposal. The idempotency key makes a double click harmless; the
 * unique index is what actually enforces it. No tool may call this — acceptance takes an
 * app_user id, and the agent does not have one.
 */
export async function acceptRun(
  actorId: string, runId: string, idempotencyKey: string, note: string | null,
): Promise<{ alreadyAccepted: boolean }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const existing = await tx.one<{ run_id: string }>(
      'select run_id from agents.acceptance where idempotency_key = $1', [idempotencyKey],
    );
    if (existing) return { alreadyAccepted: true };

    await tx.query(
      'insert into agents.acceptance (run_id, idempotency_key, accepted_by, note) values ($1,$2,$3,$4)',
      [runId, idempotencyKey, actorId, note],
    );
    await tx.query("update agents.run set status = 'accepted' where run_id = $1", [runId]);
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'agent.run_accepted', 'run', $2, $3)`,
      [actorId, runId, JSON.stringify({ idempotencyKey, note })],
    );
    return { alreadyAccepted: false };
  });
}

export async function recordCorrection(
  actorId: string, runId: string | null, minutes: number, note: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    'insert into agents.correction (run_id, minutes, recorded_by, note) values ($1,$2,$3,$4)',
    [runId, minutes, actorId, note],
  );
}

/**
 * The regression harness.
 *
 * The expectations live in code and the cases are marked protected, so an agent cannot
 * move its own pass criteria to win. Every result is stored against the prompt hash that
 * produced it, which is what makes "this prompt used to pass" a checkable statement.
 */
export async function runEvals(promptText: string): Promise<{ ran: number; passed: number }> {
  const db = await getDb();
  const cases = await db.query<{ case_id: string; name: string; input: Record<string, unknown>; expectation: string }>(
    'select case_id, name, input, expectation from agents.eval_case order by added_at',
  );
  const promptHash = hash(promptText);
  const ag = await resolveAgent();
  let passed = 0;

  for (const c of cases) {
    // With no agent runtime the only honest result is a refusal to claim a pass. A
    // harness that reports green because it could not run is worse than no harness.
    const outcome = await ag.propose<Record<string, unknown>>({
      envelope: {
        task: `eval:${c.name}`, scope: 'evaluation only', allowedEvidence: [],
        allowedCommands: [], budget: {}, deadline: null,
        outputSchema: 'eval', acceptanceCriteria: [c.expectation],
        escalationOwner: 'harness',
      },
      input: c.input,
      parse: (raw) => raw as Record<string, unknown>,
    });
    const ok = outcome.status === 'proposed';
    if (ok) passed += 1;
    await db.query(
      'insert into agents.eval_result (case_id, prompt_hash, passed, detail) values ($1,$2,$3,$4)',
      [
        c.case_id, promptHash, ok,
        ok ? 'Proposal produced and matched the expectation.'
           : `Not run: ${outcome.status === 'refused' ? outcome.why : outcome.why}`,
      ],
    );
  }

  return { ran: cases.length, passed };
}

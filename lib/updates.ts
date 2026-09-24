import { getDb } from '@/lib/db';
import { reconcilePursuit } from '@/lib/reconcile';
import { logTouchpoint, type Channel, type Direction, type Read } from '@/modules/meetings';
import {
  READER, StatusRefused, getPursuit, insertUpdate, readUpdate, recordApplied, setNextStep, setStatus,
  type PassedBy, type PursuitStatus, type UpdateApplied, type UpdateSuggestion,
} from '@/modules/strategy';

/**
 * Save an update on an LP (N61, issue 0004), with what the person chose to do about it, in one
 * transaction: the update itself; a status, through setStatus; the touchpoint it describes,
 * through logTouchpoint; a next step. What the reader suggests is worked out again here, from
 * the words saved rather than from the browser, and kept beside what was applied.
 *
 * Afterwards, if a touchpoint was logged, reconciliation reads this LP again (docs/18): a
 * meeting logged is a record, and the climb it supports is proposed as a STAGE ticket for a
 * person to approve. An update never records a rung or an amount itself.
 */
export interface UpdateInput {
  pursuitId: string;
  body: string;
  /** One per form, so a double click saves one update. */
  idempotencyKey: string;
  status?: { to: PursuitStatus; passedBy?: PassedBy | null; reason?: string | null } | null;
  touch?: { channel: Channel; direction: Direction | null; on: Date; read: Read | null } | null;
  nextStep?: { step: string; on: Date | null } | null;
}

export interface UpdateResult {
  updateId: string;
  /** False when this form was saved already: nothing was written the second time. */
  created: boolean;
  applied: UpdateApplied;
  /** Reconciliation opened a ladder proposal from the touchpoint this update logged. */
  proposed: boolean;
}

/** A status's reason is a line, not the whole update: its first sentence or two, cut short. */
function line(body: string): string {
  const first = body.split(/\n/)[0]!.trim();
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

function taken(s: UpdateSuggestion, input: UpdateInput): boolean {
  switch (s.kind) {
    case 'status': return input.status?.to === s.to;
    case 'touch': return Boolean(input.touch);
    case 'read': return input.touch?.read === s.read;
    case 'next': return Boolean(input.nextStep);
    case 'amount': return false;
  }
}

export async function addUpdate(actorId: string, input: UpdateInput): Promise<UpdateResult> {
  const body = input.body.trim();
  if (!body) throw new StatusRefused('An update needs words: what happened, or what changed.');
  if (!input.idempotencyKey.trim()) throw new StatusRefused('This form has no key; reload the page and save again.');
  const before = await getPursuit(input.pursuitId);
  if (!before) throw new Error(`No pursuit ${input.pursuitId}`);
  const suggestions = readUpdate(body, { status: before.status, today: new Date().toISOString().slice(0, 10) });

  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    const { updateId, created } = await insertUpdate(tx, {
      pursuitId: input.pursuitId, body, createdBy: actorId, idempotencyKey: input.idempotencyKey,
      suggested: { reader: `${READER.name}-${READER.version}`, suggestions },
    });
    if (!created) return { updateId, created, applied: {} as UpdateApplied };
    const p = (await getPursuit(input.pursuitId, tx))!;
    const applied: UpdateApplied = {};
    const next = input.nextStep?.step.trim() ? { step: input.nextStep.step.trim(), on: input.nextStep.on } : null;

    const to = input.status?.to;
    const changes = to && (to !== p.status || (to === 'passed' && (input.status!.passedBy !== p.passedBy || (input.status!.reason ?? null) !== p.statusReason)));
    if (to && changes) {
      const passed = to === 'passed';
      await setStatus(actorId, p.pursuitId, {
        status: to,
        passedBy: passed ? input.status!.passedBy ?? null : null,
        reason: passed ? input.status!.reason ?? 'other' : line(body),
        // The next step stays unless the update names a new one.
        nextStep: next ? next.step : p.nextStep,
        nextStepOn: next ? next.on : p.nextStepOn,
      }, { q: tx, updateId });
      applied.status = { from: p.status, to };
      if (next) applied.nextStep = { step: next.step, on: next.on?.toISOString().slice(0, 10) ?? null };
    } else if (next) {
      await setNextStep(actorId, p.pursuitId, { nextStep: next.step, nextStepOn: next.on }, { q: tx, updateId });
      applied.nextStep = { step: next.step, on: next.on?.toISOString().slice(0, 10) ?? null };
    }

    if (input.touch) {
      const t = input.touch;
      applied.touchpointId = await logTouchpoint(actorId, {
        entityId: p.entityId, vehicleId: p.vehicleId, pursuitId: p.pursuitId, channel: t.channel,
        on: t.on, direction: t.direction, summary: body, read: t.read,
      }, { q: tx, updateId });
      const endOfToday = new Date();
      endOfToday.setUTCHours(23, 59, 59, 999);
      applied.touch = { channel: t.channel, on: t.on.toISOString().slice(0, 10), ahead: t.on.getTime() > endOfToday.getTime(), read: t.read };
    }

    const declined = suggestions.filter((s) => s.kind !== 'amount' && !taken(s, input)).map((s) => s.kind);
    if (declined.length) applied.declined = declined;
    await recordApplied(tx, updateId, applied);
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'pursuit.update_added', 'pursuit', $2, $3)`,
      [actorId, p.pursuitId, JSON.stringify({ entity: p.entityName, vehicle: p.vehicleName, updateId, applied })],
    );
    return { updateId, created, applied };
  });

  // A touchpoint that happened is a record the ladder may be behind: propose, never record.
  let proposed = false;
  if (done.created && done.applied.touchpointId && !done.applied.touch?.ahead) {
    proposed = (await reconcilePursuit(input.pursuitId)).proposed > 0;
  }
  return { ...done, proposed };
}

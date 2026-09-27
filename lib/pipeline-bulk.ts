import { getDb, type Queryable } from '@/lib/db';
import {
  getPursuit, insertUpdate, recordApplied, setStatus, REASONS, STATUS_LABEL,
  type PassedBy, type PursuitStatus, type UpdateApplied,
} from '@/modules/strategy';
import { logTouchpoint, type Channel, type Direction } from '@/modules/meetings';
import { reconcilePursuit } from '@/lib/reconcile';

/** Where a status change was made, named in the rule it records when no note is given (issue 0104). */
export type BulkPlace = 'selection' | 'fit' | 'pipeline';
const PLACE_LABEL: Record<BulkPlace, string> = { selection: 'Selection', fit: 'Funder–vehicle fit', pipeline: 'Pipeline' };

export interface BulkInput {
  key: string;
  rows: Array<{ id: string; vehicleId: string; status: PursuitStatus }>;
  action: 'status' | 'touch' | 'context' | 'research' | 'connections' | 'strategy';
  /** Required for every action but a status change, where it is an optional note (issue 0104). */
  body: string;
  status?: PursuitStatus;
  passedBy?: PassedBy;
  passReason?: string;
  channel?: Channel;
  direction?: Direction | null;
  on?: string;
  place?: BulkPlace;
}

const keyFor = (actorId: string, key: string, pursuitId: string) => `table:${actorId}:${key}:${pursuitId}`;
const undoKeyFor = (actorId: string, of: string, pursuitId: string) => `table:${actorId}:undo:${of}:${pursuitId}`;

async function actorName(q: Queryable, actorId: string) {
  return (await q.one<{ name: string }>('select name from platform.app_user where id = $1', [actorId]))?.name ?? 'an unknown user';
}

/**
 * One transaction and stable per-pursuit keys. No external execution or acceptance.
 *
 * A status change needs no note (issue 0104, Juan: "changing status shouldn't require a note"). The
 * audit row still says who, when, from and to; with no note it records the rule "set on Selection
 * by <user>" as the reason. Passed is the exception: who ended it and why are kept (docs/17), so it
 * refuses without both.
 */
export async function applyBulk(actorId: string, input: BulkInput, vehicleId: string | null) {
  if (!input.key || input.key.length > 100) throw new Error('Reload the form to obtain a request key.');
  if (!['status','touch','context','research','connections','strategy'].includes(input.action)) throw new Error('Unknown action.');
  const note = (input.body ?? '').trim();
  if (input.body && input.body.length > 4000) throw new Error('Keep the note to 4,000 characters.');
  if (input.action !== 'status' && !note) throw new Error('Add a reason or description of up to 4,000 characters.');
  if (input.action === 'status') {
    if (!input.status) throw new Error('Choose a status.');
    if (input.status === 'passed') {
      if (!input.passedBy) throw new Error('Passed needs who ended it: they declined, or we stopped.');
      if (!input.passReason || !(REASONS as readonly string[]).includes(input.passReason)) throw new Error('Passed needs a reason: choose why it ended.');
    }
  }
  const rows = [...new Map(input.rows.map(r => [r.id, r])).values()];
  if (!rows.length || rows.length > 5000) throw new Error('Select between 1 and 5,000 pursuits.');
  const db = await getDb();
  const touched: string[] = [];
  const receipt = await db.transaction(async tx => {
    let written = 0;
    const rule = input.action === 'status' && !note ? `set on ${PLACE_LABEL[input.place ?? 'pipeline'] ?? 'Pipeline'} by ${await actorName(tx, actorId)}` : null;
    for (const row of rows) {
      const p = await getPursuit(row.id, tx);
      if (!p || p.vehicleId !== row.vehicleId || (vehicleId && p.vehicleId !== vehicleId)) throw new Error('A selected pursuit is outside this vehicle. Reload the table.');
      const workflow = ['research','connections','strategy'].includes(input.action);
      const body = workflow ? `Workflow request: ${input.action}. Awaiting review; not scheduled or running.\n${note}`
        : rule ? `Status set to ${STATUS_LABEL[input.status!]}, ${rule}.` : note;
      const update = await insertUpdate(tx, { pursuitId: p.pursuitId, body, createdBy: actorId,
        idempotencyKey: keyFor(actorId, input.key, p.pursuitId), suggested: {} });
      if (!update.created) continue;
      if (input.action === 'status' && p.status !== row.status) throw new Error(`${p.entityName} is ${STATUS_LABEL[p.status]} now, not ${STATUS_LABEL[row.status]} as this page showed. Reload and review before retrying. Nothing in this batch was changed.`);
      const applied: UpdateApplied = {};
      if (input.action === 'status') {
        await setStatus(actorId, p.pursuitId, { status: input.status!,
          passedBy: input.status === 'passed' ? input.passedBy : null,
          reason: input.status === 'passed' ? input.passReason : note || rule, nextStep: p.nextStep, nextStepOn: p.nextStepOn }, { q: tx, updateId: update.updateId });
        applied.status = { from: p.status, to: input.status!, was: { passedBy: p.passedBy, reason: p.statusReason } };
      } else if (input.action === 'touch') {
        if (!input.on || !/^\d{4}-\d\d-\d\d$/.test(input.on)) throw new Error('Choose the date of the touchpoint.');
        const on = new Date(`${input.on}T12:00:00Z`);
        if (!Number.isFinite(on.getTime()) || on.toISOString().slice(0,10) !== input.on) throw new Error('Invalid touchpoint date.');
        applied.touchpointId = await logTouchpoint(actorId, { entityId: p.entityId, vehicleId: p.vehicleId, pursuitId: p.pursuitId,
          channel: input.channel!, direction: input.direction ?? null, on, summary: note, read: null }, { q: tx, updateId: update.updateId });
        touched.push(p.pursuitId);
      } else {
        await tx.query(`insert into research.note (entity_id, author_id, kind, body, data) values ($1,$2,$3,$4,$5)`,
          [p.entityId, actorId, workflow ? 'workflow_request' : 'context', body,
            JSON.stringify({ pursuitId: p.pursuitId, vehicleId: p.vehicleId, updateId: update.updateId,
              ...(workflow ? { workflow: input.action, status: 'requested', execution: 'not_started' } : {}) })]);
      }
      await recordApplied(tx, update.updateId, applied);
      await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
        values ($1,'pursuit.bulk_action','pursuit',$2,$3)`, [actorId,p.pursuitId,JSON.stringify({ action: input.action, updateId: update.updateId,
          ...(rule ? { rule } : { reason: note }), ...(input.place ? { place: input.place } : {}), applied })]);
      written++;
    }
    return { written, alreadySaved: rows.length - written };
  });
  let proposals = 0, reconciliationPending = 0;
  // A recorded touchpoint may support a draft STAGE ticket. Never accepts a rung.
  for (const id of touched) {
    try { proposals += (await reconcilePursuit(id)).proposed; } catch { reconciliationPending++; }
  }
  return { ...receipt, proposals, reconciliationPending };
}

/**
 * Undo a status change made by applyBulk (issue 0104): each pursuit it moved goes back to the
 * status it had, with who ended it and why when that was Passed, through the same audited path —
 * a new update, setStatus, and an audit row naming the request it reverses. The move's own history
 * stays; the log shows both. All or nothing: if any of them has moved again since, nothing is
 * undone. Keyed on the original request, so a second tap on Undo changes nothing.
 */
export async function undoBulk(actorId: string, input: { of: string; place?: BulkPlace }, vehicleId: string | null) {
  if (!input.of || input.of.length > 100 || input.of.startsWith('undo:')) throw new Error('Nothing to undo: that change is not known.');
  const db = await getDb();
  return db.transaction(async tx => {
    const prefix = `table:${actorId}:${input.of}:`;
    const moves = await tx.query<{ pursuit_id: string; applied: UpdateApplied }>(
      `select pursuit_id::text, applied from strategy.pursuit_update
        where created_by = $1 and left(idempotency_key, length($2)) = $2 and applied ? 'status'
        order by created_at`, [actorId, prefix]);
    if (!moves.length) throw new Error('Nothing to undo: no status change of yours was found for that request.');
    const rule = `undone on ${PLACE_LABEL[input.place ?? 'pipeline'] ?? 'Pipeline'} by ${await actorName(tx, actorId)}`;
    let written = 0;
    for (const move of moves) {
      const was = move.applied.status!;
      const p = await getPursuit(move.pursuit_id, tx);
      if (!p || (vehicleId && p.vehicleId !== vehicleId)) throw new Error('A pursuit in that change is outside this vehicle. Nothing was undone.');
      const update = await insertUpdate(tx, { pursuitId: p.pursuitId, body: `Status back to ${STATUS_LABEL[was.from]}, ${rule}.`,
        createdBy: actorId, idempotencyKey: undoKeyFor(actorId, input.of, p.pursuitId), suggested: {} });
      if (!update.created) continue;
      if (p.status !== was.to) throw new Error(`${p.entityName} is ${STATUS_LABEL[p.status]} now, so the move to ${STATUS_LABEL[was.to]} cannot be undone here. Nothing was undone.`);
      const passed = was.from === 'passed';
      const reason = was.was?.reason ?? null;
      await setStatus(actorId, p.pursuitId, { status: was.from,
        passedBy: passed ? was.was?.passedBy ?? null : null,
        reason: passed ? (reason && (REASONS as readonly string[]).includes(reason) ? reason : null) : reason ?? rule,
        nextStep: p.nextStep, nextStepOn: p.nextStepOn }, { q: tx, updateId: update.updateId });
      const applied: UpdateApplied = { status: { from: p.status, to: was.from, was: { passedBy: p.passedBy, reason: p.statusReason } }, undoes: input.of };
      await recordApplied(tx, update.updateId, applied);
      await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
        values ($1,'pursuit.bulk_action','pursuit',$2,$3)`, [actorId, p.pursuitId, JSON.stringify({ action: 'undo', updateId: update.updateId,
          undoes: input.of, rule, ...(input.place ? { place: input.place } : {}), applied })]);
      written++;
    }
    return { written, alreadySaved: moves.length - written };
  });
}

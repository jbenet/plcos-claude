import { getDb } from '@/lib/db';
import { getPursuit, insertUpdate, recordApplied, setStatus, type PassedBy, type PursuitStatus, type UpdateApplied } from '@/modules/strategy';
import { logTouchpoint, type Channel, type Direction } from '@/modules/meetings';
import { reconcilePursuit } from '@/lib/reconcile';

export interface BulkInput {
  key: string;
  rows: Array<{ id: string; vehicleId: string; status: PursuitStatus }>;
  action: 'status' | 'touch' | 'context' | 'research' | 'connections' | 'strategy';
  body: string;
  status?: PursuitStatus;
  passedBy?: PassedBy;
  passReason?: string;
  channel?: Channel;
  direction?: Direction | null;
  on?: string;
}
/** One transaction and stable per-pursuit keys. No external execution or acceptance. */
export async function applyBulk(actorId: string, input: BulkInput, vehicleId: string | null) {
  if (!input.key || input.key.length > 100) throw new Error('Reload the form to obtain a request key.');
  if (!input.body.trim() || input.body.length > 4000) throw new Error('Add a reason or description of up to 4,000 characters.');
  if (!['status','touch','context','research','connections','strategy'].includes(input.action)) throw new Error('Unknown action.');
  const rows = [...new Map(input.rows.map(r => [r.id, r])).values()];
  if (!rows.length || rows.length > 5000) throw new Error('Select between 1 and 5,000 pursuits.');
  const db = await getDb();
  const touched: string[] = [];
  const receipt = await db.transaction(async tx => {
    let written = 0;
    for (const row of rows) {
      const p = await getPursuit(row.id, tx);
      if (!p || p.vehicleId !== row.vehicleId || (vehicleId && p.vehicleId !== vehicleId)) throw new Error('A selected pursuit is outside this vehicle. Reload the table.');
      const workflow = ['research','connections','strategy'].includes(input.action);
      const body = workflow ? `Workflow request: ${input.action}. Awaiting review; not scheduled or running.\n${input.body.trim()}` : input.body.trim();
      const update = await insertUpdate(tx, { pursuitId: p.pursuitId, body, createdBy: actorId,
        idempotencyKey: `table:${actorId}:${input.key}:${p.pursuitId}`, suggested: {} });
      if (!update.created) continue;
      if (input.action === 'status' && p.status !== row.status) throw new Error('A selected status changed since this table loaded. Reload and review before retrying. Nothing in this batch was changed.');
      const applied: UpdateApplied = {};
      if (input.action === 'status') {
        if (!input.status) throw new Error('Choose a status.');
        await setStatus(actorId, p.pursuitId, { status: input.status,
          passedBy: input.status === 'passed' ? input.passedBy : null,
          reason: input.status === 'passed' ? input.passReason : input.body.trim(), nextStep: p.nextStep, nextStepOn: p.nextStepOn }, { q: tx, updateId: update.updateId });
        applied.status = { from: p.status, to: input.status };
      } else if (input.action === 'touch') {
        if (!input.on || !/^\d{4}-\d\d-\d\d$/.test(input.on)) throw new Error('Choose the date of the touchpoint.');
        const on = new Date(`${input.on}T12:00:00Z`);
        if (!Number.isFinite(on.getTime()) || on.toISOString().slice(0,10) !== input.on) throw new Error('Invalid touchpoint date.');
        applied.touchpointId = await logTouchpoint(actorId, { entityId: p.entityId, vehicleId: p.vehicleId, pursuitId: p.pursuitId,
          channel: input.channel!, direction: input.direction ?? null, on, summary: input.body.trim(), read: null }, { q: tx, updateId: update.updateId });
        touched.push(p.pursuitId);
      } else {
        await tx.query(`insert into research.note (entity_id, author_id, kind, body, data) values ($1,$2,$3,$4,$5)`,
          [p.entityId, actorId, workflow ? 'workflow_request' : 'context', body,
            JSON.stringify({ pursuitId: p.pursuitId, vehicleId: p.vehicleId, updateId: update.updateId,
              ...(workflow ? { workflow: input.action, status: 'requested', execution: 'not_started' } : {}) })]);
      }
      await recordApplied(tx, update.updateId, applied);
      await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
        values ($1,'pursuit.bulk_action','pursuit',$2,$3)`, [actorId,p.pursuitId,JSON.stringify({ action: input.action, updateId: update.updateId, reason: input.body.trim(), applied })]);
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

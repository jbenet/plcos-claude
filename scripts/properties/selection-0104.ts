/** Invented fixtures for issue 0104: request keys without randomUUID, optional status notes, undo, atomic bulk moves. */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { applyBulk, undoBulk, type BulkInput } from '../../lib/pipeline-bulk';
import { newRequestKey } from '../../lib/request-key';
import type { Check } from './harness';

export async function selection0104Properties(check: Check, db: Db) {
  // Plain http has no crypto.randomUUID: the key must still be a fresh v4 UUID.
  const proto = Object.getPrototypeOf(globalThis.crypto) as object;
  const saved = Object.getOwnPropertyDescriptor(proto, 'randomUUID');
  let keys: string[] = [];
  try {
    Object.defineProperty(proto, 'randomUUID', { value: undefined, configurable: true, writable: true });
    keys = Array.from({ length: 2000 }, () => newRequestKey());
  } finally {
    if (saved) Object.defineProperty(proto, 'randomUUID', saved);
  }
  check('0104 a request key needs no crypto.randomUUID, as on the live server over plain http',
    keys.every((k) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(k)) && new Set(keys).size === keys.length
      && typeof globalThis.crypto.randomUUID === 'function',
    '2,000 keys from getRandomValues: version 4, RFC variant, all distinct; randomUUID restored after.');

  await withDb(db, async () => {
    const actor = (await db.one<{ id: string; name: string }>('select id, name from platform.app_user where active order by name limit 1'))!;
    const vehicle = (await db.one<{ id: string }>("select id from platform.vehicle where kind='fund' order by sort_order limit 1"))!.id;
    const entities: string[] = [], ids: string[] = [];
    for (const name of ['Invented Selection Alder', 'Invented Selection Birch', 'Invented Selection Cedar', 'Invented Selection Damson']) {
      const e = randomUUID(); entities.push(e);
      await db.query("insert into identity.entity(entity_id,entity_type,display_name) values($1,'person',$2)", [e, name]);
      ids.push((await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,next_step)
        values($1,$2,$3,'sourcing','Invented next step') returning pursuit_id id`, [e, vehicle, actor.id]))!.id);
    }
    const status = async (id: string) => (await db.one<{ status: string; passed_by: string | null; status_reason: string | null; next_step: string | null }>(
      'select status::text, passed_by, status_reason, next_step from strategy.pursuit where pursuit_id=$1', [id]))!;
    const count = async (sql: string, args: unknown[] = []) => Number((await db.one<{ n: string }>(sql, args))!.n);
    const audits = (id: string, action: string) => db.query<{ actor_id: string; at: unknown; detail: Record<string, unknown> }>(
      `select actor_id::text, at, detail from platform.audit_log where subject_id=$1 and action=$2 order by id`, [id, action]);
    const row = async (id: string) => ({ id, vehicleId: vehicle, status: (await status(id)).status as BulkInput['rows'][number]['status'] });
    try {
      // 1. No note needed, except for Passed.
      const a = ids[0]!;
      const move: BulkInput = { key: `sel-0104-${randomUUID()}`, action: 'status', status: 'selected', body: '', place: 'selection', rows: [await row(a)] };
      const moved = await applyBulk(actor.id, move, vehicle);
      const set = (await audits(a, 'pursuit.status_set')).at(-1);
      const bulk = (await audits(a, 'pursuit.bulk_action')).at(-1);
      const rule = `set on Selection by ${actor.name}`;
      let noteless = false; try { await applyBulk(actor.id, { ...move, key: randomUUID(), action: 'context', rows: [await row(a)] }, vehicle); } catch { noteless = true; }
      let noWhy = false; try { await applyBulk(actor.id, { ...move, key: randomUUID(), status: 'passed', passedBy: 'us', body: 'A note is not a reason', rows: [await row(a)] }, vehicle); } catch { noWhy = true; }
      let noWho = false; try { await applyBulk(actor.id, { ...move, key: randomUUID(), status: 'passed', passReason: 'timing', rows: [await row(a)] }, vehicle); } catch { noWho = true; }
      const stillSelected = (await status(a)).status === 'selected';
      const pass: BulkInput = { ...move, key: `sel-0104-${randomUUID()}`, status: 'passed', passedBy: 'them', passReason: 'timing', rows: [await row(a)] };
      await applyBulk(actor.id, pass, vehicle);
      const passed = await status(a);
      check('0104 a status change needs no note; the log keeps who, when, from, to and the rule "set on Selection by <user>"',
        moved.written === 1 && set?.actor_id === actor.id && !!set.at && set.detail.fromId === 'sourcing' && set.detail.toId === 'selected'
          && set.detail.reason === rule && bulk?.detail.rule === rule && bulk.detail.place === 'selection',
        'Empty note; the status_set and bulk_action audit rows name the actor, the time, both statuses and the rule.');
      check('0104 Passed still needs who ended it and why; other notes stay required outside a status change',
        noteless && noWhy && noWho && stillSelected && passed.status === 'passed' && passed.passed_by === 'them' && passed.status_reason === 'timing',
        'Refusals leave the status alone; Passed with who and why, and no note, is saved.');

      // 2. Undo restores the prior status, Passed with who and why, once, and never over a later change.
      const undo = await undoBulk(actor.id, { of: pass.key, place: 'selection' }, vehicle);
      const back = await status(a);
      const again = await undoBulk(actor.id, { of: pass.key, place: 'selection' }, vehicle);
      const undo2 = await undoBulk(actor.id, { of: move.key, place: 'selection' }, vehicle);
      const first = await status(a);
      const b = ids[1]!;
      const moveB: BulkInput = { ...move, key: `sel-0104-${randomUUID()}`, rows: [await row(b)] };
      await applyBulk(actor.id, moveB, vehicle);
      await applyBulk(actor.id, { ...moveB, key: randomUUID(), status: 'discussing', rows: [await row(b)] }, vehicle);
      let stale = false; try { await undoBulk(actor.id, { of: moveB.key }, vehicle); } catch { stale = true; }
      let other = false; try { await undoBulk(randomUUID(), { of: move.key }, vehicle); } catch { other = true; }
      const undoAudit = (await audits(a, 'pursuit.bulk_action')).at(-1);
      check('0104 undo restores the prior status through the audited path, once, and refuses over a later change',
        undo.written === 1 && back.status === 'selected' && again.written === 0 && again.alreadySaved === 1
          && undo2.written === 1 && first.status === 'sourcing' && first.next_step === 'Invented next step'
          && stale && (await status(b)).status === 'discussing' && other
          && undoAudit?.detail.action === 'undo' && undoAudit.detail.undoes === move.key && undoAudit.actor_id === actor.id,
        'Passed → Selected → undo gives Passed (them, timing); a second tap writes nothing; the next undo gives Sourcing with the next step kept; a changed status or another person refuses.');

      // 3. Bulk moves are atomic across rows and audited once per row.
      const trio = [ids[0]!, ids[2]!, ids[3]!];
      const updates = () => count('select count(*)::text n from strategy.pursuit_update where pursuit_id = any($1::uuid[])', [trio]);
      const logs = () => count("select count(*)::text n from platform.audit_log where subject_id = any($1::text[]) and action in ('pursuit.status_set','pursuit.bulk_action')", [trio]);
      const beforeU = await updates(), beforeL = await logs();
      const rows = await Promise.all(trio.map(row));
      const bulkMove: BulkInput = { ...move, key: `sel-0104-${randomUUID()}`, rows: [rows[0]!, rows[1]!, { ...rows[2]!, status: 'new' }] };
      let refused = false; try { await applyBulk(actor.id, bulkMove, vehicle); } catch { refused = true; }
      const untouched = refused && await updates() === beforeU && await logs() === beforeL
        && (await Promise.all(trio.map(status))).every((s) => s.status === 'sourcing');
      const ok = await applyBulk(actor.id, { ...bulkMove, key: `sel-0104-${randomUUID()}`, rows }, vehicle);
      const each = await Promise.all(trio.map(async (id) => {
        const s = await audits(id, 'pursuit.status_set'), bl = await audits(id, 'pursuit.bulk_action');
        return (await status(id)).status === 'selected' && s.at(-1)?.detail.updateId === bl.at(-1)?.detail.updateId;
      }));
      check('0104 a bulk move is all or nothing, and each row is audited once with its own update',
        untouched && ok.written === 3 && await updates() === beforeU + 3 && await logs() === beforeL + 6 && each.every(Boolean),
        'One stale row leaves all three untouched; the fresh request writes one update, one status_set and one bulk_action per row.');
    } finally {
      await db.query('delete from strategy.pursuit_update where pursuit_id=any($1::uuid[])', [ids]);
      await db.query('delete from strategy.pursuit where pursuit_id=any($1::uuid[])', [ids]);
      await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [entities]);
    }
  });
}

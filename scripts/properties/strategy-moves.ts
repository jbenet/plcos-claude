/** Invented fixtures only: scope, import atomicity and human planning decisions. */
import { randomUUID } from 'node:crypto';
import type { Db } from '../../lib/db';
import { decideMove, importMoves, listMoves, moveScore, type Estimate, type MoveFile, type MoveInput } from '../../modules/strategy/moves';
import type { Check } from './harness';

export async function strategyMoveProperties(check: Check, db: Db) {
  const actor = (await db.one<{ id: string }>('select id from platform.app_user where active order by handle limit 1'))!.id;
  const vehicles = await db.query<{ id: string; slug: string }>("select id,slug from platform.vehicle where kind='fund' order by sort_order limit 2");
  if (vehicles.length < 2) throw Error('Strategy move properties require two invented fund fixtures.');
  const [first, second] = vehicles as [typeof vehicles[number], typeof vehicles[number]];
  const prefix = `invented-0082-${randomUUID()}`;
  const ids = [prefix, `${prefix}-atomic`, `${prefix}-invalid`];
  const estimate = (value: number): Estimate => ({ value, basis: 'Invented planning assumption, not observed conversion.', label: 'GUESS' });
  const original: MoveInput = { id: ids[0]!, title: 'Invented evidence workshop', category: 'materials', detail: 'Prepare an invented diligence workshop.',
    evidence: [{ source: 'https://example.org/invented-evidence', as_of: '2026-09-27', confidence: 'low', last_verified_by: 'Invented fixture author', supports: 'A fictional evidence gap.' }],
    vehicles: [{ slug: first.slug, estimates: {
      reach: estimate(10), check: estimate(100000), baseline: estimate(.2), conversionLift: estimate(.1), checkLift: estimate(20000),
      confidence: estimate(.5), teamHours: estimate(8), cashCost: estimate(500), effectDays: estimate(14),
      audience: 'Ten invented prospects', dependencies: 'Human review and separate outreach approvals',
    } }],
  };
  const file = (...moves: MoveInput[]): MoveFile => ({ version: 1, moves });
  const clone = (): MoveInput => structuredClone(original);
  const snapshot = async () => JSON.stringify({
    moves: await db.query('select * from strategy.move where id=any($1::text[]) order by id', [ids]),
    scopes: await db.query('select * from strategy.move_vehicle where move_id=any($1::text[]) order by move_id,vehicle_id', [ids]),
    audits: await db.query("select * from platform.audit_log where subject_type='strategy_move' and subject_id=any($1::text[]) order by id", [ids]),
  });
  const capitalSnapshot = async () => JSON.stringify({
    exposures: await db.query('select * from pipeline.exposure order by exposure_id'),
    ladder: await db.query('select * from strategy.ladder_event order by event_id'),
    tickets: await db.query('select * from governance.approval_ticket order by id'),
  });
  const refused = async (work: () => Promise<unknown>) => { try { await work(); return false; } catch { return true; } };
  const row = async () => (await listMoves(db, first.id)).find(r => r.id === original.id)!;
  const decisionCount = async () => Number((await db.one<{ n: string }>("select count(*)::text n from platform.audit_log where subject_id=$1 and action='strategy.move_decided'", [original.id]))!.n);
  const beforeCapital = await capitalSnapshot();
  try {
    const scored = moveScore(original.vehicles[0]!.estimates);
    check('0082 strategy move ranking uses incremental effects per team hour', scored.expected === 80000 && scored.priority === 10000,
      'Ten prospects × ($100K × 0.1 + $20K × 0.3) × 0.5 = $80K; eight team hours. Invented GUESS inputs only.');

    const beforeInvalid = await snapshot();
    const mutations: Array<(m: MoveInput) => void> = [
      m => { m.evidence[0]!.last_verified_by = ''; },
      m => { m.evidence[0]!.source = ''; },
      m => { m.evidence[0]!.as_of = 'unknown'; },
      m => { m.vehicles[0]!.estimates.teamHours.value = 0; },
      m => { m.vehicles[0]!.estimates.reach.value = 1.5; },
      m => { m.vehicles[0]!.estimates.confidence.value = 1.1; },
      m => { m.vehicles[0]!.estimates.conversionLift.value = .9; },
      m => { m.vehicles[0]!.estimates.cashCost.value = -1; },
      m => { m.vehicles[0]!.estimates.check.value = Number.NaN; },
      m => { m.vehicles[0]!.estimates.checkLift.value = Number.POSITIVE_INFINITY; },
      m => { m.vehicles[0]!.estimates.reach.value = 1e308; m.vehicles[0]!.estimates.check.value = 1e308; },
      m => { m.vehicles[0]!.estimates.check.basis = ''; },
      m => { (m.vehicles[0]!.estimates.check as { label: string }).label = 'verified'; },
    ];
    const rejections: boolean[] = [];
    for (const mutate of mutations) { const input = clone(); mutate(input); rejections.push(await refused(() => importMoves(db, file(input), actor))); }
    const duplicate = await refused(() => importMoves(db, file(original, original), actor));
    check('0082 invalid provenance, unlabeled estimates and unsafe numbers write nothing', rejections.every(Boolean) && duplicate && beforeInvalid === await snapshot(),
      `${mutations.length} invalid variants and a duplicate source key refused before any move, scope or audit write.`);

    const validFirst = { ...clone(), id: ids[1]! };
    const invalidSecond = { ...clone(), id: ids[2]!, vehicles: [{ ...clone().vehicles[0]!, slug: 'invented-missing-vehicle' }] };
    const atomic = await refused(() => importMoves(db, file(validFirst, invalidSecond), actor));
    check('0082 a later unknown vehicle rolls back the entire import', atomic && beforeInvalid === await snapshot(),
      'The first move and its import audit roll back when the second move fails vehicle validation.');

    const imported = await importMoves(db, file(original), actor);
    const beforeRetry = await snapshot(); const repeated = await importMoves(db, file(original), actor);
    check('0082 repeated source import is idempotent including timestamps and audit', imported.written === 1 && repeated.written === 0 && beforeRetry === await snapshot(),
      'Same hash creates no duplicate record, scope version or import audit.');

    const proposal = await row();
    const choose = { id: original.id, vehicleId: first.id, version: proposal.version, state: 'chosen' as const, position: 2, note: 'Invented human chose this move.' };
    await decideMove(db, actor, choose);
    const afterChoice = await snapshot(); await decideMove(db, actor, choose);
    const chosen = await row();
    check('0082 choosing and ordering a move is audited once on retry', chosen.state === 'chosen' && chosen.position === 2 && chosen.version === proposal.version + 1
      && await decisionCount() === 1 && afterChoice === await snapshot(), 'Exact repeated decision does not change a version or duplicate an audit event.');

    const revised = clone(); revised.vehicles[0]!.estimates.teamHours = estimate(12); revised.title = 'Invented revised evidence workshop';
    await importMoves(db, file(revised), actor);
    const revision = await row();
    check('0082 revised evidence preserves a person’s chosen state and manual order', revision.title === revised.title && revision.state === 'chosen' && revision.position === 2
      && revision.estimates.teamHours.value === 12 && revision.version === chosen.version + 1 && await decisionCount() === 1,
      'Import refreshes estimates and advances their version without accepting, dismissing or reordering work.');

    const beforeStale = await snapshot();
    const stale = await refused(() => decideMove(db, actor, { ...choose, version: chosen.version, state: 'dismissed', note: 'Invented stale decision.' }));
    check('0082 a decision based on superseded estimates is refused', stale && beforeStale === await snapshot(), 'Reload required after an import changes the estimate version.');

    // Both callers saw the same version; only one distinct decision may win.
    const concurrent = await Promise.allSettled([
      decideMove(db, actor, { ...choose, version: revision.version, position: 3, note: 'Invented first reorder.' }),
      decideMove(db, actor, { ...choose, version: revision.version, position: 4, note: 'Invented concurrent reorder.' }),
    ]);
    const afterRace = await row();
    check('0082 concurrent decisions on one version cannot silently overwrite each other', concurrent.filter(r => r.status === 'fulfilled').length === 1
      && concurrent.filter(r => r.status === 'rejected').length === 1 && afterRace.version === revision.version + 1 && await decisionCount() === 2,
      'One row lock/version check succeeds and one caller must reload; exactly one additional decision audit.');

    const beforeWrong = await snapshot();
    const wrong = await refused(() => decideMove(db, actor, { ...choose, vehicleId: second.id, version: afterRace.version }));
    check('0082 decisions refuse a move outside its vehicle scope', wrong && beforeWrong === await snapshot(), 'The server checks scope independently of client values.');

    const both = structuredClone(revised); both.vehicles.push({ slug: second.slug, estimates: structuredClone(both.vehicles[0]!.estimates) });
    await importMoves(db, file(both), actor);
    const secondScope = (await listMoves(db, second.id)).find(m => m.id === original.id)!;
    check('0082 adding another vehicle starts an independent human decision', secondScope.state === 'proposed' && secondScope.position === null
      && (await row()).state === 'chosen' && (await row()).position === afterRace.position,
      'Choosing the first vehicle never chooses or orders another vehicle.');
    const beforeRemoval = await snapshot();
    const removal = await refused(() => importMoves(db, file(revised), actor));
    check('0082 import cannot silently remove a vehicle scope or its decision history', removal && beforeRemoval === await snapshot(), 'Scope removal requires a separate decision rather than disappearance from an input file.');

    const current = await row();
    await decideMove(db, actor, { ...choose, version: current.version, state: 'dismissed', position: null, note: 'Invented person dismisses the move.' });
    const dismissed = await row();
    check('0082 dismissal retains the move and records its reason', dismissed.state === 'dismissed' && dismissed.position === null
      && await decisionCount() === 3 && (await listMoves(db, second.id)).find(m => m.id === original.id)?.state === 'proposed', 'Dismissal does not delete estimates, evidence or the other vehicle’s proposal.');
    check('0082 strategy imports and decisions do not change capital, consent or approval tickets', beforeCapital === await capitalSnapshot(),
      'Full hard/soft exposure rows, ladder events and approval tickets are unchanged across imports, reorders, decisions and refusals.');
  } finally {
    await db.query('delete from strategy.move_vehicle where move_id=any($1::text[])', [ids]);
    await db.query('delete from strategy.move where id=any($1::text[])', [ids]);
  }
}

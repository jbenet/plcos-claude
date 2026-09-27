/** Invented fixtures for 0065: no private records or amounts. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { withDb, type Db } from '../../lib/db';
import { actionScore, capacityEstimate, conversionFor, statusId, vehicleStrategy, decideSuggestion } from '../../modules/strategy';
import { checkStrategy, type Strategy } from '../../lib/enrich/strategy';
import { importFindings } from '../../lib/enrich/import';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check } from './harness';

export async function vehicleStrategyProperties(check: Check, db: Db) {
  check('0065 capacity refuses prose, open ranges and other people’s money',
    capacityEstimate('$1–5M') === 3e6 && capacityEstimate('$250K–1M') === 625000
    && capacityEstimate('unknown') === null && capacityEstimate('>$25M') === null
    && capacityEstimate('$1–5M for someone else') === null, 'Only a clean closed range gets an explicitly guessed midpoint.');
  const input = { capacity: 100000, likelihood: .3, route: .8, days: 30, conversion: .5, held: false };
  check('0065 scores expose expected value and time-adjusted conversion; missing and blocked inputs stay unscored',
    actionScore(input)?.expected === 24000 && actionScore(input)?.priority === 400
    && actionScore({ ...input, route: null }) === null && actionScore({ ...input, held: true }) === null,
    'No numeric zero substitutes for unknown evidence or a restriction.');
  const t = { pursuitId: 'invented', from: 'selected' as const, to: 'discussing' as const, at: new Date() };
  check('0065 status history accepts legacy labels and deduplicates repeat exits', statusId('Discussing') === 'discussing'
    && statusId('Cash received') === null && conversionFor('selected', [t, t]).observed === 1
    && conversionFor('selected', []).observed === 0, 'Status is separate from cash and the consent ladder.');

  await withDb(db, async () => {
    const entity = randomUUID();
    const owner = (await db.one<{ id: string }>('select id from platform.app_user where active limit 1'))!.id;
    const vehicles = await db.query<{ id: string; name: string }>("select id,name from platform.vehicle where kind='fund' order by sort_order limit 2");
    if (vehicles.length !== 2) throw Error('Need two invented fund fixtures');
    const [first, intended] = vehicles as [typeof vehicles[number], typeof vehicles[number]];
    await db.query("insert into identity.entity(entity_id,entity_type,display_name) values($1,'person','Invented Strategy Cedar')", [entity]);
    const pursuits: string[] = [];
    for (const v of vehicles) pursuits.push((await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status)
      values($1,$2,$3,'selected') returning pursuit_id as id`, [entity, v.id, owner]))!.id);
    const strategy: Strategy = { key: entity, name: 'Invented Strategy Cedar', made: { at: '2026-09-27', by: 'fixture', workflow: 'W5', version: '1.18' },
      fit: { [intended.name]: { verdict: 'possible', why: 'Invented fixture' } },
      scores: { capacity: { band: '$1–5M', basis: 'Invented estimate' }, affinity: { level: 'medium', basis: 'Invented evidence' },
        propensity: { level: 'medium', basis: 'Invented evidence' }, timeToDecision: { band: 'weeks', basis: 'Invented evidence' } },
      angle: 'Invented angle', route: null, next: { what: 'Review invented evidence', who: 'Fixture owner', when: '2026-10-01' },
      ask: { vehicle: intended.name, shape: 'verify first' }, openQuestions: [], risks: [], list: 'this year', confidence: 'low' };
    const suggestion = (await db.one<{ id: string }>(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash)
      values($1,'Invented next step',$2,'fixture',now(),'0065-fixture') returning suggestion_id as id`, [pursuits[0], JSON.stringify(strategy)]))!.id;
    try {
      let refused = false;
      try { await decideSuggestion(owner, suggestion, 'accept', null); } catch { refused = true; }
      check('0065 wrong-vehicle suggestions cannot be accepted', refused, 'No status, next step or acceptance is written into the wrong raise.');
      const repair = await readFile('modules/strategy/migrations/007_suggestion_vehicle.sql', 'utf8');
      await db.exec(repair); await db.exec(repair);
      const repaired = await db.one<{ pursuit_id: string; status: string }>('select pursuit_id,status from strategy.suggestion where suggestion_id=$1', [suggestion]);
      check('0065 repair moves the proposal to its named vehicle and is idempotent', repaired?.pursuit_id === pursuits[1] && repaired.status === 'proposed', 'Undecided proposals only; no human decisions or capital modified.');
      const page = await vehicleStrategy(intended.id, new Date('2026-09-27T12:00:00Z'));
      const row = page?.rows.find(r => r.pursuit.entityId === entity);
      check('0065 actual strategies appear without any legacy fit assessment', row?.suggestion?.suggestion_id === suggestion && row.action === strategy.next.what,
        'The strategy projection reads strategy.suggestion; it does not use fit as a pipeline proxy.');
      await db.query(`update strategy.pursuit set plan='[{"move":"Older recorded plan","because":"Invented evidence"}]'::jsonb where pursuit_id=$1`, [pursuits[1]]);
      await db.query(`insert into network.route_cache(target_id,vehicle_kind,revision,input_revision,computed_at,search)
        values($1,'fund','invalidated-generation',-1,now(),$2::jsonb)`, [entity, JSON.stringify({ routes: [{ weakestTier: 'A', fromName: 'Invented Connector', hops: [{ toName: 'Invented Strategy Cedar' }] }] })]);
      const revised = (await vehicleStrategy(intended.id, new Date('2026-09-27T12:00:00Z')))!.rows.find(r => r.pursuit.entityId === entity)!;
      check('0065 invalidated route snapshots cannot supply scoring inputs', revised.route?.count === 1 && !revised.route.current && revised.routeWeight === null && revised.score === null,
        'A recently computed route is still stale when its graph or scoring generation changed.');
      check('0065 unscored evidence work retains a transparent priority', revised.workPriority > 0 && revised.workFactors.some(f => f.label === 'Route search needs refreshing'), 'Evidence points do not turn unknown monetary inputs into zero or a funding forecast.');
      check('0065 proposed strategy actions stay proposed when an older plan exists', revised.action === strategy.next.what && revised.group === 'Proposed next actions',
        'The displayed action and its provenance have the same precedence.');
      await db.query(`insert into research.note(entity_id,kind,body,data) values($1,'public_profile','Invented correction',$2::jsonb)`,
        [entity, JSON.stringify({ researched: { at: '2026-09-20', corrected: [{ at: '2026-09-27T06:00:00Z' }] } })]);
      const corrected = (await vehicleStrategy(intended.id, new Date('2026-09-27T12:00:00Z')))!.rows.find(r => r.pursuit.entityId === entity)!;
      check('0065 later research corrections require a strategy refresh', corrected.stale && corrected.action === 'Refresh the strategy against newer evidence',
        'Original research dates cannot hide a later fact check.');
      const before = await db.one<{ hard: string }>(`select coalesce(sum(amount),0)::text hard from pipeline.exposure where vehicle_id=$1 and track='hard' and closed_at is null`, [intended.id]);
      check('0065 headline equals hard exposures and keeps soft separate', page?.total.hard === Number(before?.hard), 'No status or inferred capacity can enter the hard headline.');
      const dir = await mkdtemp(join(tmpdir(), 'strategy-0065-'));
      try {
        await mkdir(join(dir,'strategy'));
        await writeFile(join(dir,'strategy',`${entity}.json`), JSON.stringify(strategy));
        const problems = checkStrategy(strategy, entity);
        check('0065 import fixture passes the protected strategy schema', problems.length === 0, problems.join('; ') || 'Valid invented strategy.');
        const imported = await importFindings(null, dir);
        const mapped = await db.query<{ pursuit_id: string }>(`select pursuit_id from strategy.suggestion where data->>'key'=$1 and status='proposed'`, [entity]);
        check('0065 importer uses named vehicle instead of earliest pursuit', imported.proposed === 1 && mapped.every(s => s.pursuit_id === pursuits[1]), 'Multi-vehicle entity; repeat import is idempotent.');
        check('0065 repeated import creates no duplicate proposals', (await importFindings(null, dir)).proposed === 0, 'File hash deduplication remains vehicle scoped.');
      } finally { await rm(dir, { recursive: true, force: true }); }
    } finally {
      await db.query('delete from network.route_cache where target_id=$1', [entity]);
      await db.query('delete from research.note where entity_id=$1', [entity]);
      await db.query('delete from strategy.suggestion where pursuit_id=any($1::uuid[])', [pursuits]);
      await db.query('delete from strategy.pursuit where entity_id=$1', [entity]);
      await db.query('delete from identity.entity where entity_id=$1', [entity]);
    }
  });
}

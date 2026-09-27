/** Invented overlapping LP strategies; all files and writes stay in the demo harness. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb, type Db } from '../../lib/db';
import { importFindings } from '../../lib/enrich/import';
import type { Strategy } from '../../lib/enrich/strategy';
import { suggestionsFor, strategyPursuitsFor, vehicleStrategy } from '../../modules/strategy';
import { vehicleReadings } from '../../lib/vehicle-readings';
import { scoreDetail } from '../../lib/pipeline-data';
import type { Check } from './harness';

export async function strategyPerVehicleProperties(check: Check, db: Db) {
  await withDb(db, async () => {
    const entity = randomUUID(), alias = 'invented-companion-alias';
    const owner = (await db.one<{ id: string }>('select id from platform.app_user where active limit 1'))!.id;
    const vehicles = await db.query<{ id: string; name: string; slug: string }>(
      "select id,name,slug from platform.vehicle where kind='fund' order by sort_order limit 2");
    const [a, b] = vehicles;
    if (!a || !b) throw Error('Two invented vehicles required');
    const dir = await mkdtemp(join(tmpdir(), 'strategy-per-vehicle-'));
    const root = join(dir, 'strategy');
    await mkdir(join(root, b.slug), { recursive: true });
    await db.query("insert into identity.entity(entity_id,entity_type,display_name) values($1,'person','Invented Companion Willow')", [entity]);
    await db.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values('prospect_key',$1,$2,'fixture')", [alias, entity]);
    const pursuits: string[] = [];
    for (const v of vehicles) pursuits.push((await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status)
      values($1,$2,$3,'selected') returning pursuit_id id`, [entity, v.id, owner]))!.id);
    const strategy = (vehicle: string, marker: string, key: string = entity): Strategy => ({
      key, name: 'Invented Companion Willow', made: { at: '2026-09-27', by: 'fixture', workflow: 'W5', version: '1.10' },
      fit: { [vehicle]: { verdict: 'possible', why: marker } },
      scores: { capacity: { band: 'unknown', basis: marker }, affinity: { level: 'low', basis: marker },
        propensity: { level: 'low', basis: marker }, timeToDecision: { band: 'weeks', basis: marker } },
      angle: marker, route: null, next: { what: marker, who: 'Fixture owner', when: '2026-10-01' },
      ask: { vehicle, shape: 'verify first' }, openQuestions: [], risks: [], list: 'this year', confidence: 'low',
    });
    const write = (path: string, s: Strategy) => writeFile(join(root, path), JSON.stringify(s));
    const run = () => importFindings(null, dir);
    const snapshot = async () => JSON.stringify(await db.query(
      'select * from strategy.suggestion where pursuit_id=any($1::uuid[]) order by suggestion_id', [pursuits]));
    try {
      await write(`${entity}.json`, strategy(a.name, 'Review invented fund evidence'));
      await write(`${b.slug}/${entity}.json`, strategy(b.slug, 'Review invented companion evidence'));
      const first = await run();
      check('W5 both legacy and companion files import to their own pursuits', first.proposed === 2 && first.problems.length === 0,
        'One LP, two vehicles, two proposals; display-name legacy and slug companion layouts.');
      const before = await snapshot();
      check('W5 repeated per-vehicle imports are idempotent', (await run()).proposed === 0 && before === await snapshot(),
        'Neither proposal is withdrawn or duplicated.');
      let scoped = true;
      for (const [i, v] of vehicles.entries()) {
        const expected = i === 0 ? 'Review invented fund evidence' : 'Review invented companion evidence';
        const lp = (await suggestionsFor(pursuits[i]!))[0];
        const table = (await vehicleStrategy(v.id, new Date('2026-09-27T12:00:00Z')))!.rows.find(r => r.pursuit.entityId === entity)!;
        const fit = (await vehicleReadings(v.id, entity))[0];
        const pane = await scoreDetail(v.id, pursuits[i]!);
        scoped &&= lp?.data.angle === expected && table.suggestion?.data.angle === expected && table.action === expected
          && fit?.data?.angle === expected && pane?.angle === expected;
      }
      check('W5 LP, strategy table, So next, fit and selection pane read the vehicle in view', scoped,
        'Distinct invented angle and action survive every reader without cross-vehicle fallback.');
      const sections = await strategyPursuitsFor(entity);
      check('W5 the LP page has separate labelled strategy pursuits', sections.length === 2
        && vehicles.every((v, i) => sections.some(s => s.pursuitId === pursuits[i] && s.vehicleName === v.name)),
        'Each section keeps its own pursuit ID for accepting the next step.');

      await write(`${b.slug}/${entity}.json`, strategy(a.name, 'Must never replace either strategy'));
      const mismatch = await run();
      check('W5 a companion folder must exactly equal ask.vehicle', mismatch.proposed === 0 && before === await snapshot()
        && mismatch.problems.some(p => p.key === `strategy/${b.slug}/${entity}.json` && p.problems.some(s => s.includes('must equal ask.vehicle'))),
        'A known folder containing another vehicle is explicitly refused without withdrawals.');
      await write(`${b.slug}/${entity}.json`, strategy(b.name, 'A display name is not a folder slug'));
      const displayName = await run();
      check('W5 companion files require the slug even when the display name resolves', displayName.proposed === 0
        && displayName.problems.some(p => p.problems.some(s => s.includes('must equal ask.vehicle'))),
        'Top-level legacy display names remain supported; a folder has an exact contract.');
      await write(`${b.slug}/${entity}.json`, strategy(b.slug, 'Review invented companion evidence'));
      await mkdir(join(root, 'invented-unknown'));
      await write(`invented-unknown/${entity}.json`, strategy('invented-unknown', 'Unknown vehicle'));
      const unknown = await run();
      check('W5 unknown vehicle folders are explicitly refused', unknown.proposed === 0 && before === await snapshot()
        && unknown.problems.some(p => p.problems.some(s => s.includes('unknown vehicle folder'))), 'Unknown folders never create a vehicle or pursuit.');
      await rm(join(root, 'invented-unknown'), { recursive: true });

      await mkdir(join(root, a.slug));
      await write(`${a.slug}/${entity}.json`, strategy(a.slug, 'Conflicting duplicate'));
      const duplicate = await run();
      check('W5 duplicate entity and vehicle files refuse both, never silently pick', duplicate.proposed === 0 && before === await snapshot()
        && duplicate.problems.filter(p => p.problems.some(s => s.includes('conflict:'))).length === 2,
        'Legacy display name and companion slug resolve to the same pair; previous proposals remain intact.');
      await rm(join(root, a.slug, `${entity}.json`));
      await write(`${a.slug}/${alias}.json`, strategy(a.slug, 'Conflicting alias', alias));
      const canonical = await run();
      check('W5 conflict detection uses canonical identity, not file keys', canonical.proposed === 0 && before === await snapshot()
        && canonical.problems.filter(p => p.problems.some(s => s.includes('conflict:'))).length === 2,
        'A mapped source alias and UUID are the same LP for duplicate detection.');
      await rm(join(root, a.slug), { recursive: true });
      await mkdir(join(root, b.slug, 'deeper'));
      await write(`${b.slug}/deeper/${entity}.json`, strategy(b.slug, 'Too deep'));
      const deep = await run();
      check('W5 import reads only one vehicle folder level', deep.proposed === 0 && before === await snapshot()
        && deep.problems.some(p => p.problems.some(s => s.includes('only one vehicle folder level'))),
        'Deeper paths are refused, never recursively imported.');

      await write(`${b.slug}/${entity}.json`, strategy(b.slug, 'Revised companion only'));
      const revised = await run();
      const aRows = await suggestionsFor(pursuits[0]!);
      const bRows = await suggestionsFor(pursuits[1]!);
      check('W5 revising a companion withdraws only that pursuit’s proposal', revised.proposed === 1 && revised.withdrawn === 1
        && aRows.length === 1 && aRows[0]?.data.angle === 'Review invented fund evidence'
        && bRows.length === 1 && bRows[0]?.data.angle === 'Revised companion only', 'The other raise keeps its existing strategy and decision state.');
    } finally {
      await rm(dir, { recursive: true, force: true });
      await db.query('delete from strategy.suggestion where pursuit_id=any($1::uuid[])', [pursuits]);
      await db.query('delete from strategy.pursuit where entity_id=$1', [entity]);
      await db.query('delete from identity.source_record where entity_id=$1', [entity]);
      await db.query('delete from identity.entity where entity_id=$1', [entity]);
    }
  });
}

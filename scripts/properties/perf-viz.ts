import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Check } from './harness';

/** Compare the reduced readers against the established full projections on demo records. */
export async function perfVizProperties(check: Check) {
  const { config } = await import('../../config/deployment');
  if (config.data.profile !== 'demo') throw new Error('Visualization properties require local demo data.');
  const scratch = join(process.cwd(), 'data', 'demo', 'perf-viz-props');
  const global = globalThis as typeof globalThis & { __capitalOsDb?: Promise<import('../../lib/db').Db> };
  const previous = global.__capitalOsDb;
  if (config.db.url && previous) await (await previous).close();
  delete global.__capitalOsDb;
  await rm(scratch, { recursive: true, force: true });
  await (await import('./database')).resetTestPostgres();
  const db = await (await import('../../lib/db')).openFresh(scratch);
  try {
    const { listPursuits, visualizationPursuits, pursuitCount } = await import('../../modules/strategy');
    const { floorState } = await import('../../lib/floor');
    const { boardState } = await import('../../lib/board');
    const { lenses } = await import('../../lib/lenses');
    const vehicles = await (await import('../../modules/platform')).listVehicles();
    const seeded = await listPursuits(null);
    const plans = [
      [],
      [{ move: 'Unblocked', because: 'Invented', blockedBy: '' }],
      [
        { move: 'Earlier unblocked', because: 'Invented' },
        { move: 'First blocked', because: 'Invented', blockedBy: 'First blocker' },
        { move: 'Later blocked', because: 'Invented', blockedBy: 'Second blocker' },
      ],
    ];
    for (const [i, plan] of plans.entries()) await db.query(
      'update strategy.pursuit set plan=$2::jsonb where pursuit_id=$1',
      [seeded[i]!.pursuitId, JSON.stringify(plan)],
    );

    const full = await listPursuits(null);
    const reduced = await visualizationPursuits(null);
    const expected = full.map(p => ({
      pursuitId: p.pursuitId, entityId: p.entityId, entityName: p.entityName,
      vehicleId: p.vehicleId, vehicleName: p.vehicleName, ownerName: p.ownerName,
      headline: p.headline, plan: p.plan.filter(step => Boolean(step.blockedBy)).slice(0, 1),
      status: p.status, statusReason: p.statusReason, passedBy: p.passedBy, statusSource: p.statusSource,
      statusSetAt: p.statusSetAt, statusSetByName: p.statusSetByName, stageSaid: p.stageSaid,
      events: p.events.map(event => ({ rung: event.rung, occurredAt: event.occurredAt })),
      rung: p.rung, nextRung: p.nextRung,
    }));
    check('VIZ slim pursuits preserve every displayed field, ladder date and first blocker',
      full.length > 3 && full.some(p => p.events.length > 1) && isDeepStrictEqual(reduced, expected),
      'Compared full and reduced readers, including empty plans, empty blockers and multiple blocked steps.');
    check('VIZ corpus count preserves the full global pursuit population',
      await pursuitCount() === full.length,
      'The footer count comes from the full corpus even when the page reads one vehicle.');
    for (const vehicle of vehicles) {
      const selected = await visualizationPursuits(vehicle.id);
      check(`VIZ scoped pursuit reader preserves ${vehicle.slug} records and order`,
        isDeepStrictEqual(selected, reduced.filter(p => p.vehicleId === vehicle.id)),
        'Filtering precedes detail loading without dropping records or changing their order.');
    }

    const envelopes = await db.query<{ envelope_id: string }>(`
      insert into agents.envelope (task, scope, allowed_evidence, allowed_commands, budget,
        deadline, output_schema, acceptance_criteria, escalation_owner, created_by)
      select 'Invented visualization envelope ' || n, e.scope, e.allowed_evidence,
        e.allowed_commands, e.budget, e.deadline, e.output_schema, e.acceptance_criteria,
        e.escalation_owner, e.created_by
      from (select * from agents.envelope order by created_at limit 1) e
      cross join generate_series(1, 4) n returning envelope_id`);
    for (const [i, envelope] of envelopes.entries()) await db.query(`
      insert into agents.run (envelope_id, status, config_hash, config_snapshot,
        input_hash, prompt_hash, agent_kind, started_at)
      values ($1, 'proposed', 'fixture', '{}'::jsonb, 'fixture', 'fixture', 'fixture', $2)`,
      [envelope.envelope_id, new Date(Date.UTC(2026, 8, 27, 0, i))]);
    const { listRuns, getEnvelope } = await import('../../modules/agents');
    const { withDb } = await import('../../lib/db');
    let queries = 0;
    const observed: import('../../lib/db').Db = {
      kind: db.kind,
      query: (sql, params) => { queries++; return db.query(sql, params); },
      one: (sql, params) => { queries++; return db.one(sql, params); },
      exec: sql => db.exec(sql), transaction: work => db.transaction(work), close: () => db.close(),
    };
    const runs = await withDb(observed, () => listRuns(60));
    const distinct = new Set(runs.map(run => run.envelope.envelopeId));
    const referenceEnvelopes = new Map(await Promise.all([...distinct].map(async id => [id, await getEnvelope(id)] as const)));
    check('VIZ agent runs batch multiple envelopes without losing envelope fields',
      distinct.size >= 4 && queries <= 3
        && runs.every(run => isDeepStrictEqual(run.envelope, referenceEnvelopes.get(run.envelope.envelopeId))),
      `${distinct.size} distinct envelopes load in ${queries} queries and equal their individual readers.`);

    for (const scope of ['neurotech', 'all', 'everything']) {
      const slug = scope === 'neurotech' ? scope : null;
      const floor = await floorState(slug, { includeGrants: scope === 'everything' });
      check(`VIZ ${scope} floor retains the global corpus disclosure`,
        floor.coverage.corpus.startsWith(`${full.length} pursuits,`),
        'Narrowed pursuit reads retain the same corpus count shown by the original reader.');
      const board = await boardState(slug, floor);
      for (const [view, members] of [
        ['line', []], ['map', []], ['plant', ['stations']], ['moves', ['moves']],
        ['grid', ['rows']], ['economy', ['resources', 'goodwill']],
      ] as const) {
        const selected = await boardState(slug, floor, view);
        const keys = ['territories', 'fog', ...members] as const;
        check(`VIZ ${scope}/${view} retains its board projection and shared map/filter data`,
          keys.every(key => isDeepStrictEqual(selected[key], board[key])),
          `Compared ${keys.join(', ')} against the complete board.`);
      }
      const allLenses = await lenses(slug, floor);
      for (const view of ['network', 'leverage', 'coverage', 'radar', 'strip'] as const) {
        const selected = await lenses(slug, floor, view);
        // These are request timestamps, not evidence dates. Calls happen at different instants.
        const expectedView = view === 'radar' || view === 'strip'
          ? { ...allLenses[view], asOf: selected[view].asOf }
          : allLenses[view];
        check(`VIZ ${scope}/${view} equals the complete lens projection`,
          isDeepStrictEqual(selected[view], expectedView),
          'Compared every selected field and evidence date; only the request as-of timestamp is aligned.');
      }
    }
  } finally {
    await db.close();
    if (previous) global.__capitalOsDb = previous;
    else delete global.__capitalOsDb;
    await rm(scratch, { recursive: true, force: true });
  }
}

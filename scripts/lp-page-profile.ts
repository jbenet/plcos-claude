/**
 * Time each data loader of the LP page (app/targets/[id]/page.tsx) against a database, one at a
 * time, then all together as the page runs them. Prints loader names, milliseconds and the slowest
 * SQL statements' first words: never parameters, rows or names.
 *
 *   PROFILE_DB_URL=postgres://… npx tsx scripts/lp-page-profile.ts <pursuitId>… [--fresh]
 *
 * The connection is forced read-only (default_transaction_read_only), so a loader that tries to
 * write fails instead of writing. --fresh empties the in-process page caches before each LP, the way
 * a write anywhere does on the server.
 */
import { withDb } from '../lib/db';
import { openPostgres } from '../lib/db/postgres';
import { withQueryTimings, type QueryTiming } from '../lib/db/timing';
import { getPursuit, spvMarks, strategyPursuitsFor, updatesFor, suggestionsFor, spvReadings, spvHistory } from '../modules/strategy';
import { listEntities } from '../modules/identity';
import { claimsFor, notesFor, listSourceDocs } from '../modules/research';
import { restrictionsFor } from '../modules/coordination';
import { planRoutes } from '../modules/network';
import { signalsFor } from '../modules/signals';
import { notesAbout } from '../lib/connectors/affinity/notes';
import { closeTracksFor } from '../modules/pipeline';
import { latestRun } from '../modules/sources';
import { readingsFor } from '../lib/connectors/affinity/readings';
import { raiseWindows, touchpointsFor } from '../modules/meetings';
import { auditFor, listVehicles } from '../modules/platform';
import { relatedLpHeadings } from '../lib/lp-heading';
import { meetingTitles } from '../lib/connectors/affinity/meetings';
import { findOpenTicket } from '../modules/governance';
import { pipelineData } from '../lib/pipeline-data';
import { dakotaFor } from '../lib/connectors/dakota/view';
import { syncSummary } from '../lib/sync';
import { revisionFor } from '../modules/network/cache';
import { routePolicyFacts } from '../modules/network/route-policy';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const fresh = args.includes('--fresh');
const url = process.env.PROFILE_DB_URL;
if (!url) throw new Error('PROFILE_DB_URL is required.');
const ro = new URL(url);
ro.searchParams.set('options', '-c default_transaction_read_only=on');
const db = await openPostgres(ro.toString(), { max: 8 });
const g = globalThis as Record<string, unknown>;

const time = async <T>(label: string, out: Record<string, number>, work: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  try { return await work(); } finally { out[label] = Math.round(performance.now() - t); }
};

try {
  for (const [n, id] of ids.entries()) {
    if (fresh) for (const k of Object.keys(g)) if (k.startsWith('__capitalOs') && k !== '__capitalOsDb') delete g[k];
    const t: Record<string, number> = {};
    const queries: QueryTiming[] = [];
    await withDb(db, () => withQueryTimings((q) => queries.push(q), async () => {
      const p = (await time('getPursuit', t, () => getPursuit(id)))!;
      await time('routeRevision', t, () => revisionFor(db));
      await time('routePolicyFacts', t, () => routePolicyFacts([p.entityId]));
      const vehicles = await time('listVehicles', t, () => listVehicles());
      await time('listEntities', t, () => listEntities([p.entityId]));
      const kind = vehicles.find((v) => v.id === p.vehicleId)?.kind ?? 'fund';
      const claims = await time('claimsFor', t, () => claimsFor(p.entityId));
      await time('notesFor', t, () => notesFor(p.entityId));
      await time('restrictionsFor', t, () => restrictionsFor(p.entityId));
      await time('planRoutes', t, () => planRoutes('juan', p.entityId, 3, kind, 'team', undefined, { vehicleId: p.vehicleId }));
      await time('planRoutes(again)', t, () => planRoutes('juan', p.entityId, 3, kind, 'team', undefined, { vehicleId: p.vehicleId }));
      await time('signalsFor', t, () => signalsFor(p.entityId));
      await time('notesAbout', t, () => notesAbout(p.entityId));
      await time('closeTracksFor', t, () => closeTracksFor(p.entityId, p.vehicleId));
      await time('latestRun', t, () => latestRun('affinity', 'meetings'));
      await time('readingsFor', t, () => readingsFor([p.entityId]));
      const touches = await time('touchpointsFor', t, () => touchpointsFor(p.entityId, null));
      await time('updatesFor', t, () => updatesFor(p.pursuitId));
      await time('auditFor', t, () => auditFor('pursuit', p.pursuitId, ['pursuit.status_set']));
      await time('listSourceDocs', t, () => listSourceDocs([...new Set(claims.map((c) => c.provenance.source))]));
      await time('spvMarks', t, () => spvMarks(db, [p.entityId]));
      await time('raiseWindows', t, () => raiseWindows());
      await time('relatedLpHeadings', t, () => relatedLpHeadings(p.entityId, p.vehicleId));
      await time('strategyPursuitsFor', t, () => strategyPursuitsFor(p.entityId));
      const mids = touches.map((x) => /^interaction:meeting:(\d+):/.exec(x.sourceRef ?? '')?.[1]).filter((x): x is string => !!x);
      await time('meetingTitles', t, () => meetingTitles(mids));
      await time('findOpenTicket', t, () => findOpenTicket('STAGE', 'pursuit', p.pursuitId));
      await time('suggestionsFor', t, () => suggestionsFor(p.pursuitId));
      await time('pipelineData', t, () => pipelineData(p.vehicleId));
      await time('pipelineData(again)', t, () => pipelineData(p.vehicleId));
      await time('dakotaFor', t, () => dakotaFor(db, p.entityId));
      await time('spvReadings+History', t, () => Promise.all([spvReadings(db, [p.entityId]), spvHistory(db, p.entityId)]));
      await time('syncSummary', t, () => syncSummary());
    }));
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    const top = Object.entries(t).sort((a, b) => b[1] - a[1]).filter(([, ms]) => ms >= 15);
    console.log(`LP #${n + 1}: sequential ${total} ms; ${queries.length} queries`);
    console.log('  ' + top.map(([k, ms]) => `${k}=${ms}`).join(' '));
    const bySql = new Map<string, { n: number; ms: number }>();
    for (const q of queries) {
      const key = q.sql.replace(/\s+/g, ' ').trim().slice(0, 90);
      const e = bySql.get(key) ?? { n: 0, ms: 0 };
      e.n++; e.ms += q.milliseconds; bySql.set(key, e);
    }
    for (const [sql, e] of [...bySql].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14)) console.log(`    ${Math.round(e.ms)} ms ×${e.n}  ${sql}`);
  }
} finally { await db.close(); }

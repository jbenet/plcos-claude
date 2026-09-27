/** Benchmark exclusively against the generated, invented temporary corpus. */
import { isDeepStrictEqual } from 'node:util';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createActivityReader } from '../lib/activity';
import { backfill, readLog } from '../lib/activity/backfill';
import { aggregate } from '../lib/activity/model';
import type { ActivityData } from '../lib/activity/types';
import { createActivityPerfFixture } from './activity-perf-fixture';

export interface PerfTiming { operation: string; ms: number; eventLoopMaxMs: number; reads: number; hits: number }
export interface PerfAssertion { name: string; ok: boolean; detail: string }
const withoutTime = ({ asOf: _asOf, ...data }: ActivityData) => data;
const same = (a: ActivityData, b: ActivityData) => isDeepStrictEqual(withoutTime(a), withoutTime(b));

export async function measureActivityPerformance() {
  if (process.env.DATA_PROFILE === 'real') throw new Error('Activity benchmark refuses the real profile.');
  const fixture = await createActivityPerfFixture();
  const timings: PerfTiming[] = [], assertions: PerfAssertion[] = [];
  const readers: ReturnType<typeof createActivityReader>[] = [];
  let generation = 'invented-0', databaseReads = 0;
  const makeReader = () => {
    const reader = createActivityReader({ root: fixture.root, generation: async () => generation,
      database: async () => { databaseReads++; return { points: [], origins: [] }; } });
    readers.push(reader); return reader;
  };
  const check = (name: string, ok: boolean, detail: string) => assertions.push({ name, ok, detail });
  const oracle = async () => {
    const log = await readLog(fixture.root), history = await backfill(fixture.root, log);
    return aggregate([...history.points, ...log.points], [...history.origins, ...log.origins], '2026-09-27T00:00:00.000Z');
  };
  const measure = async <T>(operation: string, work: () => Promise<T>, reader?: ReturnType<typeof createActivityReader>) => {
    const before = { reads: reader?.stats.reads ?? 0, hits: reader?.stats.hits ?? 0 };
    const delay = monitorEventLoopDelay({ resolution: 1 }); delay.enable();
    await new Promise<void>(resolve => setImmediate(resolve));
    const started = performance.now();
    try {
      const value = await work();
      const ms = performance.now() - started;
      await new Promise<void>(resolve => setImmediate(resolve));
      timings.push({ operation, ms, eventLoopMaxMs: delay.max / 1e6,
        reads: (reader?.stats.reads ?? 0) - before.reads, hits: (reader?.stats.hits ?? 0) - before.hits });
      return value;
    } finally { delay.disable(); }
  };
  try {
    const expected = await measure('Uncached full scan (before)', oracle);
    const reader = makeReader();
    const cold = await measure('First cached background build', () => reader.refresh(), reader);
    check('cached and uncached aggregates match at scale', same(cold, expected), 'Strict deep equality of all points, origins, sources and basis text; only asOf excluded.');
    const warm = await measure('Warm request', () => reader(), reader);
    check('warm request stays below 300 ms without source reads', same(warm, cold) && timings.at(-1)!.ms < 300 && timings.at(-1)!.reads === 0,
      `${timings.at(-1)!.ms.toFixed(1)} ms across ${fixture.rawFiles} raw files and ${fixture.ledgerRuns} ledger runs.`);
    generation = 'invented-1';
    const stale = await measure('Request immediately after import', () => reader(), reader);
    check('post-import request serves the prior aggregate immediately', stale.asOf === cold.asOf && same(stale, cold) && timings.at(-1)!.ms < 300,
      'The import marker never makes a page await generation checks or a scan.');
    const markerOnly = await measure('Generation-only background refresh', () => reader.refresh(), reader);
    check('generation changes reuse every unchanged file digest', same(markerOnly, expected) && timings.at(-1)!.reads === 0,
      `Unchanged corpus caused ${timings.at(-1)!.reads} source reads and ${timings.at(-1)!.hits} cache hits.`);
    await fixture.changeLargeFile(); await fixture.appendRun(); generation = 'invented-2';
    const beforeDb = databaseReads;
    const updated = await measure('Changed large finding + ledger refresh', async () => {
      const results = await Promise.all([reader.refresh(), reader.refresh(), reader.refresh()]);
      check('concurrent refreshes share one build', results.every(value => value === results[0]) && databaseReads === beforeDb + 1,
        'Three callers receive one snapshot and one database-evidence evaluation.');
      return results[0];
    }, reader);
    check('incremental refresh stays below three seconds', timings.at(-1)!.ms < 3000 && timings.at(-1)!.reads <= 3,
      `${timings.at(-1)!.ms.toFixed(1)} ms; ${timings.at(-1)!.reads} changed source files read.`);
    check('changed-file and appended-ledger results match uncached', same(updated, await oracle()),
      'One large finding changes its query count and a 301st workflow run is appended.');
    await fixture.removeFinding(); await fixture.addCutoff(); generation = 'invented-3';
    const cutoff = await reader.refresh();
    check('deletions and exact-time log cutoffs match uncached', same(cutoff, await oracle()),
      'A removed research document disappears and an actual fetch event suppresses later estimates, including same-day coverage.');
    await reader.close();
    const restarted = makeReader();
    const hydrated = await measure('New process reader: persisted aggregate', () => restarted(), restarted);
    check('restart immediately serves persisted aggregate', same(hydrated, cutoff) && hydrated.asOf === cutoff.asOf && timings.at(-1)!.ms < 300 && timings.at(-1)!.reads === 0,
      'The saved snapshot retains its original asOf and requires no research-file reads.');
    generation = 'invented-4';
    const rebuilt = await measure('Restart: persisted digest refresh', () => restarted.refresh(), restarted);
    check('restart reuses persisted digests', same(rebuilt, cutoff) && timings.at(-1)!.reads === 0,
      'A fresh reader reaggregates the persisted file digests without reparsing source files.');
    const serialized = await readFile(join(fixture.root, 'activity/digests-v1.json'), 'utf8');
    check('digest cache contains no finding text or full URLs', !/INVENTED_PRIVATE_FIXTURE|Invented Research Person|https:\/\/|\/fictional\//.test(serialized),
      'Cache stores source paths, file metadata, extracted counts and canonical hosts, never document bodies, query text or source URLs.');
    await restarted.close();

    let rejectGeneration = true;
    const failing = createActivityReader({root:fixture.root, generation:async () => {
      if (rejectGeneration) throw new Error('Invented unavailable generation');
      return 'recovered';
    }});
    readers.push(failing);
    const retained = await failing();
    let refused = false;
    try { await failing.refresh(); } catch { refused = true; }
    check('failed background refresh preserves the dated aggregate', refused && same(await failing(), retained) && retained.asOf === rebuilt.asOf,
      'Unavailable generation metadata neither clears the last result nor advances its asOf.');
    rejectGeneration = false;
    check('failed refresh can be retried', same(await failing.refresh(), cutoff), 'A later successful pass recovers without restarting the process.');
    await failing.close();

    let release!: () => void, started!: () => void, generationDuringPass = 'before', evaluations = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const racing = createActivityReader({root:fixture.root, generation:async () => generationDuringPass,
      database:async () => { evaluations++; started(); if (evaluations === 1) await gate; return {points:[], origins:[]}; }});
    readers.push(racing);
    const prior = await racing(), inProgress = racing.refresh();
    await entered;
    const requestStarted = performance.now(), duringPass = await racing();
    check('requests never wait for a background refresh', duringPass === prior && performance.now() - requestStarted < 300,
      'A deliberately blocked database refresh does not delay serving the last snapshot.');
    generationDuringPass = 'after'; release();
    const discarded = await inProgress;
    check('an import racing a refresh bounds work to one pass', discarded === prior && evaluations === 1,
      'A changed generation discards the inconsistent build without recursively rescanning.');
    check('a subsequent pass incorporates the racing import', same(await racing.refresh(), cutoff) && evaluations === 2,
      'The next single-flight pass publishes a coherent aggregate.');
    await racing.close();

    const malformed = JSON.parse(await readFile(join(fixture.root, 'activity/digests-v1.json'), 'utf8'));
    const researchKey = Object.keys(malformed.entries).find(key => key.startsWith('research:'))!;
    malformed.entries[researchKey].value = {at:'2026-09-01T10:00:00.000Z'};
    await writeFile(join(fixture.root, 'activity/digests-v1.json'), JSON.stringify(malformed));
    const malformedAggregate = JSON.parse(await readFile(join(fixture.root, 'activity/aggregate-v1.json'), 'utf8'));
    malformedAggregate.value.points = [null];
    await writeFile(join(fixture.root, 'activity/aggregate-v1.json'), JSON.stringify(malformedAggregate));
    const corrupted = makeReader();
    const unknown = await corrupted();
    check('valid-JSON cache corruption cannot reach consumers', unknown.points.length === 0 && unknown.asOf === new Date(0).toISOString(),
      'Integrity checks reject a malformed saved aggregate before it can reach the page.');
    const restored = await corrupted.refresh();
    check('valid-JSON digest corruption is repaired as a cache miss', same(restored, cutoff) && corrupted.stats.reads === 1,
      'A damaged digest rereads exactly its source file; healthy unchanged digests are reused.');
    await corrupted.close();

    await writeFile(join(fixture.root, 'activity/aggregate-v1.json'), '{"incomplete":');
    await writeFile(join(fixture.root, 'activity/digests-v1.json'), '{"incomplete":');
    generation = 'invented-5';
    const repaired = makeReader();
    const recovered = await repaired.refresh();
    check('corrupt caches rebuild safely from source evidence', same(recovered, cutoff),
      'Torn aggregate and digest files are disposable; rebuilding restores the uncached result.');
    return { fixture: { rawFiles: fixture.rawFiles, rawBytes: fixture.rawBytes, ledgerRuns: fixture.ledgerRuns, digestBytes:Buffer.byteLength(serialized) }, timings, assertions };
  } finally {
    for (const reader of readers) await reader.close();
    await fixture.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('Activity benchmark accepts no paths or other arguments.');
  const result = await measureActivityPerformance();
  console.log(JSON.stringify(result, null, 2));
  if (result.assertions.some(assertion => !assertion.ok)) process.exitCode = 1;
}

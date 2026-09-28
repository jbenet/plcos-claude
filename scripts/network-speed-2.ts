/** Invented, database-free hub benchmark. Run: node --import tsx scripts/network-speed-2.ts
 * Default compares a bounded baseline sample with all 5,418 optimized targets.
 * --baseline-targets=5418 measures the full baseline too (potentially many minutes).
 * --baseline-ref=8e565d0 compares the original profiled walker; the default pins
 * the prior network-speed branch. --dense exercises the per-source path cap.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { pathsFromSnapshot } from '../modules/network/path-search';
import { networkHubFixture } from './network-speed-2-fixture';

async function main() {
  const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
  const reference = arg('baseline-ref', '3f628aa5209abed033ec49e50d28472fe89dacee');
  const baselineCommit = execFileSync('git', ['rev-parse', '--verify', `${reference}^{commit}`], { encoding: 'utf8' }).trim();
  const original = execFileSync('git', ['show', `${baselineCommit}:modules/network/path-search.ts`], { encoding: 'utf8' });
  // This module has only type imports. Compiling to an in-memory module keeps the
  // baseline immutable and avoids creating a second production implementation.
  const compiled = stripTypeScriptTypes(original);
  const baseline: typeof pathsFromSnapshot = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).pathsFromSnapshot;
  const fixture = networkHubFixture(5418,18000,process.argv.includes('--dense'));
  const count = Number(arg('baseline-targets', '24'));
  if (!Number.isInteger(count) || count < 1 || count > fixture.targets.length) throw new Error('Invalid baseline target count');
  const sample = new Set(Array.from({ length: count }, (_, i) => Math.floor(i * fixture.targets.length / count)));
  const expected = new Map<number, string>();
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const heartbeat = setInterval(() => console.log(JSON.stringify({ phase: 'benchmark-running', elapsedMs: Math.round(performance.now() - started) })), 30000);
  heartbeat.unref();
  const started = performance.now();
  try {
    console.log(JSON.stringify({ phase: 'fixture-ready', baselineCommit, targets: fixture.targets.length, nodes: fixture.graph.adjacency.size, edges: fixture.edgeCount, sourceDegrees: fixture.sources.map(s => fixture.graph.adjacency.get(s)!.length), maxDegree: Math.max(...[...fixture.graph.adjacency.values()].map(a => a.length)), baselineTargets: count }));
    let beforeMs = 0;
    for (const i of sample) {
      const start = performance.now();
      const paths = await baseline(fixture.graph, fixture.sources, fixture.targets[i]!, 3, fixture.sourceOnly);
      beforeMs += performance.now() - start;
      expected.set(i, digest(paths));
    }
    console.log(JSON.stringify({ phase: 'baseline-complete', baselineTargets: count, beforeMs: Math.round(beforeMs), projectedAllTargetsMs: Math.round(beforeMs / count * fixture.targets.length), projection: count !== fixture.targets.length }));
    let optimizedSampleMs = 0, totalPaths = 0, threeHopPaths = 0, emptyTargets = 0;
    const hash = createHash('sha256'), optimizedStart = performance.now();
    for (const [i, target] of fixture.targets.entries()) {
      const start = performance.now();
      const paths = await pathsFromSnapshot(fixture.graph, fixture.sources, target, 3, fixture.sourceOnly);
      if (sample.has(i)) {
        optimizedSampleMs += performance.now() - start;
        if (digest(paths) !== expected.get(i)) throw new Error(`Baseline mismatch at invented target ${i}`);
      }
      totalPaths += paths.length; threeHopPaths += paths.filter(p => p.hops === 3).length;
      emptyTargets += Number(paths.length === 0); hash.update(digest(paths));
    }
    console.log(JSON.stringify({ phase: 'complete', baselineCommit, targets: fixture.targets.length, edges: fixture.edgeCount, baselineTargets: count, beforeMs: Math.round(beforeMs), optimizedSampleMs: Math.round(optimizedSampleMs), optimizedAllTargetsMs: Math.round(performance.now() - optimizedStart), exactSampleMatches: expected.size, totalPaths, threeHopPaths, emptyTargets, sha256: hash.digest('hex') }));
  } finally { clearInterval(heartbeat); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

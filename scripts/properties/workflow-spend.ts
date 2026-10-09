import type { FoldedRun, RunLine } from '../../lib/workflows/ledger';
import { dailyShare, family, rewrites, summarize, weighted, WEEKLY_PERCENT } from '../../lib/workflows/spend';
import type { Check } from './harness';

export function workflowSpendProperties(check: Check) {
  const line = (over: Partial<RunLine>): RunLine => ({
    event: 'finished', runId: 'r', parentRunId: null, workflow: 'W5', operation: 'write', protocol: { version: null, hash: 'h' },
    source: 'claude-code', agent: 'strategy-writer', model: 'opus', launchFolder: '/x', workerFolder: '/x',
    batch: { id: 'w5inv-1008-03', manifest: 'enrich/batches/w5inv-1008-03.txt', hash: 'h', planned: 4 },
    startedAt: '2026-10-08T01:00:00Z', endedAt: '2026-10-08T02:00:00Z',
    counts: { selected: 4, written: 4, valid: 4, failed: 0, skipped: 0 }, checks: [], usage: null, outcome: 'succeeded', reason: null, ...over,
  });
  const run = (over: Partial<RunLine>): FoldedRun => ({ runId: 'r', start: line({ event: 'started', ...over }), finish: line(over), outcome: 'succeeded', conflict: false });
  const usage = { input: 1_000_000, cacheRead: 900_000, cacheWrite: 10_000, output: 1_000, cost: null };
  check('spend weights cache reads 0.1, writes 2 and output 5 over fresh input', weighted(usage) === 90_000 + 90_000 + 20_000 + 5_000, String(weighted(usage)));
  check('spend leaves runs without usage unweighted', weighted(null) === null && weighted({ ...usage, input: null }) === null, 'null');
  check('spend groups batch ids into families', family('w5nh-replan-1008-07') === 'w5nh-replan-1008' && family('w1c-1007s09') === 'w1c-1007s', family('w1c-1007s09'));
  const rows = summarize([
    run({ usage }), run({ usage, outcome: 'partial' }), run({ usage: null }),
    run({ usage, source: 'chatgpt' }), run({ usage, startedAt: '2026-10-06T23:00:00Z' }),
  ], '2026-10-07', '2026-10-09');
  const claude = rows.find(r => r.source === 'claude-code')!;
  check('spend sums runs, keys, partials and unknown usage per family in the window',
    rows.length === 2 && claude.runs === 3 && claude.keys === 12 && claude.partial === 1 && claude.unknown === 1, JSON.stringify(rows));
  const share = dailyShare(rows).get('2026-10-08')!;
  check('spend counts only Claude runs against the weekly share', Math.abs(share - 2 * 205_000 / WEEKLY_PERCENT) < 1e-9, String(share));
  const h = rewrites([['a', 'b'], ['a'], ['a', 'a', 'c']]);
  check('spend counts each key once per manifest when histogramming rewrites', h.get(3) === 1 && h.get(1) === 2 && !h.has(4), JSON.stringify([...h]));
}

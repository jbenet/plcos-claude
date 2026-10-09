/**
 * Read-only spend report from the shared workflow ledger (docs/agent-rules/operations.md, "Batch budget").
 *
 *   DATA_PROFILE=real npx tsx scripts/workflow-spend.ts [--days N] [--cap PERCENT]
 *
 * Prints, per UTC day, the Claude-plan share of the week and the biggest batch families, then how many times
 * each W5 key was written in the window. Exits 2 when any day's Claude share is over --cap (default 15), so a
 * launcher stops before starting more (Juan confirmed the hard stop, 9 Oct 2026). Prints counts only, never keys
 * or names.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readRuns, realRoot } from '../lib/workflows/ledger';
import { dailyShare, rewrites, summarize, WEEKLY_PERCENT } from '../lib/workflows/spend';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Usage: ${name} takes a positive number.`);
  return n;
}

async function main() {
  const days = arg('--days', 2), cap = arg('--cap', 15);
  const until = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const root = await realRoot(), ledger = await readRuns();
  if (ledger.issues.length) console.warn(`Ledger has ${ledger.issues.length} issue(s); totals may be incomplete.`);
  const rows = summarize(ledger.runs, since, until), share = dailyShare(rows);
  const pct = (w: number) => `${(w / WEEKLY_PERCENT).toFixed(1)}%`;
  let over = false;
  for (const day of [...new Set(rows.map(r => r.day))]) {
    const s = share.get(day) ?? 0;
    over ||= s > cap;
    console.log(`${day}  Claude ${s.toFixed(1)}% of the week${s > cap ? `  OVER the ${cap}% cap: stop launching Claude batches` : ''}`);
    for (const r of rows.filter(x => x.day === day).slice(0, 12)) {
      const per = r.keys ? Math.round(r.weighted / r.keys / 1e3) : 0;
      console.log(`  ${r.source.padEnd(11)} ${r.workflow.padEnd(5)} ${r.family.padEnd(24)} runs ${String(r.runs).padStart(3)}`
        + `  keys ${String(r.keys).padStart(4)}  ${pct(r.weighted).padStart(6)}  ${per}K/key`
        + `${r.partial ? `  partial ${r.partial}` : ''}${r.unknown ? `  no usage ${r.unknown}` : ''}`);
    }
  }
  const lists: string[][] = [];
  for (const run of ledger.runs) {
    const start = run.start, at = start?.startedAt;
    if (!start || start.workflow !== 'W5' || !at || at < since || at >= until) continue;
    try {
      lists.push((await readFile(join(root, start.batch.manifest), 'utf8')).split('\n')
        .map(l => l.trim().split(/\s+/)[0]!).filter(k => k && !k.startsWith('#')));
    } catch { /* a missing manifest only drops it from the rewrite count */ }
  }
  if (lists.length) {
    const h = [...rewrites(lists)].sort((a, b) => a[0] - b[0]);
    console.log(`W5 writes per key: ${h.map(([n, c]) => `${n}×: ${c}`).join(', ')}`);
  }
  if (over) process.exitCode = 2;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Spend report failed.');
  process.exitCode = 1;
});

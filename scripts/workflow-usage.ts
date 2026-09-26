/** Retrospective sidecar only: never edits runs.jsonl or opens the database. */
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readRuns, realRoot } from '../lib/workflows/ledger';
import { estimateUsage, runWindows } from '../lib/workflows/usage';

async function main() {
  const [day, ...extra] = process.argv.slice(2);
  if (extra.length || !day || !/^\d{4}-\d\d-\d\d$/.test(day) || new Date(day).toISOString().slice(0, 10) !== day) {
    throw new Error('Usage: DATA_PROFILE=real tsx scripts/workflow-usage.ts YYYY-MM-DD (UTC start date)');
  }
  const root = await realRoot(), ledger = await readRuns();
  if (ledger.issues.length) throw new Error('Ledger needs operator review; no estimates written.');
  const chosen = ledger.runs.filter(r => r.start?.startedAt?.startsWith(day) && r.finish?.endedAt);
  if (!chosen.length) throw new Error('No completed runs for that UTC start date.');
  const end = new Date(Math.max(...chosen.map(r => Date.parse(r.finish!.endedAt!)))).toISOString();
  const start = Math.min(...chosen.map(r => Date.parse(r.start!.startedAt!)));
  // Include competing runs even if they started on another date or remain unfinished.
  const windows = runWindows(ledger.runs, end).filter(w => w.start <= Date.parse(end) && w.end >= start);
  const estimates = await estimateUsage(windows);
  const rows = chosen.map(r => ({ ...estimates.find(e => e.runId === r.runId)!, workflow: r.start!.workflow ?? 'unassigned', night: day }));
  const file = join(root, 'workflows/usage-estimates.jsonl');
  const existing = new Map<string, unknown>();
  try {
    for (const line of (await readFile(file, 'utf8')).split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as { runId: string };
      if (typeof row.runId !== 'string') throw new Error('Invalid usage sidecar; no write attempted.');
      existing.set(row.runId, row);
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  for (const row of rows) existing.set(row.runId, row);
  const contents = [...existing.values()].map(r => JSON.stringify(r)).join('\n') + '\n';
  const handle = await open(file, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(contents, 'utf8'); } finally { await handle.close(); }
  function table(group: 'workflow' | 'night') {
    const groups = [...new Set(rows.map(r => r[group]))].sort();
    return groups.map(label => {
      const runs = rows.filter(r => r[group] === label);
      const total = (k: 'input' | 'cachedInput' | 'output' | 'reasoning') => Math.round(runs.reduce((sum, r) => sum + (r[k] ?? 0), 0));
      return { [group]: label, runs: runs.length, unavailable: runs.filter(r => r.input === null).length,
        input: total('input'), cachedInput: total('cachedInput'), output: total('output'), reasoning: total('reasoning'),
        total: total('input') + total('output') };
    });
  }
  console.log('Estimated tokens; input includes cachedInput/cacheWrite; output includes reasoning. No dollar cost inferred.');
  console.log('Night = UTC start date; unavailable runs are excluded from totals. Session match uses provider and worker/launcher cwd.');
  console.table(table('workflow'));
  console.table(table('night'));
  console.log(`Wrote ${rows.length} run estimates; ledger unchanged.`);
}
main().catch((error: unknown) => {
  console.error(error instanceof SyntaxError ? 'Invalid JSON; no private content displayed.' : error instanceof Error ? error.message : 'Usage estimation failed.');
  process.exitCode = 1;
});

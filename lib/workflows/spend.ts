import type { FoldedRun, RunLine } from './ledger';

/**
 * Weighted tokens against the Claude plan's limits, from docs/agent-rules/operations.md (measured 25 Sep 2026):
 * a cache read counts 0.1, a cache write 2 and output 5 of an input token, and a week is roughly 1,000M
 * weighted tokens, so 1% of the week is about 9.8M. Sonnet counts about 0.9× Opus, so models are not
 * weighted separately. The ledger's `input` includes cache reads and writes.
 */
export const WEEKLY_PERCENT = 9.8e6; // GUESS from the 25 Sep measurement; re-measure if the plan changes.

export function weighted(usage: RunLine['usage']): number | null {
  if (!usage || usage.input == null) return null;
  const read = usage.cacheRead ?? 0, write = usage.cacheWrite ?? 0;
  const fresh = Math.max(0, usage.input - read - write);
  return fresh + read * 0.1 + write * 2 + (usage.output ?? 0) * 5;
}

export type SpendRow = {
  day: string; source: string; workflow: string; family: string;
  runs: number; keys: number; weighted: number; unknown: number; partial: number;
};

/** A batch family is its id without the trailing counter: `w5nh-replan-1008-07` → `w5nh-replan-1008`. */
export function family(batchId: string): string {
  return batchId.replace(/\d+$/, '').replace(/[-_]+$/, '') || batchId;
}

/** Finished runs started in [since, until), grouped by UTC start day, source, workflow and batch family. */
export function summarize(runs: FoldedRun[], since: string, until: string): SpendRow[] {
  const rows = new Map<string, SpendRow>();
  for (const run of runs) {
    const start = run.start, finish = run.finish;
    const at = start?.startedAt;
    if (!start || !finish || !at || at < since || at >= until) continue;
    const day = at.slice(0, 10), source = start.source, workflow = start.workflow ?? 'unassigned';
    const fam = family(start.batch.id), id = [day, source, workflow, fam].join('\u0000');
    const row = rows.get(id) ?? { day, source, workflow, family: fam, runs: 0, keys: 0, weighted: 0, unknown: 0, partial: 0 };
    row.runs += 1;
    row.keys += finish.counts.selected ?? start.batch.planned ?? 0;
    const w = weighted(finish.usage);
    if (w == null) row.unknown += 1; else row.weighted += w;
    if (finish.outcome === 'partial' || finish.outcome === 'failed') row.partial += 1;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || b.weighted - a.weighted);
}

/** How many times each key appears across the given manifests' key lists. */
export function rewrites(keyLists: string[][]): Map<number, number> {
  const seen = new Map<string, number>();
  for (const keys of keyLists) for (const key of new Set(keys)) seen.set(key, (seen.get(key) ?? 0) + 1);
  const histogram = new Map<number, number>();
  for (const n of seen.values()) histogram.set(n, (histogram.get(n) ?? 0) + 1);
  return histogram;
}

/** Claude-plan share of the week per day; ChatGPT, script and app runs don't count against it. */
export function dailyShare(rows: SpendRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) if (r.source === 'claude-code') out.set(r.day, (out.get(r.day) ?? 0) + r.weighted / WEEKLY_PERCENT);
  return out;
}

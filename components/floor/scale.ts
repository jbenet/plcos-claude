import type { FloorItem } from '@/lib/floor-client';
import { stateOf } from './shared';

/**
 * How the views stay readable at the volume the raise has now (issue 0066): a few named marks
 * and a count for the rest, never a mark per record once a group outgrows its space.
 *
 * Presentation limits, not domain thresholds. They bound what is drawn; every record stays
 * reachable through the list under each view.
 */

/** A group with more members than this draws the first few by name and counts the rest. */
export const NAMED_PER_GROUP = 5;

/** A scatter or radar with more marks than this draws counts per area instead of dots. */
export const MARKS_BEFORE_DENSITY = 160;

/** Blocked first, then dated soon, then cash, then the rest. */
const STATE_RANK = { blocked: 0, urgent: 1, cash: 2, plain: 3 } as const;

/**
 * The order a view names members of a crowded group in: what most needs a look first —
 * blocked, dated soon, cash — then the largest number, then the ones ahead of their evidence,
 * then the longest quiet. A name breaks the tie, so the same records always draw the same.
 */
export function byAttention(a: FloorItem, b: FloorItem): number {
  return STATE_RANK[stateOf(a)] - STATE_RANK[stateOf(b)]
    || (b.amount ?? -1) - (a.amount ?? -1)
    || Number(!!b.needsEvidence) - Number(!!a.needsEvidence)
    || (b.daysSinceMove ?? -1) - (a.daysSinceMove ?? -1)
    || a.entityName.localeCompare(b.entityName);
}

/** The first `n` by `order`, and how many were left out. */
export function headOf<T>(rows: T[], n: number, order?: (a: T, b: T) => number): { shown: T[]; rest: T[] } {
  const sorted = order ? [...rows].sort(order) : rows;
  // A single leftover is drawn rather than counted: "+1 more" costs the same space as the mark.
  if (sorted.length <= n) return { shown: sorted, rest: [] };
  return { shown: sorted.slice(0, n - 1), rest: sorted.slice(n - 1) };
}

/** Counts per key, largest first. */
export function tally<T>(rows: T[], keyOf: (row: T) => string): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** 1,998 rather than 1998: counts at this volume are read, not parsed. */
export const n = (value: number) => value.toLocaleString('en-US');

/** Move the reader to the list under the view, where a filter just landed. */
export function toList() {
  if (typeof document === 'undefined') return;
  document.getElementById('floorlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

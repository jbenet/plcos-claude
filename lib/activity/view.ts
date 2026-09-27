/**
 * Developer → Connectors (issue 0103): the activity contract (./types) folded into what the page
 * draws — buckets of days or weeks, one stacked series per source or per segment, estimates kept
 * apart from actuals all the way to the bar. Pure: no database, no clock, no files, so the
 * properties can check that stacking conserves every number it was given.
 */
import type { ActivityData, ActivityPoint, ActivitySource, SourceSummary } from './types';
import { foldSec, tidyBasis } from './model';

export type Group = 'all' | 'affinity' | 'warehouse' | 'dakota' | 'linear' | 'intake' | 'search' | 'agents';
export const ALL_SOURCES: ActivitySource[] = ['affinity', 'warehouse', 'dakota', 'linear', 'intake', 'search', 'fetch', 'sec', 'agents'];
export const GROUPS: Array<{ id: Group; label: string; long: string; sources: ActivitySource[] }> = [
  { id: 'all', label: 'All', long: 'All sources', sources: ALL_SOURCES },
  { id: 'affinity', label: 'Affinity', long: 'Affinity', sources: ['affinity'] },
  { id: 'warehouse', label: 'Warehouse', long: 'PL data warehouse', sources: ['warehouse'] },
  { id: 'dakota', label: 'Dakota', long: 'Dakota', sources: ['dakota'] },
  { id: 'linear', label: 'Linear', long: 'Linear', sources: ['linear'] },
  { id: 'intake', label: 'Intake', long: 'Intake files', sources: ['intake'] },
  // EDGAR is internet reading, not a database of its own (issue 0106): it is part of Search.
  { id: 'search', label: 'Search', long: 'Search and page fetches', sources: ['search', 'fetch', 'sec'] },
  { id: 'agents', label: 'Agents', long: 'Agents', sources: ['agents'] },
];
export const groupOf = (s: ActivitySource): Exclude<Group, 'all'> => (s === 'fetch' || s === 'sec' ? 'search' : s);

/** One hue per source group, the same on every chart. Not the meaning colours (clay, green, amber
 *  as states): a source is not a status. Labels always sit beside them; colour is never alone. */
export const GROUP_TONE: Record<Exclude<Group, 'all'>, string> = {
  affinity: '#2F6F8F', warehouse: '#5F4B9E', dakota: '#9A7420', linear: '#34466E', intake: '#6B8A3A',
  search: '#2E8A87', agents: '#9A4F7E',
};
const SEGMENT_TONES = ['#2F6F8F', '#2E8A87', '#9A7420', '#5F4B9E', '#9A4F7E'];
const OTHER_TONE = '#A8A294';
/** At most this many bars stack in one source; the rest fold into "Other". A guess at legibility. */
export const MAX_SERIES = 5;

export const METRICS = ['requests', 'bytesIn', 'bytesOut', 'records'] as const;
export type Metric = (typeof METRICS)[number];
export type RangeKey = '7' | '30' | '90' | 'all';
export const RANGES: RangeKey[] = ['7', '30', '90', 'all'];
export type BucketSize = 'day' | 'week';

export interface Part { actual: number; estimated: number }
export interface Series { key: string; label: string; tone: string }
export interface Bucket {
  start: string; end: string; days: number; partial: boolean;
  /** Per metric, one Part per series, in `series` order. */
  values: Record<Metric, Part[]>;
  /** Points in this bucket whose value for the metric was unknown (null). Unknown is not zero. */
  unknown: Record<Metric, number>;
}
export interface OriginRow {
  origin: string; actual: number; estimated: number;
  peak: number; peakDay: string; activeDays: number;
  /** The median requests on a day it was used at all; the peak against it shows a burst. */
  median: number;
  /** Requests per bucket, aligned with the view's buckets. */
  perBucket: number[];
}
export interface ActivityView {
  group: Group; range: RangeKey; size: BucketSize;
  from: string; to: string; days: number;
  series: Series[]; buckets: Bucket[];
  totals: Record<Metric, Part & { unknown: number }>;
  origins: OriginRow[] | null;
  bases: Array<{ label: string; basis: string }>;
  /** The earliest day anything was recorded in this group, if any. */
  firstDay: string | null;
}

// ── days, in UTC ───────────────────────────────────────────────────────────────────────────
const DAY = 864e5;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(ms(day) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

export function parseView(sp: Record<string, string | string[] | undefined>): { group: Group; range: RangeKey; size: BucketSize } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const group = GROUPS.some((g) => g.id === one(sp.src)) ? (one(sp.src) as Group) : 'all';
  const range = RANGES.includes(one(sp.range) as RangeKey) ? (one(sp.range) as RangeKey) : '30';
  const by = one(sp.by);
  const size: BucketSize = by === 'day' || by === 'week' ? by : defaultSize(range);
  return { group, range, size };
}
/** Days up to a month read best one bar a day; longer ranges one bar a week. */
export const defaultSize = (range: RangeKey): BucketSize => (range === '7' || range === '30' ? 'day' : 'week');

/** The days a range covers, ending on the as-of day. "all" starts at the first recorded day. */
export function rangeDays(data: ActivityData, range: RangeKey): { from: string; to: string } {
  const to = data.asOf.slice(0, 10);
  if (range !== 'all') return { from: addDays(to, -(Number(range) - 1)), to };
  const first = data.points.reduce<string | null>((m, p) => (m === null || p.day < m ? p.day : m), null);
  return { from: first && first < to ? first : to, to };
}

/** Day buckets, or Monday-to-Sunday weeks clipped to the range (the first and last may be partial). */
export function makeBuckets(from: string, to: string, size: BucketSize): Array<{ start: string; end: string; days: number }> {
  const out: Array<{ start: string; end: string; days: number }> = [];
  let start = from;
  while (start <= to) {
    let end = start;
    if (size === 'week') {
      const dow = (new Date(ms(start)).getUTCDay() + 6) % 7; // Monday 0
      end = addDays(start, 6 - dow);
      if (end > to) end = to;
    }
    out.push({ start, end, days: daysBetween(start, end) + 1 });
    start = addDays(end, 1);
  }
  return out;
}

const emptyMetrics = <T,>(f: () => T): Record<Metric, T> =>
  ({ requests: f(), bytesIn: f(), bytesOut: f(), records: f() });

const segmentKey = (p: ActivityPoint) => `${p.source}|${p.segment ?? ''}`;

export function buildView(
  data: ActivityData,
  opts: { group: Group; range: RangeKey; size: BucketSize },
): ActivityView {
  const { group, range, size } = opts;
  const { from, to } = rangeDays(data, range);
  const def = GROUPS.find((g) => g.id === group)!;
  const label = new Map(data.sources.map((s) => [s.id, s.label]));
  const sourceLabel = (s: ActivitySource) => label.get(s) ?? s;
  // Whatever arrives, SEC rows read as page fetches (the data boundary does this too).
  const inGroup = data.points.filter((p) => def.sources.includes(p.source)).map(foldSec);
  const points = inGroup.filter((p) => p.day >= from && p.day <= to);
  const firstDay = inGroup.reduce<string | null>((m, p) => (m === null || p.day < m ? p.day : m), null);

  // Series: one per source group on "All"; otherwise one per source segment, biggest first.
  let series: Series[];
  let seriesOf: (p: ActivityPoint) => number;
  if (group === 'all') {
    const present = GROUPS.filter((g) => g.id !== 'all' && points.some((p) => groupOf(p.source) === g.id));
    series = present.map((g) => ({ key: g.id, label: g.label, tone: GROUP_TONE[g.id as Exclude<Group, 'all'>] }));
    const at = new Map(series.map((s, i) => [s.key, i]));
    seriesOf = (p) => at.get(groupOf(p.source))!;
  } else {
    const weight = new Map<string, number>();
    for (const p of points) weight.set(segmentKey(p), (weight.get(segmentKey(p)) ?? 0) + (p.requests ?? 0) + (p.records ?? 0));
    const ranked = [...weight.keys()].sort((a, b) => weight.get(b)! - weight.get(a)! || a.localeCompare(b));
    const multiSource = new Set(points.map((p) => p.source)).size > 1;
    const name = (key: string) => {
      const [src, seg] = key.split('|') as [ActivitySource, string];
      if (!seg) return multiSource ? sourceLabel(src) : def.long;
      if (seg === 'edgar') return 'EDGAR';
      return multiSource ? `${sourceLabel(src)} · ${seg}` : seg;
    };
    const kept = ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
    const single = kept.length === 1 && ranked.length === 1;
    series = kept.map((k, i) => ({
      key: k, label: name(k),
      tone: single ? GROUP_TONE[group as Exclude<Group, 'all'>] : SEGMENT_TONES[i % SEGMENT_TONES.length]!,
    }));
    if (ranked.length > kept.length) series.push({ key: '*other', label: `Other · ${ranked.length - kept.length}`, tone: OTHER_TONE });
    const at = new Map(kept.map((k, i) => [k, i]));
    seriesOf = (p) => at.get(segmentKey(p)) ?? series.length - 1;
  }

  const shells = makeBuckets(from, to, size);
  const buckets: Bucket[] = shells.map((b) => ({
    ...b, partial: size === 'week' && b.days < 7,
    values: emptyMetrics(() => series.map(() => ({ actual: 0, estimated: 0 }))),
    unknown: emptyMetrics(() => 0),
  }));
  const bucketOf = bucketIndexer(shells);
  const totals = emptyMetrics(() => ({ actual: 0, estimated: 0, unknown: 0 }));
  for (const p of points) {
    const b = buckets[bucketOf(p.day)]!;
    const s = seriesOf(p);
    for (const m of METRICS) {
      const v = p[m];
      if (v === null || !Number.isFinite(v)) { b.unknown[m] += 1; totals[m].unknown += 1; continue; }
      const part = b.values[m][s]!;
      if (p.estimated) { part.estimated += v; totals[m].estimated += v; } else { part.actual += v; totals[m].actual += v; }
    }
  }

  let origins: OriginRow[] | null = null;
  if (group === 'search') {
    const rows = new Map<string, OriginRow & { byDay: Map<string, number> }>();
    for (const o of data.origins) {
      if (o.day < from || o.day > to) continue;
      const r = rows.get(o.origin) ?? { origin: o.origin, actual: 0, estimated: 0, peak: 0, peakDay: o.day, activeDays: 0, median: 0, perBucket: shells.map(() => 0), byDay: new Map() };
      if (o.estimated) r.estimated += o.requests; else r.actual += o.requests;
      r.byDay.set(o.day, (r.byDay.get(o.day) ?? 0) + o.requests);
      r.perBucket[bucketOf(o.day)]! += o.requests;
      rows.set(o.origin, r);
    }
    origins = [...rows.values()].map(({ byDay, ...r }) => {
      for (const [day, n] of byDay) if (n > r.peak || (n === r.peak && day > r.peakDay)) { r.peak = n; r.peakDay = day; }
      const used = [...byDay.values()].filter((n) => n > 0).sort((a, b) => a - b);
      const mid = used.length >> 1;
      const median = used.length === 0 ? 0 : used.length % 2 ? used[mid]! : (used[mid - 1]! + used[mid]!) / 2;
      return { ...r, activeDays: used.length, median };
    }).sort((a, b) => b.actual + b.estimated - (a.actual + a.estimated) || a.origin.localeCompare(b.origin));
  }

  // One line per source: its bases' clauses, each once, capped (issues 0107–0108).
  const bySource = new Map<ActivitySource, string[]>();
  for (const p of points) {
    if (!p.estimated) continue;
    const list = bySource.get(p.source) ?? [];
    if (p.basis && !list.includes(p.basis)) list.push(p.basis);
    bySource.set(p.source, list);
  }
  // Sources estimated the same way share one line.
  const bases = new Map<string, { label: string; basis: string }>();
  for (const [src, list] of bySource) {
    const basis = capText(tidyBasis(...list) ?? 'No basis recorded.', MAX_BASIS);
    const same = bases.get(basis);
    bases.set(basis, { label: same ? `${same.label}, ${sourceLabel(src)}` : sourceLabel(src), basis });
  }

  return {
    group, range, size, from, to, days: daysBetween(from, to) + 1,
    series, buckets, totals, origins, bases: [...bases.values()], firstDay,
  };
}

function bucketIndexer(shells: Array<{ start: string; end: string }>) {
  return (day: string) => {
    let lo = 0, hi = shells.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (shells[mid]!.start <= day) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
}

/** Per source over a range: requests and records, with how much of each was estimated. */
export function sourceTotals(data: ActivityData, from: string, to: string) {
  const out = new Map<ActivitySource, { requests: Part & { unknown: number }; records: Part & { unknown: number }; lastDay: string | null }>();
  for (const s of ALL_SOURCES) out.set(s, { requests: { actual: 0, estimated: 0, unknown: 0 }, records: { actual: 0, estimated: 0, unknown: 0 }, lastDay: null });
  for (const raw of data.points) {
    const p = foldSec(raw);
    const t = out.get(p.source);
    if (!t) continue;
    if (!t.lastDay || p.day > t.lastDay) t.lastDay = p.day;
    if (p.day < from || p.day > to) continue;
    for (const m of ['requests', 'records'] as const) {
      const v = p[m];
      if (v === null) t[m].unknown += 1;
      else if (p.estimated) t[m].estimated += v;
      else t[m].actual += v;
    }
  }
  return out;
}

/** A host's busiest day at least this many times its usual (median) day reads as a burst. A guess. */
export const BURST_RATIO = 6;
export const isBurst = (r: Pick<OriginRow, 'peak' | 'median'>) => r.median > 0 && r.peak >= BURST_RATIO * r.median;

// ── words that fit ────────────────────────────────────────────────────────────────────────
/** The longest estimate basis shown for one source, and the longest source note. Guesses at one line. */
export const MAX_BASIS = 180;
export const MAX_NOTE = 60;
/** Cut at a word boundary, with an ellipsis, when longer than n. */
export function capText(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s;,.:–—-]+$/, '')}…`;
}
/** A source's note as a short phrase, or nothing: its first sentence, capped, and dropped when
 *  most sources carry the same text (boilerplate says nothing about the source). */
export function sourceNotes(list: SourceSummary[]): Map<ActivitySource, string | null> {
  const count = new Map<string, number>();
  for (const s of list) { const k = s.note.trim(); if (k) count.set(k, (count.get(k) ?? 0) + 1); }
  return new Map(list.map((s) => {
    const k = s.note.trim();
    if (!k || (list.length > 2 && (count.get(k) ?? 0) > list.length / 2)) return [s.id, null];
    const first = k.split(/(?<=[.;])\s+/)[0]!.replace(/[.;]$/, '');
    return [s.id, capText(first, MAX_NOTE)];
  }));
}

// ── drawing ────────────────────────────────────────────────────────────────────────────────

/** One stacked bar in value space: per series, its actual part first and its estimate on top. */
export interface Slab { series: number; estimated: boolean; y0: number; y1: number }
export function stack(parts: Part[]): Slab[] {
  const out: Slab[] = [];
  let y = 0;
  parts.forEach((p, series) => {
    for (const estimated of [false, true]) {
      const v = estimated ? p.estimated : p.actual;
      if (v > 0) { out.push({ series, estimated, y0: y, y1: y + v }); y += v; }
    }
  });
  return out;
}
export const partSum = (parts: Part[]) => parts.reduce((n, p) => n + p.actual + p.estimated, 0);

/** How a slab is drawn. An estimate is lighter and outlined with a dash; an actual is solid. */
export function estimateStyle(estimated: boolean): { fillOpacity: number; strokeDasharray: string | undefined; word: 'estimate' | 'actual' } {
  return estimated
    ? { fillOpacity: 0.3, strokeDasharray: '3 2', word: 'estimate' }
    : { fillOpacity: 1, strokeDasharray: undefined, word: 'actual' };
}

/** The top gridline: the next 1, 2, 2.5 or 5 × 10ⁿ at or above the tallest bar. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * p >= v) return f * p;
  return 10 * p;
}

// ── words ──────────────────────────────────────────────────────────────────────────────────
export function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)}K`;
  return Math.round(n).toLocaleString('en-GB');
}
/** Decimal units (1 kB = 1,000 bytes), as the sources themselves bill. */
export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} kB`;
  return `${Math.round(n)} B`;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(day: string, withWeekday = true): string {
  const d = new Date(ms(day));
  return `${withWeekday ? `${DOW[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
export function bucketLabel(b: { start: string; end: string; days: number }): string {
  return b.days === 1 ? dayLabel(b.start) : `${dayLabel(b.start, false)} – ${dayLabel(b.end, false)}`;
}

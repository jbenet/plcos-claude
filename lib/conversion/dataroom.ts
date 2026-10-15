/**
 * Dataroom views on the conversion page (docs/33 §1, charts 7–10), from DocSend visits (modules/docsend, docs/32).
 * Pure: the visits and the pursuits' steps in, the charts' numbers out. A view is curiosity, not commitment; these
 * say who read what, and what went with it, never what caused it.
 */
import { MIN_FOR_RATE, wilson, type Row } from './model';

/** The fields of a DocSend visit this reads (modules/docsend DocsendVisit). */
export interface Visit {
  visitId: string;
  startedAt: Date;
  durationSec: number | null;
  percentViewed: number | null;
  pageCount: number | null;
  pageSeconds: Record<string, number> | null;
  entityId: string | null;
  documentId: string | null;
  documentTitle: string | null;
}

const DAY = 86_400_000;

export interface Reader {
  pursuitId: string;
  name: string;
  visits: number;
  /** Distinct days with a visit. */
  days: number;
  seconds: number;
  /** The furthest any visit got, 0–100, or null when DocSend did not say. */
  furthest: number | null;
  last: Date;
  lastDocument: string | null;
}

/** Each LP's reading, joined to their pursuit by entity. Visits nobody on record matches are counted apart. */
export function readers(rows: Row[], visits: Visit[], entityOf: Map<string, string>): { readers: Map<string, Reader>; unmatched: number } {
  const byPursuit = new Map(rows.map((r) => [r.p.pursuitId, r]));
  const out = new Map<string, Reader & { dayset: Set<string> }>();
  let unmatched = 0;
  for (const v of visits) {
    const pursuitId = v.entityId ? entityOf.get(v.entityId) : undefined;
    const row = pursuitId ? byPursuit.get(pursuitId) : undefined;
    if (!row) { unmatched++; continue; }
    const r = out.get(row.p.pursuitId) ?? { pursuitId: row.p.pursuitId, name: row.p.name, visits: 0, days: 0, seconds: 0,
      furthest: null, last: v.startedAt, lastDocument: v.documentTitle, dayset: new Set<string>() };
    r.visits++;
    r.dayset.add(v.startedAt.toISOString().slice(0, 10));
    r.days = r.dayset.size;
    r.seconds += v.durationSec ?? 0;
    if (v.percentViewed !== null) r.furthest = Math.max(r.furthest ?? 0, v.percentViewed);
    if (v.startedAt >= r.last) { r.last = v.startedAt; r.lastDocument = v.documentTitle; }
    out.set(row.p.pursuitId, r);
  }
  return { readers: new Map([...out].map(([k, { dayset: _, ...r }]) => [k, r])), unmatched };
}

export interface ReadFunnel { reached: number; opened: number; half: number; back: number; unknownDepth: number }

/** Of the LPs we reached, how many opened the dataroom, read past half, and came back another day. */
export function readFunnel(rows: Row[], rd: Map<string, Reader>): ReadFunnel {
  const list = [...rd.values()];
  return {
    reached: rows.filter((r) => r.m.dates.reached || rd.has(r.p.pursuitId)).length,
    opened: list.length,
    half: list.filter((r) => (r.furthest ?? 0) >= 50).length,
    back: list.filter((r) => r.days >= 2).length,
    unknownDepth: list.filter((r) => r.furthest === null).length,
  };
}

export const TIME_BANDS = [
  { key: 'none', label: 'Never opened', lo: -1, hi: 0 },
  { key: '2', label: 'Under 2 min', lo: 0, hi: 120 },
  { key: '10', label: '2–10 min', lo: 120, hi: 600 },
  { key: '30', label: '10–30 min', lo: 600, hi: 1800 },
  { key: 'more', label: 'Over 30 min', lo: 1800, hi: Infinity },
] as const;

export interface Band { key: string; label: string; n: number; met: number; committed: number; rate: number | null; ci: { lo: number; hi: number } | null }

/** LPs reached, by total time in the dataroom, and the share that met us. "Never opened" is the comparison. */
export function engagement(rows: Row[], rd: Map<string, Reader>): Band[] {
  const reached = rows.filter((r) => r.m.dates.reached || rd.has(r.p.pursuitId));
  return TIME_BANDS.map((b) => {
    const at = reached.filter((r) => {
      const x = rd.get(r.p.pursuitId);
      return b.key === 'none' ? !x : Boolean(x) && x!.seconds >= b.lo && x!.seconds < b.hi;
    });
    const met = at.filter((r) => r.m.dates.met).length;
    const enough = at.length >= MIN_FOR_RATE;
    return { key: b.key, label: b.label, n: at.length, met, committed: at.filter((r) => r.m.dates.committed).length,
      rate: enough ? met / at.length : null, ci: enough ? wilson(met, at.length) : null };
  });
}

export interface PageDrop { documentTitle: string; viewers: number; pages: Array<{ page: number; share: number; seconds: number | null }> }

/**
 * For each document read page by page: the share of its visits that reached each page, and the median seconds
 * spent there. Visits without per-page time are left out, so the base is said beside each document.
 */
export function pageDrop(visits: Visit[], limit = 3): PageDrop[] {
  const byDoc = new Map<string, Visit[]>();
  for (const v of visits) {
    if (!v.pageSeconds || !Object.keys(v.pageSeconds).length) continue;
    const k = v.documentId ?? v.documentTitle ?? 'unknown';
    const list = byDoc.get(k);
    if (list) list.push(v); else byDoc.set(k, [v]);
  }
  return [...byDoc.values()].sort((a, b) => b.length - a.length).slice(0, limit).map((vs) => {
    const count = Math.max(...vs.map((v) => v.pageCount ?? Math.max(0, ...Object.keys(v.pageSeconds!).map(Number))));
    const pages = Array.from({ length: Math.max(0, Math.min(count, 200)) }, (_, i) => {
      const p = i + 1;
      const secs = vs.map((v) => v.pageSeconds![String(p)]).filter((x): x is number => typeof x === 'number' && x > 0).sort((a, b) => a - b);
      return { page: p, share: secs.length / vs.length, seconds: secs.length ? secs[Math.floor((secs.length - 1) / 2)]! : null };
    });
    return { documentTitle: vs[0]!.documentTitle ?? 'Untitled document', viewers: vs.length, pages };
  });
}

export interface Unanswered { pursuitId: string; name: string; last: Date; document: string | null; daysSince: number }

/** Open LPs who read in the last `days` days with nothing from us since their last visit: who to follow up today. */
export function readNoFollowUp(rows: Row[], rd: Map<string, Reader>, now: Date, days = 14): Unanswered[] {
  const since = now.getTime() - days * DAY;
  const byPursuit = new Map(rows.map((r) => [r.p.pursuitId, r]));
  return [...rd.values()].flatMap((x) => {
    const r = byPursuit.get(x.pursuitId);
    if (!r || r.p.status === 'passed' || r.p.status === 'committed' || x.last.getTime() < since) return [];
    if (r.m.lastOurs && r.m.lastOurs >= x.last) return [];
    return [{ pursuitId: x.pursuitId, name: x.name, last: x.last, document: x.lastDocument, daysSince: Math.floor((now.getTime() - x.last.getTime()) / DAY) }];
  }).sort((a, b) => b.last.getTime() - a.last.getTime());
}

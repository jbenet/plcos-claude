import { lpSections, type LpSections } from '@/lib/lp-groups';
import type { SpvRowMark } from '@/modules/strategy/client';

/**
 * The rows both LP tables show — the pipeline (module 04) and selection (module 03) — and the
 * pure logic they share: filters, ordering and organisation groups (issues 0067, 0071, 0083,
 * 0089). No React here, so the properties can check it directly.
 */
export type Status = 'new' | 'sourcing' | 'selected' | 'connecting' | 'discussing' | 'committed' | 'passed';

export interface PipelineRow {
  id: string;
  entityId: string;
  isOrg: boolean;
  /** An organisation's people (docs/23): its contacts on this pursuit first, then everyone acting for it now.
   * `individual` is their own LP row in this vehicle, when they also invest personally. */
  people: Array<{ id: string; name: string; role: string; contact?: boolean; individual?: string | null }>;
  /** A person's firms, as context: `lpRow` is the firm's own LP row in this vehicle, when it has one. */
  firms: Array<{ id: string; name: string; role: string | null; lpRow: string | null }>;
  /** 'organisation' for an organisation; 'personal' for a person with evidence of investing on their own account. */
  lpCapacity: 'organisation' | 'personal' | null;
  /** Why the re-point rule could not tell firm from personal. */
  lpReview: string | null;
  capacitySort: number | null;
  vehicleId: string;
  vehicleSlug: string;
  orgId: string | null;
  score: number | null;
  scoreKind: string;
  scoreAt: string | null;
  priority: number | null;
  capacity: string | null;
  route: number | null;
  /** The proposed strategy's list (docs/04 §0): this year's close, 2027, or not now. */
  list: string | null;
  /** The first few flags, each cut short; `riskCount` is how many there are. */
  risks: string[];
  riskCount: number;
  name: string;
  /** Their organisation on record, and whether it leads the row as the LP we're targeting (issue 0013, lib/lp-heading.ts). */
  org: string | null;
  orgFirst: boolean;
  headline: string | null;
  vehicle: string;
  owner: string;
  status: Status;
  /** Passed: who and why. */
  ended: string | null;
  next: string | null;
  nextKind: string | null;
  nextOn: string | null;
  /** Affinity's word, and what it implies. */
  said: string | null;
  implied: string[];
  setHere: string | null;
  /** A meeting on record for an LP still at Selected or earlier. */
  ahead: boolean;
  doNotContact: boolean;
  /** Whether the LP unit does SPVs (Juan, 27 Sep 2026): a person's setting, research, or derived signals. */
  spv: SpvRowMark;
  /** The row's vehicle is an SPV: a "doesn't do SPVs" LP is dimmed and flagged before it is selected. */
  spvVehicle: boolean;
  money: { state: string; amount: number; wired: number; hard: boolean; signedPer: string | null } | null;
  meetings: number;
  lastMeeting: string | null;
  lastTouch: string | null;
  waitingSince: string | null;
  read: string | null;
  readOn: string | null;
  readSuggested: boolean;
  /** A later record points the other way (N57): shown struck, and not counted as their read. */
  readSuperseded: string | null;
  readOld: boolean;
  rung: number;
  /** The first rung with nothing on file: past what is accepted and what records support. */
  needs: number;
  /** 'file': a record on file supports it, and nobody has accepted it yet (N57). */
  rungs: Array<'on' | 'na' | 'off' | 'file'>;
  rungLabel: string;
}

export type SortKey = 'score' | 'priority' | 'name' | 'vehicle' | 'owner' | 'status' | 'where' | 'capacity' | 'route' | 'meetings' | 'touch' | 'read' | 'ladder' | 'spv';
export const SORT_KEYS: SortKey[] = ['score','priority','name','vehicle','owner','status','where','capacity','route','meetings','touch','read','ladder','spv'];
/** Keys whose natural first click is biggest first. */
export const numeric = new Set<SortKey>(['score','priority','capacity','route','meetings','touch','ladder','read','where','spv']);
/** An LP on record as not doing SPVs, on a pursuit of an SPV vehicle: dimmed and flagged before a move to Selected. */
export const spvFlagged = (r: Pick<PipelineRow, 'spv' | 'spvVehicle'>) => r.spvVehicle && r.spv.stance === 'does-not';
/** Does, with the larger known count first; then unknown; doesn't last. */
export const spvOrder = (m: SpvRowMark) => (m.stance === 'does' ? 2 + (m.minDeals ?? 0) / 1e4 : m.stance === 'unknown' ? 1 : 0);
export const STATUS_ORDER: Status[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed', 'passed'];
const READ_ORDER: Record<string, number> = { 'Very interested': 3, Interested: 2, 'Not very interested': 1 };
const MONEY_ORDER: Record<string, number> = { Closed: 5, Hard: 4, Signed: 3, Soft: 2, Withdrawn: 0 };

/** The name that leads an LP's row: the LP unit's own (docs/23). */
export const lead = (r: PipelineRow) => (r.orgFirst && r.org ? r.org : r.name);
/** The context under an individual's name: their firms, the first two. An organisation's people are shown apart. */
export const second = (r: PipelineRow) => (r.isOrg || !r.firms.length ? null
  : r.firms.slice(0, 2).map((f) => f.name).join(' · ') + (r.firms.length > 2 ? ` +${r.firms.length - 2}` : ''));
export const theirRead = (r: PipelineRow) => (r.readSuperseded ? null : r.read);

export function compareRows(a: PipelineRow, b: PipelineRow, key: SortKey, dir: 1 | -1): number {
  const value = (r: PipelineRow): string | number | null => {
    switch (key) {
      case 'name': return lead(r);
      case 'status': return STATUS_ORDER.indexOf(r.status);
      // Money first, by how far it has got and how much; then a dated next step, soonest first.
      case 'where': return r.money ? 1e13 * (MONEY_ORDER[r.money.state] ?? 1) + r.money.amount
        : r.nextOn ? -Date.parse(r.nextOn) / 1e3 : r.next ? -1e10 : null;
      case 'capacity': return r.capacitySort;
      case 'touch': return r.lastTouch ? Date.parse(r.lastTouch) : null;
      case 'meetings': return r.meetings || null;
      case 'ladder': return r.rung;
      case 'read': { const read = theirRead(r); return read ? READ_ORDER[read] ?? 0 : null; }
      case 'spv': return spvOrder(r.spv);
      default: return r[key];
    }
  };
  const av = value(a), bv = value(b);
  // Missing evidence stays at the bottom in either direction: unscored is not a zero.
  if (av === null || bv === null) return av === bv ? lead(a).localeCompare(lead(b)) || a.id.localeCompare(b.id) : av === null ? 1 : -1;
  const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
  return order * dir || lead(a).localeCompare(lead(b)) || a.id.localeCompare(b.id);
}

/**
 * Both LP tables' grouping (issues 0111, 0112; docs/23): the LP is the committing unit, so every row
 * is one LP unit. Organisations are listed once each, their people named inside the row; people
 * investing in their own capacity are listed apart, as Individuals, each with their firms as
 * context. Someone who does both appears in both places: named in the firm's row, and as an
 * individual row of their own.
 */
export function sectionRows(rows: PipelineRow[], key: SortKey, dir: 1 | -1): LpSections<PipelineRow> {
  return lpSections(rows, r => r.isOrg, (a, b) => compareRows(a, b, key, dir));
}
export type { LpSections };

// ── filters ─────────────────────────────────────────────────────────────────────────────────────
export interface Filters {
  q: string;
  owner: string;
  vehicle: string;
  meetings: 'any' | 'some' | 'none';
  touch: 'any' | 'waiting' | 'recent' | 'stale' | 'none';
  read: 'any' | 'very' | 'interested' | 'not' | 'none';
  money: 'any' | 'soft' | 'signed' | 'hard' | 'none';
  flag: 'any' | 'ahead' | 'dnc' | 'flagged' | 'scored' | 'unscored';
  spv: 'any' | 'open' | 'does' | 'unknown' | 'not';
}
export const EMPTY: Filters = { q: '', owner: '', vehicle: '', meetings: 'any', touch: 'any', read: 'any', money: 'any', flag: 'any', spv: 'any' };
export const CHOICES = {
  meetings: [['any', 'Any'], ['some', 'Has met'], ['none', 'Never met']],
  touch: [['any', 'Any'], ['recent', 'Last 30 days'], ['stale', 'Over 90 days'], ['waiting', 'Waiting on them'], ['none', 'Never']],
  read: [['any', 'Any'], ['very', 'Very interested'], ['interested', 'Interested'], ['not', 'Not very'], ['none', 'No read']],
  money: [['any', 'Any'], ['soft', 'Soft'], ['signed', 'Signed'], ['hard', 'Hard or closed'], ['none', 'No amount']],
  flag: [['any', 'Any'], ['scored', 'Scored'], ['unscored', 'Unscored'], ['flagged', 'Has flags'], ['ahead', 'Met, status behind'], ['dnc', 'Do not contact']],
  spv: [['any', 'Any'], ['open', 'Does or unknown'], ['does', 'Does SPVs'], ['unknown', 'Unknown'], ['not', 'Doesn’t do SPVs']],
} as const satisfies Partial<Record<keyof Filters, ReadonlyArray<readonly [string, string]>>>;
export const FILTER_LABEL: Record<keyof typeof CHOICES, string> = { meetings: 'Meetings', touch: 'Last touch', read: 'Their read', money: 'Money', flag: 'Flags', spv: 'SPVs' };

/** Only values the filters have: an address someone edited by hand can't put the table in a state it can't show. */
export function filtersFrom(given: Record<string, string | undefined> = {}): Filters {
  const f = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
    const value = given[key];
    if (value === undefined) continue;
    const allowed = (CHOICES as Record<string, ReadonlyArray<readonly [string, string]>>)[key];
    if (allowed && !allowed.some((c) => c[0] === value)) continue;
    (f as unknown as Record<string, string>)[key] = value;
  }
  return f;
}
export function sortFrom(given: Record<string, string | undefined> = {}, fallback: SortKey = 'score') {
  const key = SORT_KEYS.find((k) => k === given.sort) ?? fallback;
  return { key, dir: (given.dir === 'asc' ? 1 : given.dir === 'desc' ? -1 : numeric.has(key) ? -1 : 1) as 1 | -1 };
}

const DAY = 86_400_000;
const t = (iso: string | null) => (iso ? Date.parse(iso) : 0);
/** Every word must appear somewhere in what the row says. */
export function haystack(r: PipelineRow): string {
  return `${r.name} ${r.org ?? ''} ${r.headline ?? ''} ${r.owner} ${r.vehicle} ${r.said ?? ''} ${r.next ?? ''} ${r.ended ?? ''} ${r.capacity ?? ''} ${r.people.map((p) => p.name).join(' ')} ${r.firms.map((f) => f.name).join(' ')}`.toLowerCase();
}
export function matches(r: PipelineRow, f: Filters, words: string[], now: number, hay?: string): boolean {
  if (words.length) {
    const h = hay ?? haystack(r);
    if (!words.every((w) => h.includes(w))) return false;
  }
  if (f.owner && r.owner !== f.owner) return false;
  if (f.vehicle && r.vehicle !== f.vehicle) return false;
  if (f.meetings === 'some' && r.meetings === 0) return false;
  if (f.meetings === 'none' && r.meetings > 0) return false;
  if (f.touch === 'waiting' && !r.waitingSince) return false;
  if (f.touch === 'recent' && !(r.lastTouch && now - t(r.lastTouch) <= 30 * DAY)) return false;
  if (f.touch === 'stale' && !(r.lastTouch && now - t(r.lastTouch) > 90 * DAY)) return false;
  if (f.touch === 'none' && r.lastTouch) return false;
  const read = theirRead(r);
  if (f.read === 'very' && read !== 'Very interested') return false;
  if (f.read === 'interested' && read !== 'Interested') return false;
  if (f.read === 'not' && read !== 'Not very interested') return false;
  if (f.read === 'none' && read) return false;
  if (f.money === 'none' && r.money) return false;
  if (f.money === 'soft' && r.money?.state !== 'Soft') return false;
  if (f.money === 'signed' && r.money?.state !== 'Signed') return false;
  if (f.money === 'hard' && !r.money?.hard) return false;
  if (f.flag === 'ahead' && !r.ahead) return false;
  if (f.flag === 'dnc' && !r.doNotContact) return false;
  if (f.flag === 'flagged' && !r.riskCount) return false;
  if (f.flag === 'scored' && r.score === null) return false;
  if (f.flag === 'unscored' && r.score !== null) return false;
  if (f.spv === 'open' && r.spv.stance === 'does-not') return false;
  if (f.spv === 'does' && r.spv.stance !== 'does') return false;
  if (f.spv === 'unknown' && r.spv.stance !== 'unknown') return false;
  if (f.spv === 'not' && r.spv.stance !== 'does-not') return false;
  return true;
}

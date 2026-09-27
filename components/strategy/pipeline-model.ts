import { groupLps } from '@/lib/lp-groups';

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
  people: Array<{ id: string; name: string; role: string }>;
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

export type SortKey = 'score' | 'priority' | 'name' | 'vehicle' | 'owner' | 'status' | 'where' | 'capacity' | 'route' | 'meetings' | 'touch' | 'read' | 'ladder';
export const SORT_KEYS: SortKey[] = ['score','priority','name','vehicle','owner','status','where','capacity','route','meetings','touch','read','ladder'];
/** Keys whose natural first click is biggest first. */
export const numeric = new Set<SortKey>(['score','priority','capacity','route','meetings','touch','ladder','read','where']);
export const STATUS_ORDER: Status[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed', 'passed'];
const READ_ORDER: Record<string, number> = { 'Very interested': 3, Interested: 2, 'Not very interested': 1 };
const MONEY_ORDER: Record<string, number> = { Closed: 5, Hard: 4, Signed: 3, Soft: 2, Withdrawn: 0 };

/** The name that leads an LP's row (issue 0013): the organisation's when it is the LP we're targeting. */
export const lead = (r: PipelineRow) => (r.orgFirst && r.org ? r.org : r.name);
/** The other name, when there is one: the person under an organisation, or the organisation under a person. */
export const second = (r: PipelineRow) => (r.org && r.org !== r.name ? (r.orgFirst ? r.name : r.org) : null);
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
      default: return r[key];
    }
  };
  const av = value(a), bv = value(b);
  // Missing evidence stays at the bottom in either direction: unscored is not a zero.
  if (av === null || bv === null) return av === bv ? lead(a).localeCompare(lead(b)) || a.id.localeCompare(b.id) : av === null ? 1 : -1;
  const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
  return order * dir || lead(a).localeCompare(lead(b)) || a.id.localeCompare(b.id);
}

export interface Group { id: string; org: string | null; people: PipelineRow[] }

/**
 * Identity, not a matching display name, determines an organisation group. Never merge vehicles.
 * A group sorts by its best member in the chosen order; every person keeps their own row.
 */
export function groupRows(rows: PipelineRow[], key: SortKey, dir: 1 | -1, universe: PipelineRow[] = rows): Group[] {
  return groupLps(rows, r => r, (a, b) => compareRows(a, b, key, dir), universe);
}

/**
 * An organisation's own row, when several of its people are pursued and it has no pursuit of its
 * own (issue 0092): ranked like any LP, from its people. The score is its best person's, and says
 * so; routes and meetings add up; the last touch and their read are the latest and warmest; the
 * evidence is the furthest any of them has got, named. Nothing here is recorded anywhere: it is a
 * reading of the rows beneath it, and each person keeps their own status, evidence and actions.
 */
export interface OrgSummary {
  lead: PipelineRow;
  org: string;
  count: number;
  score: number | null;
  scoreFrom: string | null;
  status: Status;
  owners: string[];
  capacity: string | null;
  route: number | null;
  meetings: number;
  lastMeeting: string | null;
  lastTouch: string | null;
  read: string | null;
  furthest: PipelineRow;
  money: { state: string; amount: number; from: number } | null;
  doNotContact: boolean;
}
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
export function orgSummary(people: PipelineRow[]): OrgSummary {
  const byScore = [...people].sort((a, b) => compareRows(a, b, 'score', -1));
  const lead = byScore[0]!;
  const withCap = people.filter((p) => p.capacitySort !== null).sort((a, b) => b.capacitySort! - a.capacitySort!);
  const routes = people.filter((p) => p.route !== null);
  const reads = people.map(theirRead).filter((x): x is string => Boolean(x)).sort((a, b) => (READ_ORDER[b] ?? 0) - (READ_ORDER[a] ?? 0));
  const monies = people.flatMap((p) => (p.money ? [p.money] : []));
  return {
    lead,
    org: lead.org ?? lead.name,
    count: people.length,
    score: lead.score,
    scoreFrom: lead.score === null ? null : lead.name,
    status: people.reduce((s, p) => (STATUS_ORDER.indexOf(p.status) > STATUS_ORDER.indexOf(s) && p.status !== 'passed' ? p.status : s), people[0]!.status),
    owners: [...new Set(people.map((p) => p.owner))],
    capacity: withCap[0]?.capacity ?? null,
    route: routes.length ? routes.reduce((n, p) => n + p.route!, 0) : null,
    meetings: people.reduce((n, p) => n + p.meetings, 0),
    lastMeeting: people.reduce<string | null>((d, p) => later(d, p.lastMeeting), null),
    lastTouch: people.reduce<string | null>((d, p) => later(d, p.lastTouch), null),
    read: reads[0] ?? null,
    furthest: people.reduce((f, p) => (p.rung > f.rung ? p : f), people[0]!),
    // A group must never label mixed soft/hard amounts with its furthest close state.
    // The children still show each amount; summarize only one consistent track and state.
    money: monies.length && new Set(monies.map(m => `${m.state}:${m.hard}`)).size === 1
      ? { state: monies.reduce((s, m) => ((MONEY_ORDER[m.state] ?? 0) > (MONEY_ORDER[s] ?? 0) ? m.state : s), monies[0]!.state), amount: monies.reduce((n, m) => n + m.amount, 0), from: monies.length }
      : null,
    doNotContact: people.some((p) => p.doNotContact),
  };
}

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
}
export const EMPTY: Filters = { q: '', owner: '', vehicle: '', meetings: 'any', touch: 'any', read: 'any', money: 'any', flag: 'any' };
export const CHOICES = {
  meetings: [['any', 'Any'], ['some', 'Has met'], ['none', 'Never met']],
  touch: [['any', 'Any'], ['recent', 'Last 30 days'], ['stale', 'Over 90 days'], ['waiting', 'Waiting on them'], ['none', 'Never']],
  read: [['any', 'Any'], ['very', 'Very interested'], ['interested', 'Interested'], ['not', 'Not very'], ['none', 'No read']],
  money: [['any', 'Any'], ['soft', 'Soft'], ['signed', 'Signed'], ['hard', 'Hard or closed'], ['none', 'No amount']],
  flag: [['any', 'Any'], ['scored', 'Scored'], ['unscored', 'Unscored'], ['flagged', 'Has flags'], ['ahead', 'Met, status behind'], ['dnc', 'Do not contact']],
} as const satisfies Partial<Record<keyof Filters, ReadonlyArray<readonly [string, string]>>>;
export const FILTER_LABEL: Record<keyof typeof CHOICES, string> = { meetings: 'Meetings', touch: 'Last touch', read: 'Their read', money: 'Money', flag: 'Flags' };

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
  return `${r.name} ${r.org ?? ''} ${r.headline ?? ''} ${r.owner} ${r.vehicle} ${r.said ?? ''} ${r.next ?? ''} ${r.ended ?? ''} ${r.capacity ?? ''} ${r.people.map((p) => p.name).join(' ')}`.toLowerCase();
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
  return true;
}

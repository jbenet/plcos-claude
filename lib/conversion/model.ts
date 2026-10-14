/**
 * Outreach conversion (docs/33, Juan, 14 Oct 2026): "need a tool to understand how outreach is converting per
 * vehicle … what good graphs can show us what's working / not working."
 *
 * Pure: the facts in, the charts' numbers out. Each LP's steps are dated by evidence — a mail, a meeting, an
 * amount — and the status audit log fills in only where the evidence is silent, because a status read from
 * Affinity carries no date of change (docs/17: a status is our plan, the evidence is what happened).
 */
import type { PursuitStatus } from '@/modules/strategy/client';

export const STEPS = ['reached', 'replied', 'met', 'indicated', 'committed'] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABEL: Record<Step, string> = {
  reached: 'Reached', replied: 'Replied', met: 'Met', indicated: 'Indicated', committed: 'Committed',
};
export const STEP_MEANS: Record<Step, string> = {
  reached: 'Our first mail, call, intro ask or meeting with them about this raise.',
  replied: 'Their first message, call or meeting after that.',
  met: 'The first meeting or call held.',
  indicated: 'A soft amount on file.',
  committed: 'Status Committed, or a hard amount.',
};

/** Something that happened with an LP, from touchpoints or the comms trace. */
export interface Touch {
  at: Date;
  kind: 'mail' | 'meeting' | 'call' | 'intro' | 'message';
  /** ours: we reached out; theirs: they wrote; both: a meeting or call. */
  direction: 'ours' | 'theirs' | 'both';
  /** Who on our side, when known. */
  by: string | null;
}

export interface Transition { at: Date; from: PursuitStatus; to: PursuitStatus }

/** One pursuit on the vehicle, with the segments it is counted under. */
export interface PursuitFacts {
  pursuitId: string;
  name: string;
  status: PursuitStatus;
  statusSetAt: Date | null;
  passedBy: string | null;
  nextStepOn: Date | null;
  touches: Touch[];
  transitions: Transition[];
  /** The earliest soft amount on file, and its total. */
  softAt: Date | null;
  soft: number;
  hardAt: Date | null;
  hard: number;
  /** Segment key -> value, from the LP stats facts (type, check, score, fit, tier, source, owner). */
  segments: Record<string, string>;
}

export interface Milestones {
  dates: Partial<Record<Step, Date>>;
  /** Steps dated only by a later step or by a status change, not by their own evidence. */
  inferred: Step[];
  wayIn: WayIn | null;
  sender: string | null;
  passedAt: Date | null;
  lastTouch: Date | null;
  lastOurs: Date | null;
}

export const WAY_IN = ['intro', 'direct', 'inbound'] as const;
export type WayIn = (typeof WAY_IN)[number];
export const WAY_IN_LABEL: Record<WayIn, string> = { intro: 'Warm intro', direct: 'We wrote directly', inbound: 'They came to us' };

const RANK: Record<PursuitStatus, number> = { new: 0, sourcing: 0, selected: 0, connecting: 1, discussing: 2, committed: 4, passed: -1 };
const min = (a: Date | undefined, b: Date | null | undefined) => (!b ? a : !a || b < a ? b : a);

/** The dated steps of one pursuit. */
export function milestonesOf(p: PursuitFacts): Milestones {
  const touches = [...p.touches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const own: Partial<Record<Step, Date>> = {};
  const first = touches[0];
  own.reached = first?.at;
  for (const t of touches) {
    // An inbound first message counts as both reaching and replying: they opened the conversation.
    if (!own.replied && t.direction !== 'ours') own.replied = t.at;
    if (!own.met && (t.kind === 'meeting' || t.kind === 'call') && t.direction !== 'ours') own.met = t.at;
  }
  own.indicated = p.softAt ?? undefined;
  own.committed = p.hardAt ?? undefined;
  // The status log, where the evidence is silent: the first move into each status.
  const fromStatus: Partial<Record<Step, Date>> = {};
  for (const t of [...p.transitions].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const r = RANK[t.to];
    if (r >= 1) fromStatus.reached = min(fromStatus.reached, t.at);
    if (r >= 2) fromStatus.replied = min(fromStatus.replied, t.at);
    if (r >= 4) fromStatus.committed = min(fromStatus.committed, t.at);
  }
  // A status with no move on file (set from Affinity, or before the log): dated by when it was set, if ever.
  if (p.statusSetAt) {
    const r = RANK[p.status];
    if (r >= 1) fromStatus.reached = fromStatus.reached ?? p.statusSetAt;
    if (r >= 2) fromStatus.replied = fromStatus.replied ?? p.statusSetAt;
    if (r >= 4) fromStatus.committed = fromStatus.committed ?? p.statusSetAt;
  }
  const dates: Partial<Record<Step, Date>> = {};
  const inferred: Step[] = [];
  for (const s of STEPS) {
    if (own[s]) dates[s] = own[s];
    else if (fromStatus[s]) { dates[s] = fromStatus[s]; inferred.push(s); }
  }
  if (p.status === 'committed' && !dates.committed) { dates.committed = p.statusSetAt ?? undefined; if (dates.committed) inferred.push('committed'); }
  // A later step implies the earlier ones: dated no later than it, and marked inferred when that is all we have.
  // Met and indicated are not implied by a later step (someone can commit without a meeting on file).
  for (let i = STEPS.length - 1; i > 0; i--) {
    const later = dates[STEPS[i]!];
    if (!later) continue;
    for (const s of ['reached', 'replied'] as const) {
      if (STEPS.indexOf(s) >= i) continue;
      if (!dates[s] || dates[s]! > later) { if (!dates[s]) inferred.push(s); dates[s] = later; }
    }
  }
  const before = (d: Date | undefined) => touches.filter((t) => !d || t.at <= d);
  const opening = before(dates.replied);
  const wayIn: WayIn | null = !dates.reached ? null
    : opening.some((t) => t.kind === 'intro') ? 'intro'
    : first && first.direction === 'theirs' ? 'inbound'
    : first ? 'direct' : null;
  const sender = touches.find((t) => t.direction === 'ours' && t.by)?.by ?? first?.by ?? null;
  const ours = touches.filter((t) => t.direction !== 'theirs');
  return {
    dates, inferred: [...new Set(inferred)], wayIn, sender,
    passedAt: p.status === 'passed' ? p.statusSetAt : null,
    lastTouch: touches.at(-1)?.at ?? null,
    lastOurs: ours.at(-1)?.at ?? null,
  };
}

// ── The charts ──────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Wilson score interval at 95%: honest for small n, never outside 0–1. */
export function wilson(k: number, n: number): { lo: number; hi: number } | null {
  if (n <= 0) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - w) / d), hi: Math.min(1, (c + w) / d) };
}

/** GUESS: below this many LPs a rate is noise; the count shows, the rate does not. */
export const MIN_FOR_RATE = 10;

export interface FunnelStep { step: Step; n: number; inferred: number; fromPrev: number | null; medianDays: number | null; passed: number }

export interface Row { p: PursuitFacts; m: Milestones }

export function funnel(rows: Row[]): FunnelStep[] {
  return STEPS.map((step, i) => {
    const at = rows.filter((r) => r.m.dates[step]);
    const prev = i ? STEPS[i - 1]! : null;
    // Of those at the step before, the share that also reached this one: a soft amount can arrive without a
    // meeting on file, so a step's own count is not a subset of the one before it.
    const prevN = prev ? rows.filter((r) => r.m.dates[prev]).length : null;
    const went = prev ? at.filter((r) => r.m.dates[prev]).length : 0;
    const gaps = prev ? at.flatMap((r) => {
      const a = r.m.dates[prev], b = r.m.dates[step];
      return a && b && !r.m.inferred.includes(step) && !r.m.inferred.includes(prev) ? [Math.max(0, days(a, b))] : [];
    }) : [];
    // Who passed after this step and before the next: the drop-off that was decided, not silence.
    const next = STEPS[i + 1];
    const passed = at.filter((r) => r.p.status === 'passed' && (!next || !r.m.dates[next])).length;
    return { step, n: at.length, inferred: at.filter((r) => r.m.inferred.includes(step)).length,
      fromPrev: prevN ? went / prevN : null, medianDays: median(gaps), passed };
  });
}

/** Monday 00:00 UTC of the week holding `d`. */
export function weekOf(d: Date): Date {
  const w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  w.setUTCDate(w.getUTCDate() - ((w.getUTCDay() + 6) % 7));
  return w;
}

export interface Cohort { week: Date; n: number; replied: number; met: number; committed: number; passed: number; ageDays: number }

/** LPs first reached each week, and how far each week's LPs have got by now. */
export function cohorts(rows: Row[], now: Date, weeks = 12): Cohort[] {
  const start = weekOf(new Date(now.getTime() - (weeks - 1) * 7 * DAY));
  const out: Cohort[] = [];
  for (let i = 0; i < weeks; i++) {
    const week = new Date(start.getTime() + i * 7 * DAY);
    const end = new Date(week.getTime() + 7 * DAY);
    const at = rows.filter((r) => r.m.dates.reached && r.m.dates.reached >= week && r.m.dates.reached < end);
    out.push({ week, n: at.length,
      replied: at.filter((r) => r.m.dates.replied).length,
      met: at.filter((r) => r.m.dates.met).length,
      committed: at.filter((r) => r.m.dates.committed).length,
      passed: at.filter((r) => r.p.status === 'passed').length,
      ageDays: Math.max(0, Math.floor(days(week, now))) });
  }
  return out;
}

export interface Segment { value: string; label: string; n: number; replied: number; met: number; rate: number | null; metRate: number | null; ci: { lo: number; hi: number } | null }
export interface SegmentPanel { key: string; title: string; segments: Segment[] }

/** Reply and meeting rate among the LPs reached, by one dimension. */
export function segmentPanel(rows: Row[], key: string, title: string, of: (r: Row) => string | null,
  label: (v: string) => string, order: readonly string[] = []): SegmentPanel {
  const reached = rows.filter((r) => r.m.dates.reached);
  const groups = new Map<string, Row[]>();
  for (const r of reached) {
    const v = of(r) ?? 'unknown';
    const g = groups.get(v);
    if (g) g.push(r); else groups.set(v, [r]);
  }
  const segments = [...groups].map(([value, g]) => {
    const replied = g.filter((r) => r.m.dates.replied).length;
    const met = g.filter((r) => r.m.dates.met).length;
    const enough = g.length >= MIN_FOR_RATE;
    return { value, label: label(value), n: g.length, replied, met,
      rate: enough ? replied / g.length : null, metRate: enough ? met / g.length : null,
      ci: enough ? wilson(replied, g.length) : null };
  });
  const rank = (v: string) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };
  segments.sort((a, b) => (order.length ? rank(a.value) - rank(b.value) : 0) || b.n - a.n || a.label.localeCompare(b.label));
  return { key, title, segments };
}

export const WAIT_BINS = [
  { key: '0', label: '0–7 days', lo: 0, hi: 8 }, { key: '8', label: '8–14 days', lo: 8, hi: 15 },
  { key: '15', label: '15–30 days', lo: 15, hi: 31 }, { key: '31', label: 'Over 30 days', lo: 31, hi: Infinity },
] as const;

export interface Waiting { key: string; label: string; rows: Array<{ pursuitId: string; name: string; days: number }> }

/**
 * Who is stuck. No reply: reached, nothing back, not passed — aged from our last attempt, since a chaser restarts
 * the wait. Met, nothing next: met, not committed or passed, no dated next step — aged from the last touch.
 */
export function waiting(rows: Row[], now: Date): { noReply: Waiting[]; noNext: Waiting[] } {
  const open = rows.filter((r) => r.p.status !== 'passed' && r.p.status !== 'committed');
  const bin = (list: Array<{ pursuitId: string; name: string; days: number }>) => WAIT_BINS.map((b) => ({
    key: b.key, label: b.label,
    rows: list.filter((x) => x.days >= b.lo && x.days < b.hi).sort((a, b2) => b2.days - a.days),
  }));
  const noReply = open.filter((r) => r.m.dates.reached && !r.m.dates.replied).map((r) => ({
    pursuitId: r.p.pursuitId, name: r.p.name,
    days: Math.max(0, Math.floor(days(r.m.lastOurs ?? r.m.dates.reached!, now))),
  }));
  const noNext = open.filter((r) => r.m.dates.met && !r.m.dates.committed && !(r.p.nextStepOn && r.p.nextStepOn >= weekOf(now)))
    .map((r) => ({ pursuitId: r.p.pursuitId, name: r.p.name,
      days: Math.max(0, Math.floor(days(r.m.lastTouch ?? r.m.dates.met!, now))) }));
  return { noReply: bin(noReply), noNext: bin(noNext) };
}

export interface Week { week: Date; sent: number; replies: number; meetings: number; forward: number }

/** Per week: what we sent, what came back, meetings held, and LPs moved forward a status. */
export function throughput(rows: Row[], now: Date, weeks = 12): Week[] {
  const start = weekOf(new Date(now.getTime() - (weeks - 1) * 7 * DAY));
  const out: Week[] = Array.from({ length: weeks }, (_, i) => ({ week: new Date(start.getTime() + i * 7 * DAY), sent: 0, replies: 0, meetings: 0, forward: 0 }));
  const slot = (d: Date) => { const i = Math.floor((weekOf(d).getTime() - start.getTime()) / (7 * DAY)); return i >= 0 && i < weeks ? out[i] : undefined; };
  for (const { p } of rows) {
    for (const t of p.touches) {
      const w = slot(t.at);
      if (!w) continue;
      if (t.kind === 'meeting' || t.kind === 'call') { if (t.direction !== 'ours') w.meetings++; }
      else if (t.direction === 'ours') w.sent++;
      else w.replies++;
    }
    for (const t of p.transitions) {
      const w = slot(t.at);
      if (w && RANK[t.to] > RANK[t.from] && RANK[t.to] >= 1) w.forward++;
    }
  }
  return out;
}

export interface MoneyPoint { at: Date; hard: number; soft: number }

/** Hard to date and soft to date, each its own running sum: never added together (rule 1). */
export function moneyOverTime(rows: Row[]): MoneyPoint[] {
  const events = rows.flatMap(({ p }) => [
    ...(p.hardAt && p.hard ? [{ at: p.hardAt, hard: p.hard, soft: 0 }] : []),
    ...(p.softAt && p.soft ? [{ at: p.softAt, hard: 0, soft: p.soft }] : []),
  ]).sort((a, b) => a.at.getTime() - b.at.getTime());
  let hard = 0, soft = 0;
  return events.map((e) => ({ at: e.at, hard: (hard += e.hard), soft: (soft += e.soft) }));
}

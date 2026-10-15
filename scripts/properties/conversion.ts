/** Outreach conversion (docs/33): steps dated by evidence, status only where it is silent; rates honest at small n. Invented LPs only. */
import {
  cohorts, funnel, milestonesOf, moneyOverTime, segmentPanel, throughput, waiting, weekOf, wilson,
  MIN_FOR_RATE, type PursuitFacts, type Row, type Touch,
} from '../../lib/conversion/model';
import { engagement, pageDrop, readFunnel, readNoFollowUp, readers, type Visit } from '../../lib/conversion/dataroom';
import type { Check } from './harness';

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const base = (over: Partial<PursuitFacts>): PursuitFacts => ({
  pursuitId: over.pursuitId ?? 'p', name: 'Invented LP', status: 'selected', statusSetAt: null, passedBy: null, nextStepOn: null,
  touches: [], transitions: [], softAt: null, soft: 0, hardAt: null, hard: 0, segments: {}, ...over,
});
const t = (at: string, kind: Touch['kind'], direction: Touch['direction'], by: string | null = null): Touch => ({ at: D(at), kind, direction, by });

export function conversionProperties(check: Check) {
  // Evidence dates each step.
  const a = milestonesOf(base({ touches: [t('2026-10-01', 'mail', 'ours', 'Ana'), t('2026-10-03', 'mail', 'theirs'), t('2026-10-08', 'meeting', 'both')] }));
  check('conversion.evidence-dates', a.dates.reached?.getTime() === D('2026-10-01').getTime() && a.dates.replied?.getTime() === D('2026-10-03').getTime()
    && a.dates.met?.getTime() === D('2026-10-08').getTime() && a.inferred.length === 0 && a.wayIn === 'direct' && a.sender === 'Ana',
  JSON.stringify(a));

  // A status move fills in only where evidence is silent, and is marked inferred.
  const b = milestonesOf(base({ status: 'discussing', transitions: [{ at: D('2026-10-05'), from: 'selected', to: 'discussing' }],
    touches: [t('2026-10-02', 'mail', 'ours')] }));
  check('conversion.status-fills-gaps', b.dates.reached?.getTime() === D('2026-10-02').getTime() && b.dates.replied?.getTime() === D('2026-10-05').getTime()
    && b.inferred.includes('replied') && !b.inferred.includes('reached') && !b.dates.met, JSON.stringify(b));

  // A later step implies reached and replied, never met; a hard amount is committed.
  const c = milestonesOf(base({ status: 'committed', hardAt: D('2026-09-20'), hard: 500_000 }));
  check('conversion.later-implies-earlier', Boolean(c.dates.committed && c.dates.reached && c.dates.replied && !c.dates.met
    && c.dates.reached <= c.dates.committed), JSON.stringify(c));

  // They wrote first: inbound, and it is a reply. An intro before their reply: a warm intro.
  const d = milestonesOf(base({ touches: [t('2026-10-01', 'mail', 'theirs')] }));
  const e = milestonesOf(base({ touches: [t('2026-10-01', 'intro', 'ours'), t('2026-10-04', 'mail', 'theirs')] }));
  check('conversion.way-in', d.wayIn === 'inbound' && Boolean(d.dates.replied) && e.wayIn === 'intro', `${d.wayIn} ${e.wayIn}`);

  // Nothing ever happened: no steps, not in the funnel.
  const f = milestonesOf(base({ status: 'new' }));
  check('conversion.untouched', Object.keys(f.dates).length === 0 && f.wayIn === null, JSON.stringify(f));

  // The funnel never grows down the steps for replied and committed counts, and shares are of the step before.
  const rows: Row[] = [];
  for (let i = 0; i < 40; i++) {
    const touches = [t('2026-09-01', 'mail', 'ours', i % 2 ? 'Ana' : 'Ben')];
    if (i % 2 === 0) touches.push(t('2026-09-05', 'mail', 'theirs'));
    if (i % 4 === 0) touches.push(t('2026-09-12', 'meeting', 'both'));
    const p = base({ pursuitId: `p${i}`, status: i === 0 ? 'committed' : i % 9 === 0 ? 'passed' : 'connecting', touches,
      hardAt: i === 0 ? D('2026-09-30') : null, hard: i === 0 ? 1_000_000 : 0, softAt: i < 6 && i % 2 === 0 ? D('2026-09-20') : null, soft: i < 6 && i % 2 === 0 ? 250_000 : 0,
      segments: { type: i % 2 ? 'family_office' : 'individual' } });
    rows.push({ p, m: milestonesOf(p) });
  }
  const steps = funnel(rows);
  check('conversion.funnel', steps[0]!.n === 40 && steps[1]!.n === 20 && steps[1]!.fromPrev === 0.5 && steps[2]!.n === 10
    && steps[1]!.medianDays === 4 && steps[4]!.n === 1, JSON.stringify(steps));

  // Segments: rate only at n ≥ MIN_FOR_RATE, interval inside 0–1 and around the rate.
  const panel = segmentPanel(rows, 'sender', 'Who', (r) => r.m.sender, (v) => v);
  const ana = panel.segments.find((g) => g.value === 'Ana')!;
  check('conversion.segment-rate', ana.n === 20 && ana.rate === 0 && Boolean(ana.ci && ana.ci.lo === 0 && ana.ci.hi > 0 && ana.ci.hi < 0.2),
    JSON.stringify(ana));
  const small = segmentPanel(rows.slice(0, MIN_FOR_RATE - 1), 'x', 'x', () => 'one', (v) => v);
  check('conversion.small-n-no-rate', small.segments[0]!.rate === null && small.segments[0]!.ci === null, JSON.stringify(small));
  const w = wilson(5, 10)!;
  check('conversion.wilson', w.lo > 0.2 && w.lo < 0.5 && w.hi > 0.5 && w.hi < 0.8 && wilson(0, 0) === null, JSON.stringify(w));

  // Cohorts and weeks land on Mondays and count each LP once.
  const now = D('2026-10-14');
  const cs = cohorts(rows, now, 8);
  check('conversion.cohorts', cs.every((x) => x.week.getUTCDay() === 1) && cs.reduce((n, x) => n + x.n, 0) === 40
    && weekOf(D('2026-09-01')).toISOString().startsWith('2026-08-31'), JSON.stringify(cs.map((x) => x.n)));
  const wk = throughput(rows, now, 8);
  check('conversion.throughput', wk.reduce((n, x) => n + x.sent, 0) === 40 && wk.reduce((n, x) => n + x.replies, 0) === 20
    && wk.reduce((n, x) => n + x.meetings, 0) === 10, JSON.stringify(wk));

  // Waiting: no reply excludes passed and committed; aged from our last attempt.
  const wt = waiting(rows, now);
  const noReply = wt.noReply.flatMap((b) => b.rows);
  check('conversion.waiting', noReply.length === rows.filter((r) => !r.m.dates.replied && r.p.status !== 'passed' && r.p.status !== 'committed').length
    && noReply.every((r) => r.days === 43), `${noReply.length}`);

  // Money: hard and soft are separate running sums, never added (rule 1).
  const m = moneyOverTime(rows);
  const last = m.at(-1)!;
  check('conversion.money-apart', last.hard === 1_000_000 && last.soft === 750_000, JSON.stringify(last));
}

/** Dataroom views (docs/33 charts 7–10): visits join LPs by entity, depth and returns count once per LP, page drop-off is a share. */
export function dataroomProperties(check: Check) {
  const now = D('2026-10-14');
  const mk = (i: number, touches: Touch[], status: PursuitFacts['status'] = 'connecting'): Row => {
    const p = base({ pursuitId: `p${i}`, name: `Invented ${i}`, status, touches });
    return { p, m: milestonesOf(p) };
  };
  const rows = [
    mk(0, [t('2026-10-01', 'mail', 'ours')]),
    mk(1, [t('2026-10-01', 'mail', 'ours'), t('2026-10-03', 'meeting', 'both')]),
    mk(2, [t('2026-10-01', 'mail', 'ours'), t('2026-10-12', 'mail', 'ours')]),
    mk(3, [], 'passed'),
  ];
  const v = (id: string, entity: string | null, at: string, sec: number, pct: number | null, pages: Record<string, number> | null = null): Visit => ({
    visitId: id, startedAt: D(at), durationSec: sec, percentViewed: pct, pageCount: pages ? 3 : null, pageSeconds: pages,
    entityId: entity, documentId: 'd1', documentTitle: 'Invented deck' });
  const visits = [
    v('a', 'e0', '2026-10-05', 60, 30, { '1': 20, '2': 10 }),
    v('b', 'e0', '2026-10-09', 900, 80, { '1': 5, '2': 5, '3': 5 }),
    v('c', 'e1', '2026-10-04', 100, null, { '1': 9 }),
    v('d', 'e2', '2026-10-10', 30, 10),
    v('e', null, '2026-10-10', 30, 10),
    v('f', 'e3', '2026-10-11', 30, 10),
  ];
  const entities = new Map([['e0', 'p0'], ['e1', 'p1'], ['e2', 'p2'], ['e3', 'p3']]);
  const rd = readers(rows, visits, entities);
  const r0 = rd.readers.get('p0')!;
  check('dataroom.readers', rd.unmatched === 1 && rd.readers.size === 4 && r0.visits === 2 && r0.days === 2 && r0.seconds === 960 && r0.furthest === 80,
    JSON.stringify([...rd.readers.values()]));
  const f = readFunnel(rows, rd.readers);
  check('dataroom.funnel', f.opened === 4 && f.half === 1 && f.back === 1 && f.unknownDepth === 1 && f.reached === 4, JSON.stringify(f));
  const bands = engagement(rows, rd.readers);
  check('dataroom.engagement-adds-up', bands.reduce((n, b) => n + b.n, 0) === f.reached && bands.every((b) => b.rate === null), JSON.stringify(bands));
  const drop = pageDrop(visits)[0]!;
  check('dataroom.page-drop', drop.viewers === 3 && drop.pages.length === 3 && drop.pages[0]!.share === 1 && Math.abs(drop.pages[1]!.share - 2 / 3) < 1e-9
    && Math.abs(drop.pages[2]!.share - 1 / 3) < 1e-9, JSON.stringify(drop));
  // p0 read on 9 Oct after our last mail (1 Oct): follow up. p2 read 10 Oct, we wrote 12 Oct: done. p3 passed: not listed.
  const nf = readNoFollowUp(rows, rd.readers, now);
  check('dataroom.no-follow-up', nf.map((x) => x.pursuitId).sort().join() === 'p0,p1', JSON.stringify(nf));
}

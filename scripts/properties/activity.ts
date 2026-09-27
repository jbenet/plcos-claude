/**
 * Developer → Connectors activity (issue 0103). The charts are a picture of lib/activity/view.ts,
 * so these check the view: stacking conserves every figure, estimates stay estimates, buckets tile
 * the range, and the demo fixture covers what the page promises to show.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Check } from './harness';
import type { ActivityData, ActivityPoint } from '../../lib/activity/types';
import { aggregate, tidyBasis } from '../../lib/activity/model';
import {
  ALL_SOURCES, BURST_RATIO, GROUPS, MAX_BASIS, MAX_NOTE, capText, sourceNotes, METRICS, RANGES, addDays, buildView, daysBetween, estimateStyle, isBurst, makeBuckets,
  niceMax, partSum, rangeDays, stack, type BucketSize,
} from '../../lib/activity/view';

/** A small invented history with every awkward case: nulls, mixed estimates, many segments. */
function synthetic(): ActivityData {
  const points: ActivityPoint[] = [];
  let seed = 7;
  const r = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const to = '2026-03-15';
  for (let d = 0; d < 120; d++) {
    const day = addDays(to, -d);
    for (const source of ALL_SOURCES) {
      if (r() < 0.3) continue;
      const segs = source === 'agents' ? ['a', 'b', 'c', 'd', 'e', 'f', 'g'] : source === 'affinity' ? ['lists', 'notes'] : [null];
      for (const segment of segs) {
        if (r() < 0.2) continue;
        const v = () => (r() < 0.1 ? null : Math.round(r() * 1000));
        points.push({ day, source, segment, requests: v(), bytesIn: v(), bytesOut: v(), records: v(), estimated: r() < 0.4, basis: 'invented' });
      }
    }
  }
  const origins = points.filter((p) => p.source === 'fetch' && p.requests)
    .map((p, i) => ({ day: p.day, origin: `host${i % 6}.example`, requests: p.requests!, estimated: p.estimated }));
  return { points, origins, sources: [], asOf: `${to}T12:00:00Z` };
}

export async function activityProperties(check: Check) {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/activity.json'), 'utf8')) as ActivityData;
  const cases: Array<[string, ActivityData]> = [['fixture', fixture], ['synthetic', synthetic()]];

  // 1. Conservation: every bucket's stacked parts sum to the points it covers, per metric,
  //    with actual and estimated kept apart, for every group, range and bar size.
  let combos = 0;
  const bad: string[] = [];
  for (const [name, data] of cases) {
    for (const g of GROUPS) for (const range of RANGES) for (const size of ['day', 'week'] as BucketSize[]) {
      combos++;
      const v = buildView(data, { group: g.id, range, size });
      const { from, to } = rangeDays(data, range);
      const pts = data.points.filter((p) => g.sources.includes(p.source) && p.day >= from && p.day <= to);
      for (const m of METRICS) {
        const want = { actual: 0, estimated: 0, unknown: 0 };
        for (const p of pts) {
          const x = p[m];
          if (x === null) want.unknown++; else if (p.estimated) want.estimated += x; else want.actual += x;
        }
        const got = { actual: 0, estimated: 0, unknown: 0 };
        for (const b of v.buckets) {
          for (const part of b.values[m]) { got.actual += part.actual; got.estimated += part.estimated; }
          got.unknown += b.unknown[m];
          // The stacked bar's top is its sum; slabs touch, and none is empty.
          const slabs = stack(b.values[m]);
          const top = slabs.at(-1)?.y1 ?? 0;
          const touching = slabs.every((sl, i) => sl.y1 > sl.y0 && (i === 0 ? sl.y0 === 0 : sl.y0 === slabs[i - 1]!.y1));
          if (Math.abs(top - partSum(b.values[m])) > 1e-6 || !touching) bad.push(`${name} ${g.id} ${range} ${size} ${m} ${b.start}: stack`);
        }
        if (got.actual !== want.actual || got.estimated !== want.estimated || got.unknown !== want.unknown) bad.push(`${name} ${g.id} ${range} ${size} ${m}: sums`);
        const t = v.totals[m];
        if (t.actual !== want.actual || t.estimated !== want.estimated || t.unknown !== want.unknown) bad.push(`${name} ${g.id} ${range} ${size} ${m}: totals`);
      }
      if (v.series.length > (g.id === 'all' ? 7 : 5)) bad.push(`${name} ${g.id}: ${v.series.length} series`);
      if (g.id === 'search') {
        const want = data.origins.filter((o) => o.day >= from && o.day <= to).reduce((n, o) => n + o.requests, 0);
        const got = (v.origins ?? []).reduce((n, o) => n + o.actual + o.estimated, 0);
        const perBucket = (v.origins ?? []).every((o) => o.perBucket.reduce((a, b) => a + b, 0) === o.actual + o.estimated);
        if (want !== got || !perBucket) bad.push(`${name} ${range} ${size}: origins ${got} of ${want}`);
      } else if (v.origins !== null) bad.push(`${name} ${g.id}: origins outside Search`);
    }
  }
  check('Connectors activity: stacked bars conserve every figure, estimates stay estimates, unknown stays unknown',
    bad.length === 0, bad.length ? bad.slice(0, 4).join('; ') : `${combos} group × range × bar-size views over the fixture and an invented history with nulls`);

  // 2. An estimate is drawn differently from an actual, and the difference is not colour alone.
  const e = estimateStyle(true), a = estimateStyle(false);
  check('Connectors activity: an estimate is drawn lighter and dashed, an actual solid',
    e.fillOpacity < a.fillOpacity && a.fillOpacity === 1 && !!e.strokeDasharray && !a.strokeDasharray && e.word === 'estimate' && a.word === 'actual',
    `estimate opacity ${e.fillOpacity} dash ${e.strokeDasharray}; actual opacity ${a.fillOpacity}, no dash`);

  // 3. Buckets tile the range: no gap, no overlap, weeks Monday to Sunday.
  const tiling: string[] = [];
  for (const [from, to] of [['2026-08-29', '2026-09-27'], ['2026-09-21', '2026-09-27'], ['2026-01-01', '2026-03-31'], ['2026-09-27', '2026-09-27']]) {
    for (const size of ['day', 'week'] as BucketSize[]) {
      const bs = makeBuckets(from!, to!, size);
      const days = bs.reduce((n, b) => n + b.days, 0);
      const contiguous = bs.every((b, i) => (i === 0 ? b.start === from : b.start === addDays(bs[i - 1]!.end, 1)) && daysBetween(b.start, b.end) + 1 === b.days);
      const weeks = size === 'day' ? bs.every((b) => b.days === 1)
        : bs.every((b, i) => b.days <= 7 && (i === bs.length - 1 || new Date(`${b.end}T00:00:00Z`).getUTCDay() === 0));
      if (days !== daysBetween(from!, to!) + 1 || bs.at(-1)!.end !== to || !contiguous || !weeks) tiling.push(`${from}..${to} ${size}`);
    }
  }
  const nice = [1, 7, 99, 101, 2001, 0.3].every((x) => niceMax(x) >= x && niceMax(x) < x * 10.01);
  check('Connectors activity: day and week buckets tile the range; the top gridline sits at or above the tallest bar',
    tiling.length === 0 && nice, tiling.length ? tiling.join('; ') : 'four ranges, both sizes; niceMax bounds hold');

  // 4. The demo fixture shows what the page promises: 30 days, every source, actuals and estimates.
  const days = new Set(fixture.points.map((p) => p.day));
  const missing = ALL_SOURCES.filter((src) => !fixture.points.some((p) => p.source === src) || !fixture.sources.some((x) => x.id === src));
  const mixed = fixture.points.some((p) => p.estimated) && fixture.points.some((p) => !p.estimated);
  const based = fixture.points.filter((p) => p.estimated).every((p) => !!p.basis);
  check('Connectors activity: the demo fixture covers 30 days, every source, and both actuals and estimates with a basis',
    days.size === 30 && missing.length === 0 && mixed && based && fixture.origins.length > 0,
    `${days.size} days, missing ${missing.join(', ') || 'none'}, mixed ${mixed}, every estimate has a basis ${based}`);

  // 6. Issues 0107–0108: what arrives long and repeated is shown short and once.
  const views = GROUPS.map((g) => buildView(fixture, { group: g.id, range: 'all', size: 'day' }));
  const basisOk = views.every((v) => {
    const labels = v.bases.flatMap((b) => b.label.split(', '));
    return new Set(labels).size === labels.length && new Set(v.bases.map((b) => b.basis)).size === v.bases.length && v.bases.every((b) => {
      const clauses = b.basis.replace(/…$/, '').split('; ').map((c) => c.replace(/\.$/, ''));
      return b.basis.length <= MAX_BASIS && new Set(clauses).size === clauses.length;
    });
  });
  const longest = Math.max(...fixture.points.map((p) => p.basis?.length ?? 0));
  const boiler = [...sourceNotes(fixture.sources).values()].every((n) => n === null);
  const own = sourceNotes([
    { id: 'affinity', label: 'A', state: 'connected', lastAt: null, note: 'Read-only sync, lists and notes. ' + 'More detail that nobody needs here. '.repeat(10) },
    { id: 'dakota', label: 'D', state: 'read-only', lastAt: null, note: 'Bulk pull' },
    { id: 'intake', label: 'I', state: 'files', lastAt: null, note: '' },
  ]);
  const tidy = tidyBasis(Array.from({ length: 40 }, () => 'One fetch per cited page; citation may come from search.').join('; '));
  const merged = aggregate(Array.from({ length: 40 }, () => ({
    day: '2026-09-01', source: 'fetch' as const, segment: null, requests: 1, bytesIn: null, bytesOut: null, records: 1, estimated: true,
    basis: 'One fetch per cited page; citation may come from search. Research date used; retries unknown.',
  })), [], '2026-09-02T00:00:00Z').points;
  check('Connectors 0107–0108: estimate bases are one capped line per source (sources sharing one basis share the line), each clause once; notes are short or absent',
    basisOk && longest > 2000 && boiler && own.get('affinity') === 'Read-only sync, lists and notes' && own.get('dakota') === 'Bulk pull' && own.get('intake') === null
      && capText('x '.repeat(200), MAX_NOTE).length <= MAX_NOTE
      && tidy === 'One fetch per cited page; citation may come from search.'
      && merged.length === 1 && merged[0]!.basis === 'One fetch per cited page; citation may come from search. Research date used; retries unknown.',
    `fixture bases up to ${longest} characters shown as at most ${MAX_BASIS}; boilerplate notes dropped; 40 merges of one basis leave it as written`);

  // 7. Issue 0106: SEC is not a source; its rows are page fetches (EDGAR) and its host stays listed.
  const all = buildView(fixture, { group: 'all', range: 'all', size: 'day' });
  const search = buildView(fixture, { group: 'search', range: 'all', size: 'day' });
  const secReq = fixture.points.filter((p) => p.source === 'sec').reduce((n, p) => n + (p.requests ?? 0), 0);
  const edgarAt = search.series.findIndex((x) => x.label === 'EDGAR');
  const edgarReq = edgarAt < 0 ? -1 : search.buckets.reduce((n, b) => n + b.values.requests[edgarAt]!.actual + b.values.requests[edgarAt]!.estimated, 0);
  check('Connectors 0106: no SEC pill or series; SEC requests are counted once under Search as EDGAR, sec.gov among the hosts',
    !GROUPS.some((g) => (g.id as string) === 'sec') && !all.series.some((x) => x.key === 'sec') && secReq > 0 && edgarReq === secReq
      && (search.origins ?? []).some((o) => o.origin === 'sec.gov'),
    `${secReq} invented SEC requests shown as EDGAR in Search`);

  // 5. A burst is a peak well above the host's usual day, and never flagged with no usual day.
  check(`Connectors activity: a host is flagged for a burst only when its peak is ${BURST_RATIO}× its median day`,
    isBurst({ peak: BURST_RATIO * 10, median: 10 }) && !isBurst({ peak: BURST_RATIO * 10 - 1, median: 10 }) && !isBurst({ peak: 5, median: 0 }),
    `${BURST_RATIO * 10} vs 10 flagged, ${BURST_RATIO * 10 - 1} vs 10 not, no median not`);
}

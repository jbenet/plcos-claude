/** LP stats (27 Sep 2026): counts add up, filters compose, hard and soft never blend. Invented LPs only. */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import {
  CHECK_BANDS, DIMENSIONS, FIT_GROUPS, LP_TYPES, SOURCES, STATUS_ORDER, TIERS,
  bandOfText, computeStats, filterQuery, lpTypeOf, parseFilters, toggle,
  type DimKey, type Filters, type LpFact, type Stats,
} from '../../lib/lp-stats/model';
import { countryOf, regionOf } from '../../lib/lp-stats/geo';
import type { Check } from './harness';

/** A small deterministic generator, so a failure repeats. */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}
const VEHICLES = [{ slug: 'inv-a', name: 'Invented A' }, { slug: 'inv-b', name: 'Invented B' }, { slug: 'inv-c', name: 'Invented C' }];
const COUNTRIES = ['United States', 'United Kingdom', 'Singapore', 'Japan', 'Brazil', 'United Arab Emirates', null];

/** Invented pursuit-level facts: about `units` LPs, some on two or three vehicles. */
export function inventedFacts(units: number, seed = 7): LpFact[] {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const facts: LpFact[] = [];
  for (let i = 0; i < units; i++) {
    const entityId = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const unit = r() < 0.6 ? 'organisation' as const : 'individual' as const;
    const on = VEHICLES.filter((_, j) => j === i % 3 || r() < 0.25);
    for (const v of on) {
      const score = r() < 0.3 ? null : Math.floor(r() * 100);
      facts.push({
        entityId, name: `Invented LP ${i}`, context: unit === 'individual' ? `Invented Firm ${i % 17}` : null, unit,
        pursuits: [{ vehicle: v.slug, id: randomUUID(), status: pick(STATUS_ORDER) }],
        type: unit === 'individual' ? 'individual' : pick(LP_TYPES.filter((t) => t !== 'individual')), typeBasis: 'record',
        check: pick(CHECK_BANDS), checkBasis: 'strategy', checkText: null,
        score, scoreKind: score === null ? null : 'Provisional', fit: pick(FIT_GROUPS),
        country: pick(COUNTRIES), countryBasis: 'research', status: 'new', tier: pick(TIERS), source: pick(SOURCES),
        owner: pick(['Invented Owner One', 'Invented Owner Two', 'Invented Owner Three']), strategy: r() < 0.5,
        research: pick(['profile', 'claims', 'none'] as const), lastTouch: r() < 0.4 ? null : new Date(Date.UTC(2026, 0, 1) + r() * 260 * 864e5).toISOString(),
        openedAt: new Date(Date.UTC(2026, 0, 1) + r() * 200 * 864e5).toISOString(),
        money: r() < 0.3 ? { [v.slug]: { hard: r() < 0.5 ? Math.round(r() * 5e6) : 0, soft: Math.round(r() * 5e6) } } : {},
      });
      facts.at(-1)!.status = facts.at(-1)!.pursuits[0]!.status;
    }
  }
  return facts;
}

const NOW = new Date(Date.UTC(2026, 8, 27));
const none: Filters = { q: '', sel: {}, sort: 'score', page: 1 };
const ids = (s: Stats) => new Set(s.rows.map((x) => x.entityId));
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export async function lpStatsProperties(check: Check, db: Db) {
  const facts = inventedFacts(2000);

  // 1. Counts add up to N per dimension.
  const plain = computeStats(facts, none, VEHICLES, null, NOW);
  const single = plain.panels.filter((p) => !p.dim.multi);
  check('LP stats: with no filter, every panel counts every LP once (its counts add up to N)',
    plain.rows.length === plain.total && plain.total === 2000
      && single.every((p) => p.base === plain.total && p.segments.reduce((t, x) => t + x.count, 0) === plain.total),
    `${single.length} single-valued panels over 2,000 invented LPs on three vehicles; each adds up to ${plain.total}.`);
  let sums = true, bases = true, tried = 0;
  const r = rng(11);
  for (let t = 0; t < 40; t++) {
    let f: Filters = { ...none, q: t % 5 === 0 ? String(Math.floor(r() * 9)) : '' };
    for (let k = 0; k < 1 + (t % 3); k++) {
      const d = DIMENSIONS[Math.floor(r() * DIMENSIONS.length)]!;
      const panel = plain.panels.find((p) => p.dim.key === d.key)!;
      const seg = panel.segments[Math.floor(r() * panel.segments.length)]!;
      f = toggle(f, d.key, seg.value);
    }
    const s = computeStats(facts, f, VEHICLES, null, NOW);
    tried++;
    for (const p of s.panels.filter((x) => !x.dim.multi)) {
      if (p.segments.reduce((t2, x) => t2 + x.count, 0) !== p.base) sums = false;
      if (!f.sel[p.dim.key]?.length && p.base !== s.rows.length) bases = false;
    }
  }
  check('LP stats: under any filters, each panel adds up to its base, and an unfiltered panel’s base is the filtered N',
    sums && bases, `${tried} random filter sets (one to three segments, some with a search): sums ${sums}, bases ${bases}.`);

  // 2. Filters compose: AND across dimensions, OR within one, and the address round-trips.
  const one = (key: DimKey, v: string, from = none) => toggle(from, key, v);
  const a = computeStats(facts, one('type', 'family_office'), VEHICLES, null, NOW);
  const b = computeStats(facts, one('status', 'discussing'), VEHICLES, null, NOW);
  const ab = computeStats(facts, one('status', 'discussing', one('type', 'family_office')), VEHICLES, null, NOW);
  const inter = new Set([...ids(a)].filter((x) => ids(b).has(x)));
  const c1 = computeStats(facts, one('region', 'europe'), VEHICLES, null, NOW);
  const c2 = computeStats(facts, one('region', 'asia_sg'), VEHICLES, null, NOW);
  const c12 = computeStats(facts, one('region', 'asia_sg', one('region', 'europe')), VEHICLES, null, NOW);
  const union = new Set([...ids(c1), ...ids(c2)]);
  const back = computeStats(facts, one('type', 'family_office', one('type', 'family_office')), VEHICLES, null, NOW);
  const f: Filters = { q: 'Invented LP 1', sel: { type: ['family_office', 'foundation'], vehicle: ['inv-b'], touch: ['never'] }, sort: 'name', page: 2 };
  const trip = parseFilters(Object.fromEntries(new URLSearchParams(filterQuery(f).slice(1))));
  const repeated = parseFilters({ type: ['family_office', 'foundation'] });
  check('LP stats: filters compose — AND across dimensions, OR within one, a second press takes a filter off, and the address holds them',
    same(ids(ab), inter) && inter.size > 0 && same(ids(c12), union) && same(ids(back), ids(plain))
      && filterQuery(trip) === filterQuery(f) && trip.q === f.q && trip.page === 2 && trip.sort === 'name' && JSON.stringify(trip.sel.vehicle) === '["inv-b"]' && JSON.stringify(repeated.sel.type) === JSON.stringify(['family_office', 'foundation']),
    `type∧status ${ids(ab).size} = ${inter.size}; Europe∨Singapore ${ids(c12).size} = ${union.size}; toggle twice restores ${ids(plain).size}; ${filterQuery(f)} round-trips.`);

  const onB = computeStats(facts, one('vehicle', 'inv-b'), VEHICLES, null, NOW);
  const vehiclePanel = plain.panels.find((p) => p.dim.key === 'vehicle')!;
  const onBCount = vehiclePanel.segments.find((x) => x.value === 'inv-b')!.count;
  check('LP stats: across vehicles an LP counts once; the vehicle panel counts each vehicle’s own and may add up to more',
    plain.total === new Set(facts.map((x) => x.entityId)).size && onB.rows.length === onBCount
      && vehiclePanel.segments.reduce((t, x) => t + x.count, 0) >= plain.total,
    `${facts.length} pursuits → ${plain.total} LPs; vehicle panel sums to ${vehiclePanel.segments.reduce((t, x) => t + x.count, 0)}; choosing B lists ${onB.rows.length}.`);

  // 3. Hard and soft never blend, and nothing is added across vehicles.
  const byVehicle = (s: Stats, v: string, track: 'hard' | 'soft') => s.rows.reduce((t, x) => t + (x.money[v]?.[track] ?? 0), 0);
  const scoped = computeStats(facts, none, VEHICLES, 'inv-a', NOW);
  const typePanel = scoped.panels.find((p) => p.dim.key === 'type')!;
  const segHard = typePanel.segments.reduce((t, x) => t + (x.money?.hard ?? 0), 0);
  const segSoft = typePanel.segments.reduce((t, x) => t + (x.money?.soft ?? 0), 0);
  const inflated = facts.map((x) => ({ ...x, money: Object.fromEntries(Object.entries(x.money).map(([v, m]) => [v, { hard: m.hard, soft: m.soft * 10 + 1 }])) }));
  const inflatedA = computeStats(inflated, none, VEHICLES, 'inv-a', NOW);
  const inflatedHard = inflatedA.panels.find((p) => p.dim.key === 'type')!.segments.reduce((t, x) => t + (x.money?.hard ?? 0), 0);
  const multi = computeStats(facts, one('vehicle', 'inv-c', one('vehicle', 'inv-a')), VEHICLES, null, NOW);
  check('LP stats: hard and soft stay separate — soft never moves a hard figure — and money shows only for one vehicle',
    scoped.moneyVehicle === 'inv-a' && segHard === byVehicle(scoped, 'inv-a', 'hard') && segSoft === byVehicle(scoped, 'inv-a', 'soft')
      && segHard > 0 && segSoft > 0 && inflatedHard === segHard
      && plain.moneyVehicle === null && plain.panels.every((p) => p.segments.every((x) => x.money === null))
      && multi.moneyVehicle === null && onB.moneyVehicle === 'inv-b',
    `On A: hard ${segHard.toLocaleString('en-US')} and soft ${segSoft.toLocaleString('en-US')}, each equal to its own track; soft ×10 leaves hard unchanged; all vehicles and two vehicles show no money.`);

  // Readings: type, check band and place.
  const t = (x: Partial<Parameters<typeof lpTypeOf>[0]>) => lpTypeOf({ unit: 'organisation', entityType: 'org', dakotaType: null, researchType: null, contactTypes: [], name: 'Invented', ...x });
  check('LP stats: types rest on the strongest evidence, a person in their own capacity is an individual, and a bare name is unknown',
    t({ unit: 'individual', dakotaType: 'Family Office' }).type === 'individual' && t({ entityType: 'family', dakotaType: 'RIA' }).type === 'family_office'
      && t({ dakotaType: 'Multi-Family Office' }).type === 'multi_family_office' && t({ dakotaType: 'Single Family Office' }).type === 'family_office'
      && t({ dakotaType: 'Public Pension Fund' }).type === 'pension_insurance' && t({ researchType: 'fund_lp_program' }).basis === 'research'
      && t({ contactTypes: ['fo_staff'] }).basis === 'contact' && t({ name: 'Invented Foundation' }).basis === 'name'
      && t({ name: 'Invented Capital' }).type === 'unknown',
    'Record, then Dakota, research, a contact’s profile, a name; “Capital” alone says nothing.');
  check('LP stats: check bands read by midpoint, and an open range is never narrowed',
    bandOfText('$250K–1M') === '250k_1m' && bandOfText('$500K–$1M') === '250k_1m' && bandOfText('$1–5M') === '1m_5m' && bandOfText('>$25M') === '5m_plus'
      && bandOfText('<$25K') === 'lt100k' && bandOfText('<$250K') === 'open' && bandOfText('$100K+ (floor)') === 'open' && bandOfText('unknown') === 'unknown',
    '$250K–1M, $500K–$1M, $1–5M, >$25M, <$25K, <$250K, $100K+ (floor), unknown.');
  check('LP stats: places read from their broadest part, two letters only as a US state when nothing says otherwise',
    countryOf('Cambridge, MA') === 'United States' && countryOf('Cambridge, United Kingdom') === 'United Kingdom' && countryOf('Mumbai, IN') === 'India'
      && countryOf('Zug') === 'Switzerland' && countryOf('Princeton, New Jersey') === 'United States' && countryOf('based in Latin America') === null
      && regionOf('Hong Kong') === 'asia_hk' && regionOf(null) === 'unknown' && regionOf(countryOf('Dubai, UAE')) === 'middle_east',
    'Cambridge MA and UK, Mumbai IN, Zug, Princeton NJ, Latin America (no country), Hong Kong, Dubai.');

  // Speed: counting 2,000 LPs on warm facts.
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) computeStats(facts, one('status', 'discussing', one('type', 'family_office')), VEHICLES, null, NOW);
  const perView = (performance.now() - t0) / 5;
  check('LP stats: counting 2,000 invented LPs with two filters takes well under the page’s 500 ms warm budget',
    perView < 150, `${perView.toFixed(1)} ms a view (budget for the counting alone: 150 ms, a guess leaving room for rendering).`);

  // The facts from the database: one per pursuit, money per track from the exposures.
  await withDb(db, async () => {
    const { lpStatsData } = await import('../../lib/lp-stats/data');
    const data = await lpStatsData('');
    const exposures = await db.query<{ slug: string; track: string; amount: string }>(
      `select v.slug, x.track::text track, sum(x.amount)::text amount from pipeline.exposure x
         join platform.vehicle v on v.id=x.vehicle_id join strategy.active_pursuit p
           on identity.canonical_entity_id(p.entity_id)=identity.canonical_entity_id(x.entity_id) and p.vehicle_id=x.vehicle_id
        where x.closed_at is null and v.phase<>'historical' group by 1,2`);
    const want = (slug: string, track: string) => Number(exposures.find((e) => e.slug === slug && e.track === track)?.amount ?? 0);
    const got = (slug: string, track: 'hard' | 'soft') => data.facts.reduce((t2, x) => t2 + (x.money[slug]?.[track] ?? 0), 0);
    const slugs = [...new Set(exposures.map((e) => e.slug))];
    const keys = data.facts.map((x) => x.pursuits[0]!.id);
    const s = computeStats(data.facts, none, data.vehicles, null, NOW);
    check('LP stats on the seeded database: one fact per pursuit, each vehicle’s hard and soft equal its own exposures, panels add up',
      data.facts.length > 0 && new Set(keys).size === keys.length && slugs.length > 0
        && slugs.every((v) => Math.abs(got(v, 'hard') - want(v, 'hard')) < 0.01 && Math.abs(got(v, 'soft') - want(v, 'soft')) < 0.01)
        && s.panels.filter((p) => !p.dim.multi).every((p) => p.segments.reduce((t2, x) => t2 + x.count, 0) === s.total),
      `${data.facts.length} pursuits, ${s.total} LPs; money checked on ${slugs.length} vehicles, track by track.`);
  });
}

import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { lpStatsData } from '@/lib/lp-stats/data';
import { marketReference } from '@/lib/lp-stats/reference';
import { computeStats, parseFilters, filterQuery, DIM, DIMENSIONS, type Filters } from '@/lib/lp-stats/model';
import { usdCompact } from '@/lib/money';
import { FilterBar, PanelCard, CoverageCard, LpTable, PAGE_SIZE } from './parts';
import { StatsNav } from './StatsNav';
import s from './stats.module.css';

export const dynamic = 'force-dynamic';

/**
 * LP stats (Juan, 27 Sep 2026): "counts of what types of them are there, counts per typical check
 * size, counts for score bands, counts for country… a page like 'LP stats' to each vehicle (and all)…
 * That page should also allow filtering and search to narrow the set displayed in stats."
 *
 * Every count is a link that adds its segment to the filter, the address holds the filters, and the
 * LPs that match are listed below. Counting is lib/lp-stats/model.ts; the facts, lib/lp-stats/data.ts.
 */
async function LpStats({ params, searchParams }: {
  params: Promise<{ vehicle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ vehicle: slug }, sp] = await Promise.all([params, searchParams]);
  const { all } = await vehicleSelection();
  const vehicle = slug === 'all' ? null : all.find((v) => v.slug === slug);
  if (slug !== 'all' && !vehicle) notFound();

  const [data, reference] = await Promise.all([lpStatsData(vehicle?.id ?? ''), marketReference()]);
  const filters = parseFilters(sp);
  if (vehicle) delete filters.sel.vehicle;
  const now = new Date();
  const stats = computeStats(data.facts, filters, data.vehicles, vehicle?.slug ?? null, now);
  const base = `/${slug}/stats`;
  const at = (f: Filters) => `${base}${filterQuery(f)}`;
  const n = stats.rows.length;
  const filtered = n !== stats.total;
  const active = DIMENSIONS.filter((d) => filters.sel[d.key]?.length).length + (filters.q ? 1 : 0);

  const orgs = stats.rows.filter((r) => r.unit === 'organisation').length;
  const scores = stats.rows.map((r) => r.score).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const median = scores.length ? scores[Math.floor((scores.length - 1) / 2)]! : null;
  const typed = stats.rows.filter((r) => r.type !== 'unknown').length;
  const placed = stats.rows.filter((r) => r.country).length;
  const mv = stats.moneyVehicle;
  const hard = mv ? stats.rows.reduce((t, r) => t + (r.money[mv]?.hard ?? 0), 0) : 0;
  const soft = mv ? stats.rows.reduce((t, r) => t + (r.money[mv]?.soft ?? 0), 0) : 0;
  const showMoney = Boolean(mv) && (hard > 0 || soft > 0);
  const vehicleName = (v: string) => data.vehicles.find((x) => x.slug === v)?.name ?? v;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const page = Math.min(filters.page, pages);

  return (
    <Page crumbs={[{ label: vehicle ? vehicle.name : 'All vehicles', href: '/overview' }, { label: 'LP stats' }]}>
      <StatsNav>
      <div className="lbl">LP stats · {vehicle ? vehicle.name : 'all vehicles'}</div>
      <h1>Who the LPs are</h1>
      <p className="sublede">
        Every LP {vehicle ? `in ${vehicle.name}’s pipeline` : 'in a pipeline being raised'}, counted by what they are and where they
        stand. Press any count to narrow everything to that segment; press it again to take it off. The LPs that match are listed
        below.
      </p>

      <FilterBar filters={filters} base={base} vehicles={vehicle ? null : data.vehicles} panels={stats.panels} n={n} total={stats.total} at={at} />

      <div className={`kpis six ${s.kpis}`}>
        <div className="kpi">
          <div className="n">{n.toLocaleString('en-US')}</div>
          <div className="f">{filtered ? `of ${stats.total.toLocaleString('en-US')} LPs match` : 'LPs'}{vehicle ? '' : ', each counted once'}</div>
        </div>
        <div className="kpi">
          <div className="n">{orgs.toLocaleString('en-US')} <span className={s.kpiThin}>/ {(n - orgs).toLocaleString('en-US')}</span></div>
          <div className="f">organisations / individuals</div>
        </div>
        <div className="kpi">
          <div className="n">{median ?? '—'}</div>
          <div className="f">median score · {scores.length.toLocaleString('en-US')} scored ({pct(scores.length, n)})</div>
        </div>
        <div className="kpi">
          <div className="n">{pct(typed, n)}</div>
          <div className="f">with a known type · {pct(placed, n)} with a known country</div>
        </div>
        {mv ? (
          <>
            <div className="kpi">
              <div className="n g">{usdCompact(hard)}</div>
              <div className="f">hard: signed and countersigned, {vehicleName(mv)}</div>
            </div>
            <div className="kpi soft">
              <div className="n">{usdCompact(soft)}</div>
              <div className="f">soft: indicated, not committed. Never added to hard</div>
            </div>
          </>
        ) : (
          <div className={`kpi soft ${s.kpiWide}`}>
            <div className="n q">By vehicle</div>
            <div className="f">
              Money is shown for one vehicle at a time and never added across vehicles. Choose one vehicle to see hard and soft
              amounts beside every count.
            </div>
          </div>
        )}
      </div>

      {stats.total === 0 ? (
        <div className="card">
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing to count</span>
              <h3>No LP is in {vehicle ? 'this vehicle’s' : 'any'} pipeline yet.</h3>
              <p>An empty page here means nobody has added the work. It is not a finding about the LP universe.</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {n === 0 && (
            <div className={`warn ${s.none}`}>
              <b>No LP matches every filter.</b> Each panel still counts the LPs that match the others, so one of them shows what to
              widen. <Link href={base}>Clear everything</Link>.
            </div>
          )}
          <div className={`${s.grid}${showMoney ? ` ${s.money}` : ''}`}>
            {stats.panels.map((p) => (
              <PanelCard key={p.dim.key} panel={p} filters={filters} at={at} n={n} money={showMoney} />
            ))}
          </div>

          <CoverageCard rows={stats.rows} reference={reference} now={now} filtered={active > 0} />

          <LpTable rows={stats.rows} filters={{ ...filters, page }} at={at} pages={pages} showVehicle={!vehicle} money={showMoney ? mv : null}
            vehicleName={vehicleName} now={now} />
        </>
      )}

      <p className="cover">
        <b>What this counts:</b> the LP units (docs/23) with a pursuit on {vehicle ? vehicle.name : 'a vehicle being raised'}
        {vehicle ? '' : '; an LP on several vehicles counts once, with the status, owner, score and fit of its furthest-along pursuit'}.
        {!vehicle && data.onHistory > 0 && <> {data.onHistory.toLocaleString('en-US')} pursuits on vehicles kept for their history are left out; open one in the rail to count them.</>}
        {' '}Types, places and check sizes are readings of what the sources say, labelled with what they rest on; an unknown is a gap in
        the record, not a finding. Each panel counts the LPs matching the search and every other filter, so its bars add up to its own
        base. <b>Read:</b> {new Date(data.asOf).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC,
        recounted on any change to the records. {DIM.tier.note}
      </p>
      </StatsNav>
    </Page>
  );
}

export default coalescePage('/[vehicle]/stats', LpStats);

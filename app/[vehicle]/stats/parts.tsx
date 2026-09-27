import Link from '@/components/ui/AppLink';
import { usdCompact } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { REGION_LABEL, regionOf } from '@/lib/lp-stats/geo';
import {
  CHECK_BASIS_LABEL, CHECK_LABEL, DIMENSIONS, FIT_LABEL, LP_TYPE_LABEL, SOURCE_LABEL, STATUS_WORD, TYPE_BASIS_LABEL,
  coverage, filterQuery, recencyOf, toggle, without, RECENCY_LABEL,
  type Filters, type LpFact, type Panel, type Reference, type Segment,
} from '@/lib/lp-stats/model';
import s from './stats.module.css';

export const PAGE_SIZE = 50;
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
const num = (n: number) => n.toLocaleString('en-US');
const share = (x: number) => (x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
/** Values that are a gap in the record rather than a segment: drawn muted, never as a finding. */
const GAPS = new Set(['unknown', 'none', 'unsearched', 'missing', 'never', 'no', 'Unassigned']);

// ── The filter bar ──────────────────────────────────────────────────────────────────────────────
export function FilterBar({ filters, base, vehicles, panels, n, total, at }: {
  filters: Filters; base: string; vehicles: Array<{ slug: string; name: string }> | null; panels: Panel[];
  n: number; total: number; at: (f: Filters) => string;
}) {
  const chips = DIMENSIONS.flatMap((d) => (filters.sel[d.key] ?? []).map((v) => ({ d, v })));
  const chosen = chips.length;
  const valuesOf = (key: string) => panels.find((p) => p.dim.key === key)?.segments ?? [];
  return (
    <div className={s.bar}>
      {/* Keyed by the filters: after a count is pressed the ticks must follow the address, not the old form. */}
      <form key={filterQuery(filters)} className={s.form} action={base} method="get" role="search">
        <input type="search" name="q" defaultValue={filters.q} placeholder="Search an LP or their firm…" aria-label="Search LPs by name" />
        <details className={s.pick}>
          <summary className="btn">Filters{chosen ? ` · ${chosen}` : ''}</summary>
          <div className={s.pickPanel}>
          <div className={s.pickBody}>
            {DIMENSIONS.filter((d) => d.key !== 'vehicle' || vehicles).map((d) => {
              const sel = filters.sel[d.key] ?? [];
              const values = d.key === 'vehicle' ? (vehicles ?? []).map((v) => ({ value: v.slug, label: v.name, count: null as number | null }))
                : valuesOf(d.key).map((x) => ({ value: x.value, label: x.label, count: x.count as number | null }));
              return (
                <fieldset key={d.key} className={s.fs}>
                  <legend>{d.title}</legend>
                  <div className={cx(s.opts, values.length > 10 && s.long)}>
                    {values.map((x) => (
                      <label key={x.value} className={s.opt}>
                        <input type="checkbox" name={d.key} value={x.value} defaultChecked={sel.includes(x.value)} />
                        <span>{x.label}</span>
                        {x.count !== null && <span className={s.optn}>{num(x.count)}</span>}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className={s.pickFoot}>
            <span>Within a group any ticked value matches; across groups every group must.</span>
            <button className="btn c" type="submit">Apply</button>
          </div>
          </div>
        </details>
        {filters.sort !== 'score' && <input type="hidden" name="sort" value={filters.sort} />}
        <button className="btn" type="submit">Search</button>
        <span className={s.count}>
          <b>{num(n)}</b> {n === total ? 'LPs' : <>of {num(total)} LPs</>}
          {n > 0 && <> · <a href="#lps">list ↓</a></>}
        </span>
      </form>
      {(chips.length > 0 || filters.q) && (
        <div className={s.chips} aria-label="Filters in use">
          {filters.q && (
            <a data-keep className={s.chip} href={at({ ...filters, q: '', page: 1 })} aria-label={`Remove the search ${filters.q}`}>
              <span>Search</span> “{filters.q}” <i aria-hidden>×</i>
            </a>
          )}
          {chips.map(({ d, v }) => (
            <a data-keep key={`${d.key}:${v}`} className={s.chip} href={at(toggle(filters, d.key, v))}
              aria-label={`Remove ${d.title}: ${d.key === 'vehicle' ? vehicles?.find((x) => x.slug === v)?.name ?? v : d.label(v)}`}>
              <span>{d.title}</span> {d.key === 'vehicle' ? vehicles?.find((x) => x.slug === v)?.name ?? v : d.label(v)} <i aria-hidden>×</i>
            </a>
          ))}
          <a data-keep className={s.clearAll} href={base}>Clear all</a>
        </div>
      )}
    </div>
  );
}

// ── One dimension ───────────────────────────────────────────────────────────────────────────────
/** Long lists (country, owner) show their largest segments and fold the rest, still clickable. */
const FOLD = 8;

function SegmentRow({ seg, max, href, money, gap }: { seg: Segment; max: number; href: string; money: boolean; gap: boolean }) {
  return (
    <li>
      <a data-keep className={cx(s.seg, seg.selected && s.on, seg.count === 0 && s.zero, gap && s.gap)} href={href}
        aria-pressed={seg.selected} title={`${seg.label}: ${num(seg.count)} LPs, ${share(seg.share)}. ${seg.selected ? 'Press to remove this filter.' : 'Press to filter to this.'}`}>
        <span className={s.mark} aria-hidden>{seg.selected ? '✓' : ''}</span>
        <span className={s.slabel}>{seg.label}</span>
        <span className={s.track} aria-hidden><i style={{ width: `${seg.count ? Math.max(1.5, (seg.count / max) * 100) : 0}%` }} /></span>
        <span className={s.num}>{num(seg.count)}</span>
        <span className={s.share}>{share(seg.share)}</span>
        {money && (
          <>
            <span className={cx(s.cash, s.hard)}>{seg.money?.hard ? usdCompact(seg.money.hard) : '—'}</span>
            <span className={cx(s.cash, s.soft)}>{seg.money?.soft ? usdCompact(seg.money.soft) : '—'}</span>
          </>
        )}
      </a>
    </li>
  );
}

export function PanelCard({ panel, filters, at, n, money }: {
  panel: Panel; filters: Filters; at: (f: Filters) => string; n: number; money: boolean;
}) {
  const { dim, base, segments } = panel;
  const max = Math.max(1, ...segments.map((x) => x.count));
  const chosen = filters.sel[dim.key]?.length ?? 0;
  // Segments nobody is in are named on one line, not drawn as empty bars: the panel shows what is there.
  const live = segments.filter((x) => x.count > 0 || x.selected);
  const empty = segments.filter((x) => x.count === 0 && !x.selected);
  const fold = (dim.key === 'country' || dim.key === 'owner') && live.length > FOLD + 2;
  const head = fold ? live.filter((x, i) => i < FOLD || x.selected) : live;
  const rest = fold ? live.filter((x, i) => i >= FOLD && !x.selected) : [];
  const row = (seg: Segment) => (
    <SegmentRow key={seg.value} seg={seg} max={max} href={at(toggle(filters, dim.key, seg.value))} money={money && !dim.multi}
      gap={GAPS.has(seg.value)} />
  );
  const id = `dim-${dim.key}`;
  return (
    <section className={s.panel} aria-labelledby={id}>
      <header className={s.phead}>
        <h2 id={id}>{dim.title}</h2>
        <span className={s.pbase}>
          {dim.multi ? `${num(base)} LPs, some on several` : `${num(base)} LPs`}
          {!dim.multi && base !== n ? ' · the other filters only' : ''}
        </span>
        {chosen > 0 && <a data-keep className={s.pclear} href={at(without(filters, dim.key))}>Clear</a>}
      </header>
      {money && !dim.multi && (
        <div className={s.moneyHead} aria-hidden><span>LPs</span><span>share</span><span>hard</span><span>soft</span></div>
      )}
      <ol className={s.segs}>{head.map(row)}</ol>
      {rest.length > 0 && (
        <details className={s.more}>
          <summary>{rest.length} more · {num(rest.reduce((t, x) => t + x.count, 0))} LPs</summary>
          <ol className={s.segs}>{rest.map(row)}</ol>
        </details>
      )}
      {empty.length > 0 && (
        <p className={s.empty}><span>None {live.length ? 'in' : 'yet'}:</span> {empty.map((x) => x.label).join(' · ')}</p>
      )}
      <p className={s.pnote}>
        {dim.note}
        {panel.extra && <span className={s.basis}>Rests on: {panel.extra}.</span>}
      </p>
    </section>
  );
}

// ── Coverage against a reference ────────────────────────────────────────────────────────────────
/** GUESS: below this many LPs with a known segment, a few points of gap is one LP either way. */
const FEW = 20;
export function CoverageCard({ rows, reference, now, filtered }: { rows: LpFact[]; reference: Reference | null; now: Date; filtered: boolean }) {
  if (!reference) {
    return (
      <div className="card">
        <div className="chead"><h2>Coverage</h2></div>
        <div className="cbody"><p className="muted">
          No reference distribution could be read from config/lp-market-reference.json, so there is nothing to compare with.
        </p></div>
      </div>
    );
  }
  const asOf = new Date(`${reference.asOf}T00:00:00Z`);
  const block = (key: 'region' | 'type', title: string) => {
    const c = coverage(rows, key, reference, now);
    const top = Math.max(0.01, ...c.rows.flatMap((r) => [r.ours, r.reference]));
    return (
      <div className={s.cov}>
        <h3>{title}</h3>
        <p className={s.covNote}>
          Among the {num(c.known)} LPs whose {key === 'region' ? 'region' : 'type'} is known{c.unknown ? `; ${num(c.unknown)} without one are left out` : ''}.
        </p>
        {c.known === 0 ? <p className={s.covNone}>Nothing to compare: no LP here has a known {key === 'region' ? 'region' : 'type'}.</p> : <>
        {c.known < FEW && <p className={s.covFew}>Only {num(c.known)} known: too few for a gap to mean much.</p>}
        <table className={s.covTable}>
          <thead>
            <tr><th scope="col">{key === 'region' ? 'Region' : 'Type'}</th><th scope="col" className={s.covBars}><span className={s.keyOurs}>ours</span> <span className={s.keyRef}>reference</span></th><th scope="col">ours</th><th scope="col">ref.</th><th scope="col">gap</th></tr>
          </thead>
          <tbody>
            {c.rows.map((r) => {
              const size = Math.abs(r.gap);
              const words = size < 3 ? 'in line' : r.gap > 0 ? `${Math.round(size)} pts over` : `${Math.round(size)} pts under`;
              return (
                <tr key={r.value}>
                  <th scope="row">{r.label}</th>
                  <td className={s.covBars} aria-hidden>
                    <span className={s.barOurs}><i style={{ width: `${(r.ours / top) * 100}%` }} /></span>
                    <span className={s.barRef}><i style={{ width: `${(r.reference / top) * 100}%` }} /></span>
                  </td>
                  <td className={s.cnum}>{share(r.ours)}</td>
                  <td className={cx(s.cnum, s.muted)}>{share(r.reference)}</td>
                  <td className={cx(s.cnum, s.gapCell, c.known < FEW ? s.small : size >= 10 ? s.big : size >= 3 ? s.mid : s.small)}>
                    {size >= 3 && <span aria-hidden>{r.gap > 0 ? '▲' : '▼'} </span>}{words}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>}
      </div>
    );
  };
  return (
    <section className="card" aria-labelledby="coverage-title">
      <div className="chead">
        <h2 id="coverage-title">Coverage against a reference</h2>
        <span className={s.refLabel}>
          {reference.placeholder && <span className="tag t-clay">placeholder</span>}
          Reference: {reference.source} · {Number.isNaN(asOf.getTime()) ? reference.asOf : shortDate(asOf)}
        </span>
      </div>
      <div className={s.covBody}>
        {block('region', 'By region')}
        {block('type', 'By LP type')}
      </div>
      <p className="cover">
        <b>How to read it:</b> our share of the {filtered ? 'LPs matching the filters' : 'LPs in view'} beside the reference’s share of the
        LP universe, in percentage points; “over” means more of ours are there than the reference would suggest. The reference is a
        labelled file (config/lp-market-reference.json)
        {reference.placeholder ? <>, and its values are <b>invented placeholders</b> until a research run replaces them: read no gap as a finding yet.</> : '.'}
        {reference.note ? ` ${reference.note}` : ''}
      </p>
    </section>
  );
}

// ── The LPs themselves ──────────────────────────────────────────────────────────────────────────
export function LpTable({ rows, filters, at, pages, showVehicle, money, vehicleName, now }: {
  rows: LpFact[]; filters: Filters; at: (f: Filters) => string; pages: number; showVehicle: boolean;
  money: string | null; vehicleName: (slug: string) => string; now: Date;
}) {
  const sorted = [...rows].sort(filters.sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
    : filters.sort === 'touch' ? (a, b) => (b.lastTouch ?? '').localeCompare(a.lastTouch ?? '') || a.name.localeCompare(b.name)
      : (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  const page = filters.page;
  const shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sortLink = (sort: Filters['sort'], label: string) => (
    <a data-keep href={at({ ...filters, sort, page: 1 })} className={cx(s.sort, filters.sort === sort && s.sortOn)} aria-current={filters.sort === sort ? 'true' : undefined}>
      {label}{filters.sort === sort ? ' ↓' : ''}
    </a>
  );
  return (
    <section className="card" id="lps" aria-labelledby="lps-title">
      <div className="chead">
        <h2 id="lps-title">The LPs counted</h2>
        <span className="lbl">{num(rows.length)} · {pages > 1 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} shown` : 'all shown'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="cbody"><p className="muted">No LP matches every filter. Take one off above, or clear them all.</p></div>
      ) : (
        <div className={s.tscroll}>
          <table className={`list ${s.table}`}>
            <thead>
              <tr>
                <th scope="col">{sortLink('name', 'LP')}</th>
                <th scope="col">Type</th>
                <th scope="col">Check size</th>
                <th scope="col" className={s.r}>{sortLink('score', 'Score')}</th>
                <th scope="col" className={s.hideM}>Fit</th>
                <th scope="col">Country</th>
                <th scope="col">Status</th>
                <th scope="col" className={s.hideM}>Best path</th>
                <th scope="col" className={s.hideM}>Owner</th>
                <th scope="col">{sortLink('touch', 'Last touch')}</th>
                {showVehicle && <th scope="col">Vehicles</th>}
                {money && <th scope="col" className={s.r}>Hard</th>}
                {money && <th scope="col" className={s.r}>Soft</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const lead = r.pursuits[0]!;
                const m = money ? r.money[money] : undefined;
                return (
                  <tr key={r.entityId}>
                    <td className={s.lp}>
                      <a data-go href={`/${lead.vehicle}/pipeline/${lead.id}`}>{r.name}</a>
                      {r.context && <span className={s.sub}>{r.context}</span>}
                    </td>
                    <td title={`Typed from ${TYPE_BASIS_LABEL[r.typeBasis]}`}>
                      <span className={r.type === 'unknown' ? s.muted : undefined}>{r.type === 'unknown' ? 'Not known' : LP_TYPE_LABEL[r.type]}</span>
                      {r.typeBasis === 'name' && <span className={s.sub}>by name only</span>}
                    </td>
                    <td title={CHECK_BASIS_LABEL[r.checkBasis]}>
                      <span className={r.check === 'unknown' ? s.muted : undefined}>{CHECK_LABEL[r.check]}</span>
                      {r.checkBasis !== 'none' && <span className={s.sub}>{r.checkBasis === 'prospect' ? 'a guess' : 'estimate'} · {CHECK_BASIS_LABEL[r.checkBasis].replace(' (a guess)', '')}</span>}
                    </td>
                    <td className={s.r}>
                      {r.score ?? <span className={s.muted}>None</span>}
                      {r.score !== null && <span className={s.sub}>{(r.scoreKind ?? '').startsWith('Fit') ? 'assessed' : 'provisional'}</span>}
                    </td>
                    <td className={s.hideM}><span className={r.fit === 'missing' || r.fit === 'unknown' ? s.muted : undefined}>{FIT_LABEL[r.fit]}</span></td>
                    <td>
                      {r.country ?? <span className={s.muted}>Not known</span>}
                      {r.country && <span className={s.sub}>{REGION_LABEL[regionOf(r.country)]} · {r.countryBasis === 'dakota' ? 'Dakota' : 'research'}</span>}
                    </td>
                    <td>{STATUS_WORD[r.status]}</td>
                    <td className={s.hideM}><span className={r.tier === 'none' || r.tier === 'unsearched' ? s.muted : undefined}>{r.tier.length === 1 ? `Tier ${r.tier}` : r.tier === 'none' ? 'None found' : 'Not searched'}</span></td>
                    <td className={s.hideM} title={`Source: ${SOURCE_LABEL[r.source]}`}>{r.owner}</td>
                    <td className={s.nowrap}>
                      {r.lastTouch ? shortDate(new Date(r.lastTouch)) : <span className={s.muted}>None</span>}
                      {r.lastTouch && <span className={s.sub}>{RECENCY_LABEL[recencyOf(r.lastTouch, now)].toLowerCase()}</span>}
                    </td>
                    {showVehicle && <td>{r.pursuits.map((p) => vehicleName(p.vehicle)).join(', ')}</td>}
                    {money && <td className={cx(s.r, s.hardCell)}>{m?.hard ? usdCompact(m.hard) : '—'}</td>}
                    {money && <td className={cx(s.r, s.softCell)}>{m?.soft ? usdCompact(m.soft) : '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className={s.pager} aria-label="Pages of LPs">
          {page > 1 ? <Link className="btn" href={`${at({ ...filters, page: page - 1 })}#lps`}>← Previous</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link className="btn" href={`${at({ ...filters, page: page + 1 })}#lps`}>Next →</Link> : <span />}
        </nav>
      )}
    </section>
  );
}

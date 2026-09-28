import { coalescePage } from '@/lib/page-render';
import type { ReactNode } from 'react';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { moduleCrumbs } from '@/lib/nav';
import {
  listPortfolio, portfolioIdentities, readPortfolioFile,
  type PortfolioIdentity, type PortfolioInvestment, type PortfolioRow, type PortfolioSource,
} from '@/lib/enrich/portfolio';
import s from './portfolio.module.css';
export const dynamic = 'force-dynamic';

/**
 * A vehicle's portfolio (issues 0069, 0079): the company, its founders, and each investment with
 * its multiple so far. Three kinds of row, never mixed in one table: companies the fund materials
 * name, companies the PL warehouse classifies as portfolio (not confirmed holdings), and the company
 * an SPV is researched for.
 */
type Group = 'fund' | 'warehouse' | 'scope';
const groupOf = (r: PortfolioRow): Group => r.portfolioStatus?.startsWith('warehouse_') ? 'warehouse'
  : r.portfolioStatus === 'research_scope_only' ? 'scope' : 'fund';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2025-02 → Feb 2025; 2026-06-30 → 30 Jun 2026. The source's precision, no more. */
function when(d: string): string {
  const [y, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (!y || !month) return d;
  return day ? `${Number(day)} ${month} ${y}` : `${month} ${y}`;
}
function amount(v: PortfolioInvestment): string {
  const n = v.amount!;
  const unit = n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${n}`;
  return v.currency === 'USD' ? `$${unit}` : `${v.currency} ${unit}`;
}
/** Confidence as a word, never the number (frontend contract). GUESS thresholds, presentation only. */
const confidenceWord = (c: number) => c >= 0.8 ? 'high confidence' : c >= 0.5 ? 'medium confidence' : 'low confidence';
const fileName = (f: string) => f.split('/').pop() ?? f;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short labels for the documents the rows cite, in the order they first appear. */
function sourceIndex(rows: PortfolioRow[]) {
  const ids = new Map<string, { id: string; file: string; pages: Set<number>; asOf: Set<string>; verifiedBy: Set<string>; confidence: number[] }>();
  const add = (src: PortfolioSource) => {
    let e = ids.get(src.file);
    if (!e) { e = { id: `S${ids.size + 1}`, file: src.file, pages: new Set(), asOf: new Set(), verifiedBy: new Set(), confidence: [] }; ids.set(src.file, e); }
    e.pages.add(src.page); e.asOf.add(src.as_of.slice(0, 10)); e.verifiedBy.add(src.last_verified_by); e.confidence.push(src.confidence);
  };
  for (const r of rows) { add(r.source); for (const v of r.investments) add(v.source); }
  return ids;
}

function Founder({ name, role, identity }: { name: string; role?: string; identity?: PortfolioIdentity }) {
  const roleText = role ? <span className={s.role}>{role}</span> : null;
  if (identity?.corroborated) return <li><Link href={`/orgs/${identity.canonicalId}`} className={s.person}>{name}</Link>{roleText}</li>;
  const possible = identity?.possible ?? [];
  return <li>
    <span className={s.unlinked}>{name}</span>{roleText}
    {possible.length > 0 && <span className={s.match}>
      {possible.length === 1 ? <Link href={`/orgs/${possible[0]!.id}`} aria-label={`Possible match for ${name}: open ${possible[0]!.name}`}>possible match ↗</Link>
          : <>possible matches {possible.map((p, i) => <Link key={p.id} href={`/orgs/${p.id}`} aria-label={`Possible match ${i + 1} for ${name}: open ${p.name}`}>{i + 1} ↗</Link>)}</>}
    </span>}
  </li>;
}

function Company({ row, company, sources, note, cite }: { row: PortfolioRow; company?: PortfolioIdentity; sources: ReturnType<typeof sourceIndex>; note: string | null; cite: boolean }) {
  return <>
    <div className={s.company}>{company?.corroborated ? <Link href={`/orgs/${company.canonicalId}`}>{row.company}</Link> : row.company}</div>
    {cite && <div className={s.cite}>{sources.get(row.source.file)!.id} · p. {row.source.page}</div>}
    {row.note && row.note !== note && <div className={s.rownote}>{row.note}</div>}
  </>;
}

function Founders({ row, ids }: { row: PortfolioRow; ids: Map<string, PortfolioIdentity> }) {
  if (!row.founders.length) return <span className="muted">Not named in the sources</span>;
  return <ul className={s.founders}>{row.founders.map((f, i) => <Founder key={`${f.entityId}-${i}`} name={f.name} role={f.role} identity={ids.get(f.entityId)} />)}</ul>;
}

/** The note most rows in a group share, said once under the table rather than on every row. */
function commonNote(rows: PortfolioRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.note) counts.set(r.note, (counts.get(r.note) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] > 1 ? top[0] : null;
}

function GroupTable({ group, rows, ids, sources }: { group: Group; rows: PortfolioRow[]; ids: Map<string, PortfolioIdentity>; sources: ReturnType<typeof sourceIndex> }) {
  const note = commonNote(rows);
  /** When every company row cites the same page, say so once instead of on every row. */
  const sharedCite = new Set(rows.map(r => `${r.source.file}#${r.source.page}`)).size === 1 && rows.length > 1
    ? `${sources.get(rows[0]!.source.file)!.id}, p. ${rows[0]!.source.page}` : null;
  const investments = rows.flatMap(r => r.investments);
  const withMultiple = investments.filter(v => v.multiple !== null).length;
  const asOf = [...new Set(investments.map(v => v.source.as_of.slice(0, 10)))];
  const founders = rows.reduce((n, r) => n + r.founders.length, 0);
  const title = { fund: 'In the fund materials', warehouse: 'Classified as portfolio by the PL warehouse', scope: 'In this SPV’s research scope' }[group];
  const label = group === 'fund'
    ? `${plural(rows.length, 'company', 'companies')} · ${plural(investments.length, 'investment')}${asOf.length === 1 ? ` · multiples as of ${when(asOf[0]!)}` : ''}`
    : `${plural(rows.length, 'company', 'companies')} · ${plural(founders, 'founder')}${group === 'warehouse' ? ' · not confirmed holdings' : ''}`;
  const showInvestments = investments.length > 0;
  const invCites = new Set(investments.map(v => `${v.source.file}#${v.source.page}`));
  const sharedInvCite = invCites.size === 1 && investments.length > 1 ? `${sources.get(investments[0]!.source.file)!.id}, p. ${investments[0]!.source.page}` : null;
  const invColumns = sharedInvCite ? 4 : 5;
  let cover: ReactNode;
  if (group === 'fund') cover = <>
    {note && <>{note} </>}
    {showInvestments && <><b>Multiples are as reported:</b> gross, including unrealized value, not realized returns{withMultiple < investments.length
      ? `; ${withMultiple} of ${investments.length} investments have one, and “Not reported” is not a zero` : ''}.{' '}
      Fund labels follow the source; current legal ownership is unverified. </>}
    <b>Founders here count as In touch</b> under the portfolio policy; no meeting date or consent is inferred from it.
  </>;
  else if (group === 'warehouse') cover = <>
    <b>From the warehouse’s classification, not the fund materials.</b> These are not confirmed fund holdings, carry no investment records,
    and their founders are not counted as In touch from this list.{note && <> {note}</>}
  </>;
  else cover = <>{note ?? 'Investment and close status are not verified.'}</>;

  if (sharedCite || sharedInvCite) cover = <>{cover}{sharedCite && <> Every company row cites {sharedCite}.</>}{sharedInvCite && <> Every investment row cites {sharedInvCite}.</>}</>;
  return <section className="card" aria-labelledby={`group-${group}`}>
    <div className="chead">
      <h2 id={`group-${group}`}>{title}</h2>
      <span className="lbl">{label}</span>
    </div>
    <div className={s.scroll}>
      <table className={`list ${s.table} ${showInvestments ? s.withInvestments : s.namesOnly}`}>
        <thead><tr>
          <th scope="col" className={s.colCompany}>Company</th>
          <th scope="col" className={s.colFounders}>Founders</th>
          {showInvestments && <>
            <th scope="col">Invested · round</th><th scope="col">Fund in source</th>
            <th scope="col" className={s.num}>Amount</th><th scope="col" className={s.num}>Multiple so far</th>{!sharedInvCite && <th scope="col">Source</th>}
          </>}
        </tr></thead>
        {rows.map(row => {
          const lines = showInvestments ? Math.max(1, row.investments.length) : 1;
          const head = <>
            <th scope="rowgroup" rowSpan={lines} className={s.colCompany}><Company row={row} company={ids.get(row.companyId)} sources={sources} note={note} cite={!sharedCite} /></th>
            <td rowSpan={lines} className={s.colFounders}><Founders row={row} ids={ids} /></td>
          </>;
          if (!showInvestments) return <tbody key={row.id}><tr>{head}</tr></tbody>;
          if (!row.investments.length) return <tbody key={row.id}><tr>{head}<td colSpan={invColumns} className={s.none}>No investment reported in the sources</td></tr></tbody>;
          return <tbody key={row.id}>{row.investments.map((v, i) => <tr key={i}>
            {i === 0 && head}
            <td data-label="Invested" className={s.inv}>{v.date ? when(v.date) : <span className="muted">Date not reported</span>}
              <div className={s.round}>{v.round ?? 'Round not reported'}</div></td>
            <td data-label="Fund" className={s.inv}>{v.fund_label ?? <span className="muted">Not specified</span>}</td>
            <td data-label="Amount" className={`${s.inv} ${s.num}`}>{v.amount === null ? <span className="muted">Not reported</span> : amount(v)}</td>
            <td data-label="Multiple" className={`${s.inv} ${s.num} ${s.multiple}`}>{v.multiple === null ? <span className={s.nr}>Not reported</span> : `${v.multiple.toFixed(2)}×`}</td>
            {!sharedInvCite && <td data-label="Source" className={`${s.inv} ${s.cite}`}>{sources.get(v.source.file)!.id} · p. {v.source.page}</td>}
          </tr>)}</tbody>;
        })}
      </table>
    </div>
    <p className="cover">{cover}</p>
  </section>;
}

async function Portfolio() {
  const { current } = await vehicleSelection();
  const supported = !!current && ['fund', 'spv'].includes(current.kind);
  let fileProblem = false;
  const [rows, input] = await Promise.all([supported ? listPortfolio(current!.id) : Promise.resolve([]),
    readPortfolioFile().catch(() => { fileProblem = true; return null; })]);
  const ids = await portfolioIdentities([
    ...rows.map(r => ({ id: r.companyId, possible: [] })),
    ...rows.flatMap(r => r.founders.map(f => ({ id: f.entityId, possible: f.possibleMatches ?? [] }))),
  ]);
  const coverage = input?.coverage.find(c => c.vehicle === current?.slug);
  rows.sort((a, b) => a.company.localeCompare(b.company, 'en', { sensitivity: 'base' }));
  const groups = (['fund', 'scope', 'warehouse'] as Group[]).map(g => ({ g, rows: rows.filter(r => groupOf(r) === g) })).filter(x => x.rows.length);
  const sources = sourceIndex(rows);
  const founders = rows.flatMap(r => r.founders);
  const linked = founders.filter(f => ids.get(f.entityId)?.corroborated).length;
  const possible = founders.filter(f => !ids.get(f.entityId)?.corroborated && ids.get(f.entityId)?.possible.length).length;
  const origin = groups.length === 1 ? { fund: 'from the fund materials', warehouse: 'from the PL warehouse’s portfolio classification, not a confirmed list of fund holdings', scope: 'in this SPV’s research scope' }[groups[0]!.g] : 'from the sources below';
  const investmentNotes = [...new Set(rows.flatMap(r => r.investments.flatMap(v => v.note ? [v.note.trim().replace(/([^.])$/, '$1.')] : [])))];
  const founderSources = new Map<string, PortfolioSource>();
  for (const f of founders) if (!sources.has(f.source.file)) founderSources.set(f.source.file, f.source);

  return <Page crumbs={moduleCrumbs('portfolio', current?.name ?? null)}>
    <div className="lbl">{current ? `${current.name} · Portfolio` : 'Portfolio'}</div>
    <h1>{supported ? `${current!.name} portfolio` : 'Portfolio'}</h1>
    {!supported ? <div className={`empty ${s.gap}`}>
      <span className="stat unavailable"><i />{current ? "Not a fund or SPV" : "No vehicle selected"}</span>
      <h3>A portfolio belongs to a fund or an SPV.</h3>
      <p>Choose PLC Neurotech I, PLC Crypto/Rails or one of the SPVs in the rail to see its companies, founders and investments.</p>
    </div> : !rows.length ? <div className={`empty ${s.gap}`}>
      <span className="stat unavailable"><i />Nothing imported</span>
      <h3>No portfolio has been imported for {current!.name}.</h3>
      <p>Missing material is not an empty portfolio. {coverage?.detail ?? 'The sourced portfolio file has no rows for this vehicle.'}</p>
      <p className="who">Anyone can <Link href="/developer/enrich">import a sourced portfolio file</Link> from Developer → Enrich.</p>
    </div> : <>
      <p className="sublede">
        {plural(rows.length, 'company', 'companies')} and {plural(founders.length, 'founder')} {origin}.{' '}
        {founders.length > 0 && (linked === founders.length ? 'Every founder links to their page.' : <>
          {linked > 0 ? `${linked} ${linked === 1 ? 'is' : 'are'} linked to their page, where the identity is corroborated. ` : 'None is linked to a page yet: no identity is corroborated. '}
          {possible > 0 && `${possible} ${possible === 1 ? 'has' : 'have'} a possible match: a namesake in our records, not yet confirmed as the same person.`}
        </>)}
      </p>
      {groups.map(({ g, rows: groupRows }) => <GroupTable key={g} group={g} rows={groupRows} ids={ids} sources={sources} />)}
      <section className="card" aria-labelledby="portfolio-sources">
        <div className="chead"><h2 id="portfolio-sources">Sources</h2><span className="lbl">{plural(sources.size, 'document')}{coverage ? ` · coverage ${coverage.status.replace(/_/g, ' ')}` : ''}</span></div>
        <div className={s.scroll}><table className={`list ${s.sources}`}>
          <tbody>{[...sources.values()].map(src => <tr key={src.id}>
            <td className={s.cite}>{src.id}</td>
            <td className={s.file}>{fileName(src.file)}<div className={s.rownote}>{src.pages.size === 1 ? 'p.' : 'pp.'} {[...src.pages].sort((a, b) => a - b).join(', ')}</div></td>
            <td className={s.meta}>as of {[...src.asOf].sort().map(when).join(', ')} · {confidenceWord(Math.min(...src.confidence))} · verified by {[...src.verifiedBy].join('; ')}</td>
          </tr>)}</tbody>
        </table></div>
        <div className={s.more}>
          {coverage?.detail && <p><b>Coverage.</b> {coverage.detail}</p>}
          {investmentNotes.length > 0 && <p><b>On the investment rows, the source says:</b> {investmentNotes.join(' ')}</p>}
          {founderSources.size > 0 && <details>
            <summary>Founder identity sources · {plural(founderSources.size, 'document')}</summary>
            <ul>{[...founderSources.values()].map(src => <li key={src.file}><span className={s.file}>{fileName(src.file)}</span> <span className="muted">· as of {when(src.as_of.slice(0, 10))} · {confidenceWord(src.confidence)} · verified by {src.last_verified_by}</span></li>)}</ul>
          </details>}
          {fileProblem && <p><span className="stat evidence"><i />Source unavailable</span> The portfolio file does not read as valid JSON, so coverage is not shown. The rows above are the last good import.</p>}
          <p className="muted">Rows come from the sourced portfolio file; <Link href="/developer/enrich">import a new version</Link> to change them.</p>
        </div>
      </section>
    </>}
  </Page>;
}

export default coalescePage('/portfolio', Portfolio);

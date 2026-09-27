import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { moduleCrumbs } from '@/lib/nav';
import { listPortfolio, readPortfolioFile, type PortfolioSource } from '@/lib/enrich/portfolio';
export const dynamic = 'force-dynamic';

function Source({ source }: { source: PortfolioSource }) {
  return <span>{source.file}, p. {source.page} · as of {source.as_of} · confidence {source.confidence} · verified by {source.last_verified_by}</span>;
}

export default async function Portfolio() {
  const { current } = await vehicleSelection();
  const supported = current && ['fund', 'spv'].includes(current.kind);
  const [rows, input] = await Promise.all([supported ? listPortfolio(current.id) : Promise.resolve([]), readPortfolioFile()]);
  const coverage = input?.coverage.find(c => c.vehicle === current?.slug);
  const warehouse = rows.filter(r => r.portfolioStatus === 'warehouse_claimed_portfolio').length;
  const investmentCount = rows.reduce((n, r) => n + r.investments.length, 0);
  return <Page crumbs={moduleCrumbs('portfolio', current?.name ?? null)}>
    <div className="pagehead"><div className="lbl">Portfolio</div><h1>{current?.name ?? 'Choose a vehicle'} portfolio</h1>
      <p>Companies, founders and investments reported in the available materials.</p></div>
    {!supported ? <section className="card cbody">Choose a fund or SPV to inspect its portfolio.</section> : <div className="portfolio-simple">
      <div className="portfolio-summary">
        <p>{rows.length} companies · {rows.reduce((n, r) => n + r.founders.length, 0)} founder records · {investmentCount} reported investments</p>
        {warehouse > 0 && <p><strong>{warehouse} companies classified by the warehouse.</strong> These are not confirmed fund holdings.</p>}
        {current.kind === 'spv' && <p>SPV research companies. Investment and close status are not verified.</p>}
        {investmentCount > 0 && <p>Fund labels follow the source materials; current legal ownership is unverified. Multiples are reported gross MOIC, include unrealized value, and are not realized returns. A dash in the source means “Not reported”.</p>}
        <details><summary>Coverage and sources</summary><p>{coverage?.detail ?? 'Coverage is limited to the sourced rows imported for this vehicle.'}</p>
          <Link href="/developer/enrich">Import portfolio materials</Link></details>
      </div>
      {rows.map(row => <section className="card portfolio-company" key={row.id} aria-labelledby={`company-${row.id}`}>
        <div className="portfolio-company-head">
          <h2 id={`company-${row.id}`}><Link href={`/orgs/${row.companyId}`}>{row.company}</Link></h2>
          <div className="portfolio-people"><span className="lbl">Founders</span>{row.founders.length ? <ul>{row.founders.map((f, i) => <li key={`${f.entityId}-${i}`}><Link href={`/orgs/${f.entityId}`}>{f.name}</Link></li>)}</ul> : <span className="muted">Not identified in the available sources</span>}</div>
        </div>
        {row.investments.length > 0 ? <div className="portfolio-investments" role="region" aria-label={`${row.company} investments`} tabIndex={0}>
          <table><caption>Reported investments</caption><thead><tr><th scope="col">Date</th><th scope="col">Round</th><th scope="col">Fund in source</th><th scope="col">Amount</th><th scope="col">Multiple so far</th><th scope="col">As of</th></tr></thead>
            <tbody>{row.investments.map((investment, i) => <tr key={i}>
              <td>{investment.date ?? 'Not reported'}</td><td>{investment.round ?? 'Not reported'}</td><td>{investment.fund_label ?? 'Not specified'}</td>
              <td className="portfolio-number">{investment.amount === null ? 'Not reported' : `${investment.currency ?? ''} ${investment.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim()}</td>
              <td className="portfolio-number">{investment.multiple === null ? 'Not reported' : `${investment.multiple.toFixed(2)}×`}</td><td>{investment.source.as_of}</td>
            </tr>)}</tbody></table>
        </div> : <p className="portfolio-no-investments muted">Investment details not reported in the available materials.</p>}
        <details className="portfolio-evidence"><summary>Sources and identity evidence</summary>
          {row.note && <p>{row.note}</p>}<p>Company: <Source source={row.source} /></p>
          {row.founders.map((f, i) => <p key={i}><strong>{f.name}</strong>: <Source source={f.source} />. {f.resolution}{f.possibleMatches.length > 0 && ` · ${f.possibleMatches.length} possible identity matches`}.</p>)}
          {row.investments.map((investment, i) => <p key={`investment-${i}`}>Investment {i + 1}: <Source source={investment.source} />{investment.note && ` · ${investment.note}`}</p>)}
        </details>
      </section>)}
      {!rows.length && <section className="card cbody">No portfolio rows have been imported for this vehicle. Missing material does not imply an empty portfolio. <Link href="/developer/enrich">Import sourced portfolio material</Link>.</section>}
    </div>}
  </Page>;
}

import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { moduleCrumbs } from '@/lib/nav';
import { listPortfolio, readPortfolioFile } from '@/lib/enrich/portfolio';
import { listEdgesForEntities } from '@/modules/network';
export const dynamic='force-dynamic';
export default async function Portfolio() {
  const {current}=await vehicleSelection();
  const supported=current && ['neurotech','rails'].includes(current.slug);
  const rows=supported?await listPortfolio(current.id):[];
  const input=await readPortfolioFile();
  const coverage=input?.coverage.find(c=>c.vehicle===current?.slug);
  const ids=[...new Set(rows.flatMap(r=>[r.companyId,...r.founders.map(f=>f.entityId)]))];
  const ties=ids.length?await listEdgesForEntities(ids,1000):[];
  const tieResult={truncated:ties.length===1000};
  return <Page crumbs={moduleCrumbs('portfolio',current?.name??null)}><div className="pagehead"><div className="lbl">PLC portfolio</div><h1>{current?.name??'Choose a fund'} portfolio</h1>
    <p>Companies and explicitly sourced founders, with the network ties on file. Historical fund attribution stays separate from current fund ownership.</p></div>
    {!supported?<section className="card cbody">Choose PLC Neurotech or PLC Rails to inspect its portfolio.</section>:<>
      <section className="card cbody"><b>Coverage: {coverage?.status.replaceAll('_',' ')??'No material imported'}</b>
        <p>{coverage?.detail??'No sourced portfolio material is available for this vehicle. Add its materials and import the portfolio on Developer → Enrich.'}</p>
        <p>{rows.length} companies · {rows.reduce((n,r)=>n+r.founders.length,0)} founder records. Missing founders mean the inspected material does not name them.</p>
        <Link href="/developer/enrich">Developer → Enrich</Link>
      </section>
      {rows.map(row=><section className="card" key={row.id}><div className="chead"><h2><Link href={`/orgs/${row.companyId}`}>{row.company}</Link></h2><span className="lbl">{row.fundLabels.join(' · ')||'Fund attribution unavailable'}</span></div><div className="cbody">
        {row.note&&<p className="muted">{row.note}</p>}
        <p className="muted">Source: {row.source.file}, p. {row.source.page} · as of {row.source.as_of} · confidence {row.source.confidence} · verified by {row.source.last_verified_by}</p>
        {row.founders.length?<ul>{row.founders.map(f=><li key={f.entityId}><Link href={`/orgs/${f.entityId}`}>{f.name}</Link> <span className="portfolio-founder">PLC portfolio founder · In touch</span>
          <p className="muted">{f.resolution}. {f.possibleMatches.length} possible identity matches; namesakes do not inherit portfolio membership. Founder source: {f.source.file}, p. {f.source.page} · {f.source.as_of} · confidence {f.source.confidence} · {f.source.last_verified_by}.</p>
          <Link href={`/routes?target=${f.entityId}&touch=1`}>Inspect routes and network ties</Link></li>)}</ul>:<p>Founders not named in the inspected materials.</p>}
        <p>{ties.filter(t=>t.fromEntity===row.companyId||t.toEntity===row.companyId||row.founders.some(f=>f.entityId===t.fromEntity||f.entityId===t.toEntity)).length} network ties in the inspected set{tieResult.truncated ? "; first 1,000 shown" : ""}.</p>
        <ul>{ties.filter(t=>t.fromEntity===row.companyId||t.toEntity===row.companyId||row.founders.some(f=>f.entityId===t.fromEntity||f.entityId===t.toEntity)).slice(0,12).map(t=><li key={t.edgeId}><Link href={`/orgs/${t.fromEntity}`}>{t.fromName}</Link> → <Link href={`/orgs/${t.toEntity}`}>{t.toName}</Link> · grade {t.tier} · {t.kind.replaceAll("_"," ")}</li>)}</ul>
      </div></section>)}
      {!rows.length&&<section className="card cbody">No imported portfolio rows for this fund. The import action can load a sourced file; unavailable materials do not imply an empty portfolio.</section>}
    </>}
  </Page>;
}

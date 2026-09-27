import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { vehicleReadings } from '@/lib/vehicle-readings';
import { listAssessments } from '@/modules/fit';
import { STATUS_LABEL } from '@/modules/strategy';

export const dynamic = 'force-dynamic';
const SIZE = 25; // Presentation limit: every result remains reachable.
async function FitRollup({ params, searchParams }: {
  params: Promise<{ vehicle: string }>;
  searchParams: Promise<{ q?: string; coverage?: string; sort?: string; page?: string }>;
}) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  const vehicle = all.find(v => v.slug === slug);
  if (slug !== 'all' && !vehicle) notFound();
  const sp = await searchParams;
  const [readings, assessments] = await Promise.all([vehicleReadings(vehicle?.id ?? null), listAssessments(vehicle?.id ?? null)]);
  const formal = new Map(assessments.map(a => [`${a.entityId}:${a.vehicleId}`, a]));
  const rows = readings.map(r => {
    const a = formal.get(`${r.entity_id}:${r.vehicle_id}`);
    return { ...r, assessment: a, score: a ? Math.round(a.weightedFit * 100) : r.score,
      coverage: a ? 'assessed' : r.suggestion_id ? 'provisional' : 'missing' };
  });
  // Legacy formal assessments can precede a pursuit; keep them visible too.
  for (const a of assessments) if (!rows.some(r => r.entity_id === a.entityId && r.vehicle_id === a.vehicleId)) rows.push({
    pursuit_id: a.assessmentId, entity_id: a.entityId, entity_name: a.entityName, vehicle_id: a.vehicleId,
    vehicle_name: a.vehicleName, vehicle_slug: a.vehicleSlug, status: 'new', owner_name: a.ownerName ?? 'Unassigned',
    suggestion_id: null, made_at: null, made_by: null, data: null, fit: undefined,
    score: Math.round(a.weightedFit * 100), assessment: a, coverage: 'assessed',
  });
  const words = (sp.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = rows.filter(r => (!sp.coverage || r.coverage === sp.coverage) && words.every(w =>
    `${r.entity_name} ${r.vehicle_name} ${r.owner_name} ${r.fit?.why ?? ''} ${r.data?.angle ?? ''}`.toLowerCase().includes(w)));
  filtered.sort((a,b) => sp.sort === 'name' ? a.entity_name.localeCompare(b.entity_name)
    : sp.sort === 'recent' ? (b.made_at?.getTime() ?? b.assessment?.updatedAt.getTime() ?? 0) - (a.made_at?.getTime() ?? a.assessment?.updatedAt.getTime() ?? 0)
    : Number(Boolean(a.assessment?.band === 'blocked' || a.fit?.gates?.some(g => g.answer === 'no'))) - Number(Boolean(b.assessment?.band === 'blocked' || b.fit?.gates?.some(g => g.answer === 'no')))
      || (b.score ?? -1) - (a.score ?? -1) || a.entity_name.localeCompare(b.entity_name));
  const page = Math.min(Math.max(0, Number.parseInt(sp.page ?? '0',10) || 0), Math.max(0,Math.ceil(filtered.length/SIZE)-1));
  const pageHref = (n: number) => `/${slug}/fit?${new URLSearchParams({ q:sp.q ?? '',coverage:sp.coverage ?? '',sort:sp.sort ?? 'score',page:String(n) })}`;
  const dates = rows.flatMap(r => r.made_at ? [r.made_at] : r.assessment ? [r.assessment.updatedAt] : []).sort((a,b) => a.getTime()-b.getTime());
  return <Page crumbs={[{ label: vehicle?.name ?? 'All vehicles', href:'/overview' },{label:'Funder–vehicle fit'}]}>
    <div className="lbl">Funder–vehicle fit · {vehicle?.name ?? 'all vehicles'}</div>
    <h1>Where we stand with each funder</h1>
    <p className="sublede">Compare fit, capacity and readiness for this raise. Strategy readings are provisional; formal assessments carry their own gates and evidence.</p>
    <div className="kpis">
      {[[rows.length,'LP × vehicle records'],[assessments.length,'formal assessments'],[rows.filter(r=>r.coverage==='provisional').length,'provisional strategies'],[rows.filter(r=>r.coverage==='missing').length,'awaiting a reading']].map(([n,label]) =>
        <div className="kpi" key={label}><div className="n">{n}</div><div className="f">{label}</div></div>)}
    </div>
    <div className="card fit0073">
      <form className="dfilters" action={`/${slug}/fit`}>
        <input type="search" name="q" defaultValue={sp.q} placeholder="Search LP, owner or fit rationale" aria-label="Search fit" />
        <select name="coverage" defaultValue={sp.coverage ?? ''} aria-label="Reading coverage"><option value="">Every reading</option><option value="assessed">Formal assessment</option><option value="provisional">Provisional strategy</option><option value="missing">Missing reading</option></select>
        <select name="sort" defaultValue={sp.sort ?? 'score'} aria-label="Sort fit"><option value="score">Highest score</option><option value="name">LP name</option><option value="recent">Recently updated</option></select>
        <button className="btn p">Apply</button>
      </form>
      <nav className="vizpager" aria-label="Fit result pages"><span>{filtered.length ? page*SIZE+1 : 0}–{Math.min((page+1)*SIZE,filtered.length)} of {filtered.length} records</span>{page>0 && <Link className="btn" href={pageHref(page-1)}>Previous</Link>}{(page+1)*SIZE<filtered.length && <Link className="btn" href={pageHref(page+1)}>Next</Link>}</nav>
      {filtered.length === 0 ? <div className="cbody"><h2>No matching readings</h2><p>Coverage is limited to the recorded pursuits and assessments for this vehicle. Clear the filters or review the LP list for records awaiting research.</p><Link href={`/${slug}/fit`}>Clear filters</Link></div> :
        <div className="table-scroll"><table className="list"><thead><tr><th>LP / status</th><th>Fit / score</th><th>Capacity</th><th>Affinity / propensity</th><th>Decision time</th><th>Basis and next step</th></tr></thead><tbody>
          {filtered.slice(page*SIZE,(page+1)*SIZE).map(r => <tr key={`${r.entity_id}:${r.vehicle_id}`}>
            <td><Link href={r.pursuit_id === r.assessment?.assessmentId ? `/orgs/${r.entity_id}` : `/${r.vehicle_slug}/pipeline/${r.pursuit_id}`}><b>{r.entity_name}</b></Link><div className="muted">{r.assessment && !readings.some(x=>x.pursuit_id===r.pursuit_id) ? 'No pursuit recorded' : STATUS_LABEL[r.status]}</div><div className="muted">{r.owner_name}{!vehicle ? ` · ${r.vehicle_name}` : ''}</div></td>
            <td><b>{r.score ?? 'Unknown'}</b>{r.score !== null && ' / 100'}<div>{r.assessment?.band ?? r.fit?.verdict ?? 'Fit not recorded'}</div><span className="flag f-mute">{r.coverage === 'assessed' ? 'Assessed' : r.coverage === 'provisional' ? 'Provisional' : 'Missing reading'}</span>
              <div className="muted">{r.assessment ? `Gates: ${r.assessment.gateStatus}` : r.fit?.gates?.length ? `${r.fit.gates.filter(g=>g.answer==='no').length} failing · ${r.fit.gates.filter(g=>g.answer==='unknown').length} unanswered gates` : 'Gates not assessed'}</div></td>
            <td>{r.data?.scores?.capacity?.band ?? 'Unknown'}</td><td>{r.data?.scores?.affinity?.level ?? 'Unknown'} / {r.data?.scores?.propensity?.level ?? 'Unknown'}</td><td>{r.data?.scores?.timeToDecision?.band ?? 'Unknown'}</td>
            <td><p>{r.assessment?.diagnosis.statement ?? r.fit?.why ?? r.data?.angle ?? 'No vehicle-specific reading on file. Review research before planning an ask.'}</p>
              <details><summary>Evidence and next step</summary>
                {Object.entries(r.data?.scores ?? {}).map(([key,value]) => <p key={key}><b>{key === 'timeToDecision' ? 'Decision time' : key}:</b> {value.basis}</p>)}
                <p>{r.data?.next?.what ?? 'No proposed next step.'}</p>
                {r.made_at && <p className="muted">Strategy by {r.made_by} · {shortDate(r.made_at)} · {r.data?.confidence ?? 'unknown'} confidence · proposal, not verified evidence</p>}
                {r.assessment && <Link href={`/${r.vehicle_slug}/fit/${r.entity_id}`}>Full assessment →</Link>}{' '}<Link href={`/${r.vehicle_slug}/strategy/${r.entity_id}`}>Strategy and sources →</Link>
              </details></td>
          </tr>)}
        </tbody></table></div>}
      <p className="cover">Coverage: recorded pursuits, formal fit assessments and the latest applicable proposed or accepted strategy per LP and vehicle{dates.length ? `, dated ${shortDate(dates[0]!)}–${shortDate(dates.at(-1)!)}` : '; no dated readings'}. Provisional scores use the existing capacity, affinity, propensity and decision-time weights; fewer than two known readings means no score. A missing reading is a coverage gap. Neither a score nor a strategy clears participation gates or authorizes outreach.</p>
    </div>
  </Page>;
}
export default coalescePage('/[vehicle]/fit',FitRollup);

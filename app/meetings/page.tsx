import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { vehicleReadings } from '@/lib/vehicle-readings';
import { pursuitFor, STATUS_LABEL, RUNG_LABEL } from '@/modules/strategy';
import { closeTracksFor, CLOSE_STATE_LABEL } from '@/modules/pipeline';
import { claimLabel } from '@/modules/research';
import { listMeetings, MEETING_LABEL, prepBrief, touchpointsFor, CHANNEL_LABEL } from '@/modules/meetings';

export const dynamic = 'force-dynamic';
const SIZE = 15; // Presentation limit, not a limit on history.
async function Meetings({ searchParams }: { searchParams: Promise<{ e?: string; m?: string; view?: string; q?: string; page?: string }> }) {
  const selection = await vehicleSelection();
  const vehicle = selection.current;
  const slug = vehicle?.slug ?? 'all';
  const sp = await searchParams;
  const all = await listMeetings(vehicle?.id ?? null);
  const now = new Date();
  const upcoming = all.filter(m => !m.heldOn && m.scheduledFor && m.scheduledFor >= now).sort((a,b)=>a.scheduledFor!.getTime()-b.scheduledFor!.getTime());
  const held = all.filter(m => m.heldOn);
  const unconfirmed = all.filter(m => !m.heldOn && (!m.scheduledFor || m.scheduledFor < now));
  const view = ['upcoming','held','unconfirmed'].includes(sp.view ?? '') ? sp.view! : upcoming.length ? 'upcoming' : 'held';
  const pool = view === 'upcoming' ? upcoming : view === 'held' ? held : unconfirmed;
  const words = (sp.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = pool.filter(m => words.every(w => `${m.entityName} ${m.ownerName} ${m.attendees.join(' ')}`.toLowerCase().includes(w)));
  const page = Math.min(Math.max(0,Number.parseInt(sp.page ?? '0',10)||0),Math.max(0,Math.ceil(filtered.length/SIZE)-1));
  const shown = filtered.slice(page*SIZE,(page+1)*SIZE);
  // A meeting id selects a meeting, even when two meetings share an LP. Scope is already applied.
  const selected = sp.m ? all.find(m=>m.meetingId===sp.m) : sp.e ? all.find(m=>m.entityId===sp.e) : shown[0];
  const focusVehicle = vehicle ?? selection.all.find(v=>v.name===selected?.vehicleName);
  const entityId = selected?.entityId;
  const [pursuit, brief, touches, tracks, readings] = entityId && focusVehicle ? await Promise.all([
    pursuitFor(entityId,focusVehicle.id),prepBrief(entityId,focusVehicle.id),touchpointsFor(entityId,focusVehicle.id),
    closeTracksFor(entityId,focusVehicle.id),vehicleReadings(focusVehicle.id,entityId),
  ]) : [null,null,[],[],[]];
  const reading = readings.find(r=>r.pursuit_id===pursuit?.pursuitId);
  const lpHref = entityId && focusVehicle ? pursuit ? `/${focusVehicle.slug}/pipeline/${pursuit.pursuitId}` : `/orgs/${entityId}` : null;
  const link = (changes: Record<string,string>) => `/${slug}/meetings?${new URLSearchParams({view,q:sp.q ?? '',page:String(page),...changes})}`;
  const claims = [...(brief?.supported ?? [])].sort((a,b)=> {
    const priority=(f:string)=> /role|investor_type|interest|capacity|check_size/.test(f) ? 0 : 1;
    return priority(a.field)-priority(b.field) || b.asOf.getTime()-a.asOf.getTime();
  });
  return <Page crumbs={moduleCrumbs('meetings',vehicle?.name ?? null)}>
    <div className="lbl">Meetings · {vehicle?.name ?? 'all vehicles'}</div><h1>Prepare for the next conversation</h1>
    <p className="sublede">Upcoming meetings and recorded history, with the LP context needed for each conversation.</p>
    <div className="meetings0074">
      <section className="card meeting-list">
        <div className="dfilters" role="navigation" aria-label="Meeting views">
          {[['upcoming','Upcoming',upcoming.length],['held','Held',held.length],['unconfirmed','Unconfirmed',unconfirmed.length]].map(([key,label,n]) => <Link className={`btn${view===key?' p':''}`} aria-current={view===key?'page':undefined} key={key} href={link({view:String(key),page:'0'})}>{label} · {n}</Link>)}
        </div>
        <form className="dfilters" action={`/${slug}/meetings`}><input type="hidden" name="view" value={view}/><input type="search" name="q" defaultValue={sp.q} placeholder="Search LP or team" aria-label="Search meetings"/><button className="btn">Search</button></form>
        <nav className="vizpager" aria-label="Meeting pages"><span>{filtered.length?page*SIZE+1:0}–{Math.min((page+1)*SIZE,filtered.length)} of {filtered.length}</span>{page>0 && <Link className="btn" href={link({page:String(page-1)})}>Previous</Link>}{(page+1)*SIZE<filtered.length && <Link className="btn" href={link({page:String(page+1)})}>Next</Link>}</nav>
        {shown.length===0 && <div className="cbody"><p>No {view} meetings match. Try another view or clear the search. A scheduled date that passed stays unconfirmed until a held record exists.</p></div>}
        {shown.map(m=><Link className={`meeting-item${selected?.meetingId===m.meetingId?' selected':''}`} key={m.meetingId} href={link({m:m.meetingId,e:m.entityId})}>
          <span className="mono muted">{m.heldOn || m.scheduledFor ? shortDate((m.heldOn ?? m.scheduledFor)!) : 'Undated'} · {m.kind ? MEETING_LABEL[m.kind] : 'Meeting'}</span>
          <b>{m.entityName}</b><span>Owner: {m.ownerName}</span>{m.attendees.length>0 && <span className="muted">With {m.attendees.join(', ')}</span>}{!vehicle && <span className="muted">{m.vehicleName ?? 'Vehicle not specified'}</span>}
        </Link>)}
      </section>
      <div className="meeting-context">
        {!selected ? <div className="card cbody"><h2>{sp.m || sp.e ? 'Meeting not in this vehicle’s records' : 'No meeting selected'}</h2><p>Select a recorded meeting to see preparation notes and LP context.</p></div> : <>
          <div className="meeting-heading"><div><div className="lbl">{selected.heldOn ? 'Held' : selected.scheduledFor && selected.scheduledFor>=now ? 'Upcoming' : 'Unconfirmed'} · {focusVehicle?.name ?? 'Vehicle not specified'}</div><h2>{selected.entityName}</h2><p>{selected.heldOn || selected.scheduledFor ? shortDate((selected.heldOn ?? selected.scheduledFor)!) : 'Undated'} · Owner: {selected.ownerName}</p></div>{lpHref && <Link className="btn" href={lpHref}>Open LP →</Link>}</div>
          {brief?.restriction && <div className="warn"><b>Restriction on file</b><p>{brief.restriction}</p></div>}
          <section className="card meeting-summary"><div className="chead"><h2>At a glance</h2><span className="lbl">Preparation notes</span></div><div className="cbody">
            <div className="meeting-facts"><div><span className="lbl">LP status</span><b>{pursuit ? STATUS_LABEL[pursuit.status] : 'No pursuit recorded'}</b></div><div><span className="lbl">Next step</span><span>{pursuit?.nextStep ?? reading?.data?.next?.what ?? 'No next step recorded'}{!pursuit?.nextStep && reading?.data?.next?.what ? ' (proposed)' : ''}</span>{pursuit?.nextStepOn && <span className="muted">Due {shortDate(pursuit.nextStepOn)}</span>}</div></div>
            {claims.length ? <ul className="meeting-highlights">{claims.slice(0,2).map((c,i)=><li key={i}><span>{c.value}</span><small>{claimLabel(c.field)} · {shortDate(c.asOf)} · {c.confidence} confidence · {c.verifiedBy ? `verified by ${c.verifiedBy}` : 'unverified'}</small></li>)}</ul> : <p className="muted">No supported background claims are available for this LP and vehicle.</p>}
            <details><summary>Expand background and sources · {claims.length} claims{brief?.refused.length ? ` · ${brief.refused.length} withheld` : ''}</summary>
              {claims.map((c,i)=><div className="meeting-evidence" key={i}><b>{claimLabel(c.field)}</b><p>{c.value}</p><small>Source: {c.source} · {shortDate(c.asOf)} · {c.confidence} confidence · {c.verifiedBy ? `verified by ${c.verifiedBy}` : 'unverified'}</small></div>)}
              {brief?.refused.map((r,i)=><p key={i}><b>Withheld: {claimLabel(r.field)}.</b> {r.why}</p>)}
            </details>
          </div></section>
          {!focusVehicle && <p className="cover">This meeting has no recorded vehicle. Open it from a vehicle calendar if it has a supported tag; no cross-vehicle LP status is substituted here.</p>}
          <section className="card"><div className="chead"><h2>Path to closing</h2>{lpHref && <Link href={lpHref}>Full LP record →</Link>}</div><div className="cbody">
            <p>{pursuit?.headline ?? 'No closing plan recorded.'}</p>
            {pursuit?.plan.length ? <ol>{pursuit.plan.slice(0,3).map((s,i)=><li key={i}>{s.move}{s.blockedBy ? ` — blocked by ${s.blockedBy}` : ''}</li>)}</ol> : reading?.data?.next && <p><b>Proposed:</b> {reading.data.next.what} · {reading.data.next.who} · {reading.data.next.when}</p>}
            <p className="muted">Consent evidence: {pursuit?.rung ? RUNG_LABEL[pursuit.rung] : 'Nothing recorded'}. Pipeline status is separate.</p>
            {tracks.length ? tracks.map(t=><p key={t.exposure.exposureId}><b>{CLOSE_STATE_LABEL[t.state]}</b> · {t.closedOn ? `Legal close ${shortDate(t.closedOn)}` : 'Legal close not recorded'} · {t.wires.length ? 'Cash receipt recorded' : 'Cash receipt not recorded'}</p>) : <p className="muted">No commitment or closing record for this vehicle.</p>}
          </div></section>
          <section className="card"><div className="chead"><h2>Score readings</h2><span className="flag f-mute">Provisional strategy</span></div><div className="cbody meeting-scores">
            {([['Capacity',reading?.data?.scores?.capacity?.band,reading?.data?.scores?.capacity?.basis],['Affinity',reading?.data?.scores?.affinity?.level,reading?.data?.scores?.affinity?.basis],['Propensity',reading?.data?.scores?.propensity?.level,reading?.data?.scores?.propensity?.basis],['Decision time',reading?.data?.scores?.timeToDecision?.band,reading?.data?.scores?.timeToDecision?.basis]]).map(([label,value,basis])=><div key={label}><span className="lbl">{label}</span><b>{value ?? 'Unknown'}</b>{basis && <details><summary>Basis</summary><p>{basis}</p></details>}</div>)}
          </div>{reading?.made_at && <p className="cover">Strategy by {reading.made_by} · {shortDate(reading.made_at)} · {reading.data?.confidence ?? 'unknown'} confidence. These are estimates, not approvals.</p>}</section>
          <section className="card"><div className="chead"><h2>Recent touchpoints</h2>{lpHref && <Link href={lpHref}>Full timeline →</Link>}</div><div className="cbody">
            {touches.filter(t=>t.on && t.on<=now).slice(0,4).map(t=><div className="meeting-touch" key={t.touchpointId}><b>{CHANNEL_LABEL[t.channel]} · {shortDate(t.on!)}</b><p>{t.summary ?? 'No summary recorded.'}</p><small>{t.ownerName} · {t.source}{t.viaOrganization ? ` · via ${t.viaOrganization}` : ''}</small></div>)}
            {!touches.some(t=>t.on && t.on<=now) && <p className="muted">No dated touchpoints recorded for this raise.</p>}
          </div></section>
          {(brief?.openObjections.length || brief?.openQuestions.length) ? <section className="card"><div className="chead"><h2>Questions to resolve</h2></div><div className="cbody">{brief.openObjections.map(o=><p key={o.objectionId}><b>{o.status} objection:</b> {o.statement}</p>)}{brief.openQuestions.map(q=><p key={q.questionId}>{q.question} · {q.ownerName ?? 'Unassigned'}{q.dueOn ? ` · due ${shortDate(q.dueOn)}` : ''}</p>)}</div></section> : null}
          {selected.summary && <details className="card cbody"><summary>Selected meeting notes</summary><p>{selected.summary}</p></details>}
        </>}
      </div>
    </div>
    <p className="cover">Coverage: recorded meetings and calls for {vehicle?.name ?? 'all vehicles'}{all.length ? `, ${all.length} records` : ''}. Upcoming dates are plans; held records are history. Full generated briefs await the review of the existing brief workflows.</p>
  </Page>;
}
export default coalescePage('/meetings',Meetings);

import { StrategyTable } from '@/components/strategy/StrategyTable';
import { MoveMenu } from '@/components/strategy/MoveMenu';
import { getDb } from '@/lib/db';
import { listMoves, moveScore, lpEffortScore, moveHistory } from '@/modules/strategy/moves';
import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { AssignPlay } from '@/components/plays/AssignPlay';
import { Propose } from '@/components/plays/Propose';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { config } from '@/config/deployment';
import { vehicleStrategy, STATUS_LABEL, type StrategyAction } from '@/modules/strategy';
import { boardFor, listUsers, LEVER_LABEL, LEVER_MEANS, type Play } from '@/modules/plays';

export const dynamic = 'force-dynamic';
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: 'compact' }).format(n);
const date = (d: Date | null | undefined) => d ? shortDate(d) : 'date unknown';
function Ref({ label, href, at, basis, strong = false }: { label: string; href: string; at: Date; basis: string; strong?: boolean }) {
  const doc: EvidenceDoc = { docId: label, title: label, origin: 'Local records', asOf: at.toISOString().slice(0, 10), strength: strong ? 'strong' : 'weak', supports: basis, href };
  return <EvidenceRef doc={doc} />;
}

function Board({
  plays, users, path, empty,
}: {
  plays: Play[];
  users: Array<{ id: string; name: string; role: string }>;
  path: string;
  empty: string;
}) {
  if (plays.length === 0) {
    return (
      <div className="cbody">
        <div className="empty">
          <span className="stat unavailable"><i />Nothing listed</span>
          <h3>{empty}</h3>
          <p>
            An empty board is a statement about our thinking, not about the option space. There
            is always something to do; nobody has written it down.
          </p>
        </div>
      </div>
    );
  }
  return (
    <table className="list board">
      <thead>
        <tr>
          <th style={{ width: 250 }}>Play</th>
          <th>Why it is on the list</th>
          <th style={{ width: 92 }}>Lever</th>
          <th style={{ width: 88 }} className="right">Leverage</th>
          <th style={{ width: 146 }}>Assign</th>
        </tr>
      </thead>
      <tbody>
        {plays.map((p) => (
          <tr key={p.playId} className={p.answersWeakness ? 'hot' : undefined}>
            <td>
              <b>{p.title}</b>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                {p.detail}
              </div>
              <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {p.entityName && p.entityId && (
                <Link className="flag f-mute" href={`${path}/${p.entityId}`}>{p.entityName}</Link>
              )}
                {p.gate && <span className="flag f-ev">needs {p.gate}</span>}
                <span className={`cert c-${p.certainty}`}>{p.certainty}</span>
              </div>
            </td>
            <td className="muted">
              {p.because}
              <div style={{ marginTop: 6, color: 'var(--ink)' }}>
                <b style={{ fontWeight: 500 }}>What it buys.</b> {p.payoff}
              </div>
            </td>
            <td>
              <span className={`lever${p.answersWeakness ? ' hot' : ''}`} title={LEVER_MEANS[p.lever]}>
                {LEVER_LABEL[p.lever]}
              </span>
              {p.answersWeakness && (
                <div className="muted" style={{ fontSize: 9.5, marginTop: 4 }}>
                  answers a weak reading
                </div>
              )}
            </td>
            <td className="right">
              <div className="lev">{p.leverage.toFixed(2)}</div>
              <div className="levsub">{p.likelihood}/5 · {p.effortDays}d · ×{p.reach}</div>
            </td>
            <td>
              <AssignPlay
                playId={p.playId}
                suggestedId={p.suggestedOwnerId}
                suggested={p.suggestedOwner}
                assignedTo={p.assignedTo}
                users={users}
                path={path}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function VehicleStrategyPage({ params, searchParams }: {
  params: Promise<{ vehicle: string }>;
  searchParams: Promise<{ view?: string; status?: string; page?: string; q?: string; action?: string }>;
}) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  if (slug === 'all') return <Page crumbs={[{ label: 'All vehicles' }, { label: 'Strategy' }]}>
    <h1>Choose a raise</h1><p className="sublede">Progress and priorities are kept separate for each vehicle.</p>
    <div className="card">{all.map(v => <div className="row" key={v.id}><Link href={`/${v.slug}/strategy`}>{v.name}</Link></div>)}</div>
  </Page>;
  const vehicle = all.find(v => v.slug === slug);
  if (!vehicle) notFound();
  const [data, plays, users, query, moves, history] = await Promise.all([vehicleStrategy(vehicle.id), boardFor(vehicle.id), listUsers(), searchParams, getDb().then(db => listMoves(db, vehicle.id)), getDb().then(db => moveHistory(db, vehicle.id))]);
  if (!data) notFound();
  const { total, rows, now, since, counts, weekly } = data;
  const path = `/${slug}/strategy`;
  const lpPath = (r: StrategyAction) => `/${slug}/pipeline/${r.pursuit.pursuitId}`;
  const active = rows.filter(r => !r.closed);
  const views = [
    { id: 'all', label: 'All LPs', rows },
    { id: 'risk', label: 'Stalled or at risk', rows: active.filter(r => r.risks.length > 0) },
    { id: 'route', label: 'No recorded route', rows: active.filter(r => r.route?.count === 0) },
    { id: 'refresh-route', label: 'Route search needs refresh', rows: active.filter(r => r.route && !r.route.current) },
    { id: 'unsearched', label: 'Route search not recorded', rows: active.filter(r => !r.route) },
    { id: 'research', label: 'No research on file', rows: active.filter(r => !r.profileAt && !r.claimCount) },
    { id: 'strategy', label: 'No vehicle strategy', rows: active.filter(r => !r.suggestion && !r.pursuit.headline && !r.pursuit.plan.length) },
    { id: 'owner', label: 'Owner unavailable', rows: active.filter(r => !r.ownerActive) },
  ];
  const selected = views.find(v => v.id === query.view) ?? views[0]!;
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ view: selected.id, ...(query.status ? { status: query.status } : {}), ...(query.q ? { q: query.q } : {}), ...(query.action ? { action: query.action } : {}), ...patch });
    return `${path}?${p}#actions`;
  };
  const ranked = [
    ...active.map(r => ({ id: r.pursuit.pursuitId, title: r.pursuit.entityName, action: r.action, kind: 'LP action', href: lpPath(r), priority: lpEffortScore(r).priority, work: r.workPriority, position: null as number|null })),
    ...moves.filter(m => m.state !== 'dismissed').map(m => ({ id: m.id, title: m.title, action: m.detail, kind: `Move · ${m.state}`, href: `#move-${m.id}`, priority: moveScore(m.estimates).priority, work: 0, position: m.position })),
  ].sort((a,b) => (b.priority ?? -1) - (a.priority ?? -1) || b.work-a.work || a.id.localeCompare(b.id));
  const manual = ranked.filter(r => r.position !== null).sort((a,b) => a.position!-b.position! || a.id.localeCompare(b.id));
  const queue = ranked.filter(r => r.position === null);
  // Apply from the end so ties retain a stable ID order; manual positions include LP rows.
  for (const row of manual.reverse()) queue.splice(Math.min(row.position! - 1, queue.length), 0, row);
  const top = queue.slice(0, 10);
  const viewIds = new Map(rows.map(r => [r.pursuit.pursuitId, views.filter(v => v.rows.includes(r)).map(v => v.id)]));
  const tableRows = rows.map(r => {
    const effort = lpEffortScore(r);
    return { id:r.pursuit.pursuitId, name:r.pursuit.entityName, href:lpPath(r), action:r.action, group:r.group,
      status:r.pursuit.status, owner:r.pursuit.ownerSaid ?? r.pursuit.ownerName, priority:effort.priority,
      evidencePriority:r.workPriority, capacity:r.capacity, likelihood:r.likelihood, route:r.routeWeight, days:r.days,
      teamHours:effort.teamHours, views:viewIds.get(r.pursuit.pursuitId)!, detail:[
        r.suggestion?.data.angle ?? r.pursuit.headline ?? 'No vehicle strategy recorded.',
        `Capacity: ${r.capacityBasis} ${r.capacityBand ?? ''}`,
        `Likelihood GUESS: ${r.propensity?.basis ?? 'Unknown; no propensity assessment.'}`,
        `Route: ${r.route?.path ?? 'No stored route'}; ${r.route?.basis ?? 'unknown'}. As of ${date(r.route?.at)}.`,
        `Decision timing GUESS: ${r.decision?.basis ?? 'Unknown'}. Decision days are elapsed time, not team effort.`,
        `GUESS incremental capital = capacity × likelihood × route × conversion adjustment (${r.conversion.factor.toFixed(2)}) × action share (${effort.lift}). Divide by ${effort.teamHours} team hours (GUESS: preparation and review for one action). ${effort.expected === null ? 'Held or missing inputs; unscored.' : money(effort.expected)+' GUESS incremental capital.'}`,
        `Conversion basis: ${r.conversion.forward}/${r.conversion.observed} distinct LPs with recorded exits moved forward; neutral prior ${config.strategyRanking.conversionPriorWeight} (GUESS). Incomplete history, not cohort commitment probability.`,
        `Evidence priority GUESS: ${r.workFactors.map(f=>`${f.points} ${f.label}`).join(' + ') || 'No signals'}.`,
        `Recorded due date: ${date(r.pursuit.nextStepOn)}. Proposed: ${r.suggestion?.data.next?.who ?? 'unknown'} · ${r.suggestion?.data.next?.when ?? 'unknown'}.`,
        `Strategy: ${r.suggestion?.status ?? 'missing'}; ${r.suggestion?.made_by ?? 'unknown author'}; ${r.suggestion ? date(new Date(r.suggestion.made_at)) : 'unknown date'}; confidence ${r.suggestion?.data.confidence ?? 'unknown'}.`,
        ...r.risks, ...r.pursuit.plan.map(p=>`${p.move} — ${p.because}`),
      ] };
  });
  const sourceRange = rows.map(r => r.pursuit.sourceAsOf).filter((d): d is Date => Boolean(d));
  const earliest = sourceRange.length ? new Date(Math.min(...sourceRange.map(d => d.getTime()))) : null;
  const latest = sourceRange.length ? new Date(Math.max(...sourceRange.map(d => d.getTime()))) : null;
  return <Page crumbs={[{ label: vehicle.name, href: `/${slug}/overview` }, { label: 'Strategy' }]} inspector={<>
    <div className="lbl">This raise</div><div className="ihead">{vehicle.name}</div>
    <div className="kv"><span>LP pursuits</span><b>{rows.length}</b></div>
    <div className="kv"><span>Active pursuits</span><b>{active.length}</b></div>
    <div className="kv"><span>Actions with scores</span><b>{active.filter(r => r.score).length}</b></div>
    <div className="scope"><div className="lbl">How to use this</div><p>Start with the ranked actions. Open the basis to inspect each estimate, then the LP to review its strategy and evidence. Recorded next steps and proposed actions stay distinct.</p><p>A ranking authorizes nothing. Sends, intro requests and money still need their own approval.</p></div>
    <div className="acts"><Link className="btn" href={`/${slug}/pipeline`}>Open pipeline</Link><Link className="btn" href={`/${slug}/routes`}>Explore routes</Link></div>
  </>}>
    <div className="lbl">Strategy · {vehicle.name}</div><h1>Where the raise stands. What comes next.</h1>
    <p className="sublede">A working view of this vehicle’s pipeline, LP strategies and evidence. As of {date(now)}.</p>
    <section className="card strategy-summary" aria-labelledby="raise-summary">
      <div className="chead"><h2 id="raise-summary">This raise</h2><Ref label="Raise records" href={`/${slug}/pipeline`} at={now} strong basis="Current vehicle exposures and configured target. Only the hard track contributes to committed capital; status Committed alone does not." /></div>
      <div className="strategy-metrics">
        <div><span className="lbl">Hard committed</span><strong>{money(total.hard)}</strong><small>{total.hardCount} recorded hard commitments</small></div>
        <div><span className="lbl">Target</span><strong>{total.target === null ? 'Not set' : money(total.target)}</strong><small>{total.gapToTarget === null ? 'Record the raise target to measure the gap.' : `${money(Math.max(0, total.gapToTarget))} still to harden`}</small></div>
        <div><span className="lbl">Soft · must convert</span><strong>{money(total.soft)}</strong><small>{total.softCount} indications; kept separate from hard</small></div>
        <div><span className="lbl">Cash received</span><strong>{money(total.cash)}</strong><small>A separate state from legal commitment</small></div>
      </div>
      <p className="worknote"><b>Pipeline:</b> {counts.map(s => `${s.count} ${s.label.toLowerCase()}`).join(' · ')}. <Ref label="Status counts" href={`/${slug}/pipeline`} at={now} strong basis="Current pursuit statuses in this vehicle; not consent or capital." /><br /><b>This week:</b> {data.added} pursuits added, {weekly.length} recorded status changes, {money(data.hardened)} hardened and still on the hard track. <Ref label="This week’s evidence" href="#movement" at={now} basis="Since Monday UTC; detailed records and limitations appear in Movement this week." /></p>
      {!total.hardCount && <p className="worknote">No hard commitments are recorded here. This describes the available records, not proof that none exist. The raise owner should reconcile signed commitments with the close records.</p>}
      {total.historical && <p className="worknote">Historical vehicle: these records describe a past raise.</p>}
      <div className="cbody"><h3>So next · {top.length}</h3>
        <div className="strategy-table-wrap"><table className="list strategy-compact"><thead><tr><th>#</th><th>Action</th><th>Kind</th><th>GUESS $/team hour</th></tr></thead><tbody>{top.map((r,i)=><tr key={r.id}><td>{i+1}</td><td><Link href={r.href}><b>{r.title}</b></Link><div className="strategy-next-text">{r.action}</div></td><td>{r.kind}{r.position!==null&&' · manual order'}</td><td>{r.priority===null?`Unscored · ${r.work} evidence pts`:money(r.priority)}</td></tr>)}</tbody></table></div>
        {!top.length&&<p>No active actions or moves recorded. Add pursuits or import a move menu.</p>}
        <p className="muted">One scale: GUESS incremental capital per team hour. Open a move or LP row for factors. Manual positions override model order; unscored evidence work follows scored options. These overlapping alternatives are never summed into a forecast, hard capital, or a shared LP allocation.</p>
      </div>
    </section>
    <section className="card"><div className="chead"><h2>Pipeline by status</h2><Ref label="Pipeline evidence" href={`/${slug}/pipeline`} at={now} strong basis="Pursuit statuses for this vehicle. These counts do not infer consent, signatures or cash receipt." /></div>
      <div className="strategy-table-wrap"><table className="list"><thead><tr><th>Status</th><th className="right">LPs</th><th>Conversions recorded so far</th></tr></thead><tbody>{counts.map(s => <tr key={s.id}><td><Link href={link({ status: s.id, page: '1', view: 'all' })}>{s.label}</Link></td><td className="right">{s.count}</td><td>{s.conversion.observed ? `${s.conversion.forward} / ${s.conversion.observed} LPs with recorded exits moved forward` : 'No recorded exits; conversion unknown'}</td></tr>)}</tbody></table></div>
      <p className="cover">Status is our plan, separate from evidenced consent and the money track. Conversions use distinct LPs with recorded exits, not today’s status proportions. History is incomplete; these are not full-cohort conversion rates. <Ref label="Conversion basis" href="#movement" at={now} basis="Vehicle-scoped pursuit.status_set audit records; legacy status labels are normalized. Repeated exits count each LP once per source status." /></p>
    </section>
    <section className="card" id="movement"><div className="chead"><h2>Movement this week</h2><span className="lbl">Since {date(since)} · UTC</span></div>
      <div className="cbody"><p>{data.added} pursuits added · {weekly.length} recorded status changes · {money(data.hardened)} currently hard committed with a hardening date this week. <Ref label="Movement records" href={`/${slug}/pipeline`} at={now} basis="Pursuit opening dates, recorded status changes and current hard exposures hardened since Monday UTC. Imports are not inferred as progress. This is not a net capital flow." /></p>
        <details><summary>Recorded status changes ({weekly.length})</summary>{weekly.length ? <ul>{weekly.map((t, i) => { const r = rows.find(r => r.pursuit.pursuitId === t.pursuitId); return <li key={i}>{date(t.at)} · {r ? <Link href={lpPath(r)}>{r.pursuit.entityName}</Link> : 'Pursuit'} · {STATUS_LABEL[t.from]} → {STATUS_LABEL[t.to]} <Ref label="Status record" href={r ? lpPath(r) : `/${slug}/pipeline`} at={t.at} strong basis={`Recorded status change: ${STATUS_LABEL[t.from]} to ${STATUS_LABEL[t.to]}. This does not establish a consent rung.`} /></li>; })}</ul> : <p>No status changes recorded in this window. Missing history is not evidence of no activity.</p>}</details>
      </div>
    </section>
    <section className="card"><div className="chead"><h2>Stalled, at risk and coverage gaps</h2><Ref label="Coverage basis" href="#actions" at={now} basis="Active vehicle pursuits compared with stored route searches, current research claims/public profiles and vehicle-scoped strategies. Closed and Passed pursuits are excluded." /></div>
      <div className="strategy-coverage">{views.slice(1).map(v => <Link key={v.id} href={link({ view: v.id, status: '', page: '1' })}><b>{v.rows.length}</b><span>{v.label}</span></Link>)}</div>
      <p className="cover">Route counts describe dated stored searches, not all possible routes. A missing search is unknown; an empty search means no route supported in that search. Stalled means at least {config.strategyRanking.stalledDays} days without recorded activity (GUESS). Silence is not a decline.</p>
    </section>
    <MoveMenu moves={moves} vehicleId={vehicle.id} ranks={Object.fromEntries(queue.map((r,i)=>[r.id,i+1]))} />
    <details className="card"><summary className="chead">Recent move decisions · {history.length}</summary><div className="cbody">{history.length ? <ul>{history.map((h,i)=><li key={i}>{date(new Date(h.at))} · {h.actor} · {h.title}: {h.detail.before.state} → {h.detail.after.state}; position {h.detail.before.position ?? 'model'} → {h.detail.after.position ?? 'model'}. {h.detail.note}</li>)}</ul> : <p>No human move decisions recorded for this raise.</p>}</div></details>
    <section className="card" id="actions"><div className="chead"><h2>LPs by next action</h2><span className="lbl">{rows.length} LPs</span></div>
      <StrategyTable rows={tableRows} asOf={now.toISOString()} initialFilters={query} views={views.map(v=>({id:v.id,label:v.label}))} />
    </section>
    <details className="card"><summary className="chead">Saved plays and whole-raise proposals · {plays.length} plays</summary>
      <div className="strategy-table-wrap"><Board plays={plays} users={users} path={path} empty="No saved plays yet." /></div>
      <div className="cbody"><Propose vehicleId={vehicle.id} entityId={null} path={path} placeholder="Propose work for this raise; name an owner and a date." /></div>
    </details>
    <p className="cover">Corpus: this vehicle’s pursuits, exposures, status audit, imported strategies, active research claims, public profiles, vehicle-aware touchpoints and dated route searches. Pursuit source dates: {date(earliest)}–{date(latest)}; individual strategy and route dates appear beside each LP. Missing records remain unknown. Every view has a text list; no chart is required to read it.</p>
  </Page>;
}
export default coalescePage('/[vehicle]/strategy', VehicleStrategyPage);

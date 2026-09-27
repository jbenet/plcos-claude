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
function Basis({ row, slug, now }: { row: StrategyAction; slug: string; now: Date }) {
  const lp = `/${slug}/pipeline/${row.pursuit.pursuitId}`;
  return <details className="strategy-basis"><summary>Score basis · {row.score ? 'estimated' : 'not scored'}</summary>
    <dl>
      <dt>Capacity</dt><dd>{row.capacity === null ? 'Unknown' : money(row.capacity)} · {row.capacityBand ?? 'recorded soft amount'}<br />{row.capacityBasis} <Ref label="Capacity evidence" href={lp} at={row.profileAt ?? now} basis="A soft indication or a midpoint of a closed capacity range. Range midpoints are guesses; no amount is added to hard." /></dd>
      <dt>Likelihood</dt><dd>{row.likelihood === null ? 'Unknown' : `${Math.round(row.likelihood * 100)}% · GUESS from ${row.propensity?.level} propensity`}<br />{row.propensity?.basis ?? 'No propensity assessment.'}</dd>
      <dt>Route strength</dt><dd>{row.routeWeight === null ? 'Unknown' : `${row.routeWeight} · GUESS for tier ${row.route?.tier}`} · {row.route?.basis ?? 'No stored search.'} <Ref label="Route evidence" href={`/${slug}/routes?target=${row.pursuit.entityId}`} at={row.route?.at ?? now} basis="Dated search result; review current routes and guards before proposing an approach. Tiers model uncertainty, not consent." /></dd>
      <dt>Time to decision</dt><dd>{row.days === null ? 'Unknown' : `${row.days} days · GUESS for ${row.decision?.band}`}<br />{row.decision?.basis ?? 'No timing assessment. A next-action due date is not a decision date.'}</dd>
      <dt>Conversion adjustment</dt><dd>{row.conversion.forward} of {row.conversion.observed} LPs with recorded exits from {STATUS_LABEL[row.pursuit.status]} moved forward at least once. Factor {row.conversion.factor.toFixed(2)}; neutral prior weight {config.strategyRanking.conversionPriorWeight} is a GUESS. <Ref label="Recorded transitions" href="#movement" at={now} basis="Distinct LPs with recorded status exits in this vehicle; forward means a later status other than Passed. Incomplete history, not a cohort probability of committing." /></dd>
    </dl>
    <p>Estimated value = capacity × likelihood × route strength. Priority = estimated value × conversion adjustment ÷ decision days. {row.score ? `${money(row.score.expected)} estimated value; ${money(row.score.priority)}/day priority.` : row.held ? 'Held out of the funding ranking: review restrictions, strategy freshness, horizon or close state.' : 'One or more inputs are unknown; no numeric score is assigned.'}</p>
    {!row.score && <p><b>Evidence priority: {row.workPriority} points · GUESS.</b> {row.workFactors.length ? row.workFactors.map(f => `${f.points} ${f.label.toLowerCase()}`).join(' + ') : 'No measured urgency signal.'} These points order evidence work separately from monetary scores; they do not estimate capital. <Ref label="Evidence-work basis" href={lp} at={now} basis="Recorded restrictions, due dates, soft indications, freshness and missing records. All point weights are guessed and shown here." /></p>}
    <p>Estimates are for ordering work, not a forecast. No shared capital is allocated by this ranking. <Ref label="Strategy inputs" href={lp} at={row.suggestion ? new Date(row.suggestion.made_at) : now} basis={`Strategy by ${row.suggestion?.made_by ?? 'not recorded'}; ${row.suggestion?.status ?? 'missing'}. External claims retain their provenance on the LP page; a proposal is not verified or accepted.`} /></p>
  </details>;
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
  const [data, plays, users, query] = await Promise.all([vehicleStrategy(vehicle.id), boardFor(vehicle.id), listUsers(), searchParams]);
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
  const groups = [...new Set(rows.map(r => r.group))];
  const filtered = selected.rows.filter(r => (!query.action || r.group === query.action) && (!query.status || r.pursuit.status === query.status)
    && (!query.q || `${r.pursuit.entityName} ${r.action} ${r.pursuit.ownerSaid ?? r.pursuit.ownerName}`.toLowerCase().includes(query.q.toLowerCase())));
  const size = 30; const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(pages, Math.max(1, Number.parseInt(query.page ?? '1') || 1));
  const shown = filtered.slice((page - 1) * size, page * size);
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ view: selected.id, ...(query.status ? { status: query.status } : {}), ...(query.q ? { q: query.q } : {}), ...(query.action ? { action: query.action } : {}), ...patch });
    return `${path}?${p}#actions`;
  };
  const top = active.slice(0, 3);
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
      <div className="cbody"><h3>Do next</h3>
        {top.length ? <ol className="strategy-next">{top.map(r => <li key={r.pursuit.pursuitId}><Link href={lpPath(r)}><b>{r.pursuit.entityName}</b></Link> — {r.action}<div className="muted">{r.score ? `${money(r.score.priority)}/day estimated priority` : `${r.workPriority} points · evidence priority (GUESS)`} · {r.pursuit.ownerSaid ?? r.pursuit.ownerName}</div><Basis row={r} slug={slug} now={now} /></li>)}</ol>
          : <p>No active pursuits are recorded. The raise owner can add LPs in the pipeline and record their next actions.</p>}
        <p className="muted">{active.filter(r => !r.score).length} active pursuits are unscored or held. They are ordered separately by evidence priority: restrictions, overdue work, soft indications and evidence gaps, with all point weights shown. These scores are guesses, not a forecast or an allocation of shared LP capital.</p>
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
    <section className="card" id="actions"><div className="chead"><h2>LPs by next action</h2><span className="lbl">{filtered.length} LPs · {selected.label}</span></div>
      <form method="get" action={`${path}#actions`} className="strategy-filters">
        <label>Show<select name="view" defaultValue={selected.id}>{views.map(v => <option value={v.id} key={v.id}>{v.label} ({v.rows.length})</option>)}</select></label>
        <label>Status<select name="status" defaultValue={query.status ?? ''}><option value="">Every status</option>{counts.map(s => <option value={s.id} key={s.id}>{s.label}</option>)}</select></label>
        <label>Next action<select name="action" defaultValue={query.action ?? ''}><option value="">Every action group</option>{groups.map(group => <option key={group}>{group}</option>)}</select></label>
        <label>Find LP, owner or action<input name="q" defaultValue={query.q ?? ''} /></label><button className="btn" type="submit">Apply</button>
      </form>
      <p className="worknote">Ranked by estimated priority within the full queue; unscored work follows by evidence priority, then LP name. Each row states whether the action is recorded or proposed. Open a score’s basis to inspect all inputs.</p>
      {!shown.length && <div className="cbody"><h3>No LPs in this view</h3><p>Try another status or coverage filter. The raise owner can add pursuits from the pipeline.</p></div>}
      {shown.map(r => <article className="strategy-action" key={r.pursuit.pursuitId}>
        <div className="strategy-action-head"><div><span className="lbl">{r.group}</span><h3><Link href={lpPath(r)}>{r.pursuit.entityName}</Link></h3><span className="flag f-mute">{STATUS_LABEL[r.pursuit.status]}</span> <Ref label="LP record" href={lpPath(r)} at={r.pursuit.sourceAsOf ?? now} basis={`Pipeline source: ${r.pursuit.source}; status source: ${r.pursuit.statusSource}. Owner and recorded next step come from this pursuit.`} /></div><div className="right"><b>{r.score ? `${money(r.score.priority)}/day` : 'Not scored'}</b><div className="muted">{r.score ? 'estimated priority' : `${r.workPriority} points · evidence priority`}</div></div></div>
        <p><b>Next:</b> {r.action}</p>
        <div className="strategy-action-grid">
          <div><span className="lbl">Owner & timing</span><p>{r.pursuit.ownerSaid ?? r.pursuit.ownerName}{!r.ownerActive && ' · local owner unavailable'}<br />{r.pursuit.nextStepOn ? `Due ${date(r.pursuit.nextStepOn)}` : 'No recorded due date'}</p>{r.suggestion?.data.next && <p className="muted">Proposed: {r.suggestion.data.next.who} · {r.suggestion.data.next.when}</p>}</div>
          <div><span className="lbl">Strategy</span><p>{r.suggestion?.data.angle ?? r.pursuit.headline ?? 'No strategy recorded for this vehicle.'}</p>{r.pursuit.plan.length > 0 && <details><summary>Recorded plan · {r.pursuit.plan.length} steps</summary><ol>{r.pursuit.plan.map((step, i) => <li key={i}>{step.move} — {step.because}{step.blockedBy && ` · Blocked by: ${step.blockedBy}`}</li>)}</ol></details>}{r.suggestion && <p className="muted">{r.suggestion.status === 'accepted' ? 'Accepted' : 'Proposed; awaiting a decision'} · {date(new Date(r.suggestion.made_at))} <Ref label="Strategy evidence" href={lpPath(r)} at={new Date(r.suggestion.made_at)} basis={`Written by ${r.suggestion.made_by}; confidence ${r.suggestion.data.confidence ?? 'unknown'}; ${r.suggestion.status}. Review linked source claims on the LP page.`} /></p>}</div>
          <div><span className="lbl">Route</span><p>{r.route?.count ? r.route.path : r.route ? 'No supported route in the stored search.' : 'No stored route search; coverage unknown.'}</p>{r.suggestion?.data.route && <p className="muted">Strategy proposes: {r.suggestion.data.route.via} · tier {r.suggestion.data.route.tier}. {r.suggestion.data.route.why}</p>}{r.route && <p className="muted">{r.route.count} candidates · {r.route.tier ? `tier ${r.route.tier} · ` : ''}{date(r.route.at)} · {r.route.current ? 'recorded search' : 'snapshot; refresh on route page'} <Ref label="Route search" href={`/${slug}/routes?target=${r.pursuit.entityId}`} at={r.route.at} basis={r.route.basis} /></p>}</div>
        </div>
        {!!r.limits.length && <p className="worknote">{r.limits.map(l => l.instruction).join(' · ')} <Ref label="Restriction evidence" href={lpPath(r)} at={new Date(r.limits[0]!.at)} basis="Active target restrictions. Do not substitute another connector to bypass them." /></p>}
        {!!r.risks.length && <details><summary>Stalled or at risk · {r.risks.length} reasons</summary><ul>{r.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul><p>Last recorded activity {date(r.touch?.lastTouch ?? r.pursuit.statusSetAt ?? r.pursuit.openedAt)}. Research {date(r.profileAt)} · {r.claimCount} active claims. <Ref label="Risk evidence" href={lpPath(r)} at={now} basis="Vehicle-aware touchpoints, owner availability, due dates, target restrictions and risks named in the strategy; missing evidence does not establish a decline." /></p></details>}
        <Basis row={r} slug={slug} now={now} />
      </article>)}
      <nav className="strategy-pagination" aria-label="LP action pages"><span>Page {page} of {pages} · {filtered.length} LPs</span>{page > 1 && <Link className="btn" href={link({ page: String(page - 1) })}>Previous</Link>}{page < pages && <Link className="btn" href={link({ page: String(page + 1) })}>Next</Link>}</nav>
    </section>
    <details className="card"><summary className="chead">Saved plays and whole-raise proposals · {plays.length} plays</summary>
      <div className="strategy-table-wrap"><Board plays={plays} users={users} path={path} empty="No saved plays yet." /></div>
      <div className="cbody"><Propose vehicleId={vehicle.id} entityId={null} path={path} placeholder="Propose work for this raise; name an owner and a date." /></div>
    </details>
    <p className="cover">Corpus: this vehicle’s pursuits, exposures, status audit, imported strategies, active research claims, public profiles, vehicle-aware touchpoints and dated route searches. Pursuit source dates: {date(earliest)}–{date(latest)}; individual strategy and route dates appear beside each LP. Missing records remain unknown. Every view has a text list; no chart is required to read it.</p>
  </Page>;
}
export default coalescePage('/[vehicle]/strategy', VehicleStrategyPage);

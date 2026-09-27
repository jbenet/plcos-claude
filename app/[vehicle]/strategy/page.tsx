import { StrategyTable, type StrategyTableRow } from '@/components/strategy/StrategyTable';
import { MoveTable, type MoveTableRow } from '@/components/strategy/MoveTable';
import { packRows } from '@/components/strategy/pack';
import { ImportMoves } from '@/components/strategy/MoveControls';
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
import { dateLabel, shortDate } from '@/lib/time';
import { config } from '@/config/deployment';
import { vehicleStrategy, STATUS_LABEL, type StrategyAction } from '@/modules/strategy';
import { boardFor, listUsers, LEVER_LABEL, LEVER_MEANS, type Play } from '@/modules/plays';
import s from './strategy.module.css';

export const dynamic = 'force-dynamic';
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 1, notation: 'compact' }).format(n);
const count = (n: number) => n.toLocaleString('en-US');
const date = (d: Date | null | undefined) => d ? shortDate(d) : 'date unknown';
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
function Ref({ label, href, at, basis, strong = false }: { label: string; href: string; at: Date; basis: string; strong?: boolean }) {
  const doc: EvidenceDoc = { docId: label, title: label, origin: 'Local records', asOf: at.toISOString().slice(0, 10), strength: strong ? 'strong' : 'weak', supports: basis, href };
  return <EvidenceRef doc={doc} />;
}

function Board({ plays, users, path }: { plays: Play[]; users: Array<{ id: string; name: string; role: string }>; path: string }) {
  if (plays.length === 0) return <div className="cbody"><div className="empty">
    <span className="stat unavailable"><i />Nothing listed</span><h3>No saved plays yet.</h3>
    <p>An empty board is a statement about our thinking, not about the option space. Propose one below.</p>
  </div></div>;
  return <table className="list board">
    <thead><tr><th style={{ width: 250 }}>Play</th><th>Why it is on the list</th><th style={{ width: 92 }}>Lever</th><th style={{ width: 88 }} className="right">Leverage</th><th style={{ width: 146 }}>Assign</th></tr></thead>
    <tbody>{plays.map(p => <tr key={p.playId}>
      <td><b>{p.title}</b><div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>{p.detail}</div>
        <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {p.entityName && p.entityId && <Link className="flag f-mute" href={`${path}/${p.entityId}`}>{p.entityName}</Link>}
          {p.gate && <span className="flag f-ev">needs {p.gate}</span>}
          <span className={`cert c-${p.certainty}`}>{p.certainty}</span>
        </div></td>
      <td className="muted">{p.because}<div style={{ marginTop: 6, color: 'var(--ink)' }}><b style={{ fontWeight: 500 }}>What it buys.</b> {p.payoff}</div></td>
      <td><span className="lever" title={LEVER_MEANS[p.lever]}>{LEVER_LABEL[p.lever]}</span></td>
      <td className="right"><div className="lev">{p.leverage.toFixed(2)}</div><div className="levsub">{p.likelihood}/5 · {p.effortDays}d · ×{p.reach}</div></td>
      <td><AssignPlay playId={p.playId} suggestedId={p.suggestedOwnerId} suggested={p.suggestedOwner} assignedTo={p.assignedTo} users={users} path={path} /></td>
    </tr>)}</tbody>
  </table>;
}

function ChooseVehicle({ vehicles }: { vehicles: Array<{ slug: string; name: string; exemption: string }> }) {
  return <Page crumbs={[{ label: 'All vehicles' }, { label: 'Strategy' }]}>
    <div className="lbl">All vehicles</div>
    <h1>Strategy is read one raise at a time</h1>
    <p className="sublede">Each vehicle has its own capital, pipeline and options, and adding them up across vehicles would blend raises that must stay separate. Choose one.</p>
    <div className="card"><table className="list"><tbody>{vehicles.map(v => <tr key={v.slug}>
      <td><Link href={`/${v.slug}/strategy`}><b>{v.name}</b></Link></td>
      <td className="muted mono" style={{ fontSize: 11.5 }}>{v.exemption}</td>
    </tr>)}</tbody></table></div>
  </Page>;
}

/** One option on the shared scale: a single-LP action or a whole-raise move. */
interface Option { id: string; kind: 'lp' | 'move'; tag: string; title: string; text: string; href: string;
  priority: number | null; expected: number | null; hours: number | null; work: number; position: number | null; chosen: boolean }

async function VehicleStrategyPage({ params, searchParams }: {
  params: Promise<{ vehicle: string }>;
  searchParams: Promise<{ view?: string; status?: string; page?: string; q?: string; action?: string }>;
}) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  // A strategy is a reading of one raise; with every vehicle selected the rail still links here.
  if (slug === 'all') return <ChooseVehicle vehicles={all} />;
  const vehicle = all.find(v => v.slug === slug);
  if (!vehicle) notFound();
  const db = await getDb();
  const [data, plays, users, query, moves, history] = await Promise.all([vehicleStrategy(vehicle.id), boardFor(vehicle.id), listUsers(), searchParams, listMoves(db, vehicle.id), moveHistory(db, vehicle.id)]);
  if (!data) notFound();
  const { total, rows, now, since, counts, weekly } = data;
  const path = `/${slug}/strategy`;
  const lpPath = (r: StrategyAction) => `/${slug}/pipeline/${r.pursuit.pursuitId}`;
  const active = rows.filter(r => !r.closed);
  const views = [
    { id: 'all', label: 'All LPs', rows },
    { id: 'risk', label: 'Stalled or at risk', rows: active.filter(r => r.risks.length > 0) },
    { id: 'research', label: 'No research on file', rows: active.filter(r => !r.profileAt && !r.claimCount) },
    { id: 'strategy', label: 'No vehicle strategy', rows: active.filter(r => !r.suggestion && !r.pursuit.headline && !r.pursuit.plan.length) },
    { id: 'route', label: 'No recorded route', rows: active.filter(r => r.route?.count === 0) },
    { id: 'unsearched', label: 'Route search not recorded', rows: active.filter(r => !r.route) },
    { id: 'refresh-route', label: 'Route search needs refresh', rows: active.filter(r => r.route && !r.route.current) },
    { id: 'owner', label: 'Owner unavailable', rows: active.filter(r => !r.ownerActive) },
  ];
  const filterLink = (view: string) => `${path}?${new URLSearchParams({ view })}#actions`;

  // One queue, one scale (0082): GUESS incremental capital per team hour. Unscored LP work follows
  // scored options by evidence points; manual positions from audited move decisions override.
  const ranked: Option[] = [
    ...active.map(r => { const e = lpEffortScore(r); return { id: r.pursuit.pursuitId, kind: 'lp' as const, tag: `LP · ${STATUS_LABEL[r.pursuit.status]}`, title: r.pursuit.entityName, text: r.action, href: lpPath(r),
      priority: e.priority, expected: e.expected, hours: e.teamHours, work: r.workPriority, position: null, chosen: false }; }),
    ...moves.filter(m => m.state !== 'dismissed').map(m => { const e = moveScore(m.estimates); return { id: m.id, kind: 'move' as const, tag: m.category, title: m.title, text: m.detail, href: `#move-${m.id}`,
      priority: e.priority, expected: e.expected, hours: m.estimates.teamHours.value, work: 0, position: m.position, chosen: m.state === 'chosen' }; }),
  ].sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || b.work - a.work || a.id.localeCompare(b.id));
  const manual = ranked.filter(r => r.position !== null).sort((a, b) => a.position! - b.position! || a.id.localeCompare(b.id));
  const queue = ranked.filter(r => r.position === null);
  // Apply from the end so ties retain a stable ID order; manual positions include LP rows.
  for (const row of manual.reverse()) queue.splice(Math.min(row.position! - 1, queue.length), 0, row);
  const top = queue.slice(0, 10);
  const topMax = Math.max(0, ...top.map(o => o.priority ?? 0));
  const ranks = new Map(queue.map((o, i) => [o.id, i + 1]));

  const viewIds = new Map(rows.map(r => [r.pursuit.pursuitId, views.filter(v => v.rows.includes(r)).map(v => v.id)]));
  const tableRows: StrategyTableRow[] = rows.map(r => {
    const effort = lpEffortScore(r);
    return {
      id: r.pursuit.pursuitId, name: r.pursuit.entityName, href: lpPath(r), action: r.action, group: r.group,
      status: r.pursuit.status, owner: r.pursuit.ownerSaid ?? r.pursuit.ownerName, rank: ranks.get(r.pursuit.pursuitId) ?? null,
      priority: effort.priority, expected: effort.expected, evidencePriority: r.workPriority,
      capacity: r.capacity, likelihood: r.likelihood, route: r.routeWeight, days: r.days, views: viewIds.get(r.pursuit.pursuitId)!,
      risks: r.risks, held: r.held,
      basis: {
        angle: r.suggestion?.data.angle ?? r.pursuit.headline ?? null,
        capacity: `${r.capacityBasis}${r.capacityBand ? ` ${r.capacityBand}` : ''}`,
        likelihood: r.propensity?.basis ?? null,
        route: r.route ? `${r.route.path || 'No path recorded'} · tier ${r.route.tier ?? 'unknown'} · ${r.route.count} found ${date(r.route.at)}${r.route.current ? '' : ' · needs refresh'}` : null,
        decision: r.decision?.basis ?? null,
        conversion: [r.conversion.forward, r.conversion.observed, Number(r.conversion.factor.toFixed(2))],
        work: r.workFactors.map(f => [f.label, f.points] as [string, number]),
        due: r.pursuit.nextStepOn ? date(r.pursuit.nextStepOn) : null,
        proposed: r.suggestion?.data.next?.who || r.suggestion?.data.next?.when ? `${r.suggestion?.data.next?.who ?? 'someone'} · ${r.suggestion?.data.next?.when ?? 'no date'}` : null,
        strategy: r.suggestion ? `${r.suggestion.status} · ${r.suggestion.made_by} · ${date(new Date(r.suggestion.made_at))} · confidence ${r.suggestion.data.confidence ?? 'unknown'}` : null,
        plan: r.pursuit.plan.map(p => [p.move, p.because] as [string, string]),
      },
    };
  });
  const moveRows: MoveTableRow[] = moves.map(m => { const e = moveScore(m.estimates); return { ...m, rank: ranks.get(m.id) ?? null, expected: e.expected, priority: e.priority }; });

  // Where the raise stands, in sentences that each rest on a record shown lower on the page.
  const scored = active.filter(r => lpEffortScore(r).priority !== null).length;
  // Every step with recorded exits, largest sample first: a thin sample is shown as one, not ranked.
  const exits = counts.filter(c => c.id !== 'passed' && c.conversion.observed > 0).sort((a, b) => b.conversion.observed - a.conversion.observed);
  const open = counts.filter(c => c.id !== 'passed' && c.id !== 'committed' && c.count > 0);
  const heaviest = [...open].sort((a, b) => b.count - a.count)[0];
  const gaps = views.slice(2).filter(v => v.rows.length > 0).sort((a, b) => b.rows.length - a.rows.length).slice(0, 2);
  const movesInTop = top.filter(o => o.kind === 'move').length;
  const liveMoves = moves.filter(m => m.state !== 'dismissed').length;
  const gap = total.gapToTarget === null ? null : Math.max(0, total.gapToTarget);
  const headline = total.historical ? `A past raise: ${money(total.hard)} hard.`
    : gap === null ? total.soft > 0 ? `${money(total.hard)} hard. ${money(total.soft)} soft to convert.` : `${money(total.hard)} hard. No target set.`
    : gap === 0 ? `Target reached on hard commitments.`
    : total.soft > 0 ? `${money(gap)} to go. ${money(total.soft)} soft to convert.` : `${money(gap)} to go.`;
  const sourceRange = rows.map(r => r.pursuit.sourceAsOf).filter((d): d is Date => Boolean(d));
  const earliest = sourceRange.length ? new Date(Math.min(...sourceRange.map(d => d.getTime()))) : null;
  const latest = sourceRange.length ? new Date(Math.max(...sourceRange.map(d => d.getTime()))) : null;

  return <Page crumbs={[{ label: vehicle.name, href: `/${slug}/overview` }, { label: 'Strategy' }]} inspector={<>
    <div className="lbl">This raise</div><div className="ihead">{vehicle.name}</div>
    <div className="imeta">{vehicle.exemption} · as of {date(now)}</div>
    <div className="kv"><span>LP pursuits</span><span>{count(rows.length)}</span></div>
    <div className="kv"><span>Active</span><span>{count(active.length)}</span></div>
    <div className="kv"><span>LP actions with a score</span><span>{count(scored)}</span></div>
    <div className="kv"><span>Moves on the menu</span><span>{liveMoves}</span></div>
    <div className="kv"><span>Chosen for planning</span><span>{moves.filter(m => m.state === 'chosen').length}</span></div>
    <div className="scope"><div className="lbl">How options are ranked</div>
      <p>Every option, an LP action or a whole-raise move, sits on one scale: <b>GUESS capital moved per team hour</b>.</p>
      <p>LP action: capacity × likelihood × route weight × conversion adjustment × a {config.strategyRanking.actionValueFraction} action share, over {config.strategyRanking.actionTeamHours} team hours.</p>
      <p>Move: LPs reached × (check × conversion lift + check lift × conversion) × effect discount, over its team hours.</p>
      <p>Every input is a guess and is shown on its row. Options overlap the same LPs, so their capital is never added up.</p>
    </div>
    <div className="note">A ranking authorizes nothing. Sends, intro requests, spend and publication each need their own approval.</div>
    <div className="acts"><Link className="btn" href={`/${slug}/pipeline`}>Pipeline</Link><Link className="btn" href={`/${slug}/routes`}>Routes</Link></div>
  </>}>
    <div className={s.page}>
    <div className="lbl">Strategy · {vehicle.name} · {dateLabel(now)}</div>
    <h1>{headline}</h1>
    <p className="sublede">Where this raise stands, and every option we have, single-LP actions and whole-raise moves, ranked on one scale so the next hour goes where it moves the most.</p>

    <div className={`kpis ${s.kpis}`}>
      <div className="kpi"><span className="tag t-hard">Hard</span><div className="n g">{money(total.hard)}</div>
        <div className="f">{plural(total.hardCount, 'hard commitment')}. {money(total.cash)} received as cash, a separate state.</div></div>
      <div className="kpi soft"><span className="tag t-soft">Soft</span><div className="n">{money(total.soft)}</div>
        <div className="f">{plural(total.softCount, 'indication')}. <b>Never added to hard.</b></div></div>
      <div className="kpi"><div className="lbl">Gap to target</div><div className={gap === null ? 'n q' : 'n'}>{gap === null ? 'Not set' : money(gap)}</div>
        <div className="f">{total.target === null ? 'Record the raise target to measure the gap.' : `Hard only, against ${money(total.target)}.`}</div></div>
      <div className="kpi"><div className="lbl">Active pipeline</div><div className="n">{count(active.length)}</div>
        <div className="f">{plural(data.added, 'LP')} added and {plural(weekly.length, 'status change')} since {date(since)}.</div></div>
    </div>

    <section className={`diagbox ${s.diag}`} aria-label="Where the raise stands">
      <p><b>Money.</b> {total.target === null ? `${money(total.hard)} hard; no target is recorded, so the gap is unknown.` : `${money(total.hard)} hard of a ${money(total.target)} target.`}{' '}
        {total.soft > 0 ? `${money(total.soft)} soft across ${plural(total.softCount, 'indication')} is the nearest capital, and counts only once it hardens.` : 'No soft indications are recorded.'}{' '}
        <Ref label="Raise records" href={`/${slug}/pipeline`} at={now} strong basis="This vehicle's exposures and configured target. Only the hard track counts toward the headline; status Committed alone does not." /></p>
      <p><b>Pipeline.</b> {count(active.length)} active{open.length ? `: ${open.map(c => `${count(c.count)} ${c.label.toLowerCase()}`).join(', ')}` : ''}.{' '}
        {heaviest && active.length > 0 && heaviest.count / active.length > 0.5 ? `Most of it sits in ${heaviest.label.toLowerCase()}. ` : ''}
        {exits.length ? `Of LPs recorded leaving a stage, ${exits.slice(0, 3).map(c => `${c.conversion.forward} of ${c.conversion.observed} moved forward out of ${c.label.toLowerCase()}`).join('; ')}.`
          : 'No stage exits are recorded yet, so stage-to-stage conversion is unknown, not zero.'}{' '}
        <Ref label="Conversion basis" href="#funnel" at={now} basis="Vehicle-scoped status-change audit. Distinct LPs with recorded exits; history is incomplete, so these are not cohort conversion rates." /></p>
      {gaps.length > 0 && <p><b>Gaps.</b> {gaps.map((g, i) => <span key={g.id}>{i > 0 ? '; ' : ''}<Link className={s.inline} href={filterLink(g.id)}>{count(g.rows.length)} {g.label.toLowerCase()}</Link></span>)}. Missing records are unknown, not evidence of absence.</p>}
      {top[0] ? <p><b>Next.</b> Highest on the scale: <a className={s.inline} href={top[0].href}>{top[0].title}</a>{top[0].priority !== null ? `, GUESS ${money(top[0].priority)} per team hour` : ', unscored'}.{' '}
        {movesInTop} of the top {top.length} are whole-raise moves and {top.length - movesInTop} are single-LP actions. {count(scored)} of {plural(active.length, 'LP action')} have the inputs for a score; the rest follow, ordered by evidence work.{scored < active.length ? ' An LP action is scored once it has a capacity, a likelihood and a current route.' : ''}</p>
        : <p><b>Next.</b> No active LP actions or moves are recorded. Add pursuits in the pipeline or import a move menu below.</p>}
      {total.historical && <p className="muted">Historical vehicle: these records describe a past raise.</p>}
    </section>

    <section className={`card ${s.nextCard}`} aria-labelledby="so-next">
      <div className="chead"><h2 id="so-next">So next</h2><span className="lbl">{top.length ? `top ${top.length} of ${count(queue.length)} options · GUESS $ per team hour` : 'nothing ranked yet'}</span></div>
      {top.length ? <div className="tscroll"><table className={`list ${s.next}`}>
        <thead><tr><th className={s.num}>#</th><th className={s.hideS}>Kind</th><th>Option</th><th className={`${s.r} ${s.hideS}`}>GUESS capital</th><th className={`${s.r} ${s.hideS}`}>Team h</th><th className={s.score}>GUESS $ / team h</th></tr></thead>
        <tbody>{top.map((o, i) => <tr key={o.id}>
          <td className={s.num}>{i + 1}</td>
          <td className={s.hideS}><span className={`tag ${o.kind === 'lp' ? s.tagLp : s.tagMove}`}>{o.tag}</span></td>
          <td className={s.what}><span className={s.t1}><a href={o.href}><b>{o.title}</b></a>{o.chosen && <span className={s.chosen}>chosen</span>}{o.position !== null && <span className={s.manual}>placed #{o.position}</span>}</span><span className={s.text}>{o.text}</span></td>
          <td className={`${s.r} ${s.hideS}`}>{o.expected === null ? '—' : money(o.expected)}</td>
          <td className={`${s.r} ${s.hideS}`}>{o.hours ?? '—'}</td>
          <td className={s.score}>{o.priority === null ? <span className="muted">Unscored · {o.work} evidence pts</span> : <><span className={s.bar} aria-hidden><i style={{ width: `${topMax ? Math.max(3, o.priority / topMax * 100) : 0}%` }} /></span><b>{money(o.priority)}</b></>}</td>
        </tr>)}</tbody>
      </table></div> : <div className="cbody"><div className="empty"><h3>Nothing to rank yet</h3><p>No active pursuits or moves are recorded for this raise. The raise owner can add LPs in the pipeline or import a move menu below.</p></div></div>}
      <p className="cover"><b>One scale for every option.</b> Each estimate is a labelled guess; open an LP or a move to see its factors. A manual position from a recorded decision overrides model order. Alternatives overlap the same LPs, so their capital is never summed into a forecast, into hard capital, or across vehicles.</p>
    </section>

    <div className={s.pair}>
      <section className="card" id="funnel" aria-labelledby="funnel-h">
        <div className="chead"><h2 id="funnel-h">Pipeline and conversion</h2><Ref label="Status evidence" href={`/${slug}/pipeline`} at={now} strong basis="Pursuit statuses and the status-change audit for this vehicle. A status is our plan; it infers no consent, signature or cash." /></div>
        <table className={`list ${s.funnel}`}>
          <thead><tr><th>Status</th><th className={s.r}>LPs</th><th aria-label="Share of pursuits" /><th>Recorded exits moving forward</th></tr></thead>
          <tbody>{counts.map(c => <tr key={c.id}>
            <td>{c.label}</td><td className={s.r}>{count(c.count)}</td>
            <td className={s.fbar}><span className={s.bar} aria-hidden><i style={{ width: `${rows.length ? Math.max(c.count ? 2 : 0, c.count / Math.max(...counts.map(x => x.count)) * 100) : 0}%` }} /></span></td>
            <td className="muted">{c.id === 'passed' ? '—' : c.conversion.observed ? `${c.conversion.forward} of ${c.conversion.observed}` : 'none recorded'}</td>
          </tr>)}</tbody>
        </table>
        <div className="cbody"><details className={s.weekly}><summary>This week: {plural(data.added, 'LP')} added · {plural(weekly.length, 'status change')} · {money(data.hardened)} hardened</summary>
          {weekly.length ? <ul>{weekly.map((t, i) => { const r = rows.find(r => r.pursuit.pursuitId === t.pursuitId); return <li key={i}><span className="mono">{date(t.at)}</span> {r ? <Link href={lpPath(r)}>{r.pursuit.entityName}</Link> : 'Pursuit'} · {STATUS_LABEL[t.from]} → {STATUS_LABEL[t.to]}</li>; })}</ul>
            : <p className="muted">No status changes recorded since {date(since)}. Missing history is not evidence of no activity.</p>}
        </details></div>
        <p className="cover">Exits count distinct LPs recorded leaving a status; imports are not progress. History is incomplete, so these are not cohort conversion rates.</p>
      </section>
      <section className="card" aria-labelledby="gaps-h">
        <div className="chead"><h2 id="gaps-h">Gaps and risks</h2><span className="lbl">active LPs</span></div>
        <div className={s.gaps}>{views.slice(1).map(v => <Link key={v.id} href={filterLink(v.id)} className={v.rows.length ? undefined : s.zero}>
          <b>{count(v.rows.length)}</b><span>{v.label}</span><i aria-hidden>→</i></Link>)}</div>
        <p className="cover">Each opens the LP table below, filtered. Stalled means {config.strategyRanking.stalledDays}+ days without recorded activity (GUESS); silence is not a decline. Route counts describe dated stored searches, not every possible route.</p>
      </section>
    </div>

    <section className="card" id="moves" aria-labelledby="moves-h">
      <div className="chead"><h2 id="moves-h">Menu of moves</h2><div className={s.chead}><span className="lbl">whole-raise options · {liveMoves} live</span><ImportMoves /></div></div>
      <MoveTable moves={moveRows} vehicleId={vehicle.id} />
      <details className={s.history}><summary>Recorded move decisions · {history.length}</summary>
        {history.length ? <ul>{history.map((h, i) => <li key={i}><span className="mono">{date(new Date(h.at))}</span> {h.actor ?? 'Unknown person'} · <b>{h.title}</b>: {h.detail.before.state} → {h.detail.after.state}; position {h.detail.before.position ?? 'model'} → {h.detail.after.position ?? 'model'}. <span className="muted">{h.detail.note}</span></li>)}</ul>
          : <p className="muted">No one has chosen, dismissed or placed a move for this raise yet.</p>}
      </details>
      <p className="cover">Every figure is a GUESS scenario for this raise alone, never a commitment. Chosen means selected for planning; it authorizes no send, introduction, spend or publication.</p>
    </section>

    <section className="card" id="actions" aria-labelledby="actions-h">
      <div className="chead"><h2 id="actions-h">LPs by next action</h2><span className="lbl">{count(rows.length)} LPs · search with /</span></div>
      <StrategyTable table={packRows(tableRows, views.map(v => v.id), `/${slug}/pipeline/`)} asOf={now.toISOString()} initialFilters={query} views={views.map(v => ({ id: v.id, label: v.label }))}
        rules={{ hours: config.strategyRanking.actionTeamHours, share: config.strategyRanking.actionValueFraction, prior: config.strategyRanking.conversionPriorWeight }} />
    </section>

    <details className="card"><summary className={`chead ${s.summary}`}><h2>Saved plays and proposals</h2><span className="lbl">{plays.length} plays</span></summary>
      <div className="tscroll"><Board plays={plays} users={users} path={path} /></div>
      <div className="cbody"><Propose vehicleId={vehicle.id} entityId={null} path={path} placeholder="Propose work for this raise; name an owner and a date." /></div>
    </details>

    <p className={s.corpus}>Corpus: this vehicle’s pursuits, exposures, status audit, imported strategies and moves, active research claims, public profiles, vehicle-aware touchpoints and dated route searches. Pursuit source dates {date(earliest)} to {date(latest)}. Missing records stay unknown.</p>
    </div>
  </Page>;
}
export default coalescePage('/[vehicle]/strategy', VehicleStrategyPage);

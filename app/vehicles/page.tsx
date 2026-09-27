import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { CloseProgress } from '@/components/status/CloseProgress';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { usdM } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { CLOSE_PAGE_SIZE, vehicleCloseStatus, vehicleStatusCounts, vehicleTotals } from '@/modules/pipeline';
import { STATUSES } from '@/modules/strategy';

export const dynamic = 'force-dynamic';

async function Vehicles({ searchParams }: { searchParams: Promise<{ closePage?: string }> }) {
  const selection = await vehicleSelection();
  const vehicleId = selection.current?.id ?? null;
  const search = await searchParams;
  const [allTotals, counts, close] = await Promise.all([
    vehicleTotals(), vehicleStatusCounts(vehicleId), vehicleCloseStatus(vehicleId, Number(search.closePage ?? 1)),
  ]);
  const totals = allTotals.filter(t => !vehicleId || t.vehicleId === vehicleId);
  const base = `/${selection.current?.slug ?? 'all'}/status`;
  return <Page crumbs={moduleCrumbs('vehicles', selection.current?.name ?? null)}>
    <div className="lbl">Module 09 · Convert &amp; coordinate · WIP</div>
    <h1>Vehicle status</h1>
    <p className="sublede">{selection.current?.name ?? 'All vehicles'} · Pipeline counts, close records and work still open.
      This page is a work in progress and may be incomplete.</p>

    {totals.map(t => <section className="card status-summary" key={t.vehicleId}>
      <div className="chead"><h2>{t.vehicleName}{t.historical ? ' · history' : ''}</h2>
        <Link href={`/${t.vehicleSlug}/pipeline`}>Open pipeline →</Link></div>
      <dl className="status-money">
        <div><dt>Hard · signed &amp; countersigned</dt><dd>{usdM(t.hard)}</dd></div>
        <div><dt>Soft · must convert</dt><dd>{usdM(t.soft)}</dd></div>
        <div><dt>Cash received · within hard</dt><dd>{usdM(t.cash)}</dd></div>
        <div><dt>Gap to target · hard only</dt><dd>{t.gapToTarget === null ? 'Target not set' : usdM(t.gapToTarget)}</dd></div>
      </dl>
      <h3 className="status-section-label">Pipeline stats</h3>
      <dl className="status-counts">{STATUSES.map(s => {
        const count = counts.find(c => c.vehicle_id === t.vehicleId && c.status === s.id);
        return <div key={s.id}><dt>{s.label}</dt><dd>{count?.n ?? 0}</dd>
          {Boolean(count?.archived) && <small>{count!.archived} archived</small>}</div>;
      })}</dl>
      <p className="cover">Counts include archived pursuits, labelled above. Pipeline status is our plan; it does not establish consent, a legal close or cash receipt.
        Hard and soft stay separate. Each vehicle stands on its own.</p>
    </section>)}

    <section className="card status-close-list">
      <div className="chead"><h2>LP close progress</h2><span className="lbl">{close.total} LP–vehicle {close.total === 1 ? 'pair' : 'pairs'}</span></div>
      <p className="cover">LPs with an open commitment record or an active Committed pursuit. Every commitment is shown separately.
        Missing milestones remain unknown; a later milestone does not fill them in.</p>
      {close.rows.length === 0 && <div className="status-empty"><h3>No LPs in close states yet</h3>
        <p>There are no open commitments or active Committed pursuits in this scope. The vehicle owner can review the pipeline and record the next step in an LP workspace.</p>
        <Link href={`/${selection.current?.slug ?? 'all'}/pipeline`}>Review pipeline →</Link></div>}
      {close.rows.map(lp => {
        const href = lp.pursuit_id ? `/${lp.vehicle_slug}/pipeline/${lp.pursuit_id}` : `/orgs/${lp.entity_id}`;
        return <article className="status-lp" key={`${lp.entity_id}:${lp.vehicle_id}`}>
          <header><div><h3><Link href={href}>{lp.entity_name}</Link></h3><p className="muted">{lp.vehicle_name} · Owner: {lp.owner_name ?? lp.tracks[0]?.exposure.ownerName ?? 'not assigned'}</p></div>
            <Link href={href}>Open LP →</Link></header>
          {lp.tracks.map(track => <CloseProgress key={track.exposure.exposureId} track={track} />)}
          {lp.tracks.length === 0 && <div className="status-track"><p><b>Committed in the pipeline · close record missing</b></p>
            <p>No soft, signed, hard, legal-close or cash record is modelled here. Dates are not modelled yet.</p>
            {lp.stage_said && <p className="muted">Source says: {lp.stage_said} · {lp.source} · as of {lp.source_as_of ? shortDate(new Date(lp.source_as_of)) : 'not recorded'}. This is a claim, not close evidence.</p>}
          </div>}
          <div className="status-work">
            <section><h4>Next steps</h4>
              <p>{lp.next_step ?? 'No next step recorded. The owner can add one in the LP workspace.'}
                {lp.next_step_on && <> · Due {shortDate(new Date(lp.next_step_on))}</>}</p>
              {lp.conditions.map((c, i) => <p key={i}><b>{c.entity_id === null ? 'Vehicle condition' : 'Close condition'}: {c.label}</b>
                {c.detail && ` · ${c.detail}`} · Owner: {c.owner_name ?? 'not assigned'} · {c.due_on ? `Due ${shortDate(new Date(c.due_on))}` : 'No due date'}</p>)}
            </section>
            <section><h4>Open questions ({lp.questions.length})</h4>
              {lp.questions.length ? <ul>{lp.questions.map(q => <li key={q.question_id}>{q.question} · {q.status}
                {q.due_on && ` · Due ${shortDate(new Date(q.due_on))}`}</li>)}</ul> : <p className="muted">No open diligence questions recorded for this LP and vehicle.</p>}
              <Link href={`/${lp.vehicle_slug}/decisions`}>Decision room →</Link>
            </section>
            <section><h4>Notes</h4>
              {lp.headline && <p>{lp.headline}</p>}{lp.status_reason && <p>{lp.status_reason}</p>}
              {lp.note && <><p className="muted">Latest LP-wide context · {shortDate(new Date(lp.note.created_at))} · applies across vehicles</p><p className="status-note">{lp.note.body}</p></>}
              {!lp.headline && !lp.status_reason && !lp.note && <p className="muted">No strategy or context note recorded.</p>}
            </section>
          </div>
        </article>;
      })}
      {close.total > CLOSE_PAGE_SIZE && <nav className="status-pagination" aria-label="Close progress pages">
        {close.page > 1 && <Link href={`${base}?closePage=${close.page - 1}`}>← Previous</Link>}
        <span>Page {close.page} of {Math.ceil(close.total / CLOSE_PAGE_SIZE)} · up to {CLOSE_PAGE_SIZE} LPs per page</span>
        {close.page * CLOSE_PAGE_SIZE < close.total && <Link href={`${base}?closePage=${close.page + 1}`}>Next →</Link>}
      </nav>}
    </section>
  </Page>;
}

export default coalescePage('/vehicles', Vehicles);

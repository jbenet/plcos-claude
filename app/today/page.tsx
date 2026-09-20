import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { auth } from '@/lib/auth';
import { issues as issueSink, SLA } from '@/lib/issues';
import { listSyncSources, listVehicles, recentAudit } from '@/modules/platform';
import { vehicleSelection } from '@/lib/session';
import { ago, dateLabel } from '@/lib/time';
import { ALL_MODULES } from '@/lib/nav';
import { KIND_CLASS, listOpenTickets } from '@/modules/governance';
import { listConflicts } from '@/modules/coordination';

export const dynamic = 'force-dynamic';

export default async function Today() {
  const [user, sink, sources, vehicles, selection, audit] = await Promise.all([
    auth().then((a) => a.currentUser()),
    issueSink(),
    listSyncSources(),
    listVehicles(),
    vehicleSelection(),
    recentAudit(8),
  ]);
  const open = await sink.list({ status: ['open', 'triaged', 'agent-ready', 'in-progress', 'review'] });
  const [tickets, conflicts] = await Promise.all([listOpenTickets(), listConflicts('open')]);
  const connected = sources.filter((s) => s.status === 'ok' && s.source !== 'seed').length;
  const built = ALL_MODULES.filter((m) => m.built).length;

  return (
    <Page crumbs={[{ label: selection.current ? selection.current.name : 'All vehicles' }, { label: 'Today' }]}>
      <div className="lbl">{dateLabel(new Date())}</div>
      <h1>Nothing is being tracked yet. That is the correct state.</h1>
      <p className="sublede">
        L1 builds the shell, the five seams and the feedback loop — and nothing else. The numbers
        below are the only ones this system can currently stand behind. No pipeline, no
        commitments, no routes: those land from L2 onward, and until then this page shows what is
        real rather than a demo of what isn&rsquo;t.
      </p>

      <div className="kpis">
        <div className="kpi">
          <span className="tag t-plain">Vehicles</span>
          <div className="n">{vehicles.length}</div>
          <div className="f">
            {vehicles.filter((v) => v.kind === 'fund').length} funds,{' '}
            {vehicles.filter((v) => v.kind === 'spv').length} SPVs, one grants rail. Seed records,
            not a cap table.
          </div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">Open issues</span>
          <div className="n">{open.length}</div>
          <div className="f">
            Filed through the feedback box into <code>issues/</code>. {open.filter((i) => i.priority === 'P0' || i.priority === 'P1').length} at
            P0 or P1.
          </div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">Sources connected</span>
          <div className="n q">{connected} of {sources.length - 1}</div>
          <div className="f">
            No connector before L13, by design. Everything here runs on fixtures.
          </div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">Build stage</span>
          <div className="n q">L1 of L13</div>
          <div className="f">
            {built} of {ALL_MODULES.length} module screens built. The rail shows which stage each
            of the rest lands at.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Needs a decision</h2>
          <span className="lbl">
            {tickets.length} open ticket{tickets.length === 1 ? '' : 's'}
            {tickets.length > 0 ? ` \u00b7 oldest ${ago(tickets[0]!.createdAt)}` : ''}
          </span>
        </div>
        {tickets.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                Nothing pending
              </span>
              <h3>No mutating command is waiting on an approval.</h3>
              <p>
                This is an empty table, not a failed read. The five ticket kinds gate mutations
                before the fact; none has been proposed since the last decision.
              </p>
              <dl>
                <dt>What is known</dt>
                <dd>Zero open tickets.</dd>
                <dt>Who can act</dt>
                <dd>{user.name}, when something is proposed.</dd>
                <dt>Safe next step</dt>
                <dd>
                  <Link href="/approvals" style={{ borderBottom: '1px dotted var(--clay)', color: 'var(--clay)' }}>
                    Read what each ticket kind gates
                  </Link>
                  .
                </dd>
              </dl>
            </div>
          </div>
        ) : (
          tickets.map((t) => {
            const conflict = conflicts.find(
              (c) => c.claimantA.ticketId === t.id || c.claimantB.ticketId === t.id,
            );
            return (
              <Link key={t.id} href={`/approvals?t=${t.id}`} className="row">
                <span className={`kind ${KIND_CLASS[t.kind]}`} style={{ width: 150 }}>
                  {t.kind}
                </span>
                <div className="t">
                  <b>{t.subjectLabel}</b>
                  <span>
                    {conflict
                      ? `Conflict: ${conflict.claimantA.vehicleName} opened an ask on the same actor ${ago(conflict.claimantA.madeAt ?? conflict.claimantA.createdAt)}`
                      : t.scope.authorizes}
                  </span>
                </div>
                <div className="state">
                  <b>{conflict ? 'Blocked' : t.kind === 'STAGE' ? 'Needs evidence' : 'Ready'}</b>
                  {conflict ? 'Adjudication required' : `Requested by ${t.requestedByName}`}
                </div>
              </Link>
            );
          })
        )}
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Recently filed</h2>
            <span className="lbl">issues/ · {sink.destination.split(' in ')[0]}</span>
          </div>
          {open.length === 0 ? (
            <div className="cbody">
              <p className="muted">
                No open issues. The feedback box in the bar above writes one markdown file per
                complaint, into this repository.
              </p>
            </div>
          ) : (
            open.slice(0, 5).map((i) => (
              <Link key={i.id} href={`/issues/${i.id}`} className="row">
                <span className={`kind k-${i.kind}`} style={{ width: 74 }}>
                  {i.priority} · {i.kind}
                </span>
                <div className="t">
                  <b>{i.title}</b>
                  <span>
                    {i.reporter} · {i.page} · fix: {SLA[i.priority].fix}
                  </span>
                </div>
                <div className="state">
                  <b>{i.status}</b>
                  {i.created ? ago(new Date(i.created)) : ''}
                </div>
              </Link>
            ))
          )}
        </div>

        <div className="card">
          <div className="chead">
            <h2>What happened</h2>
            <span className="lbl">audit log · append-only</span>
          </div>
          <table className="list">
            <tbody>
              {audit.map((a, idx) => (
                <tr key={idx}>
                  <td className="nowrap muted mono" style={{ fontSize: 10.5, width: 70 }}>
                    {ago(new Date(a.at))}
                  </td>
                  <td>
                    <b>{a.action}</b>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {a.name ?? 'system'} · {a.subject_type}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}

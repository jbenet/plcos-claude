import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { auth } from '@/lib/auth';
import { issues as issueSink, SLA } from '@/lib/issues';
import { listSyncSources, listVehicles, recentAudit } from '@/modules/platform';
import { vehicleSelection } from '@/lib/session';
import { ago, dateLabel } from '@/lib/time';
import { ALL_MODULES } from '@/lib/nav';

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
          <span className="lbl">approval tickets · lands at L3</span>
        </div>
        <div className="cbody">
          <div className="empty">
            <span className="stat unavailable">
              <i />
              Not built yet
            </span>
            <h3>There is no approval queue because nothing can request one yet.</h3>
            <p>
              The five ticket kinds — <code>SEND</code>, <code>INTRO_ASK</code>, <code>MONEY</code>,{' '}
              <code>STAGE</code>, <code>ALLOCATION_EXCEPTION</code> — gate mutations before the
              fact. They arrive at L3 together with the ask log and conflict cases, because a gate
              without something to gate is decoration.
            </p>
            <dl>
              <dt>What is known</dt>
              <dd>Zero tickets exist. This is an empty table, not a failed read.</dd>
              <dt>Who can act</dt>
              <dd>Nobody yet. {user.name}, you are looking at the shell.</dd>
              <dt>Safe next step</dt>
              <dd>
                <Link href="/approvals" style={{ borderBottom: '1px dotted var(--clay)', color: 'var(--clay)' }}>
                  Read what each ticket kind will gate
                </Link>
                .
              </dd>
            </dl>
          </div>
        </div>
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

import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { SprintStrip } from '@/components/calendar/SprintStrip';
import { auth } from '@/lib/auth';
import { issues as issueSink } from '@/lib/issues';
import { auditLog } from '@/modules/platform';
import { describeAudit } from '@/lib/audit-words';
import { touchpointSummaries } from '@/modules/meetings';
import { vehicleSelection } from '@/lib/session';
import { ago, dateLabel, shortDate } from '@/lib/time';
import { usdM, multiple } from '@/lib/money';
import { KIND_CLASS, listOpenTickets } from '@/modules/governance';
import { listAsks, listConflicts } from '@/modules/coordination';
import { listPursuits } from '@/modules/strategy';
import { listExposures, vehicleTotals } from '@/modules/pipeline';
import { sprintStrip, urgency } from '@/modules/calendar';
import { actionableSignals, heldBack } from '@/modules/signals';
import { SignalRow } from '@/components/signals/SignalRow';

export const dynamic = 'force-dynamic';

export default async function Today() {
  const [user, sink, selection, audit, tickets, conflicts, asks, pursuits, totals, weeks, urgencyState] =
    await Promise.all([
      auth().then((a) => a.currentUser()),
      issueSink(),
      vehicleSelection(),
      auditLog(40),
      listOpenTickets(),
      listConflicts('open'),
      listAsks(),
      listPursuits(),
      vehicleTotals(),
      sprintStrip(7),
      urgency(),
    ]);
  const [signals, held, exposures] = await Promise.all([actionableSignals(5), heldBack(), listExposures()]);
  // A $0 hard headline beside a soft track read from a source says why, in the same place,
  // rather than reading as "nothing committed" (rule 1 keeps it $0; it does not keep it silent).
  const whyZero = totals
    .filter((t) => t.hard === 0 && exposures.some((x) => x.vehicleId === t.vehicleId && x.source !== 'us'))
    .map((t) => ({
      name: t.vehicleName,
      signed: exposures.filter((x) => x.vehicleId === t.vehicleId && /ready to harden/.test(x.claim ?? '')).length,
    }));

  const open = await sink.list({ status: ['open', 'triaged', 'agent-ready', 'in-progress', 'review'] });
  const focus = selection.current ? totals.find((t) => t.vehicleId === selection.current!.id) ?? null : null;
  const blocked = asks.filter((a) => a.status === 'blocked');
  // Waiting on a first reply (N62, issue 0008): LPs at Connecting with nothing from them on
  // record — the status's view of what "stuck at rung one" used to count. Longest wait first.
  const connecting = pursuits.filter((p) => p.status === 'connecting');
  const heard = await touchpointSummaries(connecting.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId })));
  const waitingOn = connecting
    .map((p) => ({ p, s: heard.get(`${p.entityId}:${p.vehicleId}`) }))
    .filter((x) => !x.s?.lastFromThem)
    .map((x) => ({ ...x, since: x.s?.awaitingSince ?? x.p.statusSetAt ?? x.p.openedAt }))
    .sort((a, b) => a.since.getTime() - b.since.getTime());
  // Signing in as someone else is not something that happened to the raise.
  const happened = audit.filter((a) => a.action !== 'session.user_switched').slice(0, 7);

  const headline = urgencyState.suppressed
    ? 'Nothing is being chased this week.'
    : tickets.length > 0
      ? `${tickets.length} decision${tickets.length === 1 ? '' : 's'} only you can make.`
      : 'Nothing is waiting on you.';

  const sublede = urgencyState.suppressed
    ? `${urgencyState.reason} The queue below is unchanged — what has changed is that this page is not going to pretend anyone will answer.`
    : tickets.length > 0
      ? 'Everything else on the board is moving without you.'
      : 'No mutating command is waiting on an approval. That is an empty queue, not a failed read.';

  return (
    <Page crumbs={[{ label: SECTION.overview }, { label: 'Today' }]}>
      <div className="lbl">{dateLabel(new Date())}</div>
      <h1>{headline}</h1>
      <p className="sublede">{sublede}</p>

      {focus ? (
        <div className="kpis">
          <div className="kpi">
            <span className="tag t-hard">Hard</span>
            <div className="n g">{usdM(focus.hard)}</div>
            <div className="f">Signed and countersigned. The only number that appears in a headline.</div>
          </div>
          <div className="kpi soft">
            <span className="tag t-soft">Soft</span>
            <div className="n">{usdM(focus.soft)}</div>
            <div className="f">
              {focus.softCount} indications. <b>Never added to hard.</b> Convertible{' '}
              {usdM(focus.convertibleSoft, 2)}.
            </div>
          </div>
          <div className="kpi">
            <div className="lbl">Gap to target</div>
            <div className="n">{focus.gapToTarget === null ? '—' : usdM(focus.gapToTarget)}</div>
            <div className="f">
              Hard-only basis. {weeks.filter((w) => !w.dead).length} working weeks in the next{' '}
              {weeks.length}.
            </div>
          </div>
          <div className="kpi">
            <div className="lbl">Coverage</div>
            <div className="n">{focus.coverage === null ? '—' : multiple(focus.coverage)}</div>
            <div className="f">
              Pipeline depth, not money. {pursuits.filter((p) => p.vehicleId === focus.vehicleId && !p.closedAt).length}{' '}
              pursuits open.
            </div>
          </div>
        </div>
      ) : (
        <div className="kpis">
          <div className="kpi">
            <span className={tickets.length ? 'tag t-clay' : 'tag t-plain'}>Waiting on a decision</span>
            <div className="n">{tickets.length}</div>
            <div className="f">
              Approval tickets open{tickets.length ? ` · oldest ${ago(tickets[0]!.createdAt)}` : ''}.
            </div>
          </div>
          <div className="kpi">
            <span className={conflicts.length ? 'tag t-clay' : 'tag t-plain'}>Conflicts</span>
            <div className="n">{conflicts.length}</div>
            <div className="f">Two vehicles on one actor inside the window.</div>
          </div>
          <div className="kpi">
            <span className="tag t-plain">Asks blocked</span>
            <div className="n">{blocked.length}</div>
            <div className="f">Refused by a guard before anything left the building.</div>
          </div>
          <div className="kpi">
            <span className="tag t-plain">Waiting on a first reply</span>
            <div className="n">{waitingOn.length}</div>
            <div className="f">
              Connecting, and nothing from them yet: a connector is asking, or we wrote.
            </div>
          </div>
        </div>
      )}

      {!focus && (
        <div className="card">
          <div className="chead">
            <h2>Each vehicle, hard only</h2>
            <span className="lbl">select one in the rail for a headline</span>
          </div>
          <table className="list">
            <tbody>
              {totals
                .filter((t) => t.hard > 0 || t.soft > 0)
                .map((t) => (
                  <tr key={t.vehicleId}>
                    <td>
                      <b>{t.vehicleName}</b>
                    </td>
                    <td className="right mono" style={{ color: 'var(--green)', width: 100 }}>
                      {usdM(t.hard)}
                    </td>
                    <td className="right mono muted" style={{ width: 120 }}>
                      {usdM(t.soft)} soft
                    </td>
                    <td className="right mono muted" style={{ width: 130 }}>
                      {t.gapToTarget === null ? '—' : `${usdM(t.gapToTarget)} to target`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {whyZero.length > 0 && (
            <p className="cover">
              {whyZero.map((w) => (
                <span key={w.name}>
                  <b>{w.name}: hard is {usdM(0)} because no countersignature is recorded in this tool yet.</b>{' '}
                  {w.signed ? `${w.signed} ${w.signed === 1 ? 'commitment is' : 'commitments are'} signed per Affinity and ready to harden — ` : ''}
                  <Link href="/soft-hard">Soft → Hard</Link>.{' '}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Needs a decision</h2>
          <span className="lbl">
            {tickets.length} open ticket{tickets.length === 1 ? '' : 's'}
            {tickets.length > 0 ? ` · oldest ${ago(tickets[0]!.createdAt)}` : ''}
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
              <p>This is an empty table, not a failed read.</p>
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

      <div className="card">
        <div className="chead">
          <h2>What changed</h2>
          <span className="lbl">
            signals above the threshold · {held.length} held back by it
          </span>
        </div>
        {signals.length === 0 ? (
          <div className="cbody">
            <p className="muted">
              Nothing has crossed a threshold inside the freshness window. {held.length} change
              {held.length === 1 ? ' was' : 's were'} observed and held back — see System &amp;
              seams for which rule stopped each one.
            </p>
          </div>
        ) : (
          signals.map((s) => <SignalRow key={s.signalId} signal={s} />)
        )}
        <p className="cover">
          <b>Signals run on fixtures until L13.</b> They arrive through the same
          <code> Connector</code> contract a real source will use — land raw, normalize
          separately, idempotent on the source key — so attaching EDGAR later changes the
          connector and nothing else.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The run to first close</h2>
          <span className="lbl">
            sprint calendar · {urgencyState.suppressed ? 'urgency suppressed today' : 'holiday overlay on'}
          </span>
        </div>
        <SprintStrip weeks={weeks} />
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Waiting on a first reply</h2>
            <span className="lbl">connecting · nothing from them yet</span>
          </div>
          {waitingOn.length === 0 ? (
            <div className="cbody">
              <p className="muted">Nobody at Connecting is waiting: everyone there has answered, or there is nobody there.</p>
            </div>
          ) : (
            waitingOn.slice(0, 8).map(({ p, s }) => (
              <Link className="row" key={p.pursuitId} href={`/targets/${p.pursuitId}`}>
                <div className="t">
                  <b>{p.entityName}</b>
                  <span>
                    {p.vehicleName} · owner {p.ownerSaid ?? p.ownerName}
                  </span>
                </div>
                <div className="state">
                  <b>{s?.awaitingSince ? `we wrote ${shortDate(s.awaitingSince)}` : 'no outreach on record'}</b>
                  {p.rung === 'connector_willing' ? 'a connector is asking' : 'Connecting'}
                </div>
              </Link>
            ))
          )}
          {waitingOn.length > 8 && (
            <p className="cover">
              {waitingOn.length - 8} more. <Link href="/targets?status=connecting&touch=waiting">The pipeline, at Connecting, waiting on them</Link>.
            </p>
          )}
        </div>

        <div className="card">
          <div className="chead">
            <h2>What happened</h2>
            <span className="lbl">audit log · append-only</span>
          </div>
          <table className="list">
            <tbody>
              {happened.map((a, i) => {
                const w = describeAudit(a);
                return (
                  <tr key={i}>
                    <td className="nowrap muted mono" style={{ fontSize: 10.5, width: 70 }}>
                      {ago(a.at)}
                    </td>
                    <td>
                      <b>{w.what}</b>
                      {w.about && <div className="muted" style={{ fontSize: 11.5 }}>{w.about}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {open.length > 0 && (
            <p className="cover">
              {open.length} open issue{open.length === 1 ? '' : 's'} filed through the feedback box ·{' '}
              {open.filter((i) => i.priority === 'P0' || i.priority === 'P1').length} blocking or
              serious. <Link href="/issues">Open the list</Link>.
            </p>
          )}
        </div>
      </div>
    </Page>
  );
}

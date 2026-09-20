import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { DecideForm } from '@/components/approvals/DecideForm';
import { AdjudicateForm } from '@/components/approvals/AdjudicateForm';
import { config } from '@/config/deployment';
import { ago, shortDate } from '@/lib/time';
import {
  KIND_CLASS, KIND_GATES, listDecidedTickets, listOpenTickets, type ApprovalTicket,
} from '@/modules/governance';
import {
  evaluateGuards, getAsk, getConflictForAsk, REASON_LABEL, RULE_LABEL, type GuardReport,
} from '@/modules/coordination';

export const dynamic = 'force-dynamic';

async function guardFor(ticket: ApprovalTicket): Promise<GuardReport | null> {
  if (ticket.subjectType !== 'ask') return null;
  const ask = await getAsk(ticket.subjectId);
  if (!ask) return null;
  return evaluateGuards({ entityId: ask.entityId, connectorId: ask.connectorId, vehicleId: ask.vehicleId });
}

export default async function Approvals({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const [open, decided] = await Promise.all([listOpenTickets(), listDecidedTickets(6)]);
  const selected = open.find((x) => x.id === t) ?? open[0] ?? null;
  const guard = selected ? await guardFor(selected) : null;
  const conflict =
    selected && selected.subjectType === 'ask' ? await getConflictForAsk(selected.subjectId) : null;
  const blocked = Boolean(guard && !guard.ok);

  const flagFor = (ticket: ApprovalTicket) => {
    if (ticket.expiresAt && ticket.expiresAt.getTime() < Date.now()) {
      return { cls: 'f-block', text: 'Expired' };
    }
    if (ticket.subjectType === 'ask') return { cls: 'f-block', text: 'Guard refusing' };
    if (ticket.kind === 'STAGE') return { cls: 'f-ev', text: 'Needs evidence' };
    return { cls: 'f-ok', text: 'Ready' };
  };

  return (
    <Page
      crumbs={[{ label: 'Approvals' }]}
      queue={
        <>
          <div className="qhead">
            <div className="lbl">Module 24 · gate, not record</div>
            <h2>{open.length} open</h2>
            <p>
              One open ticket per subject per kind. Every mutating command in the five families
              fails closed without an approved, unexpired one.
            </p>
          </div>
          {open.map((ticket) => {
            const flag = flagFor(ticket);
            return (
              <Link
                key={ticket.id}
                href={`/approvals?t=${ticket.id}`}
                className={`tix${selected?.id === ticket.id ? ' on' : ''}`}
              >
                <div className="tixtop">
                  <span className={`kind ${KIND_CLASS[ticket.kind]}`}>{ticket.kind}</span>
                  <span className="age">{ago(ticket.createdAt)}</span>
                </div>
                <b>{ticket.subjectLabel}</b>
                <p>
                  {ticket.vehicleName ?? 'No vehicle'} · requested by {ticket.requestedByName}
                </p>
                <span className={`flag ${flag.cls}`}>{flag.text}</span>
              </Link>
            );
          })}

          {decided.length > 0 && (
            <>
              <div className="qhead" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="lbl">Decided</div>
                <p>The record of who authorized what, and when.</p>
              </div>
              {decided.map((d) => (
                <div className="tix" key={d.id} style={{ cursor: 'default', opacity: 0.75 }}>
                  <div className="tixtop">
                    <span className={`kind ${KIND_CLASS[d.kind]}`}>{d.kind}</span>
                    <span className="age">{d.decidedAt ? ago(d.decidedAt) : ''}</span>
                  </div>
                  <b>{d.subjectLabel}</b>
                  <p>
                    {d.decision} by {d.decidedByName}
                    {d.decisionNote ? ` — ${d.decisionNote}` : ''}
                  </p>
                </div>
              ))}
            </>
          )}
        </>
      }
    >
      {!selected ? (
        <>
          <div className="lbl">Module 24 · Approvals &amp; compliance</div>
          <h1>Nothing is waiting on you.</h1>
          <p className="sublede">
            The queue is empty. That is a real state and not a failed read — no mutating command in
            the five families has been proposed since the last decision.
          </p>
          <div className="card">
            <div className="chead">
              <h2>The five kinds</h2>
              <span className="lbl">closed set</span>
            </div>
            {(Object.keys(KIND_GATES) as Array<keyof typeof KIND_GATES>).map((k) => (
              <div className="row" key={k}>
                <span className={`kind ${KIND_CLASS[k]}`} style={{ width: 150 }}>
                  {k}
                </span>
                <div className="t">
                  <b>{KIND_GATES[k]}</b>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="lbl">
            Approval ticket · {selected.kind} · requested by {selected.requestedByName},{' '}
            {ago(selected.createdAt)}
          </div>
          <h1>{selected.subjectLabel}</h1>
          <p className="sublede">
            {selected.vehicleName ?? 'No vehicle'} ·{' '}
            {selected.expiresAt ? `expires ${shortDate(selected.expiresAt)}` : 'no expiry set'}
          </p>

          <div className="card">
            <div className="chead">
              <h2>This approval authorizes</h2>
              <span className="lbl">a specific bounded action</span>
            </div>
            <div className="cbody">
              <p>{selected.scope.authorizes}</p>
              <div className="lbl" style={{ marginTop: 14, marginBottom: 6 }}>
                It does not authorize
              </div>
              {selected.scope.excludes.map((x) => (
                <div className="fact" key={x}>
                  <span>{x}</span>
                  <span className="muted" style={{ fontWeight: 400 }}>
                    not covered
                  </span>
                </div>
              ))}
              {selected.scope.basis && selected.scope.basis.length > 0 && (
                <>
                  <div className="lbl" style={{ marginTop: 16, marginBottom: 6 }}>
                    What you are deciding on
                  </div>
                  {selected.scope.basis.map((b) => (
                    <div className="fact" key={b.label}>
                      <span>{b.label}</span>
                      <span>{b.value}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {guard && (
            <div className="card">
              <div className="chead">
                <h2>{guard.ok ? 'No guard refused this' : `${guard.blocks.length} guard${guard.blocks.length === 1 ? '' : 's'} refusing`}</h2>
                <span className="lbl">checked now, not when the ticket was opened</span>
              </div>
              <div className="guardlist">
                {guard.blocks.map((b) => (
                  <div className="row" key={b.rule}>
                    <span className={`gr${b.rule === 'cross_vehicle_conflict' ? ' info' : ''}`}>
                      {RULE_LABEL[b.rule].toUpperCase()}
                    </span>
                    <div className="t">
                      <b>{b.message}</b>
                      <span>{b.evidence}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="cover">
                <b>What the guard inspected:</b> {guard.inspected}{' '}
                <b>An empty list means nothing in the material available refused this, not that it is safe.</b>
              </p>
            </div>
          )}

          {conflict && conflict.status === 'open' && (
            <div className="card">
              <div className="chead">
                <h2>Conflict case</h2>
                <span className="lbl">
                  {conflict.entityName} · {conflict.windowDays}-day window · opened {ago(conflict.openedAt)}
                </span>
              </div>
              <div className="cbody" style={{ paddingBottom: 0 }}>
                <p>
                  Two vehicles are pursuing the same actor inside the window. This is a record with
                  a lifecycle, not a block: one proceeds, and the other receives a dated follow-up
                  rather than a silent loss.
                </p>
              </div>
              <AdjudicateForm conflict={conflict} />
            </div>
          )}

          {conflict && conflict.status === 'adjudicated' && (
            <div className="card">
              <div className="chead">
                <h2>Conflict case — adjudicated</h2>
                <span className="lbl">
                  {conflict.adjudicatedByName} · {conflict.adjudicatedAt ? ago(conflict.adjudicatedAt) : ''}
                </span>
              </div>
              <div className="cbody">
                <div className="fact">
                  <span>Proceeds</span>
                  <span>
                    {conflict.winnerAskId === conflict.claimantA.askId
                      ? conflict.claimantA.vehicleName
                      : conflict.claimantB.vehicleName}
                  </span>
                </div>
                <div className="fact">
                  <span>Reason</span>
                  <span>{conflict.reasonCode ? REASON_LABEL[conflict.reasonCode] : '—'}</span>
                </div>
                <div className="fact">
                  <span>Loser returns on</span>
                  <span>{conflict.loserFollowupAt ? shortDate(conflict.loserFollowupAt) : '—'}</span>
                </div>
                {conflict.note && (
                  <div className="fact">
                    <span>Note</span>
                    <span style={{ fontWeight: 400 }}>{conflict.note}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="chead">
              <h2>Decide</h2>
              <span className="lbl">
                {config.guard.conflictWindowDays}-day conflict window · one open ticket per subject
              </span>
            </div>
            <div className="cbody">
              <DecideForm ticketId={selected.id} blocked={blocked} />
            </div>
          </div>

          <p className="note">
            Approving a ticket never means the same thing twice here. An agent finishing its run, a
            teammate accepting a task, an LP approving terms, counsel closing, and cash landing are
            five different states and never share one check mark.
          </p>
        </>
      )}
    </Page>
  );
}

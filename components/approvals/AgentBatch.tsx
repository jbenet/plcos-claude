import { AuthorizedControl } from '@/lib/authz/read/Control';
import Link from '@/components/ui/AppLink';
import { ago, shortDate } from '@/lib/time';
import { KIND_CLASS, type ApprovalTicket } from '@/modules/governance';
import { decideAgentBatch } from '@/app/approvals/actions';

/**
 * An autonomous agent's tickets, together (Juan, 5 Oct 2026). Since only an agent acting with no person in the
 * loop needs a SEND or INTRO_ASK ticket, these are the agent's batch — juanmail's run of invitations, say — and a
 * person approves them as one. Each is still its own ticket, decided one at a time with its own audit line and the
 * same checks as a single decision: the batch is only the button. Approving sends nothing; the agent sends, then
 * links each message (outreach_link_message), which marks its ticket used.
 */
export function AgentBatch({ tickets, receipt }: {
  tickets: ApprovalTicket[];
  receipt: { approved?: number; rejected?: number; failed?: number } | null;
}) {
  return (
    <>
      <div className="lbl">Approval tickets · SEND and INTRO_ASK · requested by an autonomous agent</div>
      <h1>{tickets.length ? `${tickets.length} ${tickets.length === 1 ? 'thing' : 'things'} an agent wants to send or ask on its own` : 'No agent is waiting on you.'}</h1>
      <p className="sublede">
        A person sends without an approval (Juan, 5 Oct 2026). These are the agent&rsquo;s: the mail desk asked to send with
        nobody clicking send. Each says what it covers and nothing else; uncheck any you are unsure of, or open it to read it in full.
      </p>
      {receipt && (
        <p className="note" style={{ marginBottom: 12 }} data-agent-receipt>
          {receipt.approved !== undefined && <>Approved: {receipt.approved}. </>}
          {receipt.rejected !== undefined && <>Rejected: {receipt.rejected}. </>}
          {receipt.failed ? <>Not decided: {receipt.failed} (decided already, or no longer an agent&rsquo;s open ticket).</> : null}
        </p>
      )}
      {tickets.length > 0 && (
        <AuthorizedControl action="approve" scope={{ vehicle: tickets.map((t) => t.vehicleId).filter((id): id is string => !!id), ticketKind: 'SEND' }}><form action={decideAgentBatch} className="card" data-agent-batch>
          <div className="chead">
            <h2>Agent tickets</h2>
            <span className="lbl">one ticket per send · each decided on its own</span>
          </div>
          <div className="batch">
            {tickets.map((t) => (
              <label className="brow" key={t.id}>
                <input type="checkbox" name="ticketId" value={t.id} defaultChecked />
                <div>
                  <span className={`kind ${KIND_CLASS[t.kind]}`}>{t.kind}</span>{' '}
                  <b>{t.subjectLabel}</b>
                  <span className="muted"> · {t.vehicleName ?? 'no vehicle'} · asked {ago(t.createdAt)}{t.expiresAt ? ` · expires ${shortDate(t.expiresAt)}` : ''} · <Link href={`/approvals?t=${t.id}`}>open</Link></span>
                  <div className="bline"><span>Authorizes</span>{t.scope.authorizes}</div>
                  {(t.scope.basis ?? []).filter((b) => /advisory|restriction|wrap/i.test(b.label)).map((b) => (
                    <div className="bline" key={b.label}><span>{b.label}</span>{b.value}</div>
                  ))}
                </div>
              </label>
            ))}
          </div>
          <div style={{ padding: '12px 16px 0' }}>
            <label className="lbl" htmlFor="agentnote">A note on each decision · optional</label>
            <input id="agentnote" name="note" type="text" placeholder="Kept with every ticket decided here" style={{ marginTop: 6 }} />
          </div>
          <div className="acts" style={{ padding: '12px 16px' }}>
            <button className="btn p" type="submit" name="decision" value="approve">Approve the checked</button>
            <button className="btn" type="submit" name="decision" value="reject">Reject the checked</button>
          </div>
          <p className="cover">
            <b>What approving does:</b> lets the agent send each checked email once, to the recipients it names, before its
            ticket expires. It sends nothing itself. A restriction still refuses, and a material&rsquo;s wrap is checked again when
            the send is linked.
          </p>
        </form></AuthorizedControl>
      )}
    </>
  );
}

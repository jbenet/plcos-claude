import Link from 'next/link';
import { ago } from '@/lib/time';
import type { ApprovalTicket } from '@/modules/governance';
import { decideMany } from '@/app/approvals/actions';

/**
 * Reconciliation's proposals, together (N57, docs/18). Each row is its own STAGE ticket for one
 * LP, and names every rung it would record with the record behind it; the checkboxes and the two
 * buttons only save deciding them one by one. Nothing here records anything until approved.
 */
export function ReconcileBatch({ proposals, receipt }: {
  proposals: ApprovalTicket[];
  receipt: { approved?: number; rejected?: number; failed?: number } | null;
}) {
  return (
    <>
      <div className="lbl">Approval tickets · STAGE · requested by Reconciliation</div>
      <h1>{proposals.length ? `${proposals.length} ladders behind their records` : 'The ladders match their records.'}</h1>
      <p className="sublede">
        After each translation, reconciliation compares what each LP&rsquo;s ladder has accepted
        with what the records here support: a meeting on the calendar or logged here, a reply from
        them, a signature or a wire recorded in the close room. Where the records are ahead, it
        proposes the climb. Affinity&rsquo;s words and the team&rsquo;s notes are claims and are not
        used. Approving records the rungs listed, each on its record, and nothing else.
      </p>
      {receipt && (
        <p className="note" style={{ marginBottom: 12 }}>
          {receipt.approved !== undefined && <>Approved and recorded: {receipt.approved}. </>}
          {receipt.rejected !== undefined && <>Rejected: {receipt.rejected}; the same records won&rsquo;t be proposed again. </>}
          {receipt.failed ? <>Approved but not recorded: {receipt.failed}, because the ladder moved since the proposal; the next translation proposes again from where it is now.</> : null}
        </p>
      )}
      {proposals.length > 0 && (
        <form action={decideMany} className="card">
          <div className="chead">
            <h2>Proposed climbs</h2>
            <span className="lbl">one ticket per LP · uncheck any you are unsure of</span>
          </div>
          <div className="batch">
            {proposals.map((t) => {
              const rungs = t.scope.basis?.filter((b) => b.source) ?? [];
              return (
                <label className="brow" key={t.id}>
                  <input type="checkbox" name="ticketId" value={t.id} defaultChecked />
                  <div>
                    <b>{t.subjectLabel.replace(/ — on file$/, '')}</b>
                    <span className="muted"> · {t.vehicleName ?? 'no vehicle'} · proposed {ago(t.createdAt)} · <Link href={`/approvals?t=${t.id}`}>open</Link></span>
                    {rungs.map((b) => (
                      <div className="bline" key={b.label}><span>{b.label}</span>{b.value}</div>
                    ))}
                  </div>
                </label>
              );
            })}
          </div>
          <div style={{ padding: '12px 16px 0' }}>
            <label className="lbl" htmlFor="batchnote">A note on each decision · optional</label>
            <input id="batchnote" name="note" type="text" placeholder="Why, or on whose word — kept with every ticket decided here" style={{ marginTop: 6 }} />
          </div>
          <div className="acts" style={{ padding: '12px 16px' }}>
            <button className="btn p" type="submit" name="decision" value="approve">Approve the checked</button>
            <button className="btn" type="submit" name="decision" value="reject">Reject the checked</button>
          </div>
          <p className="cover">
            <b>What approving does:</b> for each checked LP, records the rungs listed, dated by their
            records and attributed to you, as one STAGE ticket each. It doesn&rsquo;t change a status,
            the close track, a forecast or the hard total, and sends nothing. If an LP&rsquo;s ladder
            changed since the proposal, that one records nothing and says so.
          </p>
        </form>
      )}
    </>
  );
}

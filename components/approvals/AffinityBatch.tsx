import { AuthorizedControl } from '@/lib/authz/read/Control';
import { ago } from '@/lib/time';
import { config } from '@/config/deployment';
import { callsFor, type WriteItem } from '@/lib/affinity-writes';
import { decideAffinityBatch } from '@/app/approvals/actions';

const PLAN: Record<WriteItem['plan'], string> = { 'person+note': 'Add person + note', note: 'Add note', skip: 'Skip' };

/**
 * The open batch of Affinity writes (Juan, 14 Oct 2026): people he emailed who are missing from Affinity, and notes of
 * the mail its sync missed. JuanMail proposed them; nothing has reached Affinity. Approving writes the checked items,
 * one by one, and rejects the rest.
 */
export function AffinityBatch({ batch, receipt }: {
  batch: { batchId: string; openedAt: Date; items: WriteItem[] } | null;
  receipt: { written?: number; failed?: number; error?: string } | null;
}) {
  const items = batch?.items ?? [];
  const todo = items.filter((i) => i.plan !== 'skip');
  const calls = todo.reduce((n, i) => n + callsFor(i.plan), 0);
  return (
    <>
      <div className="lbl">Affinity writes · proposed from sent mail · approved by batch</div>
      <h1>{todo.length ? `${todo.length} ${todo.length === 1 ? 'person' : 'people'} to bring into Affinity` : 'No Affinity writes are waiting on you.'}</h1>
      <p className="sublede">
        Mail you sent that Affinity&rsquo;s own sync did not capture. Approving adds each checked person to Affinity if they are
        missing, then a note listing the dates and subjects of the mail. Nothing has been written yet. Uncheck any you would rather leave out.
      </p>
      {receipt && (
        <p className="note" style={{ marginBottom: 12 }} data-affinity-receipt>
          {receipt.error ? <>Not decided: {receipt.error}</> : <>Written: {receipt.written ?? 0}.{receipt.failed ? ` Failed: ${receipt.failed} (each says why below, in the last batch's record).` : ''}</>}
        </p>
      )}
      {batch && items.length > 0 && (
        <AuthorizedControl action="admin" scope={{}}><form action={decideAffinityBatch} className="card" data-affinity-batch>
          <input type="hidden" name="batchId" value={batch.batchId} />
          <div className="chead">
            <h2>Affinity writes</h2>
            <span className="lbl">{calls} Affinity requests · at most {config.affinity.writeBatchMaxCalls} a batch · opened {ago(batch.openedAt)}</span>
          </div>
          <div className="batch">
            {items.map((i) => (
              <label className="brow" key={i.itemId} style={i.plan === 'skip' ? { opacity: 0.6 } : undefined}>
                {i.plan === 'skip' ? <span style={{ width: 13 }} /> : <input type="checkbox" name="itemId" value={i.itemId} defaultChecked />}
                <div>
                  <b>{i.name ?? i.address}</b>
                  <span className="muted"> · {i.address}{i.firm ? ` · ${i.firm}` : ''} · {PLAN[i.plan]}</span>
                  <div className="bline"><span>Why</span>{i.reason}</div>
                  <div className="bline"><span>Mail</span>{i.messages.map((m) => `${m.at.slice(0, 10)}${m.subject ? ` · ${m.subject}` : ''}`).join('; ')}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="acts" style={{ padding: '12px 16px' }}>
            <button className="btn p" type="submit" name="decision" value="approve">Write the checked to Affinity</button>
            <button className="btn" type="submit" name="decision" value="reject">Reject them all</button>
          </div>
          <p className="cover">
            <b>What approving does:</b> creates each checked person in Affinity when no one there has the address, then adds one
            note on them with the dates and subjects of the mail (never a body). Unchecked items are rejected. Nothing else in
            Affinity is changed.
          </p>
        </form></AuthorizedControl>
      )}
    </>
  );
}

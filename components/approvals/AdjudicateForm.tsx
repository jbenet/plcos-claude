'use client';

import { useState } from 'react';
import { adjudicate } from '@/app/approvals/actions';
import { REASON_LABEL, type ConflictCase, type ConflictReason } from '@/modules/coordination/client';

const REASONS = Object.keys(REASON_LABEL) as ConflictReason[];

/** Default follow-up: three weeks out. Long enough not to be the same ask twice. */
function defaultFollowup(): string {
  return new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10);
}

export function AdjudicateForm({ conflict }: { conflict: ConflictCase }) {
  const [winner, setWinner] = useState<string>(conflict.claimantA.askId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loser = winner === conflict.claimantA.askId ? conflict.claimantB : conflict.claimantA;

  return (
    <form
      action={async (fd) => {
        setPending(true);
        setError(null);
        const res = await adjudicate(fd);
        setPending(false);
        if (res?.error) setError(res.error);
      }}
    >
      <input type="hidden" name="caseId" value={conflict.caseId} />
      <input type="hidden" name="winnerAskId" value={winner} />

      <div className="vs">
        {[conflict.claimantA, conflict.claimantB].map((ask) => (
          <div className={`claim${winner === ask.askId ? ' win' : ''}`} key={ask.askId}>
            <div className="lbl">{ask.vehicleName}</div>
            <h3>{ask.connectorName ? `via ${ask.connectorName}` : 'Direct approach'}</h3>
            <div className="cl">
              <span>Owner</span>
              <span>{ask.ownerName}</span>
            </div>
            <div className="cl">
              <span>Status</span>
              <span>{ask.status}</span>
            </div>
            <div className="cl">
              <span>{ask.madeAt ? 'Made' : 'Proposed'}</span>
              <span>
                {(ask.madeAt ?? ask.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              </span>
            </div>
            <div className="cl">
              <span>Purpose</span>
              <span style={{ fontWeight: 400, textAlign: 'left', fontSize: 11.5, color: 'var(--muted)' }}>
                {ask.purpose}
              </span>
            </div>
            <button
              type="button"
              className={`pick${winner === ask.askId ? ' sel' : ''}`}
              onClick={() => setWinner(ask.askId)}
            >
              <span className="radio" />
              {winner === ask.askId ? 'This vehicle proceeds' : 'Let this vehicle proceed'}
            </button>
          </div>
        ))}
      </div>

      <div className="cbody" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="fieldrow">
          <label className="field">
            <span className="lbl">Reason</span>
            <select name="reasonCode" defaultValue="closer_to_close" required>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="lbl">Follow-up for {loser.vehicleName}</span>
            <input type="date" name="loserFollowupAt" defaultValue={defaultFollowup()} required />
          </label>
        </div>
        <label className="field">
          <span className="lbl">Note (optional)</span>
          <input type="text" name="note" placeholder="What the losing vehicle should say when it comes back" />
        </label>

        <p className="note" style={{ marginTop: 0 }}>
          The follow-up date is not optional. Blocking an ask protects the relationship and loses
          the deferred opportunity; a dated second bite is the difference between a guard and a
          portfolio policy. {loser.vehicleName} is scheduled to return on the date above.
        </p>

        {error && (
          <div className="warn" style={{ marginTop: 12 }}>
            <div className="lbl" style={{ color: 'var(--clay)' }}>
              Not adjudicated
            </div>
            <p>{error}</p>
          </div>
        )}

        <div className="acts">
          <button className="btn c" type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Adjudicate'}
          </button>
        </div>
      </div>
    </form>
  );
}

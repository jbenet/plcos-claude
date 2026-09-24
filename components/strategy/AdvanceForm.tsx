'use client';

import { useState } from 'react';
import Link from '@/components/ui/AppLink';
import { requestLadderAdvance } from '@/app/targets/actions';
import { RUNG_LABEL, RUNG_REQUIRES, type LadderRung } from '@/modules/strategy/client';

/**
 * Advancing a rung is a STAGE-gated mutation, so this opens a ticket rather than writing
 * anything. The form states what the rung requires *before* the box, because the point of
 * the ladder is that a step needs a particular kind of evidence, not any evidence.
 */
export function AdvanceForm({ pursuitId, nextRung }: { pursuitId: string; nextRung: LadderRung }) {
  const [state, setState] = useState<{ error?: string; ticketId?: string } | null>(null);
  const [pending, setPending] = useState(false);

  if (state?.ticketId) {
    return (
      <div className="cbody">
        <div className="stat ready">
          <i />
          Ticket opened
        </div>
        <p style={{ marginTop: 10, fontSize: 12.5 }}>
          Nothing has been recorded. A <code>STAGE</code> ticket is waiting for a decision — the
          rung is written only after it is approved, and the ladder is re-checked at that moment.
        </p>
        <Link className="btn p" href={`/approvals?t=${state.ticketId}`} style={{ display: 'inline-block', padding: 8 }}>
          Open the ticket
        </Link>
      </div>
    );
  }

  return (
    <form
      className="cbody"
      action={async (fd) => {
        setPending(true);
        setState(await requestLadderAdvance(fd));
        setPending(false);
      }}
    >
      <input type="hidden" name="pursuitId" value={pursuitId} />
      <input type="hidden" name="rung" value={nextRung} />
      <p style={{ fontSize: 12.5, lineHeight: 1.55, margin: '0 0 12px' }}>
        <b>{RUNG_LABEL[nextRung]} requires:</b> {RUNG_REQUIRES[nextRung]}
      </p>
      <div className="fieldrow">
        <label className="field">
          <span className="lbl">Evidence kind</span>
          <select name="evidenceKind" defaultValue="email">
            <option value="email">email</option>
            <option value="meeting">meeting</option>
            <option value="document">document</option>
            <option value="relationship_note">relationship note</option>
            <option value="ask_outcome">ask outcome</option>
            <option value="wire">wire confirmation</option>
          </select>
        </label>
        <label className="field">
          <span className="lbl">Reference</span>
          <input type="text" name="evidenceRef" placeholder="email:2026-09-22" required />
        </label>
      </div>
      <label className="field">
        <span className="lbl">What it says</span>
        <input type="text" name="evidenceNote" placeholder="Quote or summarise the part that justifies this rung" required />
      </label>

      {state?.error && (
        <div className="warn" style={{ marginBottom: 12 }}>
          <div className="lbl" style={{ color: 'var(--clay)' }}>
            Refused
          </div>
          <p>{state.error}</p>
        </div>
      )}

      <button className="btn p" type="submit" disabled={pending}>
        {pending ? 'Opening ticket…' : `Request: ${RUNG_LABEL[nextRung]}`}
      </button>
    </form>
  );
}

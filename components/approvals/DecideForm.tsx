'use client';

import { useState } from 'react';
import { decide } from '@/app/approvals/actions';

/**
 * Consequential commands wait for a server receipt — no optimistic update here. The button
 * disables, the action runs, and the page re-renders from what the server actually wrote.
 */
export function DecideForm({ ticketId, blocked }: { ticketId: string; blocked: boolean }) {
  const [pending, setPending] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        setPending(String(fd.get('decision')));
        await decide(fd);
        setPending(null);
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="field" style={{ marginTop: 14 }}>
        <span className="lbl">Note on the decision</span>
        <input type="text" name="note" placeholder="Why, in one line" />
      </label>
      <div className="acts">
        <button className="btn p" name="decision" value="approve" disabled={blocked || pending !== null}>
          {pending === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button className="btn" name="decision" value="request_changes" disabled={pending !== null}>
          Request changes
        </button>
        <button className="btn" name="decision" value="reject" disabled={pending !== null}>
          Reject
        </button>
      </div>
      {blocked && (
        <p className="note" style={{ marginTop: 10 }}>
          Approval is disabled while a guard refuses this ask. Clear the block first — an approval
          granted over an unresolved refusal is exactly the record that makes an audit useless.
        </p>
      )}
    </form>
  );
}

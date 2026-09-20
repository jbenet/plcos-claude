'use client';

import { useState } from 'react';
import { saveInvitation } from '@/app/grants/actions';

/**
 * Recording an invitation is the only thing that opens the gate. It needs a reference and
 * a date, because "they were encouraging at the conference" is not an invitation and the
 * whole rule exists to keep that distinction.
 */
export function InvitationForm({ funderId, funderName }: { funderId: string; funderName: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ error?: string } | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)} style={{ fontSize: 11.5, padding: '4px 9px' }}>
        Record an invitation
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        setPending(true);
        setState((await saveInvitation(fd)) ?? null);
        setPending(false);
      }}
      style={{ display: 'grid', gap: 6 }}
    >
      <input type="hidden" name="funderId" value={funderId} />
      <input type="text" name="reference" placeholder="email:funder-2026-09-05" required style={{ fontSize: 11.5, padding: '4px 8px' }} aria-label={`Invitation reference for ${funderName}`} />
      <input type="text" name="invitedBy" placeholder="Who invited us, by name" required style={{ fontSize: 11.5, padding: '4px 8px' }} />
      <input type="date" name="invitedOn" defaultValue={new Date().toISOString().slice(0, 10)} required style={{ fontSize: 11.5, padding: '4px 8px' }} />
      <button className="btn p" type="submit" disabled={pending} style={{ fontSize: 11.5, padding: '4px 9px' }}>
        {pending ? 'Recording…' : 'Open the gate'}
      </button>
      {state?.error && <span className="flag f-block">{state.error}</span>}
    </form>
  );
}

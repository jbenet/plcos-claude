'use client';

import { useState } from 'react';
import Link from 'next/link';
import { requestHarden } from '@/app/soft-hard/actions';

/**
 * Asking to harden a commitment opens a MONEY ticket. It does not move the number, and the
 * label says so — "Ask to harden", never "Mark as hard".
 */
export function HardenForm({ exposureId, entityName }: { exposureId: string; entityName: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ error?: string; ticketId?: string } | null>(null);
  const [pending, setPending] = useState(false);

  if (state?.ticketId) {
    return (
      <Link className="flag f-ok" href={`/approvals?t=${state.ticketId}`}>
        MONEY ticket open →
      </Link>
    );
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)} style={{ fontSize: 11.5, padding: '4px 9px' }}>
        Ask to harden
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        setPending(true);
        setState(await requestHarden(fd));
        setPending(false);
      }}
      style={{ display: 'flex', gap: 5, alignItems: 'center' }}
    >
      <input type="hidden" name="exposureId" value={exposureId} />
      <input
        type="text"
        name="evidenceRef"
        placeholder="sub-doc:…"
        required
        style={{ fontSize: 11.5, padding: '4px 8px', width: 120 }}
        aria-label={`Evidence reference for ${entityName}`}
      />
      <button className="btn p" type="submit" disabled={pending} style={{ fontSize: 11.5, padding: '4px 9px' }}>
        {pending ? '…' : 'Open ticket'}
      </button>
      {state?.error && (
        <span className="flag f-block" title={state.error}>
          refused
        </span>
      )}
    </form>
  );
}

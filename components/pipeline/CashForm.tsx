'use client';

import { useState } from 'react';
import { recordWire } from '@/app/soft-hard/actions';

/**
 * Recording that a wire landed (issue 0005).
 *
 * `pipeline.recordCash` existed, was tested, and was called by no screen — so cash received
 * was a separate state from an accepted commitment, which is correct, and a state nobody
 * could reach, which is not.
 *
 * It is deliberately **not** gated by a MONEY ticket. An approval authorises something we
 * are about to do; a wire is something that has already happened to us, and a system that
 * refuses to write down money it has received is lying about its own bank account. What it
 * does require is the bank reference, because "it landed" without one is a recollection.
 */
export function CashForm({ exposureId, entityName }: { exposureId: string; entityName: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  if (state?.ok) return <span className="flag f-ok">recorded</span>;

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)} style={{ fontSize: 11, padding: '3px 8px' }}>
        Record the wire
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        setPending(true);
        setState(await recordWire(fd));
        setPending(false);
      }}
      style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <input type="hidden" name="exposureId" value={exposureId} />
      <input
        type="date"
        name="receivedAt"
        required
        style={{ fontSize: 11, padding: '3px 6px' }}
        aria-label={`Date the wire from ${entityName} landed`}
      />
      <input
        type="text"
        name="reference"
        placeholder="bank ref"
        required
        style={{ fontSize: 11, padding: '3px 6px', width: 86 }}
        aria-label={`Bank reference for ${entityName}`}
      />
      <button className="btn p" type="submit" disabled={pending} style={{ fontSize: 11, padding: '3px 8px' }}>
        {pending ? '…' : 'Record'}
      </button>
      {state?.error && <span className="flag f-block" title={state.error}>refused</span>}
    </form>
  );
}

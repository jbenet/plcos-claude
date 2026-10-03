'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createDraftAction } from '@/app/email/actions';

/** Start a draft (docs/25). Waits for the server's receipt, then shows it open. */
export function NewDraftButton({ label, fields, primary = true }: { label: string; fields: Record<string, string>; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={`btn${primary ? ' p' : ''}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const form = new FormData();
          for (const [k, v] of Object.entries(fields)) form.set(k, v);
          try {
            const r = await createDraftAction(form);
            if (!r.ok) setError(r.error);
            else router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Starting…' : label}
      </button>
      {error && <span role="status" style={{ color: 'var(--clay)', fontSize: 12, marginLeft: 8 }}>{error}</span>}
    </>
  );
}

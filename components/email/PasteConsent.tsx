'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pasteConsentAction } from '@/app/email/actions';

/** Finish a Gmail connect from another device by pasting the address Google sent you to (docs/25). */
export function PasteConsent() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <form
      style={{ display: 'contents' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await pasteConsentAction(new FormData(e.currentTarget));
        setMsg(r);
        if (r.ok) router.refresh();
      }}
    >
      <input name="url" placeholder="http://localhost:3000/api/email/google/callback?state=…&code=…" aria-label="The address Google sent you to" />
      <button className="btn" type="submit">Finish connecting</button>
      {msg && <span role="status" style={{ flexBasis: '100%', fontSize: 12, color: msg.ok ? 'var(--green)' : 'var(--clay)' }}>{msg.message}</span>}
    </form>
  );
}

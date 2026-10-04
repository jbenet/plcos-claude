'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { connectMailguardAction, testMailguardAction, type ConnectResult } from '@/app/email/actions';
import s from './email.module.css';

const Said = ({ r }: { r: ConnectResult | null }) =>
  r && <span role="status" style={{ flexBasis: '100%', fontSize: 12, color: r.ok ? 'var(--green)' : 'var(--clay)' }}>{r.message}</span>;

/** Paste a mailguard token. It is checked before it is kept; a token that can send is refused and not stored (docs/25 §12). */
export function PasteToken({ label = 'Connect' }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<ConnectResult | null>(null);
  return (
    <form
      className={s.paste}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        try {
          const out = await connectMailguardAction(new FormData(form));
          setR(out);
          form.reset();
          if (out.ok) router.refresh();
        } finally { setBusy(false); }
      }}
    >
      <input name="token" type="password" autoComplete="off" spellCheck={false} placeholder="mg_…" aria-label="Your mailguard token" required />
      <button className="btn p" type="submit" disabled={busy}>{busy ? 'Checking…' : label}</button>
      <Said r={r} />
    </form>
  );
}

/** One harmless read at mailguard — which mailbox, what the token may do — and no draft. */
export function TestConnection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<ConnectResult | null>(null);
  return (
    <div className={s.paste}>
      <button className="btn" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { setR(await testMailguardAction(new FormData())); router.refresh(); } finally { setBusy(false); }
      }}>{busy ? 'Asking mailguard…' : 'Test the connection'}</button>
      <Said r={r} />
    </div>
  );
}

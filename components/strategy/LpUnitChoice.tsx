'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decideLpUnitAction } from '@/app/targets/lp-unit-actions';

/**
 * A person's answer to who the LP is (docs/23). Consequential, so it waits for the server's receipt:
 * a move opens the firm's LP page, where this person is now named as a contact.
 */
export function LpUnitChoice({ pursuitId, personal, firms, compact = false }: {
  pursuitId: string; personal: boolean;
  firms: Array<{ id: string; name: string; role: string | null; lpRow: string | null }>;
  /** In the header's picker: smaller buttons and type, the same choices and words. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const choose = (choice: { kind: 'personal' } | { kind: 'firm'; orgId: string }, label: string) => start(async () => {
    setError(null); setSaved(null);
    const r = await decideLpUnitAction(pursuitId, choice);
    if (r.error) { setError(r.error); return; }
    setSaved(label);
    if (r.to) router.push(`/targets/${r.to}`); else router.refresh();
  });
  // Compact: left-aligned, wrapping words, a touch smaller; still a full-width target.
  const btn = compact ? { fontSize: 12, padding: '5px 9px', textAlign: 'left' as const, whiteSpace: 'normal' as const, lineHeight: 1.35 } : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 5 : 6, fontSize: compact ? 12 : undefined }} aria-busy={pending}>
      {!personal && <button type="button" className="btn" style={btn} disabled={pending} onClick={() => choose({ kind: 'personal' }, 'Kept as an individual LP.')}>
        They invest personally: keep this row
      </button>}
      {firms.map((f) => (
        <button key={f.id} type="button" className="btn" style={btn} disabled={pending} onClick={() => choose({ kind: 'firm', orgId: f.id }, `Moved to ${f.name}.`)}>
          Move to {f.name}{f.lpRow ? ' (its LP row here)' : ''}, as its contact
        </button>
      ))}
      <p className="muted" style={{ margin: '2px 0 0', fontSize: compact ? 11 : 11.5, lineHeight: 1.45 }}>
        Status, owner, history, strategy and notes go with a move, and no status is lowered. Money on record stays in the name it was
        recorded under. Reversible from Developer → Enrich.
      </p>
      {pending && <p role="status" className="muted" style={{ margin: 0 }}>Saving…</p>}
      {saved && <p role="status" style={{ margin: 0 }}>{saved}</p>}
      {error && <p role="alert" style={{ margin: 0, color: 'var(--clay)' }}>{error}</p>}
    </div>
  );
}

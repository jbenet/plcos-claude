'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importMoveFile, saveMove } from '@/app/[vehicle]/strategy/actions';
import type { MoveRow } from '@/modules/strategy/moves';
import s from './strategy.module.css';

export function ImportMoves() {
  const [pending, start] = useTransition(); const [message, setMessage] = useState(''); const router = useRouter();
  return <div className={s.import}>
    {message && <span role="status">{message}</span>}
    <button type="button" className="btn" disabled={pending} onClick={() => start(async () => { const r = await importMoveFile(); setMessage(r.error ?? r.message ?? ''); if (!r.error) router.refresh(); })}>{pending ? 'Importing…' : 'Import move menu'}</button>
  </div>;
}

/** A consequential, audited decision: it waits for the server's receipt before showing as saved. */
export function MoveControls({ move, vehicleId }: { move: Pick<MoveRow, 'id' | 'state' | 'position' | 'version'>; vehicleId: string }) {
  const [pending, start] = useTransition(); const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null); const router = useRouter();
  return <form className={s.decide} onSubmit={e => {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    start(async () => {
      const r = await saveMove({ id: move.id, vehicleId, version: move.version, state: String(f.get('state')) as MoveRow['state'], position: f.get('position') ? Number(f.get('position')) : null, note: String(f.get('note')) });
      setResult(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved and recorded.' });
      // The form stays mounted across the refresh so the receipt stays visible; the reason belonged to that decision.
      if (!r.error) { (form.elements.namedItem('note') as HTMLInputElement).value = ''; router.refresh(); }
    });
  }}>
    <label>Decision<select name="state" defaultValue={move.state}><option value="proposed">Proposed</option><option value="chosen">Chosen for planning</option><option value="dismissed">Dismissed</option></select></label>
    <label>Queue position<input name="position" aria-label="Manual queue position" type="number" inputMode="numeric" min="1" max="10000" defaultValue={move.position ?? ''} placeholder="Model order" /></label>
    <label className={s.wide}>Reason<input name="note" required maxLength={1000} placeholder="Why change the plan? Kept in the record." /></label>
    <div className={s.wide}><button className="btn p" disabled={pending}>{pending ? 'Saving…' : 'Record decision'}</button>{result && <span role="status" className={result.ok ? s.ok : s.err}>{result.text}</span>}</div>
  </form>;
}

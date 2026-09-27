'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSpvStanceAction, withdrawSpvStanceAction } from '@/app/targets/spv-actions';
import type { SpvStance } from '@/modules/strategy/client';
import s from './spv.module.css';

const CHOICES: Array<{ id: SpvStance; label: string }> = [
  { id: 'does', label: 'Does SPVs' }, { id: 'does-not', label: 'Doesn’t' }, { id: 'unknown', label: 'Unknown' },
];

/**
 * A person's SPV stance (Juan, 27 Sep 2026): does, doesn't or unknown, an optional count of known SPV
 * or co-investment deals, and a note. Consequential for how the LP is approached, so it waits for the
 * server's receipt. It wins over the evidence until withdrawn, and every change is in the log.
 */
export function SpvControl({ entityId, current }: {
  entityId: string; current: { stance: SpvStance; minDeals: number | null; note: string | null } | null;
}) {
  const router = useRouter();
  const [stance, setStance] = useState<SpvStance | null>(current?.stance ?? null);
  const [count, setCount] = useState(current?.minDeals ? String(current.minDeals) : '');
  const [note, setNote] = useState(current?.note ?? '');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = count.trim() ? Number(count) : null;
  const badCount = stance === 'does' && n !== null && !(Number.isInteger(n) && n >= 1 && n <= 10000);
  const same = !!current && current.stance === stance && (current.minDeals ?? null) === (stance === 'does' ? n : null) && (current.note ?? '') === note.trim();

  const save = () => stance && start(async () => {
    setError(null); setMsg(null);
    const r = await setSpvStanceAction(entityId, { stance, minDeals: stance === 'does' ? n : null, note });
    if (r.error) { setError(r.error); return; }
    setMsg('Saved. It stands over the evidence until withdrawn.');
    router.refresh();
  });
  const withdraw = () => start(async () => {
    setError(null); setMsg(null);
    const r = await withdrawSpvStanceAction(entityId);
    if (r.error) { setError(r.error); return; }
    setMsg(r.none ? 'Nothing to withdraw.' : 'Withdrawn. The stance follows the evidence again.');
    setStance(null); setCount(''); setNote('');
    router.refresh();
  });

  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); save(); }} aria-busy={pending}>
      <fieldset>
        <legend>{current ? 'Your team’s setting' : 'Set it'}</legend>
        <div className={s.choices} role="radiogroup" aria-label="SPV stance">
          {CHOICES.map((c) => (
            <label key={c.id} className={`${s.choice}${stance === c.id ? ` ${s.on}` : ''}`}>
              <input type="radio" name={`spv-${entityId}`} value={c.id} checked={stance === c.id} onChange={() => setStance(c.id)} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      {stance === 'does' && (
        <div className={s.row}>
          <label>At least <input type="number" inputMode="numeric" min={1} max={10000} step={1} value={count}
            onChange={(e) => setCount(e.target.value)} aria-label="Known SPV or co-investment deals, at least" placeholder="—" /></label>
          <span className="muted">known SPV or co-investment deals (optional)</span>
        </div>
      )}
      {stance && (
        <div className={s.row}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} aria-label="Note"
            placeholder="How we know: who said it, when, which deals (optional)" />
        </div>
      )}
      <div className={s.actions}>
        <button type="submit" className="btn p" disabled={pending || !stance || badCount || same}>{pending ? 'Saving…' : 'Save'}</button>
        {current && <button type="button" className="btn" disabled={pending} onClick={withdraw}>Withdraw the setting</button>}
      </div>
      {badCount && <p className={s.err}>The count is a whole number from 1 to 10,000, or blank.</p>}
      {msg && <p role="status" className={s.msg}>{msg}</p>}
      {error && <p role="alert" className={s.err}>{error}</p>}
      <p className="muted" style={{ margin: '8px 0 0', fontSize: 11.5 }}>
        A person’s setting wins over research and derived signals. Withdrawing it returns the LP to the evidence; both are in the log.
      </p>
    </form>
  );
}

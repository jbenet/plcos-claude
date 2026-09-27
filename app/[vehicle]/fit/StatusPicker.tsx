'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkLpAction } from '@/app/targets/bulk-actions';
import { newRequestKey } from '@/lib/request-key';
import { PASSED_BY_CHOICES, PASSED_BY_LABEL, REASONS, STATUSES, type PassedBy, type PursuitStatus } from '@/modules/strategy/client';
import s from './fit.module.css';

const REASON_WORD = (r: string) => r.replace(/_/g, ' ');

/**
 * Change an LP's status from the fit list (issue 0096). The same audited path as the pipeline
 * table's "Set status": one transaction, an idempotency key per attempt so a double tap records
 * once, the next step kept, and a refusal if the status changed since the page loaded. A status is
 * our plan: no rung is written and nothing is sent. It waits for the server's answer. The line for
 * the log is optional (issue 0104): without one the log records "set on Funder–vehicle fit by <user>".
 * Passed still needs who ended it and why.
 */
export function StatusPicker({ name, pursuitId, vehicleId, status }: {
  name: string; pursuitId: string; vehicleId: string; status: PursuitStatus;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PursuitStatus | null>(null);
  const [why, setWhy] = useState('');
  const [passedBy, setPassedBy] = useState<PassedBy | ''>('');
  const [passReason, setPassReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const key = useRef<string | null>(null);
  const label = (id: PursuitStatus) => STATUSES.find((x) => x.id === id)?.label ?? id;

  const choose = (next: PursuitStatus) => {
    key.current = null; setMessage(null); setWhy(''); setPassedBy(''); setPassReason('');
    setTarget(next === status ? null : next);
  };
  const save = async () => {
    if (!target || busy) return;
    if (target === 'passed' && !passedBy) { setMessage({ text: 'Say who ended it.', bad: true }); return; }
    if (target === 'passed' && !passReason) { setMessage({ text: 'Say why it ended.', bad: true }); return; }
    key.current ??= newRequestKey();
    setBusy(true); setMessage(null);
    const res = await bulkLpAction({
      key: key.current, rows: [{ id: pursuitId, vehicleId, status }], action: 'status', status: target,
      body: why.trim(), place: 'fit',
      ...(target === 'passed' ? { passedBy: passedBy as PassedBy, passReason } : {}),
    }).catch(() => ({ ok: false as const, error: 'Not confirmed. Saving again with the same request records it once.' }));
    setBusy(false);
    if (!res.ok) { setMessage({ text: res.error, bad: true }); return; }
    setMessage({ text: res.written ? `Saved: ${label(status)} → ${label(target)}.` : 'Already saved.' });
    setTarget(null); key.current = null;
    router.refresh();
  };

  return (
    <div className={s.status} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <select
        aria-label={`Status of ${name}`}
        value={target ?? status}
        disabled={busy}
        onChange={(e) => choose(e.target.value as PursuitStatus)}
      >
        {STATUSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      {target && (
        <div className={s.confirm} role="group" aria-label={`Change ${name} to ${label(target)}`}>
          <span className={s.confirmHead}>{label(status)} → <b>{label(target)}</b></span>
          {target === 'passed' && (
            <>
              <select aria-label="Who ended it" value={passedBy} onChange={(e) => setPassedBy(e.target.value as PassedBy)}>
                <option value="">Who ended it…</option>
                {PASSED_BY_CHOICES.map((p) => <option key={p} value={p}>{PASSED_BY_LABEL[p]}</option>)}
              </select>
              <select aria-label="Why it passed" value={passReason} onChange={(e) => setPassReason(e.target.value)}>
                <option value="">Why it ended…</option>
                {REASONS.map((r) => <option key={r} value={r}>{REASON_WORD(r)}</option>)}
              </select>
            </>
          )}
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="A line for the log (optional)" aria-label="A line for the log"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } if (e.key === 'Escape') setTarget(null); }} />
          <button type="button" className="btn p" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => setTarget(null)}>Cancel</button>
        </div>
      )}
      {message && <span className={message.bad ? s.bad : s.saved} role="status">{message.text}</span>}
    </div>
  );
}

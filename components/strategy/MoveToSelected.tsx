'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkLpAction, undoBulkLpAction } from '@/app/targets/bulk-actions';
import { newRequestKey } from '@/lib/request-key';
import { lead, type PipelineRow, type Status } from './pipeline-model';
import { cx, n } from './lp-view';
import s from './selection.module.css';

/**
 * Move to Selected (issue 0104): the one thing a person mostly does on Selection, as one large
 * button, the `s` key, and an Undo. It moves the ticked LPs when some are ticked, otherwise the LP
 * in focus. The same audited path as "Set status": one transaction, a key per request, a refusal if
 * a status changed since the page loaded. No note is asked for; the log records who set it, where,
 * when, and from what. Undo puts each back through that path too. It waits for the server.
 */

const WORD: Record<Status, string> = {
  new: 'New', sourcing: 'Sourcing', selected: 'Selected', connecting: 'Connecting', discussing: 'Discussing', committed: 'Committed', passed: 'Passed',
};

export interface Moved {
  key: string;
  rows: Array<{ id: string; name: string; from: Status }>;
  to: Status;
  state: 'done' | 'undoing' | 'undone' | 'failed';
  error?: string;
}

/** The move, its undo and their receipt, shared by the button, the keyboard and the toast. */
export function useMove() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Moved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const move = useCallback(async (rows: PipelineRow[]): Promise<Moved | null> => {
    const todo = rows.filter((r) => r.status !== 'selected');
    if (!todo.length || lock.current) return null;
    lock.current = true; setBusy(true); setError(null);
    const key = newRequestKey();
    try {
      const res = await bulkLpAction({ key, action: 'status', status: 'selected', body: '', place: 'selection',
        rows: todo.map((r) => ({ id: r.id, vehicleId: r.vehicleId, status: r.status })) });
      if (!res.ok) { setError(res.error); return null; }
      const moved: Moved = { key, to: 'selected', state: 'done', rows: todo.map((r) => ({ id: r.id, name: lead(r), from: r.status })) };
      setLast(moved);
      router.refresh();
      return moved;
    } catch {
      setError('The move was not confirmed. Check the list after it reloads before trying again.');
      router.refresh();
      return null;
    } finally { lock.current = false; setBusy(false); }
  }, [router]);

  // A move keeps its Undo until the next one or a dismissal; the receipt for an undo fades by itself.
  useEffect(() => {
    if (last?.state !== 'undone') return;
    const t = setTimeout(() => setLast((cur) => (cur === last ? null : cur)), 6000);
    return () => clearTimeout(t);
  }, [last]);

  /** A change made elsewhere (the tray's Set status) that the toast can offer to undo. */
  const remember = useCallback((m: Moved) => { setLast(m); setError(null); }, []);

  const undo = useCallback(async (): Promise<Moved | null> => {
    const m = last;
    if (!m || m.state !== 'done' || lock.current) return null;
    lock.current = true; setLast({ ...m, state: 'undoing' });
    try {
      const res = await undoBulkLpAction({ of: m.key, place: 'selection' });
      const next: Moved = res.ok ? { ...m, state: 'undone' } : { ...m, state: 'failed', error: res.error };
      setLast(next);
      router.refresh();
      return res.ok ? next : null;
    } catch {
      setLast({ ...m, state: 'failed', error: 'The undo was not confirmed. Check the list after it reloads.' });
      router.refresh();
      return null;
    } finally { lock.current = false; }
  }, [last, router]);

  return { busy, last, error, move, undo, remember, dismiss: () => { setLast(null); setError(null); } };
}
export type MoveState = ReturnType<typeof useMove>;

/** The large button, for the ticked LPs or the one in focus. */
export function MoveButton({ state, rows, ticked, onMove }: { state: MoveState; rows: PipelineRow[]; ticked: boolean; onMove: () => void }) {
  const todo = rows.filter((r) => r.status !== 'selected');
  const already = rows.length - todo.length;
  const one = rows.length === 1 ? rows[0]! : null;
  const label = !rows.length ? 'Move to Selected'
    : !todo.length ? (one ? 'Already Selected' : 'All ticked are Selected')
    : ticked && todo.length > 1 ? `Move ${n(todo.length)} to Selected` : 'Move to Selected';
  const what = !rows.length ? 'Tick LPs or pick one in the list.'
    : one ? <>{ticked && '1 ticked · '}<b>{lead(one)}</b> · now {WORD[one.status]}</>
    : <><b>{n(rows.length)} ticked</b>{todo.length > 0 && <> · {froms(todo)}</>}{already > 0 && <> · {n(already)} already Selected</>}</>;
  return (
    <div className={s.move}>
      <div className={s.moveWhat} aria-live="polite">{what}</div>
      <button type="button" className={s.moveBtn} disabled={!todo.length || state.busy} onClick={onMove}
        aria-keyshortcuts="s">
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
        <span>{state.busy ? 'Moving…' : label}</span>
        {todo.length > 0 && !state.busy && <kbd className={s.kbd} aria-hidden>S</kbd>}
      </button>
      {state.error && <p role="alert" className={s.moveErr}>{state.error}</p>}
      <p className={s.moveNote}>A plan, not a rung: nothing is sent. The log keeps who moved it and when; Undo puts it back.</p>
    </div>
  );
}

const froms = (rows: PipelineRow[]) => {
  const count = new Map<Status, number>();
  for (const r of rows) count.set(r.status, (count.get(r.status) ?? 0) + 1);
  return count.size === 1 ? `from ${WORD[rows[0]!.status]}` : [...count].map(([st, k]) => `${n(k)} ${WORD[st]}`).join(', ');
};

/** The receipt for the last move, with Undo, fixed at the bottom so it follows the list. */
export function UndoToast({ state, onUndo }: { state: MoveState; onUndo: () => void }) {
  const m = state.last;
  if (!m) return null;
  const who = m.rows.length === 1 ? m.rows[0]!.name : `${n(m.rows.length)} LPs`;
  const back = [...new Set(m.rows.map((r) => WORD[r.from]))].join(' or ');
  return (
    <div className={cx(s.toast, m.state === 'failed' && s.toastBad)} role="status" aria-live="polite">
      <span className={s.toastText}>
        {m.state === 'done' && <>Moved <b>{who}</b> to {WORD[m.to]}.</>}
        {m.state === 'undoing' && <>Putting <b>{who}</b> back…</>}
        {m.state === 'undone' && <><b>{who}</b> back to {back}. Both changes are in the log.</>}
        {m.state === 'failed' && <>{m.error ?? 'The undo was not confirmed.'}</>}
      </span>
      {m.state === 'done' && (
        <button type="button" className={s.toastUndo} onClick={onUndo} aria-keyshortcuts="u">
          Undo <kbd className={s.kbd} aria-hidden>U</kbd>
        </button>
      )}
      <button type="button" className={s.toastClose} onClick={state.dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}

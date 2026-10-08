'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkLpAction, undoBulkLpAction } from '@/app/targets/bulk-actions';
import { newRequestKey } from '@/lib/request-key';
import type { BulkPlace } from '@/lib/pipeline-bulk';
import { lead, type PipelineRow, type Status } from './pipeline-model';
import { actionFailure, withDeadline } from '@/lib/client/action-failure';
import { cx, n } from './lp-view';
import s from './selection.module.css';

/**
 * Move to Selected (issue 0104): the one thing a person mostly does on Selection, as one large
 * button, the `s` key, and an Undo. It moves the ticked LPs when some are ticked, otherwise the LP
 * in focus. The same audited path as "Set status": one transaction, a key per request, a refusal if
 * a status changed since the page loaded. No note is asked for; the log records who set it, where,
 * when, and from what. Undo puts each back through that path too. The list shows the move at once
 * (see useMove); the receipt waits for the server.
 */

const WORD: Record<Status, string> = {
  new: 'New', sourcing: 'Sourcing', selected: 'Selected', connecting: 'Connecting', discussing: 'Discussing', committed: 'Committed', passed: 'Passed',
};

export interface Moved {
  key: string;
  rows: Array<{ id: string; name: string; from: Status }>;
  to: Status;
  state: 'moving' | 'done' | 'undoing' | 'undone' | 'failed';
  error?: string;
}

/** A status the page shows ahead of the server: `to`, for as long as the server still says `from`. */
interface Ahead { from: Status; to: Status }

/**
 * The move, its undo and their receipt, shared by the button, the keyboard and the toast.
 *
 * The list changes at once (performance pass, 8 Oct 2026). A move used to hold the page until the
 * server had saved it and rebuilt the whole list: two to five seconds on the live data, and much
 * longer while an import was writing, so s, s, s down the list crawled. Now each moved LP shows its
 * new status the moment it is moved, the focus goes on, and the save runs behind; the receipt says
 * "Moving…" until the server confirms, and Undo waits for that. A refused move puts the LP back and
 * says why. The list is reloaded once, after the last save in flight.
 */
export function useMove(place: BulkPlace = 'selection', rows: PipelineRow[] = []) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Moved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ahead, setAhead] = useState<ReadonlyMap<string, Ahead>>(() => new Map());
  const inFlight = useRef(0);
  const saving = useRef(new Map<string, Promise<boolean>>());
  const undoLock = useRef(false);

  const show = useCallback((ids: Array<{ id: string; from: Status }>, to: Status) => setAhead((prior) => {
    const next = new Map(prior);
    for (const r of ids) next.set(r.id, { from: r.from, to });
    return next;
  }), []);
  const drop = useCallback((ids: string[], to: Status) => setAhead((prior) => {
    const next = new Map(prior);
    for (const id of ids) if (next.get(id)?.to === to) next.delete(id);
    return next;
  }), []);
  // Once the server's list no longer says `from`, it has caught up (or someone else moved it): its word wins.
  useEffect(() => {
    if (!ahead.size) return;
    const status = new Map(rows.map((r) => [r.id, r.status]));
    const stale = [...ahead].filter(([id, a]) => status.get(id) !== a.from).map(([id]) => id);
    if (stale.length) setAhead((prior) => { const next = new Map(prior); for (const id of stale) next.delete(id); return next; });
  }, [rows, ahead]);
  const shown = useMemo(() => !ahead.size ? rows : rows.map((r) => {
    const a = ahead.get(r.id);
    return a && r.status === a.from ? { ...r, status: a.to } : r;
  }), [rows, ahead]);

  const begin = () => { inFlight.current++; setBusy(true); };
  const end = () => {
    inFlight.current = Math.max(0, inFlight.current - 1);
    if (inFlight.current === 0) { setBusy(false); router.refresh(); }
  };

  const move = useCallback((targets: PipelineRow[]): Moved | null => {
    const todo = targets.filter((r) => r.status !== 'selected');
    if (!todo.length) return null;
    setError(null);
    const key = newRequestKey();
    const moved: Moved = { key, to: 'selected', state: 'moving', rows: todo.map((r) => ({ id: r.id, name: lead(r), from: r.status })) };
    show(moved.rows, 'selected');
    setLast(moved);
    begin();
    const saved = (async () => {
      try {
        const res = await withDeadline(bulkLpAction({ key, action: 'status', status: 'selected', body: '', place,
          rows: todo.map((r) => ({ id: r.id, vehicleId: r.vehicleId, status: r.status })) }));
        if (!res.ok) {
          drop(moved.rows.map((r) => r.id), 'selected');
          setError(res.error);
          setLast((cur) => (cur?.key === key ? null : cur));
          return false;
        }
        setLast((cur) => (cur?.key === key ? { ...moved, state: 'done' } : cur));
        return true;
      } catch (e) {
        drop(moved.rows.map((r) => r.id), 'selected');
        setError(actionFailure(e, 'The move was not confirmed. Check the list after it reloads before trying again.'));
        setLast((cur) => (cur?.key === key ? null : cur));
        return false;
      } finally {
        saving.current.delete(key);
        end();
      }
    })();
    saving.current.set(key, saved);
    return moved;
    // begin and end only touch refs, setters and the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, place, show, drop]);

  // A move keeps its Undo until the next one or a dismissal; the receipt for an undo fades by itself.
  useEffect(() => {
    if (last?.state !== 'undone') return;
    const t = setTimeout(() => setLast((cur) => (cur === last ? null : cur)), 6000);
    return () => clearTimeout(t);
  }, [last]);

  /** A change made elsewhere (the tray's Set status) that the toast can offer to undo; the list shows it at once. */
  const remember = useCallback((m: Moved) => { show(m.rows, m.to); setLast(m); setError(null); }, [show]);

  const undo = useCallback(async (): Promise<Moved | null> => {
    const m = last;
    if (!m || (m.state !== 'done' && m.state !== 'moving') || undoLock.current) return null;
    undoLock.current = true;
    try {
      // Undo names the move's request, so that request has to be saved first.
      if (m.state === 'moving' && !(await saving.current.get(m.key) ?? true)) return null;
      setLast({ ...m, state: 'undoing' });
      for (const r of m.rows) show([{ id: r.id, from: m.to }], r.from);
      begin();
      try {
        const res = await withDeadline(undoBulkLpAction({ of: m.key, place }));
        const next: Moved = res.ok ? { ...m, state: 'undone' } : { ...m, state: 'failed', error: res.error };
        if (!res.ok) for (const r of m.rows) drop([r.id], r.from);
        setLast(next);
        return res.ok ? next : null;
      } catch (e) {
        for (const r of m.rows) drop([r.id], r.from);
        setLast({ ...m, state: 'failed', error: actionFailure(e, 'The undo was not confirmed. Check the list after it reloads.') });
        return null;
      } finally { end(); }
    } finally { undoLock.current = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, router, place, show, drop]);

  return { busy, last, error, rows: shown, move, undo, remember, dismiss: () => { setLast(null); setError(null); } };
}
export type MoveState = ReturnType<typeof useMove>;

/**
 * The main button, for the ticked LPs or the one in focus: the app's black primary, full width
 * (issue 0109: the green one was too big). The heading above it says what it acts on.
 */
export function MoveButton({ state, rows, ticked, onMove }: { state: MoveState; rows: PipelineRow[]; ticked: boolean; onMove: () => void }) {
  const todo = rows.filter((r) => r.status !== 'selected');
  const label = !todo.length ? (rows.length === 1 ? 'Already Selected' : 'All ticked are Selected')
    : ticked && rows.length > 1 ? `Move ${n(todo.length)} to Selected` : 'Move to Selected';
  return (
    <div className={s.move}>
      <button type="button" className={s.moveBtn} disabled={!todo.length} onClick={onMove} aria-keyshortcuts="s">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
        <span>{label}</span>
        {todo.length > 0 && <kbd className={s.kbd} aria-hidden>S</kbd>}
      </button>
      {state.error && <p role="alert" className={s.moveErr}>{state.error}</p>}
    </div>
  );
}

/** Where the given LPs would move from: "from Sourcing", or "2 Sourcing, 1 New". */
export function statusMix(rows: PipelineRow[]) {
  return froms(rows);
}
export const statusWord = (st: Status) => WORD[st];

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
        {m.state === 'moving' && <>Moving <b>{who}</b> to {WORD[m.to]}…</>}
        {m.state === 'done' && <>Moved <b>{who}</b> to {WORD[m.to]}.</>}
        {m.state === 'undoing' && <>Putting <b>{who}</b> back…</>}
        {m.state === 'undone' && <><b>{who}</b> back to {back}. Both changes are in the log.</>}
        {m.state === 'failed' && <>{m.error ?? 'The undo was not confirmed.'}</>}
      </span>
      {(m.state === 'done' || m.state === 'moving') && (
        <button type="button" className={s.toastUndo} onClick={onUndo} aria-keyshortcuts="u">
          Undo <kbd className={s.kbd} aria-hidden>U</kbd>
        </button>
      )}
      <button type="button" className={s.toastClose} onClick={state.dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}

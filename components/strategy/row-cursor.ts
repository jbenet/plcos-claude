'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * The keyboard cursor shared by Selection and Pipeline (issues 0091, 0104, 0111, 0121): which row
 * is in focus, how ↑ and ↓ move it, and how the page scrolls to follow.
 *
 * Issue 0121 (Juan, 29 Sep 2026):
 * - A click or a tap anywhere in a row, its tick box included, puts the cursor there (the pages call
 *   `setFocus`), so the arrows go on from that row.
 * - When the row in focus leaves the list (moved to Selected, bulk or single), the cursor keeps its
 *   place: the next row still listed, or the one before, or the same position. A change of search, filter, status or
 *   sort (`resetKey`) still starts from the top, as before.
 * - The page scrolls ahead of the cursor, keeping it `CURSOR_EDGE` of the screen away from the top
 *   and bottom edge, so the next rows are readable before the cursor gets there.
 * - A move is cheap: the page keeps its rendered rows (memoised), each row reads whether it holds
 *   the cursor from a small store (`useIsCursor`), so a move re-renders two rows, not the list; and
 *   one scroll is computed by hand after the commit (no scrollIntoView).
 * - A held key does not queue moves: at most one move a frame, and a key repeat that was generated
 *   before the last move reached the screen is dropped. When the key is released the cursor stops.
 */

/** GUESS: Juan asked for the cursor to stay "maybe 10–20%" from the edge; 15% is the middle. */
export const CURSOR_EDGE = 0.15;

interface Options<R extends { id: string }> {
  /** The whole list in its shown order, including rows past the page limit. */
  ranked: R[];
  initialId?: string | null;
  /** With nothing chosen yet, the first row is in focus (Selection); otherwise none (Pipeline). */
  defaultFirst: boolean;
  /** How many rows are rendered, and how to render more: a row past the limit grows the list. */
  limit: number;
  setLimit: (n: number) => void;
  page: number;
  /** Changes whenever the list is re-filtered or re-sorted; the cursor's place is kept only while it holds. */
  resetKey: string;
}

/** Which row holds the cursor, for the rows to read without the list re-rendering. */
export interface CursorStore {
  get: () => string | null;
  subscribe: (listener: () => void) => () => void;
}

function cursorStore() {
  let id: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => id,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    set: (next: string | null) => { if (next === id) return; id = next; for (const l of listeners) l(); },
  };
}

/** Whether this row holds the cursor; only the rows whose answer changes re-render. */
export function useIsCursor(store: CursorStore, id: string) {
  return useSyncExternalStore(store.subscribe, () => store.get() === id, () => false);
}

export function useRowCursor<R extends { id: string }>({ ranked, initialId = null, defaultFirst, limit, setLimit, page, resetKey }: Options<R>) {
  const [focusId, setFocusId] = useState<string | null>(initialId);
  // Where the cursor last was, for when its row leaves the list.
  const place = useRef<{ key: string; index: number; list: readonly R[] }>({ key: resetKey, index: 0, list: ranked });
  let index = focusId ? ranked.findIndex((r) => r.id === focusId) : -1;
  if (index < 0 && ranked.length > 0) {
    if (focusId !== null && place.current.key === resetKey) index = nearby(place.current.list, place.current.index, ranked);
    else if (defaultFirst) index = 0;
  }
  const focus = index >= 0 ? ranked[index]! : null;

  useEffect(() => {
    place.current = { key: resetKey, index: Math.max(0, index), list: ranked };
    // The row in focus left the list: hand the focus to the one now in its place.
    if (focus && focusId !== null && focus.id !== focusId) setFocusId(focus.id);
  }, [resetKey, index, focus, focusId, ranked]);

  // The rows read the cursor from here; set after each commit, before the paint.
  const [store] = useState(cursorStore);
  const focusShown = focus?.id ?? null;
  useLayoutEffect(() => store.set(focusShown), [store, focusShown]);

  const live = useRef({ ranked, index, limit, setLimit, page });
  live.current = { ranked, index, limit, setLimit, page };

  // The scroll that follows a move: after the commit, before the paint, one layout read.
  const scrollTo = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = scrollTo.current;
    if (!id) return;
    scrollTo.current = null;
    const el = document.querySelector(`[data-lp="${CSS.escape(id)}"]`);
    if (el) keepInView(el);
  });

  /** Put a row in focus and bring it into view: the list grows to include it. */
  const reveal = useCallback((r: R) => {
    const { ranked, limit, setLimit, page } = live.current;
    const i = ranked.indexOf(r);
    if (i >= limit) setLimit(Math.ceil((i + 1) / page) * page);
    scrollTo.current = r.id;
    setFocusId(r.id);
  }, []);

  // One move a frame; a repeat older than the last painted move is stale and dropped.
  const busy = useRef(false);
  const shownAt = useRef(0);
  /** ↑ or ↓: returns false when there is nowhere to go, so the page may scroll as usual. */
  const step = useCallback((delta: 1 | -1, e: KeyboardEvent): boolean => {
    const { ranked, index } = live.current;
    const next = ranked[index < 0 ? 0 : Math.max(0, Math.min(ranked.length - 1, index + delta))];
    if (!next) return false;
    e.preventDefault();
    if (busy.current) return true;
    const now = performance.now();
    // Same clock only (event.timeStamp is on performance.now()'s clock in current browsers).
    if (e.repeat && Math.abs(e.timeStamp - now) < 10_000 && e.timeStamp < shownAt.current) return true;
    if (index >= 0 && ranked[index] === next) return true;
    busy.current = true;
    reveal(next);
    requestAnimationFrame(() => { busy.current = false; shownAt.current = performance.now(); });
    return true;
  }, [reveal]);

  const setFocus = useCallback((id: string) => setFocusId(id), []);
  return { focusId, focus, index, setFocus, reveal, step, store: store as CursorStore };
}

/**
 * Where the cursor goes when its row left the list: the first row after it that is still listed,
 * else the last one before it, else the same position (clamped). Ticked rows that left from above
 * the cursor do not push it further down the list.
 */
function nearby<R extends { id: string }>(before: readonly R[], at: number, now: readonly R[]): number {
  const pos = new Map(now.map((r, i) => [r.id, i]));
  for (let j = at + 1; j < before.length; j++) { const k = pos.get(before[j]!.id); if (k !== undefined) return k; }
  for (let j = Math.min(at, before.length) - 1; j >= 0; j--) { const k = pos.get(before[j]!.id); if (k !== undefined) return k; }
  return Math.min(at, now.length - 1);
}

/** A rendered row's nearest scrolling ancestor, or null for the page itself. */
function scroller(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight + 1) continue;
    if (/(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/**
 * Keep the row `edge` of the visible band away from its top and bottom, scrolling as little as that
 * takes. The band is the scrolling box, or the window below the sticky top bar. A row taller than
 * what the margins leave is centred instead.
 */
export function keepInView(el: Element, edge = CURSOR_EDGE) {
  const box = scroller(el);
  let top: number, bottom: number;
  if (box) {
    const b = box.getBoundingClientRect();
    top = b.top; bottom = b.bottom;
  } else {
    const bar = document.querySelector('.topbar');
    top = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
    bottom = window.innerHeight;
  }
  const r = el.getBoundingClientRect();
  const band = bottom - top;
  const m = Math.max(0, Math.min(band * edge, (band - r.height) / 2));
  let dy = 0;
  if (r.bottom > bottom - m) dy = r.bottom - (bottom - m);
  if (r.top - dy < top + m) dy = r.top - (top + m);
  if (Math.abs(dy) < 1) return;
  if (box) box.scrollTop += dy;
  else window.scrollBy({ top: dy, behavior: 'instant' });
}

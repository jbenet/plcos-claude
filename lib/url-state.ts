'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * A view choice kept in the address (N65, issue 0009). Juan: "every action from the user that
 * changes the viewable state of the page should properly navigate the URL bar so (a) user's browser
 * history navigates properly, and (b) so they can send links to other people."
 *
 * The address is the state: the value is read from it, and setting it writes it — a history entry
 * for a real change of view ('push'), none while someone types ('replace'). Back and forward move
 * through the views, because Next keeps useSearchParams in step with the history it is given.
 */
export function useUrlParam<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (v: T, mode?: 'push' | 'replace') => void] {
  const sp = useSearchParams();
  const raw = sp.get(key);
  const value = (raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : fallback) as T;
  const set = useCallback((v: T, mode: 'push' | 'replace' = 'push') => {
    const u = new URL(window.location.href);
    if (v === fallback) u.searchParams.delete(key); else u.searchParams.set(key, v);
    if (u.toString() === window.location.href) return;
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', u.toString());
  }, [key, fallback]);
  return [value, set];
}

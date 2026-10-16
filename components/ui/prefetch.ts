'use client';

import { useContext, useEffect, useMemo } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';

type Router = NonNullable<React.ContextType<typeof AppRouterContext>>;

/** The whole page, data included, not only its shell: what a click on it would fetch. */
export const FULL = { kind: 'full' as PrefetchKind };

// Pages waiting out their pause, by address: leaving a row or a link before then cancels its page.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** After a pause (GUESS: 60 ms), unless cancelled first: a pointer sweeping across a list starts none. */
export function prefetchIntent(router: Router | null, href: string) {
  if (!router || pending.has(href)) return;
  pending.set(href, setTimeout(() => { pending.delete(href); router.prefetch(href, FULL); }, 60));
}
export function cancelPrefetchIntent(href: string) {
  const t = pending.get(href);
  if (t) { clearTimeout(t); pending.delete(href); }
}

/**
 * Fetches a page a person is about to open, so the click shows it at once (performance pass, 15–16 Oct 2026: an LP
 * page took 120–500 ms after the click, nearly all of it the server building it; 40–80 ms once fetched ahead). A row a
 * pointer rests on, or the keyboard cursor reaches, starts its page after a short pause, so sweeping across a list
 * starts none. The router keeps what it fetched for staleTimes (next.config.ts), and a person's own change empties it.
 *
 * The router comes from context, not useRouter(): a component rendered outside the app's router (a property check, a
 * static render) prefetches nothing.
 */
export function usePrefetch() {
  const router = useContext(AppRouterContext);
  return useMemo(() => ({
    /** Now: a page that is very likely next. */
    now: (href: string) => router?.prefetch(href, FULL),
    intent: (href: string) => prefetchIntent(router, href),
    cancel: cancelPrefetchIntent,
  }), [router]);
}

/** The first few rows of a list, once the page is idle: the likeliest clicks on it. GUESS: three. */
export function usePrefetchFirst(hrefs: readonly string[], count = 3) {
  const { now } = usePrefetch();
  const key = hrefs.slice(0, count).join('\n');
  useEffect(() => {
    if (!key) return;
    const run = () => { for (const href of key.split('\n')) now(href); };
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 2000 }) : null;
    const t = idle === null ? setTimeout(run, 300) : null;
    return () => { if (idle !== null) cancelIdleCallback(idle); if (t) clearTimeout(t); };
  }, [key, now]);
}

'use client';

import NextLink from 'next/link';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { useContext, useEffect, type ComponentProps } from 'react';
import { canonicalPath } from '@/lib/paths';
import { useVehicleSlug } from '@/components/shell/Here';

/**
 * next/link, with an old address put in its place before anyone clicks it (issues 0027–0028, real).
 * A link to /targets/… reached its page through the proxy's redirect, which a client navigation
 * follows mid-flight: Chrome shrugs, and Safari fetched the page twice and threw "stream is closing
 * or closed". Every in-app link comes through here; `npm run boundaries` checks.
 */
/**
 * In the Mac app (docs/31) pages come from the copy on the same machine, a few milliseconds away: a link fetches its
 * whole page the moment the pointer reaches it (or it gets focus), and the click then shows it at once (15 Oct 2026,
 * Juan: "pre-warming likely clicks"). Elsewhere a link prefetches as Next decides. The app's window is this one origin.
 */
const DESKTOP_ORIGINS = ['http://127.0.0.1:47100', 'http://localhost:47100'];
export const inDesktopApp = () => typeof window !== 'undefined' && DESKTOP_ORIGINS.includes(window.location.origin);

/** Fetch whole pages ahead of a likely click, in the Mac app only (the first rows of a list, say). */
export function usePrefetchPages(hrefs: readonly string[]) {
  // The router from context, not useRouter(): a link rendered outside the app's router (a property, a static render)
  // simply prefetches nothing.
  const router = useContext(AppRouterContext);
  const key = hrefs.join('\n');
  useEffect(() => {
    if (!router || !inDesktopApp() || !key) return;
    const run = () => { for (const href of key.split('\n')) router.prefetch(href, { kind: 'full' as PrefetchKind }); };
    const idle = (window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    if (idle) idle(run); else setTimeout(run, 50);
  }, [key, router]);
}

export default function Link({ href, onMouseEnter, onFocus, ...rest }: ComponentProps<typeof NextLink>) {
  const vehicle = useVehicleSlug();
  const router = useContext(AppRouterContext);
  const target = typeof href === 'string' ? canonicalPath(href, vehicle) : href;
  const warm = () => { if (router && typeof target === 'string' && inDesktopApp()) router.prefetch(target, { kind: 'full' as PrefetchKind }); };
  return <NextLink href={target} {...rest}
    onMouseEnter={(e) => { warm(); onMouseEnter?.(e); }} onFocus={(e) => { warm(); onFocus?.(e); }} />;
}

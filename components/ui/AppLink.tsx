'use client';

import NextLink from 'next/link';
import { useContext, type ComponentProps } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { canonicalPath } from '@/lib/paths';
import { useVehicleSlug } from '@/components/shell/Here';
import { cancelPrefetchIntent, FULL, prefetchIntent } from './prefetch';

/**
 * next/link, with an old address put in its place before anyone clicks it (issues 0027–0028, real).
 * A link to /targets/… reached its page through the proxy's redirect, which a client navigation
 * follows mid-flight: Chrome shrugs, and Safari fetched the page twice and threw "stream is closing
 * or closed". Every in-app link comes through here; `npm run boundaries` checks.
 *
 * A link fetches its whole page, data included, when the pointer rests on it or it gets focus, and the click then
 * shows it at once (15–16 Oct 2026, Juan: "pre-warming likely clicks"). Next alone fetches only a dynamic page's shell.
 */
export default function Link({ href, onMouseEnter, onMouseLeave, onFocus, ...rest }: ComponentProps<typeof NextLink>) {
  const vehicle = useVehicleSlug();
  // The router from context (components/ui/prefetch.ts): outside the app's router a link prefetches nothing.
  const router = useContext(AppRouterContext);
  const target = typeof href === 'string' ? canonicalPath(href, vehicle) : href;
  const ahead = typeof target === 'string' && rest.prefetch !== false ? target : null;
  // Next's own prefetch of every link in view is off unless asked for (prefetch={true}, an LP page's tabs): for these
  // pages it fetches only the shell, one request per link, and a vehicle's overview sent 52 of them at once, alongside
  // the page itself (16 Oct 2026). The pointer's pause above fetches the page that matters, whole.
  return <NextLink href={target} {...rest} prefetch={rest.prefetch === true ? true : false}
    onMouseEnter={(e) => { if (ahead) prefetchIntent(router, ahead); onMouseEnter?.(e); }}
    onMouseLeave={(e) => { if (ahead) cancelPrefetchIntent(ahead); onMouseLeave?.(e); }}
    onFocus={(e) => { if (ahead) router?.prefetch(ahead, FULL); onFocus?.(e); }} />;
}

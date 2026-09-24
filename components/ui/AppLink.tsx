'use client';

import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { canonicalPath } from '@/lib/paths';
import { useVehicleSlug } from '@/components/shell/Here';

/**
 * next/link, with an old address put in its place before anyone clicks it (issues 0027–0028, real).
 * A link to /targets/… reached its page through the proxy's redirect, which a client navigation
 * follows mid-flight: Chrome shrugs, and Safari fetched the page twice and threw "stream is closing
 * or closed". Every in-app link comes through here; `npm run boundaries` checks.
 */
export default function Link({ href, ...rest }: ComponentProps<typeof NextLink>) {
  const vehicle = useVehicleSlug();
  return <NextLink href={typeof href === 'string' ? canonicalPath(href, vehicle) : href} {...rest} />;
}

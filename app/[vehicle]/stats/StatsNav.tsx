'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * The page has a few hundred filter links. Each as its own client link made the server render slow;
 * these are plain anchors (already at their canonical address, /<vehicle>/stats?…), and this one
 * listener turns a plain click on one marked `data-keep` into a client navigation that keeps the
 * scroll position, so pressing a count narrows the panels without jumping to the top; one marked
 * `data-go` (an LP's page) navigates as a link would. A modified click (new tab, new window) is left to
 * the browser.
 */
export function StatsNav({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <div
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as HTMLElement).closest('a[data-keep], a[data-go]');
        if (!(a instanceof HTMLAnchorElement) || a.target) return;
        e.preventDefault();
        router.push(a.getAttribute('href')!, { scroll: !a.hasAttribute('data-keep') });
      }}
    >
      {children}
    </div>
  );
}

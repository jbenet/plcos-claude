'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-render a server page every few seconds while something it shows is still moving — a
 * slice being read, say — and stop the moment it is rendered without this.
 */
export function AutoRefresh({ seconds = 4 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(t);
  }, [router, seconds]);
  return null;
}

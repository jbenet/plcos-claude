'use client';

import PageError from './error';

/** Root-layout reads can time out too; this fallback needs neither the rail nor the DB. */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><PageError {...props} /></body></html>;
}

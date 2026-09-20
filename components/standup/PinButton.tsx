'use client';

import { useState, useTransition } from 'react';
import { pinToday } from '@/app/standup/pin';

/**
 * Pinning is one-way. The server only writes where `captured_at is null`, so pressing this
 * twice cannot rewrite what the team actually met on.
 */
export function PinButton({ day }: { day: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <button
      className="btn p"
      disabled={pending || done}
      onClick={() => start(async () => { await pinToday(day); setDone(true); })}
    >
      {pending ? 'Pinning…' : done ? 'Pinned' : 'Pin these numbers'}
    </button>
  );
}

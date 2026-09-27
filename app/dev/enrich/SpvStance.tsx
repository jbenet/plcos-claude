'use client';

import { useActionState } from 'react';
import { deriveSpvStanceAction } from './actions';

/**
 * Derive SPV stance (Juan, 27 Sep 2026): the button and what the last pass found. Runs on its own
 * and as a step of Import the findings. A person's setting on an LP page always wins over it.
 */
export function SpvStance({ last }: { last: string | null }) {
  const [state, action, pending] = useActionState(deriveSpvStanceAction, {});
  return <div style={{ marginTop: 12 }}>
    <form action={action}><button className="btn" disabled={pending}>{pending ? 'Queueing…' : 'Derive SPV stance'}</button>
      <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>From our own SPV commitments, Dakota’s co-investment flag and research text. Research facts and a person’s setting rank above it.</span>
    </form>
    <div aria-live="polite" aria-busy={pending}>
      {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {last && <p>Last pass: {last}</p>}
    </div>
  </div>;
}

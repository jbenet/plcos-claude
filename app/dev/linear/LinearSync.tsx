'use client';

import { useActionState } from 'react';
import { rebuildLinearAction, syncLinearAction } from './actions';
import s from './linear.module.css';

/** The Sync Linear button. A consequential command: it waits for the server's receipt. */
export function LinearSync({ refused, rebuildRefused, synced }: { refused: string | null; rebuildRefused: boolean; synced: boolean }) {
  const [state, action, pending] = useActionState(syncLinearAction, {});
  const [rebuildState, rebuildAction, rebuilding] = useActionState(rebuildLinearAction, {});
  return (
    <div className={s.sync}>
      <form action={action} className={s.syncForm}>
        <button className="btn" disabled={pending || rebuilding || refused !== null} name="full" value="0">{pending ? 'Queueing…' : 'Sync Linear'}</button>
        {synced && <button className={`btn ${s.quiet}`} disabled={pending || rebuilding || refused !== null} name="full" value="1">Full resync</button>}
        <span className={s.hint}>
          {refused ?? (synced ? 'Reads what changed since the last complete sync, archived items included. A full resync reads all allowed-team records again.' : 'The first sync reads only the allowed teams and their records.')}
        </span>
      </form>
      <form action={rebuildAction} className={s.syncForm}>
        <button className={`btn ${s.quiet}`} disabled={pending || rebuilding || rebuildRefused}>{rebuilding ? 'Queueing…' : 'Purge and re-map'}</button>
        <span className={s.hint}>Removes other teams from the local replica and rebuilds its tables. Uses the existing copy; no Linear requests.</span>
      </form>
      <div aria-live="polite" aria-busy={pending || rebuilding}>
        {rebuildState.message && <p role="status" className={s.msg}>{rebuildState.message}</p>}
        {rebuildState.error && <p role="alert" className={s.err}>{rebuildState.error}</p>}
        {state.message && <p role="status" className={s.msg}>{state.message}</p>}
        {state.error && <p role="alert" className={s.err}>{state.error}</p>}
      </div>
    </div>
  );
}

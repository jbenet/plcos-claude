'use client';

import { useActionState } from 'react';
import { syncLinearAction } from './actions';
import s from './linear.module.css';

/** The Sync Linear button. A consequential command: it waits for the server's receipt. */
export function LinearSync({ refused, synced }: { refused: string | null; synced: boolean }) {
  const [state, action, pending] = useActionState(syncLinearAction, {});
  return (
    <div className={s.sync}>
      <form action={action} className={s.syncForm}>
        <button className="btn" disabled={pending || refused !== null} name="full" value="0">{pending ? 'Queueing…' : 'Sync Linear'}</button>
        {synced && <button className={`btn ${s.quiet}`} disabled={pending || refused !== null} name="full" value="1">Full resync</button>}
        <span className={s.hint}>
          {refused ?? (synced ? 'Reads what changed since the last complete sync, archived items included. A full resync reads everything again.' : 'The first sync reads every team, project and issue the key can see.')}
        </span>
      </form>
      <div aria-live="polite" aria-busy={pending}>
        {state.message && <p role="status" className={s.msg}>{state.message}</p>}
        {state.error && <p role="alert" className={s.err}>{state.error}</p>}
      </div>
    </div>
  );
}

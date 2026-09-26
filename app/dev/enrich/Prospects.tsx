'use client';

import { useActionState } from 'react';
import { addProspectsAction } from './actions';

export function Prospects({ directory }: { directory: string }) {
  const [state, action, pending] = useActionState(addProspectsAction, {});
  const r = state.result;
  return <div className="card">
    <div className="chead"><h2>Add prospects to the pipeline</h2><span className="lbl">New or Sourcing · Juan’s rule, 26 Sep</span></div>
    <div className="cbody">
      <p>Good LP fits with useful check sizes (ideally $500K or more), or strategic value for the vehicle.
        Reads <code>{directory}/*.jsonl</code>. Each new pursuit is owned by the person running the import.</p>
      <p className="muted">Existing pursuits stay as they are. Sourced prospects with no matching person are added to the network,
        with their organization as an affiliation when given. Ambiguous names or conflicting identities are skipped and listed.
        Invalid records stop the whole import. New prospects appear in the next W0 export; consent evidence does not change.</p>
      <form action={action}><button className="btn p" type="submit" disabled={pending}>{pending ? 'Adding prospects…' : 'Add prospects to the pipeline'}</button></form>
      <div aria-live="polite" aria-busy={pending}>
        {state.error && <p role="alert">{state.error}</p>}
        {r && <>
          <p><b>{r.added} added</b> · {r.existing} skipped as existing · {r.ambiguous} skipped as ambiguous or conflicting.</p>
          {r.files === 0 && <p>No prospect files found. Place the JSONL files in the directory above, then run the action again.</p>}
          {r.invalid.length > 0 && <p role="alert">Nothing added. Correct these invalid records, then retry.</p>}
          {(r.invalid.length > 0 || r.skipped.length > 0) && <ul>
            {[...r.invalid, ...r.skipped].map((p, i) => <li key={i}><code>{p.file}</code>, line {p.line}{p.name ? ` · ${p.name} (${p.vehicle})` : ''}: {p.reason}</li>)}
          </ul>}
        </>}
      </div>
    </div>
  </div>;
}

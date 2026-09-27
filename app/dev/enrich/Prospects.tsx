'use client';

import { useActionState } from 'react';
import { addProspectsAction } from './actions';

export function Prospects({ directory }: { directory: string }) {
  const [state, action, pending] = useActionState(addProspectsAction, {});
  const r = state.result;
  return <div className="card">
    <div className="chead"><h2>Add prospects to the pipeline</h2><span className="lbl">New, Sourcing or Passed · Juan’s rule, 26 Sep</span></div>
    <div className="cbody">
      <p>Research decisions use a $500K-or-more check size, or strategic value for the vehicle.
        Reads <code>{directory}/*.jsonl</code>. Each new pursuit is owned by the person running the import.</p>
      <p className="muted">Rule-set pursuits can move to the row’s status; Passed requires a reason.
        The later filename date, then line, wins conflicting rule dispositions; the winning file is recorded. A status set by a person is kept. Each change records the rule and reason and can be reversed on the LP page.
        Sourced prospects with no matching person are added to the network,
        with their organization as an affiliation when given. Ambiguous source mappings or conflicting identities are skipped and listed.
        An optional entityId pins an existing match; use entityType: "org" for an organization. Invalid rows are skipped and listed. Files modified in the last two minutes are in progress; retry after writing finishes. New prospects appear in the next W0 export; consent evidence does not change.</p>
      <form action={action}><button className="btn p" type="submit" disabled={pending}>{pending ? 'Adding prospects…' : 'Add prospects to the pipeline'}</button></form>
      <div aria-live="polite" aria-busy={pending}>
        {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
        {r && <>
          <p><b>{r.added} added</b> · {r.moved} moved (to sourcing {r.toSourcing}, to passed {r.toPassed}) · {r.kept} kept because a person set them
            {' '}· {r.existing} unchanged · {r.ambiguous} skipped as ambiguous or conflicting.</p>
          {r.files === 0 && <p>No prospect files found. Place the JSONL files in the directory above, then run the action again.</p>}
          {r.invalid.length > 0 && <p role="alert">Invalid rows or files were skipped. Correct the listed problems, then retry.</p>}
          {r.inProgress.length > 0 && <><p>In progress — skipped until writing finishes and the file has been unchanged for two minutes:</p>
            <ul>{r.inProgress.map(file => <li key={file}><code>{file}</code> · in progress</li>)}</ul></>}
          {(r.invalid.length > 0 || r.skipped.length > 0) && <ul>
            {[...r.invalid, ...r.skipped].map((p, i) => <li key={i}><code>{p.file}</code>, line {p.line}{p.name ? ` · ${p.name} (${p.vehicle})` : ''}: {p.reason}</li>)}
          </ul>}
        </>}
      </div>
    </div>
  </div>;
}

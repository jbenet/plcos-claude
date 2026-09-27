'use client';

import { useActionState, useState, useTransition } from 'react';
import type { PursuitMergeReport } from '@/modules/strategy';
import { consolidatePursuitsAction, reversePursuitMergeAction } from './actions';

export function PursuitMerges({ report }: { report?: PursuitMergeReport }) {
  const [state, action, pending] = useActionState(consolidatePursuitsAction, {});
  const result = state.result ?? report;
  return <div style={{ marginTop: 12 }}>
    <form action={action}><button className="btn" disabled={pending}>{pending ? 'Consolidating…' : 'Consolidate pursuits'}</button></form>
    <div aria-live="polite" aria-busy={pending}>
      {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {result && <>
        <p>{result.merged} pursuits merged, {result.ambiguous.length} ambiguous</p>
        {(result.merges.length > 0 || result.ambiguous.length > 0) && <details className="more">
          <summary>Merge details and reversals</summary>
          <p className="muted">Person-set conflicts need review. Moved approval tickets need fresh approval. Reversal preserves subsequent edits and refuses if a moved record has changed.</p>
          <ul>{result.ambiguous.map(a => <li key={`${a.entityId}:${a.vehicleId}`}>
            <code>{a.entityId}</code> · vehicle <code>{a.vehicleId}</code> · {a.reason} Pursuits: {a.pursuitIds.join(', ')}
          </li>)}</ul>
          {result.merges.map(m => <Reversal key={m.id} id={m.id} survivor={m.survivorId} count={m.loserIds.length} />)}
        </details>}
      </>}
    </div>
  </div>;
}
function Reversal({ id, survivor, count }: { id: string; survivor: string; count: number }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [reversed, setReversed] = useState(false);
  return <form style={{ marginTop: 8 }} action={() => start(async () => {
    const r = await reversePursuitMergeAction(id, reason);
    setError(r.error); if (!r.error) setReversed(true);
  })}>
    <p>{count} merged into <code>{survivor}</code> · merge <code>{id}</code></p>
    {reversed ? <p>Merge reversed.</p> : <>
      <label>Reversal reason <input required value={reason} onChange={e => setReason(e.target.value)} /></label>{' '}
      <button className="btn" disabled={pending || !reason.trim()}>{pending ? 'Reversing…' : 'Reverse merge'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </form>;
}

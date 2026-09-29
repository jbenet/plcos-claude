'use client';

import { useActionState, useState, useTransition } from 'react';
import Link from '@/components/ui/AppLink';
import type { PursuitMergeReport } from '@/modules/strategy';
import type { ImportDuplicateReport } from '@/lib/enrich/import-dupes';
import { mergeImportDuplicatesAction, reverseImportDuplicateAction, reverseIdentitySeparationAction } from './actions';
import { PursuitMerges } from './PursuitMerges';

export function ImportDuplicates({ report, pursuitReport }: { report?: ImportDuplicateReport; pursuitReport?: PursuitMergeReport }) {
  const [state, action, pending] = useActionState(mergeImportDuplicatesAction, {});
  const result = state.result ?? report;
  return <div style={{ marginTop: 12 }}>
    <form action={action}><button className="btn" disabled={pending}>{pending ? 'Merging…' : 'Merge duplicate identities'}</button></form>
    <div aria-live="polite" aria-busy={pending}>
      {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {result && <>
        <p>{result.merged} duplicate identities merged, {result.ambiguous.length} ambiguous</p>
        {result.decisions && <>
          <p>{result.decisions.applied} decisions applied, {result.decisions.refused.length} refused{result.decisions.skipped > 0 ? `, ${result.decisions.skipped} already applied` : ''}{!!result.decisions.superseded?.length && `, ${result.decisions.superseded.length} superseded`}</p>
          {!!result.decisions.superseded?.length && <ul>{result.decisions.superseded.map(r => <li key={r.line}>
            Line {r.line} · group {r.group.slice(0, 12)}: superseded by line {r.byLine}, which reviews the expanded group.
          </li>)}</ul>}
          {result.decisions.refused.length > 0 && <ul>{result.decisions.refused.map(r => <li key={r.line}>
            Line {r.line}{r.group ? ` · group ${r.group.slice(0, 12)}` : ''}: {r.reason}
          </li>)}</ul>}
        </>}
        {(result.merges.length > 0 || result.ambiguous.length > 0 || result.corrected.length > 0 || !!result.decisions?.separations.length) && <details className="more">
          <summary>Duplicate identity details and reversals</summary>
          <ul>{result.ambiguous.map(a => <li key={a.entityIds.join(':')}>
            <Link href={`/orgs/${a.entityIds[0]}`}>{a.name}</Link> · {a.reason}
            {a.entityIds.slice(1).map((id, i) => <span key={id}> · <Link href={`/orgs/${id}`}>candidate {i + 2}</Link></span>)}
          </li>)}</ul>
          <p className="muted">To undo, reverse the related pursuit merges first, then identity merges. Original source records are retained. Type corrections can then be reversed through the entity-type action using the IDs below.</p>
          {result.merges.map(m => <Reversal key={m.assertionId} merge={m} />)}
          {result.decisions?.separations.filter((s, i, all) => all.findIndex(a => a.group === s.group) === i).map(s =>
            <SeparationReversal key={s.group} assertionId={s.assertionId} group={s.group} />)}
          {result.corrected.map(c => <p key={c.correctionId}>Type correction for <Link href={`/orgs/${c.entityId}`}>{c.entityId}</Link>: <code>{c.correctionId}</code></p>)}
        </details>}
      </>}
    </div>
    <PursuitMerges report={state.result?.pursuitMerges ?? pursuitReport} />
  </div>;
}

function SeparationReversal({ assertionId, group }: { assertionId: string; group: string }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [reversed, setReversed] = useState(false);
  return <form style={{ marginTop: 8 }} action={() => start(async () => {
    const r = await reverseIdentitySeparationAction(assertionId, reason);
    setError(r.error); if (!r.error) setReversed(true);
  })}>
    <p>Separate identities · group <code>{group.slice(0, 12)}</code> · assertion <code>{assertionId}</code></p>
    {reversed ? <p>Separation reversed. Export again to review this group.</p> : <>
      <label>Reversal reason <input type="text" required value={reason} onChange={e => setReason(e.target.value)} /></label>{' '}
      <button className="btn" disabled={pending || !reason.trim()}>{pending ? 'Reversing…' : 'Reverse separation'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </form>;
}

function Reversal({ merge }: { merge: ImportDuplicateReport['merges'][number] }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [reversed, setReversed] = useState(false);
  return <form style={{ marginTop: 8 }} action={() => start(async () => {
    const r = await reverseImportDuplicateAction(merge.assertionId, reason);
    setError(r.error); if (!r.error) setReversed(true);
  })}>
    <p><Link href={`/orgs/${merge.survivorId}`}>{merge.name}</Link> · merge <code>{merge.assertionId}</code></p>
    {reversed ? <p>Merge reversed.</p> : <>
      <label>Reversal reason <input type="text" required value={reason} onChange={e => setReason(e.target.value)} /></label>{' '}
      <button className="btn" disabled={pending || !reason.trim()}>{pending ? 'Reversing…' : 'Reverse identity merge'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </form>;
}

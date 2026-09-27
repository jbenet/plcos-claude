'use client';

import { useActionState, useState, useTransition } from 'react';
import Link from '@/components/ui/AppLink';
import type { LpUnitDecisionRow } from '@/modules/strategy';
import type { LpUnitFileReport } from '@/lib/enrich/lp-unit-decisions';
import { repointPursuitsAction, reverseLpRepointAction } from './actions';

const WORD = { moved: 'Moved to its organisation', personal: 'Individual LP', review: 'To review' } as const;

/**
 * Re-point pursuits to their LP (issues 0111, 0112; docs/23): the button, what the last pass did,
 * and each standing decision with its reversal. Runs on its own and inside Import the findings.
 */
export function LpUnits({ last, decisions, fileDecisions }: { last: string | null; decisions: LpUnitDecisionRow[]; fileDecisions?: LpUnitFileReport }) {
  const [state, action, pending] = useActionState(repointPursuitsAction, {});
  const [shown, setShown] = useState<'all' | LpUnitDecisionRow['decision']>('all');
  const counts = { moved: 0, personal: 0, review: 0 };
  for (const d of decisions) counts[d.decision]++;
  const list = decisions.filter(d => shown === 'all' || d.decision === shown);
  return <div style={{ marginTop: 12 }}>
    <form action={action}><button className="btn" disabled={pending}>{pending ? 'Queueing…' : 'Re-point pursuits to their LP'}</button>
      <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>A person at a firm becomes a contact on the firm’s LP row; one who invests personally stays an individual LP.</span>
    </form>
    <div aria-live="polite" aria-busy={pending}>
      {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {last && <p>Last pass: {last}</p>}
      {fileDecisions && <details className="more">
        <summary>{fileDecisions.applied} file decisions applied, {fileDecisions.skipped} already applied, {fileDecisions.refused.length} refused</summary>
        <p className="muted">Reads lp-unit-decisions.jsonl. A person’s LP-page decision always wins. Money in the person’s name prevents a move to a firm.</p>
        <ul>{fileDecisions.refused.map((r, i) => <li key={`${r.line}:${i}`}>
          Line {r.line}{r.pursuitId && <> · <Link href={`/targets/${r.pursuitId}`}>Pursuit</Link></>} — {r.reason}
        </li>)}</ul>
      </details>}
      {decisions.length > 0 && <details className="more">
        <summary>{decisions.length} standing decisions: {counts.moved} moved, {counts.personal} individual, {counts.review} to review</summary>
        <p className="muted">Each is reversible: a reversal restores exactly what it changed and refuses if something changed since. Undo a later
          re-point into the same LP first. The rule never re-applies a reversed decision or overrides a person’s.</p>
        <div role="group" aria-label="Show" style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
          {(['all', 'moved', 'personal', 'review'] as const).map(k => <button key={k} type="button" className="btn" aria-pressed={shown === k}
            style={shown === k ? { fontWeight: 600 } : undefined} onClick={() => setShown(k)}>{k === 'all' ? 'All' : WORD[k]}</button>)}
        </div>
        {list.map(d => <Decision key={d.id} d={d} />)}
      </details>}
    </div>
  </div>;
}

function Decision({ d }: { d: LpUnitDecisionRow }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [reversed, setReversed] = useState(false);
  return <form style={{ marginTop: 10, fontSize: 12.5 }} action={() => start(async () => {
    const r = await reverseLpRepointAction(d.id, reason);
    setError(r.error); if (!r.error) setReversed(true);
  })}>
    <p style={{ margin: 0 }}>
      <b>{WORD[d.decision]}</b> · <Link href={d.decision === 'moved' ? `/orgs/${d.personId}` : `/targets/${d.pursuitId}`}>{d.person}</Link>
      {d.org && <> → <Link href={`/targets/${d.orgPursuitId}`}>{d.org}</Link>{d.created ? ' (its pursuit created)' : ''}</>} · {d.vehicle}
      {d.decidedBy === 'person' ? ' · decided by a person' : d.decidedBy === 'file' ? ' · research decision from file' : ''}
    </p>
    <p className="muted" style={{ margin: '2px 0 4px' }}>{d.reason}</p>
    {reversed ? <p>Reversed.</p> : <>
      <label>Reversal reason <input required value={reason} onChange={e => setReason(e.target.value)} /></label>{' '}
      <button className="btn" disabled={pending || !reason.trim()}>{pending ? 'Reversing…' : 'Reverse'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </form>;
}

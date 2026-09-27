'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkLpAction } from '@/app/targets/bulk-actions';
import type { BulkInput } from '@/lib/pipeline-bulk';
import type { PipelineRow, Status } from './PipelineTable';
import { Glyph } from '@/components/ui/Glyph';
import { REASONS, PASSED_BY_LABEL } from '@/modules/strategy/client';

export function BulkLpActions({ rows, statuses }: { rows: PipelineRow[]; statuses: Array<{ id: Status; label: string }> }) {
  const router = useRouter();
  const [action, setAction] = useState<BulkInput['action'] | 'feedback'>('status');
  const [status, setStatus] = useState<Status>('selected');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef<string | null>(null);
  const frozen = useRef<BulkInput | null>(null);
  return <details className="lp-bulk scope" open><summary><Glyph name="list" title="Selected LP actions" />Actions for {rows.length} selected pursuits</summary>
    <p>Applies to the selected people, including hidden rows. Context and requests stay on their records. Touchpoints record activity; nothing is sent.</p>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || done) return;
      const data = new FormData(event.currentTarget);
      const text = (name: string) => String(data.get(name) ?? '');
      setBusy(true); setMessage('');
      try {
        if (action === 'feedback') {
          const response = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Feedback on selected LPs', body: text('body'), kind: 'request', priority: 'P2',
              page: window.location.pathname, context: { pursuits: rows.map(r => ({ pursuitId: r.id, vehicleId: r.vehicleId })) }, screenshots: [] }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? 'Filing not confirmed. Check the issue list before retrying.');
          setMessage(`Filed as issue ${result.id}.`); setDone(true); return;
        }
        key.current ??= crypto.randomUUID();
        frozen.current ??= { key: key.current, rows: rows.map(r => ({ id: r.id, vehicleId: r.vehicleId, status: r.status })),
          action, body: text('body'), status, passedBy: text('passedBy') as BulkInput['passedBy'], passReason: text('passReason'),
          channel: text('channel') as BulkInput['channel'], direction: text('direction') as BulkInput['direction'] || null, on: text('on') };
        const result = await bulkLpAction(frozen.current);
        if (!result.ok) { frozen.current = null; throw new Error(result.error); }
        setMessage(`${result.written} saved; ${result.alreadySaved} already saved.${['research','connections','strategy'].includes(action) ? ' Requests await review on each LP’s timeline; no workflow has started.' : ''}${result.proposals ? ` ${result.proposals} draft approval tickets created.` : ''}${result.reconciliationPending ? ` ${result.reconciliationPending} touchpoints saved but reconciliation needs a retry on the LP page.` : ''}`);
        setDone(true); router.refresh();
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Save not confirmed. Retry the same request.'); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy || done || Boolean(frozen.current)}><div className="lp-action-fields">
        <label>Action<select aria-label="Bulk action" value={action} onChange={e => setAction(e.target.value as typeof action)}>
          <option value="status">Set status</option><option value="touch">Add touchpoint</option><option value="context">Add context</option>
          <option value="research">Request research</option><option value="connections">Request better connections</option><option value="strategy">Request strategy / next actions</option><option value="feedback">File feedback about this selection</option>
        </select></label>
        {action === 'status' && <label>Status<select aria-label="New status" value={status} onChange={e => setStatus(e.target.value as Status)}>{statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
        {action === 'status' && status === 'passed' && <><label>Who passed<select name="passedBy" required>{Object.entries(PASSED_BY_LABEL).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Pass reason<select name="passReason" required>{REASONS.map(r => <option key={r} value={r}>{r.replaceAll('_',' ')}</option>)}</select></label></>}
        {action === 'touch' && <><label>Date<input type="date" name="on" required /></label><label>Channel<select name="channel"><option value="meeting">Meeting</option><option value="call">Call</option><option value="email">Email</option><option value="message">Message</option></select></label><label>Direction<select name="direction"><option value="both">Both</option><option value="theirs">From them</option><option value="ours">From us</option></select></label></>}
      </div><label className="field"><span>Reason / description · required</span><textarea name="body" required maxLength={4000} rows={3} placeholder="What should be recorded for every selected LP?" /></label></fieldset>
      <button className="btn p" disabled={busy || done} type="submit">{busy ? 'Saving…' : done ? 'Saved' : action === 'feedback' ? 'File feedback' : ['research','connections','strategy'].includes(action) ? 'Save requests for review' : `Apply to ${rows.length} pursuits`}</button>
      {done && <button className="btn" type="button" onClick={() => { key.current = null; frozen.current = null; setDone(false); setMessage(''); }}>New action</button>}
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}

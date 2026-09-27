'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkLpAction } from '@/app/targets/bulk-actions';
import type { BulkInput } from '@/lib/pipeline-bulk';
import type { PipelineRow, Status } from './pipeline-model';
import { Glyph } from '@/components/ui/Glyph';
import { REASONS, PASSED_BY_LABEL } from '@/modules/strategy/client';
import { cx, n } from './lp-view';
import s from './lp-tables.module.css';

type Action = BulkInput['action'] | 'feedback';
const ACTIONS: Array<{ id: Action; label: string; glyph: Parameters<typeof Glyph>[0]['name'] }> = [
  { id: 'status', label: 'Set status', glyph: 'status' },
  { id: 'touch', label: 'Touchpoint', glyph: 'calendar' },
  { id: 'context', label: 'Context', glyph: 'note' },
  { id: 'research', label: 'Research', glyph: 'search' },
  { id: 'connections', label: 'Connections', glyph: 'link' },
  { id: 'strategy', label: 'Strategy', glyph: 'chart' },
  { id: 'feedback', label: 'Feedback', glyph: 'chat' },
];
const HINT: Record<Action, string> = {
  status: 'Each LP’s status changes, with this reason in its log. Statuses are a plan: no rung moves and nothing is sent.',
  touch: 'Records the same touchpoint on each LP. It may support a draft approval ticket; it never accepts a rung.',
  context: 'Adds this note to each LP’s record, for the team and the next strategy.',
  research: 'Asks for more research (enrichment) on each LP. Saved for review on each timeline; no workflow starts.',
  connections: 'Asks for more or better routes to each LP. Saved for review; no workflow starts.',
  strategy: 'Asks for a better strategy or next action for each LP. Saved for review; no workflow starts.',
  feedback: 'Files an issue about this set of LPs: something that seems off, or something we want to do.',
};

/**
 * Actions on the selected LPs (issue 0067): audited, one transaction, one idempotency key per
 * request, so a double tap cannot record anything twice. Nothing is sent and nothing is accepted.
 */
export function BulkLpActions({ rows, statuses, initialStatus = 'selected', onClear, hidden = 0 }: {
  rows: PipelineRow[]; statuses: Array<{ id: Status; label: string }>; initialStatus?: Status; onClear: () => void;
  /** How many of them the current search, filters or statuses hide: they are still acted on. */
  hidden?: number;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const key = useRef<string | null>(null);
  const frozen = useRef<BulkInput | null>(null);
  const reset = () => { key.current = null; frozen.current = null; setDone(false); setMessage(null); };
  const choose = (a: Action) => { if (busy) return; reset(); setAction(action === a ? null : a); };
  const names = rows.slice(0, 4).map((r) => (r.orgFirst && r.org ? r.org : r.name));
  const workflow = action === 'research' || action === 'connections' || action === 'strategy';

  return (
    <section className={s.tray} aria-label="Actions on the selected LPs">
      <div className={s.trayHead}>
        <h3>{n(rows.length)} selected</h3>
        <button type="button" className={s.linkBtn} onClick={onClear}>Clear</button>
      </div>
      <p className={s.trayNames}>
        {names.map((x, i) => <span key={i}>{i > 0 && ', '}<b>{x}</b></span>)}
        {rows.length > names.length && <> and {n(rows.length - names.length)} more</>}
        {hidden > 0 && <>. {n(hidden)} of them {hidden === 1 ? 'is' : 'are'} not in this view, and still included</>}
      </p>
      <div className={s.actions} role="group" aria-label="Choose an action">
        {ACTIONS.map((a) => (
          <button key={a.id} type="button" className={cx(s.action, action === a.id && s.on)} aria-pressed={action === a.id} onClick={() => choose(a.id)}>
            <Glyph name={a.glyph} title={a.label} />{a.label}
          </button>
        ))}
      </div>
      {action && (
        <form className={s.form} onSubmit={async (event) => {
          event.preventDefault(); if (busy || done) return;
          const data = new FormData(event.currentTarget);
          const text = (name: string) => String(data.get(name) ?? '');
          setBusy(true); setMessage(null);
          try {
            if (action === 'feedback') {
              const response = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ title: 'Feedback on selected LPs', body: text('body'), kind: 'request', priority: 'P2',
                  page: window.location.pathname, context: { pursuits: rows.map((r) => ({ pursuitId: r.id, vehicleId: r.vehicleId })) }, screenshots: [] }) });
              const result = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(result.error ?? 'Filing not confirmed. Check the issue list before retrying.');
              setMessage({ text: `Filed as issue ${result.id}.` }); setDone(true); return;
            }
            key.current ??= crypto.randomUUID();
            frozen.current ??= { key: key.current, rows: rows.map((r) => ({ id: r.id, vehicleId: r.vehicleId, status: r.status })),
              action, body: text('body'), status, passedBy: text('passedBy') as BulkInput['passedBy'], passReason: text('passReason'),
              channel: text('channel') as BulkInput['channel'], direction: (text('direction') || null) as BulkInput['direction'], on: text('on') };
            const result = await bulkLpAction(frozen.current);
            if (!result.ok) { frozen.current = null; throw new Error(result.error); }
            setMessage({ text: `${n(result.written)} saved${result.alreadySaved ? `; ${n(result.alreadySaved)} already saved` : ''}.${workflow ? ' Each request awaits review on the LP’s timeline; no workflow has started.' : ''}${result.proposals ? ` ${result.proposals} draft approval tickets created.` : ''}${result.reconciliationPending ? ` ${result.reconciliationPending} touchpoints saved, but reconciliation needs a retry on the LP page.` : ''}` });
            setDone(true); router.refresh();
          } catch (error) {
            setMessage({ text: error instanceof Error ? error.message : 'Save not confirmed. Retry the same request.', bad: true });
          } finally { setBusy(false); }
        }}>
          <p className={s.formHint}>{HINT[action]}</p>
          <fieldset disabled={busy || done}>
            {action === 'status' && (
              <div className={s.formRow}>
                <label>New status
                  <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>{statuses.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
                </label>
                {status === 'passed' && <>
                  <label>Who passed<select name="passedBy" required>{Object.entries(PASSED_BY_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                  <label>Reason<select name="passReason" required>{REASONS.map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}</select></label>
                </>}
              </div>
            )}
            {action === 'touch' && (
              <div className={s.formRow}>
                <label>Date<input type="date" name="on" required /></label>
                <label>Channel<select name="channel"><option value="meeting">Meeting</option><option value="call">Call</option><option value="email">Email</option><option value="message">Message</option></select></label>
                <label>Direction<select name="direction"><option value="both">Both</option><option value="theirs">From them</option><option value="ours">From us</option></select></label>
              </div>
            )}
            <label>{action === 'status' ? 'Reason, kept in each log' : action === 'feedback' ? 'What seems off, or what you want to do' : action === 'touch' ? 'What happened' : 'What to record'}
              <textarea name="body" required maxLength={4000} rows={3} />
            </label>
          </fieldset>
          <div className={s.formFoot}>
            <button className="btn p" disabled={busy || done} type="submit">
              {busy ? 'Saving…' : done ? 'Saved' : action === 'feedback' ? 'File feedback' : workflow ? `Save ${n(rows.length)} requests` : `Apply to ${n(rows.length)}`}
            </button>
            {done && <button className="btn" type="button" onClick={reset}>Another</button>}
          </div>
          {message && <p role="status" className={cx(s.receipt, message.bad && s.bad)}>{message.text}</p>}
        </form>
      )}
    </section>
  );
}

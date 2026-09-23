'use client';

import { useState } from 'react';
import { setPursuitStatus } from '@/app/targets/actions';
import {
  PASSED_BY_LABEL, REASONS, STATUSES, type PassedBy, type PursuitStatus,
} from '@/modules/strategy/client';

/**
 * Where our effort is with this LP (N50, docs/17). Any status to any other: a process that
 * goes backwards is recorded going backwards. It waits for the server's answer before the
 * page says anything changed — a status is cheap to change, but it is still a record.
 */
export function StatusForm(props: {
  pursuitId: string;
  status: PursuitStatus;
  passedBy: PassedBy | null;
  reason: string | null;
  nextStep: string | null;
  nextStepOn: string | null;
}) {
  const [status, setStatus] = useState<PursuitStatus>(props.status);
  const [state, setState] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const passed = status === 'passed';

  return (
    <form
      className="statusform"
      action={async (fd) => {
        setPending(true);
        setState(await setPursuitStatus(fd));
        setPending(false);
      }}
    >
      <input type="hidden" name="pursuitId" value={props.pursuitId} />
      <input type="hidden" name="status" value={status} />
      <div className="choices" role="radiogroup" aria-label="Status">
        {STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={status === s.id}
            className={status === s.id ? 'on' : ''}
            title={s.means}
            onClick={() => { setStatus(s.id); setState(null); }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 10px' }}>{STATUSES.find((s) => s.id === status)!.means}</p>
      {passed ? (
        <div className="fieldrow">
          <label className="field">
            <span className="lbl">Who ended it</span>
            <select name="passedBy" defaultValue={props.passedBy ?? ''} required>
              <option value="" disabled>Choose</option>
              {(Object.keys(PASSED_BY_LABEL) as PassedBy[]).map((k) => <option key={k} value={k}>{PASSED_BY_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="lbl">Why</span>
            <select name="reason" defaultValue={props.reason && (REASONS as readonly string[]).includes(props.reason) ? props.reason : 'other'}>
              {REASONS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <label className="field">
          <span className="lbl">A line about it (optional)</span>
          <input name="reason" defaultValue={props.status === status ? props.reason ?? '' : ''} placeholder="What moved it here" />
        </label>
      )}
      <div className="fieldrow">
        <label className="field" style={{ flex: 2 }}>
          <span className="lbl">Next step</span>
          <input name="nextStep" defaultValue={props.nextStep ?? ''} placeholder={passed ? 'Back in touch after their next fund, say' : 'Send the side letter, say'} />
        </label>
        <label className="field">
          <span className="lbl">By</span>
          <input name="nextStepOn" type="date" defaultValue={props.nextStepOn ?? ''} />
        </label>
      </div>
      {state?.error && <div className="warn" style={{ fontSize: 12.5, marginTop: 8 }}>{state.error}</div>}
      {state?.ok && !pending && <div className="stat ready" style={{ marginTop: 8 }}><i />Saved</div>}
      <button className="btn p" type="submit" disabled={pending} style={{ marginTop: 10 }}>
        {pending ? 'Saving…' : 'Save status'}
      </button>
      <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>No ticket: a status claims nothing about the LP and moves neither the ladder nor the money.</span>
    </form>
  );
}

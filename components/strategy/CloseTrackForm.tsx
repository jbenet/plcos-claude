'use client';

import { useState } from 'react';
import { closeTrackAction } from '@/app/targets/actions';
import type { CloseState } from '@/modules/pipeline/client';

type Op = 'sign' | 'close' | 'wire' | 'soft' | 'withdraw';
const LABEL: Record<Op, string> = {
  sign: 'A signature', close: 'The closing', wire: 'A wire', soft: 'A new soft amount', withdraw: 'A withdrawal',
};

/**
 * Record what happened to the money (N52). Which steps are offered follows the state: a wire or
 * a closing only once it is hard, a revised amount or a withdrawal only while it is soft.
 * Countersignature is not here: it is a MONEY ticket, on Soft → Hard.
 */
export function CloseTrackForm(props: { exposureId: string; pursuitId: string; state: CloseState; signedBefore: boolean }) {
  const hard = props.state === 'hard' || props.state === 'closed';
  const ops: Op[] = hard ? ['wire', ...(props.state === 'hard' ? (['close'] as Op[]) : []), 'sign'] : ['sign', 'soft', 'withdraw'];
  const [op, setOp] = useState<Op>(ops[0]!);
  const [state, setState] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [key, setKey] = useState(0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      key={key}
      className="statusform"
      action={async (fd) => {
        setPending(true);
        const r = await closeTrackAction(fd);
        setState(r);
        setPending(false);
        if (r.ok) setKey((k) => k + 1);
      }}
    >
      <input type="hidden" name="exposureId" value={props.exposureId} />
      <input type="hidden" name="pursuitId" value={props.pursuitId} />
      <input type="hidden" name="op" value={op} />
      <div className="choices" role="radiogroup" aria-label="What happened">
        {ops.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={op === o} className={op === o ? 'on' : ''} onClick={() => { setOp(o); setState(null); }}>
            {LABEL[o]}
          </button>
        ))}
      </div>
      <div className="fieldrow">
        <label className="field">
          <span className="lbl">When</span>
          <input name="on" type="date" defaultValue={today} required />
        </label>
        {op === 'sign' && (
          <label className="field" style={{ flex: 2 }}>
            <span className="lbl">Which document, which version</span>
            <input name="document" placeholder="Subscription agreement, v2" required />
          </label>
        )}
        {op === 'close' && (
          <label className="field" style={{ flex: 2 }}>
            <span className="lbl">Which closing</span>
            <input name="closing" placeholder="First close" />
          </label>
        )}
        {(op === 'wire' || op === 'soft') && (
          <label className="field">
            <span className="lbl">Amount</span>
            <input name="amount" placeholder={op === 'wire' ? '1,250,000' : '2.5m'} required />
          </label>
        )}
        {op === 'wire' && (
          <label className="field">
            <span className="lbl">Wire reference</span>
            <input name="reference" placeholder="Bank confirmation number" required />
          </label>
        )}
      </div>
      {((op === 'sign' && props.signedBefore) || op === 'withdraw') && (
        <label className="field">
          <span className="lbl">{op === 'sign' ? 'Why they signed again' : 'Why they withdrew'}</span>
          <input name="reason" placeholder={op === 'sign' ? 'Their holding entity changed its name' : 'Their IC declined'} required />
        </label>
      )}
      {state?.error && <div className="warn" style={{ fontSize: 12.5, marginTop: 8 }}>{state.error}</div>}
      {state?.ok && !pending && <div className="stat ready" style={{ marginTop: 8 }}><i />Recorded</div>}
      <button className="btn p" type="submit" disabled={pending} style={{ marginTop: 10 }}>{pending ? 'Recording…' : 'Record it'}</button>
    </form>
  );
}

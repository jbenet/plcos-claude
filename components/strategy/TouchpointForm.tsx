'use client';

import { useState } from 'react';
import { logTouchpointAction } from '@/app/targets/actions';
import {
  CHANNELS, CHANNEL_LABEL, DIRECTION_LABEL, READS, READ_LABEL, type Channel, type Direction,
} from '@/modules/meetings/client';

/**
 * Log a meeting, a call, an email, a research pass (N51). Their read goes with the touchpoint,
 * by whoever was there — the latest one is what the pipeline shows, with its date.
 */
export function TouchpointForm(props: { pursuitId: string; entityId: string; vehicleId: string; vehicleName: string }) {
  const [channel, setChannel] = useState<Channel>('meeting');
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
        const r = await logTouchpointAction(fd);
        setState(r);
        setPending(false);
        if (r.ok) setKey((k) => k + 1);
      }}
    >
      <input type="hidden" name="pursuitId" value={props.pursuitId} />
      <input type="hidden" name="entityId" value={props.entityId} />
      <input type="hidden" name="vehicleId" value={props.vehicleId} />
      <input type="hidden" name="channel" value={channel} />
      <div className="choices" role="radiogroup" aria-label="Kind">
        {CHANNELS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={channel === c} className={channel === c ? 'on' : ''} onClick={() => setChannel(c)}>
            {CHANNEL_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="fieldrow">
        <label className="field">
          <span className="lbl">When</span>
          <input name="on" type="date" defaultValue={today} required />
        </label>
        {channel !== 'research' && (
          <label className="field">
            <span className="lbl">Who reached out</span>
            <select name="direction" defaultValue={channel === 'meeting' || channel === 'call' ? 'both' : 'ours'}>
              {(Object.keys(DIRECTION_LABEL) as Direction[]).map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="lbl">About</span>
          <select name="vehicle" defaultValue="this">
            <option value="this">{props.vehicleName}</option>
            <option value="any">No vehicle in particular</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span className="lbl">{channel === 'research' ? 'What was looked at, over what dates' : 'What happened (optional)'}</span>
        <input name="summary" placeholder={channel === 'research' ? 'Their 13F filings 2023–26, and the foundation’s annual report' : 'Walked through the fund terms; they asked about reporting'} />
      </label>
      {channel !== 'research' && (
        <label className="field">
          <span className="lbl">Their read, if you were there</span>
          <select name="read" defaultValue="">
            <option value="">No read</option>
            {READS.map((r) => <option key={r} value={r}>{READ_LABEL[r]}</option>)}
          </select>
        </label>
      )}
      {state?.error && <div className="warn" style={{ fontSize: 12.5, marginTop: 8 }}>{state.error}</div>}
      {state?.ok && !pending && <div className="stat ready" style={{ marginTop: 8 }}><i />Logged</div>}
      <button className="btn p" type="submit" disabled={pending} style={{ marginTop: 10 }}>{pending ? 'Logging…' : 'Log it'}</button>
      <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>A record, not a claim: the ladder moves when someone asks for a rung with it as evidence.</span>
    </form>
  );
}

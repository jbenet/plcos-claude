'use client';

import { useActionState } from 'react';
import { astraSettingsAction, queueAstraAction } from './actions';
import s from './astra.module.css';

const WORKFLOWS: Array<[string, string]> = [['w1w5', 'Profile, then strategy (W1+W5)'], ['w1', 'Profile (W1)'], ['w5', 'Strategy (W5)']];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Queue runs. Consequential: it waits for the server's receipt. */
export function QueueForm({ batchSize }: { batchSize: number }) {
  const [state, action, pending] = useActionState(queueAstraAction, {});
  return (
    <>
      <form action={action} className={s.form}>
        <label>Workflow
          <select name="workflow" defaultValue="w1w5">{WORKFLOWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label>Runs<input type="number" name="count" min={1} max={12} defaultValue={4} /></label>
        <label>LPs per run<input type="number" name="size" min={1} max={20} defaultValue={batchSize} /></label>
        <label>When
          <select name="when" defaultValue="tonight"><option value="tonight">Tonight, in the window</option><option value="now">Now</option></select>
        </label>
        <button className="btn" disabled={pending}>{pending ? 'Queueing…' : 'Queue runs'}</button>
      </form>
      <div aria-live="polite">
        {state.message && <p role="status" className={s.msg}>{state.message}</p>}
        {state.error && <p role="alert" className={s.err}>{state.error}</p>}
      </div>
    </>
  );
}

export function PauseButton({ paused }: { paused: boolean }) {
  const [state, action, pending] = useActionState(astraSettingsAction, {});
  return (
    <form action={action} className={s.inline}>
      <input type="hidden" name="pause" value={paused ? '0' : '1'} />
      <button className="btn" disabled={pending}>{pending ? 'Saving…' : paused ? 'Resume' : 'Pause runner'}</button>
      {state.error && <span role="alert" className={s.err}>{state.error}</span>}
    </form>
  );
}

/** Auto: the runner queues this many runs itself at the start of each night window. */
export function AutoForm(p: { autoOn: boolean; autoWorkflow: string; autoBatches: number; batchSize: number; windowStart: number; windowEnd: number }) {
  const [state, action, pending] = useActionState(astraSettingsAction, {});
  return (
    <>
      <form action={action} className={s.form}>
        <label className={s.check}><input type="checkbox" name="autoOn" defaultChecked={p.autoOn} /> Run every night</label>
        <label>Workflow
          <select name="autoWorkflow" defaultValue={p.autoWorkflow}>{WORKFLOWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label>Runs a night<input type="number" name="autoBatches" min={1} max={12} defaultValue={p.autoBatches} /></label>
        <label>LPs per run<input type="number" name="batchSize" min={1} max={20} defaultValue={p.batchSize} /></label>
        <label>Window from
          <select name="windowStart" defaultValue={p.windowStart}>{HOURS.map((h) => <option key={h} value={h}>{hour(h)}</option>)}</select>
        </label>
        <label>to
          <select name="windowEnd" defaultValue={p.windowEnd}>{HOURS.map((h) => <option key={h} value={h}>{hour(h)}</option>)}</select>
        </label>
        <button className="btn" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      </form>
      <div aria-live="polite">
        {state.message && <p role="status" className={s.msg}>{state.message}</p>}
        {state.error && <p role="alert" className={s.err}>{state.error}</p>}
      </div>
    </>
  );
}

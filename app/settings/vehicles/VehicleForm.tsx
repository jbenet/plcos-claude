'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from '@/components/ui/AppLink';
import { slugFromName, slugProblem } from '@/modules/platform/client';
import { createVehicleAction, type VehicleResult } from './actions';
import s from '../people/people.module.css';

const KINDS = [
  { v: 'spv', label: 'SPV' },
  { v: 'fund', label: 'Fund' },
  { v: 'grant_rail', label: 'Grant rail' },
] as const;
const EXEMPTIONS = [
  { v: '506(c)', label: '506(c)' },
  { v: '506(b)', label: '506(b)' },
  { v: 'n/a', label: 'n/a (grants)' },
  { v: 'unknown', label: 'Unknown (historical only)' },
] as const;

/**
 * Add a vehicle. The slug follows the name until it is edited; it is checked as you type and again on the
 * server, which also refuses one already taken. The exemption is preselected to 506(c), and says so beside it:
 * every current vehicle is 506(c) (AGENTS.md), and a change is one click, never silent.
 */
export function AddVehicle({ readOnly, taken }: { readOnly: boolean; taken: string[] }) {
  const [state, run, pending] = useActionState<VehicleResult, FormData>(createVehicleAction, null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [exemption, setExemption] = useState('506(c)');
  const [phase, setPhase] = useState('active');
  // A vehicle made: the form starts again (its slug is taken now, so keeping it would show a refusal under a success).
  useEffect(() => { if (state?.ok) { setName(''); setSlug(''); setEdited(false); setExemption('506(c)'); setPhase('active'); } }, [state]);
  const shown = edited ? slug : slugFromName(name);
  const problem = shown ? (slugProblem(shown) ?? (taken.includes(shown) ? `A vehicle with the slug "${shown}" exists already.` : null)) : null;
  return (
    <form action={run} className={s.add}>
      <label className={s.field}><span>Name</span><input name="name" required autoComplete="off" placeholder="Example SPV I" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} /></label>
      <label className={s.field}>
        <span>Slug (the address)</span>
        <input name="slug" required autoComplete="off" spellCheck={false} placeholder="example-spv-i" value={shown}
          onChange={(e) => { setEdited(true); setSlug(e.target.value.toLowerCase()); }} disabled={readOnly} aria-invalid={problem ? true : undefined} />
        {problem ? <small className={s.bad}>{problem}</small> : shown ? <small className={s.muted}>/{shown}/overview</small> : null}
      </label>
      <label className={s.field}>
        <span>Kind</span>
        <select name="kind" defaultValue="spv" disabled={readOnly}>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
      </label>
      <label className={s.field}>
        <span>Exemption</span>
        <select name="exemption" value={exemption} onChange={(e) => setExemption(e.target.value)} disabled={readOnly} required>
          {EXEMPTIONS.map((x) => <option key={x.v} value={x.v} disabled={x.v === 'unknown' && phase !== 'historical'}>{x.label}</option>)}
        </select>
        <small className={exemption === '506(c)' ? s.muted : s.bad}>
          {exemption === '506(c)' ? 'Preselected: every current vehicle is 506(c). Change it if this one is not; it decides what may be said in public.'
            : exemption === '506(b)' ? '506(b): no general solicitation. It decides what may be said in public, so be sure.'
              : exemption === 'n/a' ? 'n/a is for a grant rail, which takes no securities.' : 'Unknown is read as 506(c) by the gates.'}
        </small>
      </label>
      <label className={s.field}>
        <span>Phase</span>
        <select name="phase" value={phase} onChange={(e) => { setPhase(e.target.value); if (e.target.value !== 'historical' && exemption === 'unknown') setExemption('506(c)'); }} disabled={readOnly}>
          <option value="active">Active</option>
          <option value="historical">Historical (did not close)</option>
        </select>
      </label>
      <label className={s.field}><span>Target, dollars (optional)</span><input name="target" inputMode="decimal" autoComplete="off" placeholder="25000000 or 25M" disabled={readOnly} /></label>
      <label className={s.field}><span>Raise opens (optional)</span><input name="opens" type="date" disabled={readOnly} /></label>
      <label className={s.field}><span>Raise closes (optional)</span><input name="closes" type="date" disabled={readOnly} /></label>
      <label className={s.field}><span>Aliases (optional, comma-separated)</span><input name="aliases" autoComplete="off" placeholder="the company's name, a short name" disabled={readOnly} /></label>
      <div className={s.actions}>
        <button className="btn p" disabled={pending || readOnly || Boolean(problem)}>{pending ? 'Adding…' : 'Add vehicle'}</button>
        {state?.ok ? <p className={s.ok} role="status">{state.message} <Link href={`/${state.slug}/overview`}>Open it</Link>.</p>
          : state ? <p className={s.bad} role="status">{state.error}</p> : null}
      </div>
    </form>
  );
}

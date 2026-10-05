'use client';

import { useActionState, useState } from 'react';
import { addPersonAction, setPersonActiveAction, signOutEverywhereAction, updatePersonAction, type PeopleResult } from './actions';
import s from './people.module.css';

export interface VehicleOption { id: string; name: string }
export interface PersonRow {
  id: string; name: string; email: string; role: string; access: 'admin' | 'gp' | 'viewer'; vehicles: string[] | null; active: boolean; you: boolean;
}

const ACCESS = [
  { v: 'admin', label: 'Admin', says: 'everything, every vehicle, Settings' },
  { v: 'gp', label: 'GP', says: 'reads and changes the vehicles chosen' },
  { v: 'viewer', label: 'Viewer', says: 'reads the vehicles chosen, changes nothing' },
] as const;

function Result({ r }: { r: PeopleResult }) {
  if (!r) return null;
  return <p className={r.ok ? s.ok : s.bad} role="status">{r.ok ? r.message : r.error}</p>;
}

function Vehicles({ vehicles, chosen, access }: { vehicles: VehicleOption[]; chosen: string[] | null; access: string }) {
  const [all, setAll] = useState(chosen === null);
  if (access === 'admin') return <span className={s.muted}>Admins see every vehicle.</span>;
  return (
    <span className={s.vehicles}>
      <label><input type="checkbox" name="allVehicles" checked={all} onChange={(e) => setAll(e.target.checked)} /> All vehicles</label>
      {!all && vehicles.map((v) => (
        <label key={v.id}><input type="checkbox" name="vehicle" value={v.id} defaultChecked={chosen?.includes(v.id) ?? false} /> {v.name}</label>
      ))}
    </span>
  );
}

export function AddPerson({ vehicles, readOnly }: { vehicles: VehicleOption[]; readOnly: boolean }) {
  const [state, run, pending] = useActionState<PeopleResult, FormData>(addPersonAction, null);
  const [access, setAccess] = useState<'admin' | 'gp' | 'viewer'>('gp');
  return (
    <form action={run} className={s.add}>
      <label className={s.field}><span>Name</span><input name="name" required autoComplete="off" placeholder="Alex Example" disabled={readOnly} /></label>
      <label className={s.field}><span>Workspace email</span><input name="email" type="email" required autoComplete="off" placeholder="alex@your-workspace.org" disabled={readOnly} /></label>
      <label className={s.field}><span>Title (optional)</span><input name="role" autoComplete="off" placeholder="Partner" disabled={readOnly} /></label>
      <fieldset className={s.field} disabled={readOnly}>
        <span>Access</span>
        <span className={s.access}>
          {ACCESS.map((a) => (
            <label key={a.v} title={a.says}><input type="radio" name="access" value={a.v} checked={access === a.v} onChange={() => setAccess(a.v)} /> {a.label}</label>
          ))}
        </span>
      </fieldset>
      <fieldset className={s.field} disabled={readOnly}><span>Vehicles</span><Vehicles key={access} vehicles={vehicles} chosen={null} access={access} /></fieldset>
      <div className={s.actions}>
        <button className="btn p" disabled={pending || readOnly}>{pending ? 'Adding…' : 'Add person'}</button>
        <Result r={state} />
      </div>
    </form>
  );
}

export function PersonControls({ p, vehicles, readOnly }: { p: PersonRow; vehicles: VehicleOption[]; readOnly: boolean }) {
  const [saved, save, saving] = useActionState<PeopleResult, FormData>(updatePersonAction, null);
  const [toggled, toggle, toggling] = useActionState<PeopleResult, FormData>(setPersonActiveAction, null);
  const [out, signOut, signing] = useActionState<PeopleResult, FormData>(signOutEverywhereAction, null);
  const [access, setAccess] = useState(p.access);
  const [open, setOpen] = useState(false);
  return (
    <div className={s.controls}>
      {!readOnly && p.active && (open ? (
        <form action={save} className={s.edit}>
          <input type="hidden" name="userId" value={p.id} />
          <select name="access" value={access} onChange={(e) => setAccess(e.target.value as typeof access)} aria-label={`Access for ${p.name}`}>
            {ACCESS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
          </select>
          <Vehicles key={access} vehicles={vehicles} chosen={p.vehicles} access={access} />
          <button className="btn p" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        </form>
      ) : <button type="button" className="btn" onClick={() => setOpen(true)}>Edit access</button>)}
      {!readOnly && (
        <form action={toggle} onSubmit={(e) => { if (p.active && !confirm(`Deactivate ${p.name}? They are signed out everywhere and cannot sign in until reactivated.`)) e.preventDefault(); }}>
          <input type="hidden" name="userId" value={p.id} />
          <input type="hidden" name="active" value={p.active ? '0' : '1'} />
          <button className="btn" disabled={toggling}>{p.active ? 'Deactivate' : 'Reactivate'}</button>
        </form>
      )}
      {!readOnly && p.active && (
        <form action={signOut}>
          <input type="hidden" name="userId" value={p.id} />
          <button className="btn" disabled={signing}>Sign out everywhere</button>
        </form>
      )}
      <Result r={saved ?? toggled ?? out} />
    </div>
  );
}

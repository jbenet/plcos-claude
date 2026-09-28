'use client';

import { useActionState } from 'react';
import { linkProjectsAction } from './actions';
import s from './linear.module.css';

type Decision = 'accept' | 'reject' | 'remove';

/**
 * One link decision: a person's click, which waits for the server's receipt before the page says
 * it happened (a consequential command, even though a link can be removed again).
 */
export function LinkButton({ vehicle, projects, decision, source, basis, label, quiet }: {
  vehicle: string; projects: string[]; decision: Decision; source: 'name' | 'person'; basis?: string | null; label: string; quiet?: boolean;
}) {
  const [state, action, pending] = useActionState(linkProjectsAction, {});
  return (
    <form action={action} className={s.linkForm}>
      <input type="hidden" name="vehicle" value={vehicle} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="source" value={source} />
      {basis && <input type="hidden" name="basis" value={basis} />}
      {projects.map((p) => <input key={p} type="hidden" name="project" value={p} />)}
      <button className={`btn ${quiet ? s.quiet : ''} ${s.small}`} disabled={pending}>{pending ? 'Saving…' : label}</button>
      <span aria-live="polite" className={state.error ? s.err : s.msgInline}>{state.error ?? ''}</span>
    </form>
  );
}

/** Link any project by hand, for a workstream whose name doesn't say which vehicle it serves. */
export function LinkPicker({ vehicle, vehicleName, options }: { vehicle: string; vehicleName: string; options: Array<{ projectId: string; name: string }> }) {
  const [state, action, pending] = useActionState(linkProjectsAction, {});
  if (options.length === 0) return null;
  return (
    <form action={action} className={s.linkForm}>
      <input type="hidden" name="vehicle" value={vehicle} />
      <input type="hidden" name="decision" value="accept" />
      <input type="hidden" name="source" value="person" />
      <label className="sr-only" htmlFor={`pick-${vehicle}`}>Link another project to {vehicleName}</label>
      <select id={`pick-${vehicle}`} name="project" className={s.pick} defaultValue="">
        <option value="" disabled>Link another project…</option>
        {options.map((o) => <option key={o.projectId} value={o.projectId}>{o.name}</option>)}
      </select>
      <button className={`btn ${s.quiet} ${s.small}`} disabled={pending}>{pending ? 'Saving…' : 'Link'}</button>
      <span aria-live="polite" className={state.error ? s.err : s.msgInline}>{state.error ?? state.message ?? ''}</span>
    </form>
  );
}

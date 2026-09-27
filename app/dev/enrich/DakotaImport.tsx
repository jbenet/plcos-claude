'use client';
import { useActionState } from 'react';
import { importDakotaAction } from './actions';
export function DakotaImport() {
  const [state,action,pending]=useActionState(importDakotaAction,{});
  return <section className="card"><div className="chead"><h2>Import Dakota</h2></div><div className="cbody">
    <p>Imports complete local replicas, enriches matched LPs with Dakota claims, and adds qualifying accounts as New candidates. The data stays in the database.</p>
    <p className="muted">Names alone remain possible matches. Ticket sizes remain estimates. Import from the live server after a pull completes.</p>
    <form action={action}><button className="btn p" disabled={pending}>{pending?'Importing Dakota…':'Import Dakota'}</button></form>
    <div aria-live="polite" aria-busy={pending}>{state.error&&<p role="alert">{state.error}</p>}{state.result&&<p>{state.result.replicas} replicas · {state.result.accounts} accounts changed · {state.result.contacts} contacts changed · {state.result.merged} corroborated matches · {state.result.possible} possible matches · {state.result.claims} claims changed · {state.result.sourced} New candidates.</p>}</div>
  </div></section>;
}

'use client';
import { useActionState } from 'react';
import { importPortfolioAction } from './actions';
export function PortfolioImport({file}:{file:string}) {
  const [state,action,pending]=useActionState(importPortfolioAction,{});
  return <section className="card"><div className="chead"><h2>Import portfolio</h2></div><div className="cbody">
    <p>Reads <code>{file}</code>. Company and founder rows retain their fund attribution and page-level sources.</p>
    <p className="muted">A name alone creates a possible match. Only corroborated identities link to existing people. Portfolio founders count as In touch; importing does not change pipeline status or consent.</p>
    <form action={action}><button className="btn p" disabled={pending}>{pending?'Importing portfolio…':'Import portfolio'}</button></form>
    <div aria-live="polite" aria-busy={pending}>{state.error&&<p role="alert">{state.error}</p>}{state.result&&<p>{state.result.rows} companies · {state.result.founders} founder records · {state.result.linked} corroborated links · {state.result.possible} possible matches.</p>}</div>
  </div></section>;
}

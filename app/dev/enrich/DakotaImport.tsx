'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DakotaStatus } from '@/lib/connectors/dakota/translate';
import { importDakotaAction } from './actions';
export function DakotaImport() {
  const [state,action,pending]=useActionState(importDakotaAction,{});
  const [job,setJob]=useState<DakotaStatus|null>(null),[pollError,setPollError]=useState<string|null>(null);
  const router=useRouter();
  useEffect(()=>{if(state.job)setJob(state.job);},[state.job]);
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const response=await fetch('/api/dakota/status',{cache:'no-store'});
        if(!response.ok)throw new Error();
        const data=await response.json() as {job:DakotaStatus|null};
        if(!cancelled){setJob(data.job);setPollError(null);}
      } catch {if(!cancelled)setPollError('Progress is unavailable. Retrying; committed batches are preserved.');}
      if(!cancelled)timer=setTimeout(poll,1500);
    };
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[]);
  useEffect(()=>{if(job?.status==='completed')router.refresh();},[job?.id,job?.status,router]);
  const running=job?.status==='queued'||job?.status==='running',result=job?.result;
  return <section className="card"><div className="chead"><h2>Import Dakota</h2></div><div className="cbody">
    <p>Imports complete local replicas in the background, enriches matched LPs with Dakota claims, and adds qualifying accounts as New candidates. The data stays in the database.</p>
    <p className="muted">Names alone remain possible matches. Ticket sizes remain estimates. Import from the live server after a pull completes. You can leave this page while it runs.</p>
    <form action={action}><button className="btn p" disabled={pending||running}>{pending?'Queueing…':running?'Import running':job?.status==='failed'?'Resume Dakota import':'Import Dakota'}</button></form>
    <div aria-live="polite">
      {state.error&&<p role="alert">{state.error}</p>}{pollError&&<p role="status">{pollError}</p>}
      {job&&<><p>{job.status==='completed'?'Completed':job.status==='failed'?'Stopped':job.status==='queued'?'Queued':'Working'} · {job.done.toLocaleString()} of {job.total.toLocaleString()} records processed · {job.phase==='reading'?'Reading complete replicas':job.phase}.</p>
        <p className="muted">Started {new Date(job.started).toLocaleString()} · Last batch {job.lastBatch?new Date(job.lastBatch).toLocaleString():'waiting'}.</p>
        {job.error&&<p role="alert">{job.error}</p>}</>}
      {result&&<p>{result.replicas} replicas · {result.accounts} accounts changed · {result.contacts} contacts changed · {result.merged} corroborated matches · {result.possible} possible matches · {result.claims} claims changed · {result.sourced} New candidates.</p>}
    </div>
  </div></section>;
}

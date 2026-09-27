'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IMPORT_LABELS, type ImportJob } from '@/lib/import-jobs/types';
type Status = Pick<ImportJob,'id'|'kind'|'status'|'phase'|'done'|'total'|'result'|'error'>;

/** One status area follows the user across pages. Closing a page does not cancel a child. */
export function ImportJobs() {
  const [jobs,setJobs]=useState<Status[]>([]),[error,setError]=useState<string|null>(null);
  const previous=useRef(new Map<string,string>());
  const router=useRouter();
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const response=await fetch('/api/import-jobs',{cache:'no-store'});
        if(!response.ok)throw new Error();
        const data=await response.json() as {jobs:Status[]};
        if(cancelled)return;
        if(data.jobs.some(j=>previous.current.has(j.id)&&previous.current.get(j.id)!==j.status&&['completed','failed'].includes(j.status)))router.refresh();
        previous.current=new Map(data.jobs.map(j=>[j.id,j.status]));
        setJobs(data.jobs);setError(null);
      } catch {if(!cancelled)setError('Import progress is unavailable. Retrying; no import has been restarted.');}
      if(!cancelled)timer=setTimeout(poll,2000);
    };
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[router]);
  if(!jobs.length&&!error)return null;
  const visible=jobs.filter(j=>['queued','running','failed'].includes(j.status));
  if(!visible.length&&jobs[0])visible.push(jobs[0]);
  return <section className="card" style={{margin:16}} aria-label="Import progress">
    <div className="chead"><h2>Imports</h2><span className="muted">You can keep using other pages.</span></div>
    <div className="cbody" aria-live="polite">
      {error&&<p role="status">{error}</p>}
      {visible.map(job=><div key={job.id} style={{marginBottom:8}}>
        <b>{IMPORT_LABELS[job.kind]}</b> · {job.status==='queued'?'Queued':job.status==='running'?'Working':job.status==='completed'?'Completed':'Stopped'}
        {' · '}{job.phase}{job.total!==null?` · ${job.done} of ${job.total} ${job.kind==='dakota'?'records':'steps'}`:''}
        {job.error&&<p role="alert">{job.error}</p>}
        {job.status==='completed'&&job.result&&<p className="muted">{Object.entries(job.result).filter(([,value])=>typeof value==='number').map(([key,value])=>`${key}: ${value}`).join(' · ')}</p>}
      </div>)}
    </div>
  </section>;
}

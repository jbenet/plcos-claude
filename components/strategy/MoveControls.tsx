'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importMoveFile, saveMove } from '@/app/[vehicle]/strategy/actions';
import type { MoveRow } from '@/modules/strategy/moves';
export function ImportMoves() {
  const [pending,start]=useTransition(); const [message,setMessage]=useState(''); const router=useRouter();
  return <div><button className="btn" disabled={pending} onClick={()=>start(async()=>{const r=await importMoveFile();setMessage(r.error??r.message??'');if(!r.error)router.refresh();})}>{pending?'Importing…':'Import move menu'}</button><span role="status">{message}</span></div>;
}
export function MoveControls({move,vehicleId}:{move:Pick<MoveRow,'id'|'state'|'position'|'version'>;vehicleId:string}) {
  const [pending,start]=useTransition(); const [error,setError]=useState(''); const router=useRouter();
  return <form className="move-decision" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);start(async()=>{const r=await saveMove({id:move.id,vehicleId,version:move.version,state:String(f.get('state')) as MoveRow['state'],position:f.get('position')?Number(f.get('position')):null,note:String(f.get('note'))});setError(r.error??'Saved.');if(!r.error)router.refresh();});}}>
    <label>Decision<select name="state" defaultValue={move.state}><option value="proposed">Proposed</option><option value="chosen">Chosen for planning</option><option value="dismissed">Dismissed</option></select></label>
    <label>Queue position<input name="position" aria-label="Manual queue position" type="number" min="1" max="10000" defaultValue={move.position??''} placeholder="Model order" /></label>
    <label>Reason<input name="note" required maxLength={1000} placeholder="Why change the plan?" /></label><button className="btn" disabled={pending}>{pending?'Saving…':'Save decision'}</button><span role="status">{error}</span>
  </form>;
}

import { getDb } from '@/lib/db';
import { dakotaFor, dakotaLabel } from '@/lib/connectors/dakota/view';
export async function DakotaClaims({entityId}:{entityId:string}) {
  const data=await dakotaFor(await getDb(),entityId);
  if(!data.claims.length&&!data.contacts.length&&!data.capacity)return null;
  return <section className="card"><div className="chead"><h2>Claims from Dakota</h2><span className="muted">Tier C · vendor claims, not evidence</span></div><div className="cbody">
    {data.capacity&&<p><b>Capacity estimate: {data.capacity.amount.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})}.</b> {data.capacity.basis} Confidence medium · imported by {data.capacity.verifiedBy}.</p>}
    {data.claims.map((c,i)=><div className="fact" key={`${c.field}:${i}`}><span>{c.subject==='LP'?'':`${c.subject}: `}{dakotaLabel(c.field)}</span><span>{c.value}<small className="muted" style={{display:'block'}}>Dakota · as of {new Date(c.as_of).toISOString().slice(0,10)} · confidence {c.confidence} · imported by {c.last_verified_by}</small></span></div>)}
    {data.contacts.length>0&&<><h3>Contacts at this account</h3>{data.contacts.map((c,i)=><p key={`${c.name}:${i}`}><b>{c.name}</b> · {c.title??'Title not recorded'}{c.likely?' · Likely first contact (title-based estimate)':''}<small className="muted" style={{display:'block'}}>Dakota · as of {new Date(c.as_of).toISOString().slice(0,10)} · confidence medium · imported by {c.last_verified_by}</small></p>)}</>}
  </div></section>;
}

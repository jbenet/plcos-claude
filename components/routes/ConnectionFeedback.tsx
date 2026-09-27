'use client';

import { useEffect, useId, useState } from 'react';
import { usePathname } from 'next/navigation';
import { newRequestKey } from '@/lib/request-key';

export function ConnectionFeedback({ lp }: { lp: string }) {
  const label = useId();
  const page = usePathname();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [receiptKey, setReceiptKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [policy,setPolicy]=useState<{allowed:boolean;error?:string}|null>(null);
  useEffect(()=>{
    let live=true;
    void fetch('/api/feedback').then(r=>r.json()).then((p:{allowed:boolean;error?:string})=>{if(live)setPolicy(p);})
      .catch(()=>{if(live)setPolicy({allowed:false,error:'Feedback policy is unavailable. Retry later.'});});
    return ()=>{live=false;};
  },[page]);
  if(!policy?.allowed)return <section className="card"><div className="chead"><h2>Connection feedback</h2></div><p className="cbody muted">{policy?.error??'Checking feedback policy…'}</p></section>;
  return <section className="card">
    <div className="chead"><h2>Connection feedback</h2></div>
    <form className="cbody" onSubmit={async (event) => {
      event.preventDefault();
      if (pending) return;
      const id = receiptKey ?? newRequestKey();
      setReceiptKey(id); setPending(true); setMessage('Saving…'); setFailed(false);
      try {
        const res = await fetch('/api/connection-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, lp, page, text }) });
        const result = await res.json();
        if (!res.ok || result.id !== id || !result.at) throw new Error(result.error ?? 'No save receipt received. Retry this note.');
        setText(''); setReceiptKey(null); setMessage('Saved. This note will inform connection review and the next research run.');
      } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'No save receipt received. Keep this note and retry.'); }
      finally { setPending(false); }
    }}>
      <label htmlFor={label}>What is wrong or missing about this LP&rsquo;s connections?</label>
      <textarea id={label} value={text} maxLength={5000} required disabled={pending} rows={3}
        placeholder="For example: I know them directly. Or describe a missing tie or a redundant route."
        onChange={(event) => { setText(event.target.value); setReceiptKey(null); setMessage(''); }}
        style={{ display: 'block', width: '100%', margin: '8px 0', padding: 10, border: '1px solid var(--hair)', borderRadius: 4, background: 'var(--surface)', color: 'var(--ink)', font: 'inherit' }} />
      <p className="muted" style={{ fontSize: 12 }}>Saved with your name and date. An explicit statement that you know this LP records your own reviewed tie; other corrections await review.</p>
      <button className="btn p" disabled={pending || !text.trim()}>{pending ? 'Saving…' : 'Save connection feedback'}</button>
      <p role={failed ? 'alert' : 'status'} style={{ color: failed ? 'var(--clay)' : 'var(--muted)', marginTop: 8 }}>{message}</p>
    </form>
  </section>;
}

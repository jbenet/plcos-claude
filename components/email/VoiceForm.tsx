'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveVoiceAction, type SavedVoice } from '@/app/settings/actions';
import s from './email.module.css';

const STYLE_HINT = 'Short. First name, no “Dear”. One idea per email, a question at the end. I sign off “Best, J”. Never “circle back”, “synergy” or “excited to share”.';

/** Your style notes and sample emails (docs/email-guidelines.md §Voice). Saving waits for the server. */
export function VoiceForm({ style, samples, limits }: { style: string; samples: string[]; limits: { styleChars: number; samples: number; sampleChars: number } }) {
  const router = useRouter();
  const [count, setCount] = useState(Math.min(limits.samples, Math.max(3, samples.length)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SavedVoice | null>(null);
  const send = async (form: HTMLFormElement, wipe: boolean) => {
    setBusy(true);
    try {
      const data = new FormData(form);
      if (wipe) data.set('delete', '1');
      const r = await saveVoiceAction(data);
      setResult(r);
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <form className={s.voiceForm} onSubmit={(e) => { e.preventDefault(); void send(e.currentTarget, false); }}>
      <label>
        <span>How you write</span>
        <textarea name="style" rows={4} maxLength={limits.styleChars} defaultValue={style} placeholder={STYLE_HINT} />
      </label>
      {Array.from({ length: count }, (_, i) => (
        <label key={i}>
          <span>Sample email {i + 1}</span>
          <textarea name="sample" rows={5} maxLength={limits.sampleChars} defaultValue={samples[i] ?? ''} placeholder={i === 0 ? 'Paste one email you sent: greeting to sign-off, without the thread below it.' : ''} />
        </label>
      ))}
      <div className={s.voiceActions}>
        <button type="submit" className="btn p" disabled={busy}>{busy ? 'Saving…' : 'Save my voice'}</button>
        {count < limits.samples && <button type="button" className="btn" onClick={() => setCount(count + 1)}>Add a sample</button>}
        {(style || samples.length > 0) && (
          <button type="button" className={`btn ${s.discard}`} disabled={busy} onClick={(e) => { if (window.confirm('Delete your style notes and sample emails?')) void send(e.currentTarget.form!, true); }}>Delete it</button>
        )}
        {result && (
          <span role="status" className={s.message} data-tone={result.ok ? 'ok' : 'bad'}>
            {result.ok ? (result.deleted ? 'Deleted.' : `Saved: ${result.styleChars ? 'your notes and ' : ''}${result.samples} ${result.samples === 1 ? 'sample' : 'samples'}.`) : result.error}
          </span>
        )}
      </div>
    </form>
  );
}

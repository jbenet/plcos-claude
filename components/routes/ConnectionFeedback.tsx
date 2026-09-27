'use client';

import { useId, useState } from 'react';
import { usePathname } from 'next/navigation';
import { enqueueConnectionNote } from '@/lib/feedback-outbox';
import { useOutbox } from '@/components/shell/FeedbackOutbox';

/**
 * A note about this LP's connections. Save puts it in this browser's feedback outbox and clears the
 * box at once (Juan, 27 Sep: writes must not be lost while an import pegs the server); the outbox
 * sends it until the server's receipt names it, and a resend is answered with the note already
 * kept (lib/enrich/feedback.ts). What it says below the button follows the outbox.
 *
 * It used to ask GET /api/feedback for a Dakota policy first. That handler went when the Dakota
 * refusal was taken off filing (merge 7bf581f), so the check always failed and hid the form.
 */
export function ConnectionFeedback({ lp }: { lp: string }) {
  const label = useId();
  const page = usePathname();
  const out = useOutbox();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const waiting = last ? out.entries.find((e) => e.clientId === last) : undefined;
  const filed = last ? out.filed.some((f) => f.clientId === last) : false;
  let message = '';
  let alert = false;
  if (failed) { message = failed; alert = true; }
  else if (waiting?.refused) { message = `Not saved: ${waiting.lastError}. The note is kept in this browser; open the outbox in the menu to retry or copy it.`; alert = true; }
  else if (waiting && waiting.attempts > 0) message = `Kept in this browser and retrying (${waiting.lastError ?? 'not confirmed'}). It saves on its own when the server answers.`;
  else if (waiting) message = 'Kept in this browser. Saving…';
  else if (last && filed) message = 'Saved. This note will inform connection review and the next research run.';
  else if (last) message = 'Saved.';

  return <section className="card">
    <div className="chead"><h2>Connection feedback</h2></div>
    <form className="cbody" onSubmit={async (event) => {
      event.preventDefault();
      if (saving || !text.trim()) return;
      setSaving(true); setFailed(null);
      try {
        const kept = await enqueueConnectionNote({ lp, page, text: text.trim() });
        setLast(kept.clientId); setText('');
      } catch (error) {
        setFailed(`This browser could not keep the note (${error instanceof Error ? error.message : 'no storage'}). Your text is still here; copy it somewhere safe or retry.`);
      } finally { setSaving(false); }
    }}>
      <label htmlFor={label}>What is wrong or missing about this LP&rsquo;s connections?</label>
      <textarea id={label} value={text} maxLength={5000} required disabled={saving} rows={3}
        placeholder="For example: I know them directly. Or describe a missing tie or a redundant route."
        onChange={(event) => { setText(event.target.value); setFailed(null); }}
        style={{ display: 'block', width: '100%', margin: '8px 0', padding: 10, border: '1px solid var(--hair)', borderRadius: 4, background: 'var(--surface)', color: 'var(--ink)', font: 'inherit' }} />
      <p className="muted" style={{ fontSize: 12 }}>Saved with your name and date. An explicit statement that you know this LP records your own reviewed tie; other corrections await review.</p>
      <button className="btn p" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Save connection feedback'}</button>
      <p role={alert ? 'alert' : 'status'} style={{ color: alert ? 'var(--clay)' : 'var(--muted)', marginTop: 8 }}>{message}</p>
    </form>
  </section>;
}

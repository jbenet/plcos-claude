'use client';

import { useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type Kind = 'bug' | 'request' | 'question' | 'chore';
type Priority = 'P0' | 'P1' | 'P2' | 'P3';

const SLA: Record<Priority, string> = {
  P0: 'triaged same business day · fixed in 1–2 days',
  P1: 'triaged in 1 business day · fixed within a week',
  P2: 'triaged in 2 business days · next version slice',
  P3: 'weekly triage · backlog',
};

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        Give feedback
      </button>
      {open && <FeedbackDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDrawer({ onClose }: { onClose: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<Kind>('bug');
  const [priority, setPriority] = useState<Priority>('P2');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState<{ id: string; location: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const context = useMemo(
    () => ({ route: path, filters }),
    [path, filters],
  );

  const submit = async () => {
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body, kind, priority, page: path, context }),
      });
      const json = (await res.json()) as { id?: string; location?: string; error?: string };
      if (!res.ok || !json.id || !json.location) throw new Error(json.error ?? 'Unknown error');
      setResult({ id: json.id, location: json.location });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('failed');
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="Give feedback">
        <div className="lbl">Feedback</div>

        {state === 'done' && result ? (
          <>
            <h2>Filed as issue {result.id}</h2>
            <p className="sublede">
              Written to <code>{result.location}</code>. It is a file in this repository, so it
              travels in the same pull request as its fix and survives <code>npm run db:reset</code>.
            </p>
            <div className="acts">
              <a className="btn p" href={`/issues/${result.id}`} style={{ textAlign: 'center', padding: 8 }}>
                Open the issue
              </a>
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>What went wrong?</h2>
            <p className="sublede" style={{ marginBottom: 14 }}>
              This writes a markdown file into <code>issues/</code>. No API token, no webhook.
            </p>

            <div className="lbl">Captured with it</div>
            <div className="ctx">{JSON.stringify(context, null, 2)}</div>

            <label className="field">
              <span className="lbl">Title</span>
              <input
                type="text"
                value={title}
                placeholder="Guard message doesn't say whose ask is blocking"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            <label className="field">
              <span className="lbl">What happened</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} />
            </label>

            <div className="fieldrow">
              <label className="field">
                <span className="lbl">Kind</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  <option value="bug">bug</option>
                  <option value="request">request</option>
                  <option value="question">question</option>
                  <option value="chore">chore</option>
                </select>
              </label>
              <label className="field">
                <span className="lbl">Priority</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
              </label>
            </div>
            <p className="note" style={{ marginTop: 0 }}>
              {priority}: {SLA[priority]}.
            </p>

            {state === 'failed' && (
              <div className="warn" style={{ marginTop: 12 }}>
                <div className="lbl" style={{ color: 'var(--clay)' }}>
                  Not filed
                </div>
                <p>{error} — nothing was written. Your text is still in the box.</p>
              </div>
            )}

            <div className="acts">
              <button className="btn p" disabled={!title.trim() || state === 'sending'} onClick={submit}>
                {state === 'sending' ? 'Filing…' : 'File it'}
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

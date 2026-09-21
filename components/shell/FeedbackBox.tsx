'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { ShotEditor } from './ShotEditor';
import { capturePage, METHOD_LABEL, type CaptureMethod } from '@/lib/capture';

type Kind = 'bug' | 'request' | 'question' | 'chore';
type Priority = 'P0' | 'P1' | 'P2' | 'P3';

const SLA: Record<Priority, string> = {
  P0: 'triaged same business day · fixed in 1–2 days',
  P1: 'triaged in 1 business day · fixed within a week',
  P2: 'triaged in 2 business days · next version slice',
  P3: 'weekly triage · backlog',
};

export function FeedbackButton({ variant = 'bar' }: { variant?: 'bar' | 'rail' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [method, setMethod] = useState<CaptureMethod | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * `capturePage` asks for a screen capture first, and that API needs the click's own
   * user activation — so nothing may be awaited before it. The busy flag is set after.
   */
  const start = () => {
    setBusy(true);
    void capturePage().then((c) => {
      setShot(c?.dataUrl ?? null);
      setMethod(c?.method ?? null);
      setNote(c?.note ?? null);
      setBusy(false);
      setOpen(true);
    });
  };

  return (
    <>
      <button
        className={variant === 'rail' ? 'railfeedback' : 'btn'}
        onClick={start}
        disabled={busy}
        aria-busy={busy}
      >
        {/* The label does not change while capturing — it would be in the screenshot.
            The dot is stripped from the capture by the filter below. */}
        {variant === 'rail' ? (
          <>
            <span aria-hidden>✎</span> Feedback
            {busy && <span className="capdot nocapture" aria-hidden />}
          </>
        ) : (
          <>
            Give feedback
            {busy && <span className="capdot nocapture" aria-hidden />}
          </>
        )}
      </button>
      {open && (
        <FeedbackDrawer
          shot={shot}
          method={method}
          note={note}
          onShot={setShot}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FeedbackDrawer({
  shot, method, note, onShot, onClose,
}: {
  shot: string | null;
  method: CaptureMethod | null;
  note: string | null;
  onShot: (png: string) => void;
  onClose: () => void;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<Kind>('bug');
  const [priority, setPriority] = useState<Priority>('P2');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState<{ id: string; location: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeShot, setIncludeShot] = useState(true);
  const [editing, setEditing] = useState(false);
  const [annotated, setAnnotated] = useState(false);

  /**
   * The drawer and the editor are portalled to <body>.
   *
   * They are rendered from inside the rail, and `.rail` is `position: sticky`, which makes
   * its own stacking context — so a z-index of 60 in there still painted underneath the
   * topbar's z-index of 5. A Playwright click on the editor's Done button found the pane
   * toggle instead, which is exactly what a person's click would have found.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
        body: JSON.stringify({
          title, body, kind, priority, page: path, context,
          screenshot: includeShot && shot ? shot : undefined,
        }),
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

  const ui = (
    <>
      {editing && shot && (
        <ShotEditor
          src={shot}
          onCancel={() => setEditing(false)}
          onSave={(png) => { onShot(png); setAnnotated(true); setEditing(false); }}
        />
      )}
      <div className="scrim nocapture" onClick={onClose} />
      <div className="drawer nocapture" role="dialog" aria-label="Give feedback">
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

            <div className="lbl" style={{ marginTop: 14 }}>Screenshot</div>
            {!shot ? (
              <p className="note" style={{ marginTop: 6 }}>
                This browser would not give us an image of the page. The complaint still files
                without one — a failed capture is not a reason to lose what you were going to say.
              </p>
            ) : (
              <>
                <div className={`shotthumb${includeShot ? '' : ' off'}`}>
                  <button
                    onClick={() => setEditing(true)}
                    aria-label="Open the screenshot to annotate it"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot} alt="The page as it looked when you pressed feedback" />
                    <span className="pencil" aria-hidden>✎ Annotate</span>
                  </button>
                  {annotated && <span className="flag f-ok annotated">annotated</span>}
                </div>
                <label className="shotcheck">
                  <input
                    type="checkbox"
                    checked={includeShot}
                    onChange={(e) => setIncludeShot(e.target.checked)}
                  />
                  <span>
                    Include screenshot
                    <small>
                      <b>{method ? METHOD_LABEL[method] : 'Captured'}.</b>{' '}
                      {note ?? 'Exactly the pixels that were on your screen.'} Filed beside the
                      issue as a PNG in this repository — click it to draw on it.
                    </small>
                  </span>
                </label>
              </>
            )}

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

  return mounted ? createPortal(ui, document.body) : null;
}

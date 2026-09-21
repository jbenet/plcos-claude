'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { ShotEditor } from './ShotEditor';
import { capturePage, METHOD_LABEL, type CaptureMethod, type Region } from '@/lib/capture';
import { RegionPicker } from './RegionPicker';
import { MarkdownField, type DroppedImage } from '@/components/ui/MarkdownField';

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

  /**
   * Opening the box takes no screenshot.
   *
   * It used to ask for one on every press, which meant a browser permission dialog before
   * the reporter had typed a word. A screenshot is now something you ask for.
   */
  return (
    <>
      <button
        className={variant === 'rail' ? 'railfeedback' : 'btn'}
        onClick={() => setOpen(true)}
      >
        {variant === 'rail' ? <><span aria-hidden>✎</span> Feedback</> : 'Give feedback'}
      </button>
      {open && <FeedbackDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDrawer({ onClose }: { onClose: () => void }) {
  const [shot, setShot] = useState<string | null>(null);
  const [method, setMethod] = useState<CaptureMethod | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const [picking, setPicking] = useState(false);
  const onShot = setShot;

  /**
   * Take the picture with the drawer hidden, so the panel is not in its own screenshot.
   * The `nocapture` filter already drops it, and hiding it also lets the reporter see the
   * page they are drawing a box on.
   */
  const take = (region?: Region) => {
    setShooting(true);
    setPicking(false);
    // One frame for the hidden class to land before the clone is made.
    requestAnimationFrame(() => {
      void capturePage(region).then((c) => {
        setShot(c?.dataUrl ?? null);
        setMethod(c?.method ?? null);
        setNote(c?.note ?? null);
        setShooting(false);
      });
    });
  };
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
  const [images, setImages] = useState<DroppedImage[]>([]);

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
          images: images.map((i) => ({ name: i.name, dataUrl: i.dataUrl })),
          /**
           * The server numbers attachments with the screenshot first, so a body written
           * against `attachment:1` would point at the screenshot once the box is ticked.
           * The offset is applied here rather than renumbering as the checkbox moves.
           */
          imageOffset: includeShot && shot ? 1 : 0,
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
      {picking && (
        <RegionPicker onPick={(r) => take(r)} onCancel={() => setPicking(false)} />
      )}
      <div className={`scrim nocapture${picking || shooting ? ' away' : ''}`} onClick={onClose} />
      <div
        className={`drawer nocapture${picking || shooting ? ' away' : ''}`}
        role="dialog"
        aria-label="Give feedback"
      >
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

            <div className="lbl" style={{ marginTop: 14 }}>
              {shot ? 'Screenshot' : 'Add a screenshot'}
            </div>
            {!shot ? (
              <>
                <div className="shotpick">
                  <button className="btn" onClick={() => take()} disabled={shooting}>
                    <span className="gl" aria-hidden>▢</span>
                    {shooting ? 'Drawing…' : 'Whole page'}
                  </button>
                  <button className="btn" onClick={() => setPicking(true)} disabled={shooting}>
                    <span className="gl" aria-hidden>⌖</span>
                    Pick a part
                  </button>
                </div>
                <p className="mdhint" style={{ border: 0, padding: '7px 0 0' }}>
                  No permission prompt: your browser draws the page from its own markup, and this
                  panel is left out of it. Optional — the complaint files without one.
                </p>
              </>
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
                      {note ?? 'Exactly the pixels that were on your screen.'} Click it to draw on
                      it.{' '}
                      <button className="linkish" onClick={(e) => { e.preventDefault(); setShot(null); }}>
                        Take another
                      </button>
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

            <div className="field">
              <span className="lbl">What happened</span>
              <MarkdownField
                value={body}
                onChange={setBody}
                images={images}
                onImages={setImages}
                placeholder={
                  'What you expected, what happened instead.\n\n'
                  + 'Markdown works. Drop a screenshot from somewhere else in here if you have one.'
                }
              />
            </div>

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

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { ShotEditor } from './ShotEditor';
import {
  capturePage, capturePageExact, METHOD_LABEL, type CaptureMethod, type Region,
} from '@/lib/capture';
import { RegionPicker } from './RegionPicker';
import { MarkdownField, packAttachments, type DroppedImage } from '@/components/ui/MarkdownField';

type Kind = 'bug' | 'request' | 'question' | 'chore';
type Priority = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * What a priority *means*, not when it will be fixed (issue 0012).
 *
 * The old list promised "fixed in 1–2 days" against P0, which is a delivery date invented by
 * a dropdown. How fast anything gets fixed is a function of how full the queue is, and a
 * promise the queue cannot keep teaches people to file everything as P0.
 */
const PRIORITY_MEANS: Record<Priority, string> = {
  P0: 'Blocking — nobody can work around this',
  P1: 'Serious — there is a workaround and it hurts',
  P2: 'Normal — worth doing, not urgent',
  P3: 'Someday — a good idea with no clock on it',
};

const WIDE_KEY = 'capitalos.feedback.wide';

export function FeedbackButton({
  variant = 'bar', profile = 'demo',
}: {
  variant?: 'bar' | 'rail';
  /** Where the issue is filed differs by profile, and the box says so (docs/15). */
  profile?: 'demo' | 'real';
}) {
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
      {open && <FeedbackDrawer profile={profile} onClose={() => setOpen(false)} />}
    </>
  );
}

interface Shot {
  id: string;
  dataUrl: string;
  method: CaptureMethod;
  annotated: boolean;
}

function FeedbackDrawer({ profile, onClose }: { profile: 'demo' | 'real'; onClose: () => void }) {
  /**
   * Screenshots are a list.
   *
   * The first is taken automatically when the box opens — a redraw, no dialog, and the
   * feedback panel redacted out of it. The buttons **add** rather than replace, because a
   * second shot of a different part of the page is a second piece of evidence, and one
   * somebody has already annotated must not vanish because they pressed the button again.
   */
  const [shots, setShots] = useState<Shot[]>([]);
  const [shooting, setShooting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** A picture dropped into the description, being drawn on (issue 0018). */
  const [editingImage, setEditingImage] = useState<number | null>(null);
  /** Everything filed while this box has been open — reports come in batches (issue 0017). */
  const [filed, setFiled] = useState<Array<{ id: string; title: string }>>([]);
  /** Bumped per report, so the description field starts from nothing rather than from a reset. */
  const [generation, setGeneration] = useState(0);
  const seeded = useRef(false);

  const add = (dataUrl: string, method: CaptureMethod) => {
    setShots((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, dataUrl, method, annotated: false },
    ]);
  };

  /** The automatic one. Its failure is silent — it was never asked for. */
  const seedShot = () => { void capturePage().then((c) => { if (c) add(c.dataUrl, c.method); }); };
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    seedShot();
  }, []);

  /**
   * A retake, using the browser's own screen capture. It shows a permission dialog and it
   * cannot redact — which is exactly the trade somebody makes when the automatic redraw has
   * got the layout wrong.
   */
  const take = (region?: Region) => {
    setShooting(true);
    setPicking(false);
    setFailed(false);
    requestAnimationFrame(() => {
      void capturePageExact(region)
        .then((c) => {
          if (c) add(c.dataUrl, c.method);
          else setFailed(true);
        })
        .catch(() => setFailed(true))
        // Whatever happens, the drawer comes back. A capture that can hang has to be able
        // to give up, and the panel must never be left hidden behind one.
        .finally(() => setShooting(false));
    });
  };

  const drop = (id: string) => setShots((prev) => prev.filter((x) => x.id !== id));
  const replace = (id: string, dataUrl: string) =>
    setShots((prev) => prev.map((x) => (x.id === id ? { ...x, dataUrl, annotated: true } : x)));

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
  const [images, setImages] = useState<DroppedImage[]>([]);

  /**
   * The drawer and the editor are portalled to <body>.
   *
   * They are rendered from inside the rail, and `.rail` is `position: sticky`, which makes
   * its own stacking context — so a z-index of 60 in there painted underneath the topbar's
   * z-index of 5.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [showKeys, setShowKeys] = useState(false);
  /**
   * Wider, for a report that has got long (issue 0020). Remembered in this browser only — it
   * is a preference about the screen, not something anybody else needs to see.
   */
  const [wide, setWide] = useState(false);
  useEffect(() => {
    try { setWide(window.localStorage.getItem(WIDE_KEY) === '1'); } catch { /* private window */ }
  }, []);
  const toggleWide = () => setWide((w) => {
    try { window.localStorage.setItem(WIDE_KEY, w ? '0' : '1'); } catch { /* private window */ }
    return !w;
  });

  /**
   * Escape closes the box, and ⌘/Ctrl+Enter files it (issues 0009, 0012).
   *
   * Escape is handled here and not in the editors: the annotation editor and the region
   * picker take it first when they are open, so the drawer only sees it when it is the
   * outermost thing on screen. That is the level people expect it to act at.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId || editingImage !== null || picking) return;
      if (e.key === 'Escape') {
        if (showKeys) { setShowKeys(false); return; }
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // On the confirmation, the same keys start the next one — reports come in batches.
        if (doneRef.current) againRef.current?.();
        else void submitRef.current?.();
      }
      if (e.key === '?' && (e.target as HTMLElement | null)?.tagName !== 'TEXTAREA'
          && (e.target as HTMLElement | null)?.tagName !== 'INPUT'
          && !(e.target as HTMLElement | null)?.isContentEditable) {
        e.preventDefault();
        setShowKeys((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingId, editingImage, picking, showKeys, onClose]);

  const filters = useMemo(() => Object.fromEntries(params.entries()), [params]);
  // What the report was written on (issue 0019, real): the browser, the window and the screen, so a
  // layout bug can be reproduced on the device it was seen on.
  const [client, setClient] = useState<{ userAgent: string; viewport: string; pixelRatio: number; touch: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    setClient({
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      pixelRatio: window.devicePixelRatio,
      touch: navigator.maxTouchPoints > 0,
    });
  }, [open]);
  const context = useMemo(
    () => ({ route: path, filters, ...(client ? { client } : {}) }),
    [path, filters, client],
  );

  // A draft survives a reload (issue 0018, real): the words, the kind and the priority are kept in
  // this browser while they're being written, one draft per page — the way GitHub keeps an unsent
  // comment — and cleared once the report is filed. Pictures are not kept: they're too big for it.
  const draftKey = `capitalos.feedback.draft:${path}`;
  const [restored, setRestored] = useState<string | null>(null);
  useEffect(() => {
    if (!open || title || body) return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { title?: string; body?: string; kind?: Kind; priority?: Priority; at?: string };
      if (!d.title && !d.body) return;
      setTitle(d.title ?? '');
      setBody(d.body ?? '');
      if (d.kind) setKind(d.kind);
      if (d.priority) setPriority(d.priority);
      setGeneration((g) => g + 1);
      setRestored(d.at ?? null);
    } catch { /* private window, or a draft that doesn't parse: start clean */ }
    // Only when the box opens: a restore while typing would fight the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey]);
  useEffect(() => {
    if (state === 'done') { try { window.localStorage.removeItem(draftKey); } catch { /* nothing kept */ } return; }
    try {
      if (title.trim() || body.trim()) window.localStorage.setItem(draftKey, JSON.stringify({ title, body, kind, priority, at: new Date().toISOString() }));
      else window.localStorage.removeItem(draftKey);
    } catch { /* private window: the draft just isn't kept */ }
  }, [title, body, kind, priority, state, draftKey]);

  const submitRef = useRef<(() => Promise<void>) | null>(null);

  const submit = async () => {
    if (!title.trim() && !body.trim()) return;
    if (state === 'sending' || state === 'done') return;
    setState('sending');
    setError(null);
    // A picture deleted from the text is not sent (issue 0020) — it may be the wrong one.
    const packed = packAttachments(body, images);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title, body: packed.body, kind, priority, page: path, context,
          screenshots: includeShot ? shots.map((x) => x.dataUrl) : [],
          images: packed.images.map((i) => ({ name: i.name, dataUrl: i.dataUrl })),
          /**
           * The server numbers attachments with the screenshot first, so a body written
           * against `attachment:1` would point at the screenshot once the box is ticked.
           * The offset is applied here rather than renumbering as the checkbox moves.
           */
          imageOffset: includeShot ? shots.length : 0,
        }),
      });
      const json = (await res.json()) as { id?: string; location?: string; title?: string; error?: string };
      if (!res.ok || !json.id || !json.location) throw new Error(json.error ?? 'Unknown error');
      setResult({ id: json.id, location: json.location });
      setFiled((prev) => [...prev, { id: json.id!, title: json.title ?? title }]);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('failed');
    }
  };
  submitRef.current = submit;

  /**
   * Start the next report without closing the box (issue 0017).
   *
   * Everything specific to the last one goes — its words, its pictures, its kind and
   * priority — and a fresh automatic screenshot is taken, because the one that was attached
   * belongs to the issue it was filed with. The page and filters are captured again anyway.
   */
  const again = () => {
    setRestored(null);
    setTitle('');
    setBody('');
    setImages([]);
    setShots([]);
    setIncludeShot(true);
    setFailed(false);
    setKind('bug');
    setPriority('P2');
    setError(null);
    setResult(null);
    setState('idle');
    setGeneration((g) => g + 1);
    seedShot();
  };
  const againRef = useRef<(() => void) | null>(null);
  againRef.current = again;
  const doneRef = useRef(false);
  doneRef.current = state === 'done';

  const ui = (
    <>
      {editingId && (
        <ShotEditor
          src={shots.find((x) => x.id === editingId)!.dataUrl}
          onCancel={() => setEditingId(null)}
          onSave={(png) => { replace(editingId, png); setEditingId(null); }}
        />
      )}
      {editingImage !== null && images.some((i) => i.index === editingImage) && (
        <ShotEditor
          src={images.find((i) => i.index === editingImage)!.dataUrl}
          onCancel={() => setEditingImage(null)}
          onSave={(png) => {
            const which = editingImage;
            setImages((prev) => prev.map((i) => (i.index === which
              ? { ...i, dataUrl: png, contentType: 'image/png', annotated: true }
              : i)));
            setEditingImage(null);
          }}
        />
      )}
      {picking && (
        <RegionPicker onPick={(r) => take(r)} onCancel={() => setPicking(false)} />
      )}
      {showKeys && (
        <div className={`keycard nocapture${wide ? ' overdrawer' : ''}`} role="dialog" aria-label="Keyboard shortcuts">
          <div className="lbl">Keyboard · this dialog first</div>
          <dl>
            <div><dt><kbd>⌘</kbd><kbd>↵</kbd></dt><dd>File the report</dd></div>
            <div><dt><kbd>esc</kbd></dt><dd>Close this card, then the annotation editor, then the box</dd></div>
            <div><dt><kbd>tab</kbd> / <kbd>⇧</kbd><kbd>tab</kbd></dt><dd>Next and previous field — this is how you leave a text box</dd></div>
            <div><dt><kbd>?</kbd></dt><dd>This card, when the cursor is not in a text box</dd></div>
          </dl>
          <div className="lbl" style={{ marginTop: 10 }}>Anywhere</div>
          <dl>
            <div><dt><kbd>⌘</kbd><kbd>k</kbd></dt><dd>Not built yet — say so and it will be</dd></div>
          </dl>
          <button className="btn" onClick={() => setShowKeys(false)}>Close</button>
        </div>
      )}
      <div className={`scrim nocapture${picking || shooting ? ' away' : ''}`} onClick={onClose} />
      <div
        className={`drawer nocapture${wide ? ' wide' : ''}${picking || shooting ? ' away' : ''}`}
        role="dialog"
        aria-label="Give feedback"
      >
        <div className="drawerhead">
          <div className="lbl">Feedback</div>
          <button
            type="button"
            className="drawerwide"
            onClick={toggleWide}
            aria-pressed={wide}
            title={wide ? 'Back to the narrow panel' : 'Use more of the page for a long report'}
          >
            {wide ? '⇥ Narrower' : '⇤ Wider'}
          </button>
        </div>

        {state === 'done' && result ? (
          <>
            <h2>Filed as issue {result.id}</h2>
            <p className="sublede">
              Thanks — it is in the queue with this page, your filters and any screenshots
              attached.
            </p>
            <div className="acts three">
              <button className="btn p" onClick={again} autoFocus>
                Give more feedback
              </button>
              <a className="btn" href={`/issues/${result.id}`} style={{ textAlign: 'center' }}>
                Open the issue
              </a>
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
            <div className="keyhint">
              <span><kbd>⌘</kbd><kbd>↵</kbd> another</span>
              <span><kbd>esc</kbd> close</span>
            </div>
            {filed.length > 0 && (
              <div className="filedlist">
                <div className="lbl">Filed while this was open · {filed.length}</div>
                {filed.map((f) => (
                  <a key={f.id} href={`/issues/${f.id}`} className="filedrow">
                    <span className="mono">{f.id}</span>
                    <span>{f.title || 'Untitled'}</span>
                  </a>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h2>What went wrong?</h2>
            <p className="sublede" style={{ marginBottom: 14 }}>
              A description is enough. The title, the page you are on and your filters are
              filled in for you.
            </p>

            <div className="fbcols">
            <div className="fbshots">
            <div className="lbl">
              Screenshots{shots.length > 0 ? ` · ${shots.length}` : ''}
            </div>

            <div className={`shotlist${includeShot ? '' : ' off'}`}>
              {shots.map((x, i) => (
                <div className="shotthumb" key={x.id}>
                  <button
                    className="shotopen"
                    onClick={() => setEditingId(x.id)}
                    aria-label={`Annotate screenshot ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={x.dataUrl} alt={`Screenshot ${i + 1}`} />
                    <span className="pencil" aria-hidden>✎ Annotate</span>
                  </button>
                  <button
                    className="shotx"
                    onClick={() => drop(x.id)}
                    aria-label={`Remove screenshot ${i + 1}`}
                    title="Remove"
                  >
                    ×
                  </button>
                  <div className="shotmeta">
                    <span className={`flag ${x.method === 'screen' ? 'f-ok' : 'f-mute'}`}>
                      {METHOD_LABEL[x.method]}
                    </span>
                    {x.annotated && <span className="flag f-ok">annotated</span>}
                    {x.method === 'render' && (
                      <span
                        className="misaligned"
                        tabIndex={0}
                        title={
                          'The automatic capture is your browser redrawing the page from its own '
                          + 'markup. It needs no permission and it leaves this panel out — but it '
                          + 'can get spacing, wrapping or a form control subtly wrong.\n\n'
                          + 'If it looks wrong, press Whole page or Pick a part below. Those use '
                          + "your browser's own screen capture, so they are exactly what you see. "
                          + 'Your browser will ask permission first, and that capture cannot leave '
                          + 'this panel out.'
                        }
                      >
                        Mis-aligned?
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="shotpick">
              <button className="btn" onClick={() => take()} disabled={shooting}>
                <span className="gl" aria-hidden>▢</span>
                {shooting ? 'Capturing…' : 'Whole page'}
              </button>
              <button className="btn" onClick={() => setPicking(true)} disabled={shooting}>
                <span className="gl" aria-hidden>⌖</span>
                Pick a part
              </button>
            </div>
            <p className="mdhint" style={{ border: 0, padding: '7px 0 0' }}>
              {shots.length === 0
                ? 'Optional — the complaint files without one.'
                : 'Adds another; it does not replace what is already here.'}
              {' '}Both buttons use your browser&rsquo;s screen capture for exact pixels, and it
              will ask permission.
            </p>
            {failed && (
              <p className="mdhint refused">
                No capture came back — declined, unsupported, or it took too long. Everything else
                still files.
              </p>
            )}

            {shots.length > 0 && (
              <label className="shotcheck">
                <input
                  type="checkbox"
                  checked={includeShot}
                  onChange={(e) => setIncludeShot(e.target.checked)}
                />
                <span>
                  Include {shots.length === 1 ? 'the screenshot' : `all ${shots.length} screenshots`}
                  <small>
                    {profile === 'real'
                      ? 'Filed beside the issue as PNGs in data/real/issues/, with the real data — never committed.'
                      : 'Filed beside the issue as PNGs in this repository.'}{' '}
                    Click one to draw on it; the × removes it.
                  </small>
                </span>
              </label>
            )}

            </div>

            <div className="fbtext">
            {restored !== null && state === 'idle' && (title || body) && (
              <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                Your unsent draft for this page, kept in this browser{restored ? ` since ${new Date(restored).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}. Pictures aren&rsquo;t kept in a draft.
              </p>
            )}
            <label className="field">
              <span className="lbl">Title · optional</span>
              <input
                type="text"
                value={title}
                placeholder="Left blank, intake names it from your first line"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            <div className="field">
              <span className="lbl">What happened</span>
              <MarkdownField
                key={generation}
                value={body}
                onChange={setBody}
                images={images}
                onImages={setImages}
                onAnnotate={(i) => setEditingImage(i)}
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
                  {(Object.keys(PRIORITY_MEANS) as Priority[]).map((p) => (
                    <option key={p} value={p}>{p} — {PRIORITY_MEANS[p]}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="note" style={{ marginTop: 0 }}>
              {PRIORITY_MEANS[priority]}. <b>No date is promised against a priority</b> — how
              fast anything is fixed depends on how full the queue is, which the issues page
              shows.
            </p>

            {state === 'failed' && (
              <div className="warn" style={{ marginTop: 12 }}>
                <div className="lbl" style={{ color: 'var(--clay)' }}>
                  Not filed
                </div>
                <p>{error} — nothing was written. Your text is still in the box.</p>
              </div>
            )}
            </div>
            </div>

            <div className="acts">
              <button
                className="btn p"
                disabled={(!title.trim() && !body.trim()) || state === 'sending'}
                onClick={submit}
              >
                {state === 'sending' ? 'Filing…' : 'File it'}
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
            <div className="keyhint">
              <span><kbd>⌘</kbd><kbd>↵</kbd> file</span>
              <span><kbd>esc</kbd> close</span>
              <span><kbd>tab</kbd> next field</span>
              <button type="button" onClick={() => setShowKeys(true)}>
                <kbd>?</kbd> all shortcuts
              </button>
            </div>
            {/* What goes with the report — the page, its filters, the device — is there to repro a bug,
                not to read (issue 0025, real): at the foot, folded, open on demand. */}
            <details className="more fbcaptured">
              <summary>Captured with it: the page, its filters and the device</summary>
              <div className="ctx">{JSON.stringify(context, null, 2)}</div>
            </details>
          </>
        )}
      </div>
    </>
  );

  return mounted ? createPortal(ui, document.body) : null;
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { ShotEditor } from './ShotEditor';
import {
  capturePage, capturePageExact, METHOD_LABEL, type CaptureMethod, type Region,
} from '@/lib/capture';
import { RegionPicker } from './RegionPicker';
import shell from './Shell.module.css';
import { ShortcutList, useShortcutPlatform } from './KeyboardShortcuts';
import { isFeedbackKey, isShortcutsKey } from '@/lib/keyboard-shortcuts';
import { MarkdownField, packAttachments, type DroppedImage } from '@/components/ui/MarkdownField';
import {
  discardDraft, listDrafts, readDraft, readPictures, writeDraft, writePictures, type DraftSummary,
} from '@/lib/feedback-drafts';
import { enqueue, startOutbox } from '@/lib/feedback-outbox';
import { formatDate } from '@/lib/time';

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

/** "14:05" today, "23 Sep 14:05" before. */
const savedAt = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${formatDate(d, { day: 'numeric', month: 'short' })} ${time}`;
};

export function FeedbackButton({
  variant = 'bar', profile = 'demo', home = { filesHere: true, livePort: null },
}: {
  variant?: 'bar' | 'rail';
  /** Where the issue is filed differs by profile, and the box says so (docs/15). */
  profile?: 'demo' | 'real';
  /** Whether this server files issues, and the live app's port when it does not (config/ports.ts). */
  home?: { filesHere: boolean; livePort: number | null };
}) {
  const [open, setOpen] = useState(false);
  const { alt } = useShortcutPlatform();
  // The outbox sends what an earlier page, tab or session kept (lib/feedback-outbox.ts). Every
  // layout has this button — even the busy-server one without a rail — so it starts here.
  useEffect(() => { startOutbox(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isFeedbackKey(event) || document.querySelector('dialog[open], [role="dialog"]:not(dialog):not([hidden])')) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /**
   * The drawer may add an automatic redraw, which needs no browser permission.
   * An exact screen capture is requested separately from inside the drawer.
   */
  return (
    <>
      <button
        className={variant === 'rail' ? 'railfeedback' : 'btn'}
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Alt+F"
        title="Give feedback"
      >
        {variant === 'rail' ? <><span aria-hidden>✎</span> Feedback</> : 'Give feedback'}
        <span className="feedbackkey">{alt}+F</span>
      </button>
      {open && (home.filesHere
        ? <FeedbackDrawer profile={profile} onClose={() => setOpen(false)} />
        : <FiledFromLive livePort={home.livePort} onClose={() => setOpen(false)} />)}
    </>
  );
}

/**
 * A dev worktree's servers file nothing (docs/COLLAB.md): issue numbers are taken in filing order,
 * so an issue filed on a branch would take a number the live app gives out too. The box says so
 * before anything is typed, and links to the live app on the host name in the address bar — the
 * iPad reaches these servers by IP, where "localhost" would be somewhere else.
 */
function FiledFromLive({ livePort, onClose }: { livePort: number | null; onClose: () => void }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (livePort) setHref(`${window.location.protocol}//${window.location.hostname}:${livePort}/`);
  }, [livePort]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="scrim nocapture" onClick={onClose} />
      <div className={`drawer nocapture ${shell.drawer}`} role="dialog" aria-label="Give feedback">
        <div className="drawerhead"><div className="lbl">Feedback</div></div>
        <h2>Feedback is filed from the live app</h2>
        <p className="sublede">
          This server runs a branch in development, not master. Issues are numbered in the order
          they are filed, so one filed here would take a number the live app gives out too. File it
          from the live app, and say which branch and page it is about.
        </p>
        <div className="acts">
          {href && <a className="btn p" href={href}>Open the live app · :{livePort}</a>}
          <button className="btn" onClick={onClose} autoFocus={!href}>Close</button>
        </div>
        {!livePort && (
          <p className="note">
            No live app is named for this checkout in .ports.json, so there is no link. It runs from
            the folder that holds .git.
          </p>
        )}
      </div>
    </>,
    document.body,
  );
}

interface Shot {
  id: string;
  dataUrl: string;
  method: CaptureMethod;
  annotated: boolean;
  /** The reporter said the automatic capture does not match the screen. */
  misaligned?: boolean;
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
  const flagMisaligned = (id: string) =>
    setShots((prev) => prev.map((x) => (x.id === id ? { ...x, misaligned: !x.misaligned } : x)));

  const path = usePathname();
  const params = useSearchParams();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<Kind>('bug');
  const [priority, setPriority] = useState<Priority>('P2');
  /** 'saving' is the moment it goes into this browser's outbox; nothing here waits on the server. */
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [imagesPending, setImagesPending] = useState(false);
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
        void submitRef.current?.();
      }
      if (isShortcutsKey(e)) {
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
    setClient({
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      pixelRatio: window.devicePixelRatio,
      touch: navigator.maxTouchPoints > 0,
    });
  }, []);

  /**
   * Drafts (issues 0018 and 0026, real). The box edits one draft at a time, named by the page it was
   * started on: this page's, until another is picked from the list beside Wider. Its words and its
   * pictures are kept in this browser as they change (lib/feedback-drafts.ts) and dropped once it is
   * filed. A draft is words, or a picture somebody drew on or dropped in; the automatic screenshot
   * alone is not one. Moving to another page with the box open keeps editing the same draft.
   */
  const [draftPage, setDraftPage] = useState(path);
  const [restored, setRestored] = useState<{ at: string; pictures: number } | null>(null);
  const [others, setOthers] = useState<DraftSummary[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  /** While a draft's pictures are read back, nothing is saved over them. */
  const hydrating = useRef(false);
  const worthKeeping = Boolean(title.trim() || body.trim() || shots.some((x) => x.annotated) || images.length);

  /**
   * Put a draft in the box: its words at once, its pictures when IndexedDB answers. `carry` is what
   * to show when it brings no pictures — the screenshot already on screen, or (null) a fresh one.
   */
  const load = (page: string, carry: Shot[] | null) => {
    const d = readDraft(page);
    setDraftPage(page);
    setTitle(d?.title ?? '');
    setBody(d?.body ?? '');
    setKind((d?.kind as Kind | undefined) ?? 'bug');
    setPriority((d?.priority as Priority | undefined) ?? 'P2');
    setRestored(d ? { at: d.at ?? '', pictures: d.pictures ?? 0 } : null);
    setImages([]);
    setGeneration((g) => g + 1);
    const fill = (kept: { shots: Shot[]; images: DroppedImage[] } | null) => {
      if (kept) { setShots(kept.shots); setImages(kept.images); }
      else if (carry) setShots(carry);
      else { setShots([]); seedShot(); }
    };
    if (d?.pictures) {
      hydrating.current = true;
      setShots([]);
      void readPictures<Shot, DroppedImage>(page).then((kept) => { hydrating.current = false; fill(kept); });
    } else if (d) setShots([]); // A saved draft with no pictures keeps the reporter’s deletion.
    else fill(null);
  };
  // On opening: this page's draft, if there is one, else a fresh automatic screenshot.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    load(path, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hydrating.current || state === 'saved') return;
    writeDraft(draftPage, worthKeeping
      ? { title, body, kind, priority, at: new Date().toISOString(), pictures: shots.length + images.length }
      : null);
  }, [title, body, kind, priority, shots, images, draftPage, state, worthKeeping]);
  // Pictures change rarely — taken, drawn on, removed — so each change is written as it happens.
  useEffect(() => {
    if (hydrating.current || state === 'saved') return;
    void writePictures<Shot, DroppedImage>(draftPage, worthKeeping ? { shots, images } : null);
  }, [shots, images, draftPage, state, worthKeeping]);
  useEffect(() => {
    setOthers(listDrafts().filter((d) => d.page !== draftPage));
  }, [draftPage, showDrafts, state]);

  /** The one in the box is already kept, as it stands; its pictures stay with it. */
  const switchTo = (page: string) => {
    load(page, worthKeeping ? null : shots);
    setShowDrafts(false);
  };
  const discard = (page: string) => {
    if (!window.confirm(`Discard the unsent draft started on ${page}? Its words and pictures go, and this cannot be undone.`)) return;
    void discardDraft(page).then(() => setOthers(listDrafts().filter((d) => d.page !== draftPage)));
  };

  const misaligned = shots.flatMap((x, i) => (x.misaligned ? [i + 1] : []));
  const context = useMemo(
    () => ({
      route: path, url: typeof window !== 'undefined' ? window.location.href : undefined, filters,
      ...(draftPage !== path ? { startedOn: draftPage } : {}),
      ...(client ? { client } : {}),
      ...(misaligned.length ? { capture: { misaligned } } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, filters, client, draftPage, misaligned.join(',')],
  );

  const submitRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * File it (Juan, 27 Sep: "it should journal to the server. the page may die or close forever").
   * The report is kept in this browser first (lib/feedback-outbox.ts), then posted with a 3 s
   * timeout; the server journals it and answers at once, and files it afterwards. The box closes
   * either way, and the rail says which it is: "Saved on the server" (safe to close the tab) or
   * "only on this device" (the server was not reached; it resends on its own). Only a report that
   * neither this browser nor the server could keep stays in the box, as a draft, with the reason.
   */
  const submit = async () => {
    if (!title.trim() && !body.trim()) return;
    if (state !== 'idle' && state !== 'failed') return;
    if (imagesPending || hydrating.current) return;
    setState('saving');
    setError(null);
    // A picture deleted from the text is not sent (issue 0020) — it may be the wrong one.
    const packed = packAttachments(body, images);
    try {
      await enqueue({
        title, body: packed.body, kind, priority, page: path, context,
        screenshots: shots.map((x) => x.dataUrl),
        images: packed.images.map((i) => ({ name: i.name, dataUrl: i.dataUrl })),
        /**
         * The server numbers attachments with the screenshot first, so a body written
         * against `attachment:1` needs an offset for the screenshots still attached.
         */
        imageOffset: shots.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('failed');
      return;
    }
    // Kept in the outbox now: the draft goes, and nothing autosaves it back on the way out.
    setState('saved');
    void discardDraft(draftPage);
    onClose();
  };
  submitRef.current = submit;

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
          <ShortcutList group="feedback" />
          <button className="btn" onClick={() => setShowKeys(false)}>Close</button>
        </div>
      )}
      <div className={`scrim nocapture${picking || shooting ? ' away' : ''}`} onClick={onClose} />
      <div
        className={`drawer nocapture ${shell.drawer}${wide ? ' wide' : ''}${picking || shooting ? ' away' : ''}`}
        role="dialog"
        aria-label="Give feedback"
      >
        <div className="drawerhead">
          <h2 className="fbhead">Feedback</h2>
          {others.length > 0 && state !== 'saved' && (
            <button
              type="button"
              className="drawerwide"
              onClick={() => setShowDrafts((v) => !v)}
              aria-expanded={showDrafts}
              data-tip="Unsent reports kept in this browser, started on other pages"
            >
              Drafts · {others.length}
            </button>
          )}
          <button
            type="button"
            className="drawerwide"
            onClick={toggleWide}
            aria-pressed={wide}
            data-tip={wide ? 'Back to the narrow panel' : 'Use more of the page for a long report'}
          >
            {wide ? '⇥ Narrower' : '⇤ Wider'}
          </button>
        </div>
        {showDrafts && others.length > 0 && state !== 'saved' && (
          <div className="draftlist">
            <div className="lbl">Unsent, kept in this browser · {others.length}</div>
            {others.map((d) => (
              <div className="draftrow" key={d.page}>
                <button type="button" className="draftopen" onClick={() => switchTo(d.page)}>
                  <b>{d.title}</b>
                  <span>
                    {d.page}{d.at ? ` · ${savedAt(d.at)}` : ''}
                    {d.pictures ? ` · ${d.pictures} ${d.pictures === 1 ? 'picture' : 'pictures'}` : ''}
                  </span>
                </button>
                <button type="button" className="draftx" onClick={() => discard(d.page)}>Discard</button>
              </div>
            ))}
            <p>
              Picking one puts it in this box, pictures and all{worthKeeping ? '; the one in the box now is kept' : ''}.
              It is filed with this page and says which page it was started on.
            </p>
          </div>
        )}

        <>
            <div className="fbcols">
            <div className="fbshots">
            <div className="lbl">
              Screenshots{shots.length > 0 ? ` · ${shots.length}` : ''}
            </div>

            <div className="shotlist">
              {shots.map((x, i) => (
                <div className="shotthumb" key={x.id}>
                  <button
                    className="shotopen"
                    onClick={() => setEditingId(x.id)}
                    aria-label={`Annotate screenshot ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={x.dataUrl} alt={`Screenshot ${i + 1}`} />
                  </button>
                  <div className="mdembedbar">
                    <button type="button" onClick={() => setEditingId(x.id)} data-tip="Draw on this picture">✎ Annotate</button>
                    <button
                      type="button"
                      className="x"
                      onClick={() => drop(x.id)}
                      aria-label={`Remove screenshot ${i + 1}`}
                      data-tip={`Delete screenshot ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="shotmeta">
                    <span className={`flag ${x.method === 'screen' ? 'f-ok' : 'f-mute'}`}>
                      {METHOD_LABEL[x.method]}
                    </span>
                    {x.annotated && <span className="flag f-ok">annotated</span>}
                    {x.method === 'render' && (
                      <button
                        type="button"
                        className={`misaligned${x.misaligned ? ' on' : ''}`}
                        aria-pressed={Boolean(x.misaligned)}
                        onClick={() => flagMisaligned(x.id)}
                        data-tip={
                          'The automatic capture is your browser redrawing the page from its own '
                          + 'markup. It needs no permission and it leaves this panel out — but it '
                          + 'can get spacing, wrapping or a form control subtly wrong.\n\n'
                          + 'Press to tell us it does not match your screen: the report says so, '
                          + 'which helps fix the capture. For exact pixels, press Whole page or '
                          + "Pick a part below; they take a screenshot in your browser."
                        }
                      >
                        {x.misaligned ? 'Misaligned · noted' : 'Misaligned? Tell us'}
                      </button>
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
              <span
                className="fbhelp" data-tip-end=""
                tabIndex={0}
                role="note"
                aria-label="About screenshots"
                data-tip={
                  (shots.length === 0
                    ? 'Optional — the report files without one.'
                    : 'Adds another; it does not replace what is already here.')
                  + " Both buttons use your browser's screen capture for exact pixels, and it will ask permission. "
                  + 'Click a screenshot to annotate it; use its × to delete it. '
                  + (profile === 'real'
                      ? 'Filed beside the issue with the real data — never committed.'
                      : 'Filed beside the issue in this repository.')
                }
              >
                ?
              </span>
            </div>
            {failed && (
              <p className="mdhint refused">
                No capture came back — declined, unsupported, or it took too long. Everything else
                still files.
              </p>
            )}
            {shots.some((x) => x.misaligned) && (
              <p className="mdhint">Thanks — the report says the automatic capture was off. Click the <b>Whole Page</b> or <b>Pick a Part</b> to take a screenshot in your browser.</p>
            )}

            </div>

            <div className="fbtext">
            {restored !== null && state === 'idle' && worthKeeping && (
              <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                Your unsent draft {draftPage === path ? 'for this page' : <>started on <span className="mono">{draftPage}</span></>},
                kept in this browser{restored.at ? ` since ${savedAt(restored.at)}` : ''}
                {restored.pictures ? ', with its pictures' : ''}.
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
              <span className="lbl">Enter any feedback:</span>
              <MarkdownField
                key={generation}
                value={body}
                onChange={setBody}
                images={images}
                onImages={setImages}
                onPendingChange={setImagesPending}
                onAnnotate={(i) => setEditingImage(i)}
                label="Enter any feedback"
                placeholder={
                  'What you expected, what happened instead.\n'
                  + 'Markdown works. Drop or paste a screenshot from somewhere else in here.'
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

            {state === 'failed' && (
              <div className="warn" style={{ marginTop: 12 }}>
                <div className="lbl" style={{ color: 'var(--clay)' }}>
                  Not saved
                </div>
                <p>Neither the server nor this browser could keep it ({error}). Your text and pictures are still in this draft; try File again, or copy the text somewhere safe.</p>
              </div>
            )}
            </div>
            </div>

            <div className="acts">
              <button
                className="btn p"
                disabled={(!title.trim() && !body.trim()) || state === 'saving' || imagesPending}
                onClick={submit}
              >
                {state === 'saving' ? 'Saving…' : 'File it'}
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
      </div>
    </>
  );

  return mounted ? createPortal(ui, document.body) : null;
}

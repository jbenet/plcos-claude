'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import shell from './Shell.module.css';
import { useShortcutPlatform } from './KeyboardShortcuts';
import { isFeedbackKey } from '@/lib/keyboard-shortcuts';
import { startOutbox } from '@/lib/feedback-outbox';

/**
 * The drawer — its form, drafts, captures and outbox — is fetched when it first opens, not with every page: it was the
 * biggest piece of the script every page loads (perf pass, 17 Oct 2026). Pointing at or focusing the button fetches it
 * ahead of the click.
 */
const loadDrawer = () => import('./FeedbackDrawer').then((m) => m.FeedbackDrawer);
const FeedbackDrawer = dynamic(loadDrawer, { ssr: false });

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
        onPointerEnter={home.filesHere ? () => void loadDrawer() : undefined}
        onFocus={home.filesHere ? () => void loadDrawer() : undefined}
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


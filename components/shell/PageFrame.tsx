'use client';

import Link from '@/components/ui/AppLink';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PANE_QUERY } from '@/lib/viewport';
import { useMedia, useModalSheet } from './useSheet';
import { TopSearch } from './TopSearch';
import s from './Shell.module.css';

const STORE_KEY = 'capitalos.rightpane';

/**
 * The frame every screen sits in: breadcrumb bar, work area, and a right pane that is
 * closable.
 *
 * The pane is for drilling into one thing — the detail of a selected object, the source
 * material behind it, a conversation about it. It is not scaffolding, so it closes, and
 * the choice is remembered.
 *
 * Up to PANE_MAX wide (issue 0090) the pane is not drawn beside the work, which it left a column
 * about 230 px wide on a tablet held upright. A Details button opens it over the page instead: from
 * the right on a tablet, from the bottom on a phone, with a close button, Escape, a tap outside, and
 * focus kept inside it until it closes. That sheet always starts closed and is not remembered; the
 * desktop choice above is left as it was.
 */
const PROFILE = {
  demo: {
    label: 'Demo data',
    title: 'Fictional people and amounts. Safe to reset, screenshot and publish.',
  },
  real: {
    label: 'Real data',
    title: 'The real raise. This machine only: never committed, screenshotted or published (docs/15).',
  },
  /** A preview (docs/COLLAB.md): the real data as it was when copied, for a branch in development. */
  copy: {
    label: 'Copy of real data',
    title:
      'A copy of the real data, served for a branch in development (npm run preview). Changes made here stay in the copy ' +
      'and are thrown away when it is copied again; the live data never sees them. Real data all the same: never ' +
      'committed, screenshotted or published (docs/15).',
  },
} as const;

export function PageFrame({
  profile, notice, crumbs, syncTone, syncLine, syncTitle, actions, inspector, children,
}: {
  /** Passed in rather than read from config, which only knows the answer on the server. */
  profile: 'demo' | 'real' | 'copy';
  notice?: string;
  crumbs: Array<{ label: string; href?: string }>;
  syncTone: string;
  syncLine: string;
  syncTitle: string;
  actions?: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw !== null) setOpen(raw === 'open');
    } catch {
      /* blocked storage — the default is fine */
    }
  }, []);

  const toggle = () => {
    setOpen((prev) => {
      try {
        window.localStorage.setItem(STORE_KEY, prev ? 'closed' : 'open');
      } catch {
        /* nothing to do */
      }
      return !prev;
    });
  };

  const path = usePathname();
  const narrow = useMedia(PANE_QUERY);
  // Open "at" an address, so a link followed from inside the sheet closes it.
  const [sheetAt, setSheetAt] = useState<string | null>(null);
  const sheet = narrow && sheetAt === path;
  const closeSheet = useCallback(() => setSheetAt(null), []);
  const details = useRef<HTMLButtonElement>(null);
  const pane = useRef<HTMLElement>(null);
  useModalSheet(sheet, pane, details, closeSheet);

  const last = crumbs[crumbs.length - 1];

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          {crumbs.slice(0, -1).map((c) => (
            <span key={c.label}>
              {c.label}
              {' / '}
            </span>
          ))}
          <b>{last?.label}</b>
        </div>
        <Suspense fallback={null}><TopSearch /></Suspense>
        <div className="sync" title={syncTitle}>
          <Link href="/dev/data" className={`profile p-${profile}`} title={PROFILE[profile].title}>
            {PROFILE[profile].label}
          </Link>
          <span className={`dot ${syncTone}`} />
          {syncLine}
        </div>
        {actions}
        {inspector && (
          <button
            ref={details}
            type="button"
            className={`btn ${s.details}`}
            onClick={() => setSheetAt(path)}
            aria-expanded={sheet}
            aria-controls="page-pane"
          >
            Details
          </button>
        )}
        {inspector && (
          <button
            className={`panetoggle ${s.deskToggle}`}
            onClick={toggle}
            aria-expanded={open}
            // The glyph is decoration. Without the label a screen reader announces "⟩",
            // which is not a thing anybody can act on.
            aria-label={open ? 'Hide the detail pane' : 'Show the detail pane'}
            title={open ? 'Hide the detail pane' : 'Show the detail pane'}
          >
            <span aria-hidden>{open ? '⟩' : '⟨'}</span>
          </button>
        )}
      </div>

      {notice && (
        <div className="pnotice" role="status">
          <b>Real data, nothing imported.</b> {notice}
        </div>
      )}

      <div className="body">
        <div className="work">{children}</div>
        {inspector && (open || sheet) ? (
          <aside
            id="page-pane"
            ref={pane}
            className={`insp ${s.pane}${sheet ? ` ${s.paneOpen}` : ''}`}
            role={sheet ? 'dialog' : undefined}
            aria-modal={sheet || undefined}
            aria-label={sheet ? 'Details' : undefined}
            tabIndex={sheet ? -1 : undefined}
          >
            {sheet && (
              <div className={s.paneHead}>
                <span className="lbl">Details</span>
                <button type="button" className={`btn ${s.paneClose}`} onClick={closeSheet} data-sheet-focus>Close</button>
              </div>
            )}
            {inspector}
          </aside>
        ) : null}
        {sheet && <div className={s.scrim} onClick={closeSheet} aria-hidden />}
      </div>
    </>
  );
}

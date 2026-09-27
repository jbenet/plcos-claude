'use client';

import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from '@/components/ui/AppLink';
import { PHONE_QUERY } from '@/lib/viewport';
import { useMedia, useModalSheet } from './useSheet';
import { OutboxIndicator } from './FeedbackOutbox';
import s from './Shell.module.css';

/**
 * The app's frame: the rail and the page (issue 0090).
 *
 * Above the phone width this is the old frame exactly: the rail's wrapper has `display: contents`,
 * so the rail is still the flex row's first child, and the top bar is not drawn. At phone widths the
 * rail becomes a sheet over the page, opened by the menu button in a top bar, with the same sections
 * in the same order, because it is the same rail. The sheet closes on navigation, Escape, its close
 * button or a tap outside, and focus goes back to the menu button.
 */
export function AppShell({ rail, mark, name, children }: {
  rail: ReactNode;
  mark: string;
  name: string;
  children: ReactNode;
}) {
  const path = usePathname();
  const phone = useMedia(PHONE_QUERY);
  // Open "at" an address: navigating anywhere closes it without an effect, and so does widening
  // the window past the phone width.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = phone && openAt === path;
  const close = useCallback(() => setOpenAt(null), []);
  const menu = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useModalSheet(open, sheet, menu, close);

  // A link to the page already in view does not change the address, and still means "take me there".
  const onSheetClick = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('a[href]')) close();
  };

  return (
    <div className={`app ${s.app}`}>
      <header className={s.bar} inert={open}>
        <button
          ref={menu}
          type="button"
          className={s.menu}
          onClick={() => setOpenAt(path)}
          aria-expanded={open}
          aria-controls="app-rail"
          aria-label="Open the menu"
        >
          <span aria-hidden className={s.burger}><i /><i /><i /></span>
        </button>
        <Link className={s.brand} href="/today">
          <span className="mark">{mark}</span>
          <b>{name}</b>
        </Link>
        <OutboxIndicator variant="bar" />
      </header>

      <div
        id="app-rail"
        ref={sheet}
        className={`${s.sheet}${open ? ` ${s.open}` : ''}`}
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
        aria-label={open ? 'Menu' : undefined}
        tabIndex={open ? -1 : undefined}
        onClick={open ? onSheetClick : undefined}
      >
        {open && (
          <button type="button" className={s.close} onClick={close} aria-label="Close the menu" data-sheet-focus>
            <span aria-hidden>×</span>
          </button>
        )}
        {rail}
      </div>
      {open && <div className={s.scrim} onClick={close} aria-hidden />}

      <div className="main" inert={open}>{children}</div>
    </div>
  );
}

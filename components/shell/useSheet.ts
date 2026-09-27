'use client';

import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { nextFocusIndex } from '@/lib/viewport';

/**
 * Whether a media query matches. False on the server and on the first render in the browser, so
 * the markup the server sent always hydrates; the stylesheet does the first paint's layout on its
 * own, and this only decides behaviour (which sheet a button opens).
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    // Collapsed sections and closed <details> draw nothing, and nothing drawn takes focus.
    .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
}

/**
 * A modal sheet's keyboard (issue 0090): focus moves into it when it opens, Tab and Shift+Tab stay
 * inside it, Escape closes it, and focus goes back to the button that opened it. A dialog opened on
 * top of the sheet (the feedback box, the shortcuts list) keeps its own keys.
 */
export function useModalSheet(
  open: boolean,
  sheet: RefObject<HTMLElement | null>,
  opener: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    const root = sheet.current;
    if (!open || !root) return;
    const first = root.querySelector<HTMLElement>('[data-sheet-focus]') ?? focusables(root)[0];
    (first ?? root).focus({ preventScroll: true });

    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const above = [...document.querySelectorAll('dialog[open], [role="dialog"]')]
        .some((d) => d !== root && !root.contains(d) && d.getClientRects().length > 0);
      if (above) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusables(root);
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(list.length, at, event.shiftKey);
      event.preventDefault();
      (next === null ? root : list[next]).focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      html.style.overflow = overflow;
      // Back to the opener, unless the reader has already put focus somewhere else on purpose.
      const active = document.activeElement;
      if (!active || active === document.body || root.contains(active)) opener.current?.focus({ preventScroll: true });
    };
  }, [open, sheet, opener, close]);
}

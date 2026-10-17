'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { LpUnitChoice } from './LpUnitChoice';
import u from './lp-units.module.css';

type Firm = { id: string; name: string; role: string | null; lpRow: string | null };

/**
 * The header's "firm or personal?" mark, which settles it in place (Juan, 17 Oct 2026: "'firm or
 * individual' should enable setting it here"). The same choices as the People tab's "Who is the LP?"
 * card, through the same action and with the same words: keep this row as someone who invests
 * personally, or move it to one of their firms with them as its contact. A small panel under the mark;
 * Escape or a click elsewhere closes it, and focus goes back to the mark.
 */
export function LpUnitPicker({ pursuitId, capacity, review, firms }: {
  pursuitId: string; capacity: 'organisation' | 'personal' | null; review: string | null; firms: Firm[];
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const mark = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const personal = capacity === 'personal' && !review;
  const label = review ? 'firm or personal?' : personal ? 'personal' : 'firm or personal?';
  const tone = review ? u.review : personal ? u.personal : '';

  // Keep the panel on the screen: a mark near the right edge of a phone opens it leftwards.
  useLayoutEffect(() => {
    if (!open || !panel.current || !root.current) { setShift(0); return; }
    const left = root.current.getBoundingClientRect().left;
    const width = panel.current.getBoundingClientRect().width;
    const room = document.documentElement.clientWidth - 16;
    const over = left + width - room;
    setShift(over > 0 ? -Math.min(over, Math.max(0, left - 16)) : 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); mark.current?.focus(); } };
    const away = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); };
  }, [open]);

  return (
    <span className={u.pick} ref={root}>
      <button
        type="button" ref={mark} className={`${u.tag} ${tone} ${u.tagBtn}`}
        aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
        title={review ?? 'Who is the LP? Set it here'}
        onClick={() => setOpen((o) => !o)}
      >
        {label}<span aria-hidden="true" className={u.caret}>{open ? '▴' : '▾'}</span>
        <span className={u.srOnly}>: who is the LP? Set it</span>
      </button>
      {open && (
        <div id={id} ref={panel} role="dialog" aria-label="Who is the LP?" className={u.pop} style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
          <p className={u.popHead}>Who is the LP?</p>
          <p className={u.popWhy}>
            {review ? <>The re-point rule could not tell: {review}</>
              : personal ? <>In their own capacity: there is evidence on file that they invest personally.</>
              : <>As an individual. Whether they invest personally is not established yet.</>}
            {firms.length > 0 && <> A person at a firm is not the LP: if this is really {firms.length === 1 ? `${firms[0]!.name}’s` : 'one of their firms’'}, move it there and they stay on it as a contact.</>}
          </p>
          <LpUnitChoice compact pursuitId={pursuitId} personal={personal} firms={firms} />
        </div>
      )}
    </span>
  );
}

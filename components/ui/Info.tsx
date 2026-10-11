'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The explainer behind an "i" (Juan, 11 Oct 2026: "a ton of this text is just never going to be read"). What a
 * card covers, why a rule holds, where a number came from: one tap or click away, never a paragraph on the page.
 * Phrasing content only (a span and a button), so it sits inside a line, a label or a paragraph; give the
 * children <span className="ip"> for separate paragraphs.
 */
export function Info({ children, label = 'About this' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className={`info${open ? ' open' : ''}`} ref={box}>
      <button type="button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>i</button>
      {open && <span className="infobody" role="note">{children}</span>}
    </span>
  );
}

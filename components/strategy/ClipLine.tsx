'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * One line of a timeline row's words, cut with an ellipsis where the line ends (17 Oct 2026). The
 * whole text opens below the row, and the "the rest" link shows only when the line was cut: text that
 * fits needs nothing to open. Rendered on the server with the link, so it is there before scripts run.
 */
export function ClipLine({ line, full, open = 'the rest', title }: { line: ReactNode; full: string; open?: string; title?: string }) {
  const clip = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(true);
  useLayoutEffect(() => {
    const el = clip.current;
    if (!el) return;
    const check = () => setCut(el.scrollWidth > el.clientWidth + 1 || full.includes('\n') || el.closest('details')?.open === true);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);
  return (
    <details className="thread tl-main" onToggle={(e) => { if (!(e.currentTarget as HTMLDetailsElement).open) setCut(true); }}>
      <summary tabIndex={cut ? undefined : -1} onClick={(e) => { if (!cut) e.preventDefault(); }} style={cut ? undefined : { cursor: 'text' }}>
        <span className="tl-clip" ref={clip} title={title}>{line}</span>
        {cut && <span className="open">{open}</span>}
      </summary>
      <div className="t full">{full}</div>
    </details>
  );
}

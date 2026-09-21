'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

const STORE_KEY = 'capitalos.rightpane';

/**
 * The frame every screen sits in: breadcrumb bar, work area, and a right pane that is
 * closable.
 *
 * The pane is for drilling into one thing — the detail of a selected object, the source
 * material behind it, a conversation about it. It is not scaffolding, so it closes, and
 * the choice is remembered.
 */
export function PageFrame({
  crumbs, syncTone, syncLine, syncTitle, actions, inspector, children,
}: {
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
        <div className="sync" title={syncTitle}>
          <span className={`dot ${syncTone}`} />
          {syncLine}
        </div>
        {actions}
        {inspector && (
          <button
            className="panetoggle"
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

      <div className="body">
        <div className="work">{children}</div>
        {inspector && open ? <aside className="insp">{inspector}</aside> : null}
      </div>
    </>
  );
}

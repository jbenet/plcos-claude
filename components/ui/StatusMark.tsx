import type { ReactNode } from 'react';
import s from './StatusMark.module.css';

/**
 * A pipeline status with a small mark beside its word (issue 0097: "committed could be a
 * checkmark"). The word always stays: the mark helps recognition, it never carries the meaning
 * alone. One set for the whole app, so a status looks the same on every page that adopts it.
 *
 *   New ○ dashed · Sourcing magnifier · Selected ◉ · Connecting → · Discussing speech ·
 *   Committed ✓ (green) · Passed ⊘ (muted)
 */
const MARK: Record<string, { label: string; tone: string; path: ReactNode }> = {
  new: { label: 'New', tone: s.muted, path: <circle cx="8" cy="8" r="5" strokeDasharray="2 2" /> },
  sourcing: { label: 'Sourcing', tone: s.muted, path: <><circle cx="7" cy="7" r="3.8" /><path d="M9.8 9.8l3.4 3.4" /></> },
  selected: { label: 'Selected', tone: s.ink, path: <><circle cx="8" cy="8" r="5" /><circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" /></> },
  connecting: { label: 'Connecting', tone: s.amber, path: <path d="M2.5 8h9M8.5 4.5L12 8l-3.5 3.5" /> },
  discussing: { label: 'Discussing', tone: s.purple, path: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /> },
  committed: { label: 'Committed', tone: s.green, path: <path d="M3.5 8.5l3 3 6-6.5" /> },
  passed: { label: 'Passed', tone: s.muted, path: <><circle cx="8" cy="8" r="5" /><path d="M4.5 11.5l7-7" /></> },
};

export function StatusMark({ status, label, iconOnly = false }: { status: string; label?: string; iconOnly?: boolean }) {
  const m = MARK[status];
  const word = label ?? m?.label ?? status.charAt(0).toUpperCase() + status.slice(1);
  if (!m) return <span className={s.mark}>{word}</span>;
  return <span className={`${s.mark} ${m.tone}`} title={iconOnly ? word : undefined}>
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{m.path}</svg>
    {iconOnly ? <span className={s.sr}>{word}</span> : <span className={s.word}>{word}</span>}
  </span>;
}

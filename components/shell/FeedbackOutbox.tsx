'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  discardEntry, retryNow, serverSnapshot, snapshot, startOutbox, subscribe, type OutboxState,
} from '@/lib/feedback-outbox';
import { entryPictures, entryText, entryTitle, type JournalEntry } from '@/lib/feedback-journal';
import s from './FeedbackOutbox.module.css';

export const useOutbox = (): OutboxState => useSyncExternalStore(subscribe, snapshot, serverSnapshot);

const plural = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/** "14:05" today, "23 Sep 14:05" before. */
const writtenAt = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
};

const inSeconds = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`;
};

/**
 * Clipboard access needs a secure context, and the live app is reached over plain http on the
 * local network (lib/request-key.ts), so the old selection-and-copy path is the fallback.
 */
async function copy(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch { return false; }
}

/**
 * The feedback outbox, where it can be seen (Juan, 27 Sep). Quiet and absent at zero: in the rail's
 * footer, "2 notes waiting to file", or "Saved. Filing…" just after File, or the issue number for a
 * few seconds once one files. It opens the list: each report's state, Retry now and Copy text. At
 * phone widths the rail is a sheet, so the same line also sits in the top bar (`variant="bar"`).
 */
export function OutboxIndicator({ variant = 'rail' }: { variant?: 'rail' | 'bar' }) {
  const out = useOutbox();
  const [open, setOpen] = useState(false);
  /** Where the chip is, so the list opens just above it rather than over it. */
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => { startOutbox(); }, []);

  const waiting = out.entries.length;
  const latest = out.filed.at(-1);
  if (!waiting && !latest) return open ? <OutboxList anchor={anchor} onClose={() => setOpen(false)} /> : null;

  // The top bar on a phone shares its line with the menu and the name, so it says the same in fewer words.
  let label: string;
  let short: string;
  let tone: 'wait' | 'send' | 'done' | 'refused';
  if (out.justSaved && out.sending.includes(out.justSaved) && waiting === 1) {
    label = 'Saved. Filing…'; short = 'Filing…'; tone = 'send';
  } else if (waiting) {
    const refused = out.entries.filter((e) => e.refused).length;
    label = `${plural(waiting)} waiting to file${refused ? ` · ${refused} refused` : ''}`;
    short = `${waiting} waiting`;
    tone = refused ? 'refused' : out.sending.length ? 'send' : 'wait';
  } else {
    label = latest!.id ? `Filed as issue ${latest!.id}` : 'Connection note saved';
    short = latest!.id ? `Filed ${latest!.id}` : 'Saved';
    tone = 'done';
  }

  return (
    <div className={variant === 'bar' ? s.barWrap : s.railWrap} aria-live="polite">
      <button
        type="button"
        className={`${s.chip} ${variant === 'bar' ? s.bar : s.rail} ${s[tone]}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ left: Math.max(8, r.left), bottom: Math.max(8, window.innerHeight - r.top + 8) });
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Feedback kept in this browser until the server confirms it"
        aria-label={variant === 'bar' ? label : undefined}
      >
        <span className={s.mark} aria-hidden>{tone === 'done' ? '✓' : tone === 'refused' ? '!' : '↑'}</span>
        <span className={s.text}>{variant === 'bar' ? short : label}</span>
      </button>
      {open && <OutboxList anchor={anchor} onClose={() => setOpen(false)} />}
    </div>
  );
}

function OutboxList({ anchor, onClose }: { anchor: { left: number; bottom: number } | null; onClose: () => void }) {
  const out = useOutbox();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = (e: JournalEntry) => {
    if (out.sending.includes(e.clientId)) return 'Sending now…';
    if (e.refused) return `The server refused it: ${e.lastError ?? 'no reason given'}. It will not retry on its own.`;
    if (!e.attempts) return 'Waiting for its first send.';
    const tries = `${e.attempts} ${e.attempts === 1 ? 'try' : 'tries'}`;
    return `${e.lastError ?? 'Not confirmed'} · ${tries} · next in ${inSeconds(e.nextAt - now)}`;
  };

  return createPortal(
    <>
      <div className={`${s.scrim} nocapture`} onClick={onClose} aria-hidden />
      <div
        ref={panel}
        className={`${s.panel} nocapture`}
        role="dialog"
        aria-label="Feedback waiting to file"
        tabIndex={-1}
        style={anchor ? ({ '--at-left': `${anchor.left}px`, '--at-bottom': `${anchor.bottom}px` } as CSSProperties) : undefined}
      >
        <div className={s.head}>
          <div className="lbl">Feedback outbox{out.entries.length ? ` · ${out.entries.length} waiting` : ''}</div>
          <button type="button" className={s.x} onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className={s.lede}>
          Kept in this browser until the server confirms an issue number, through reloads and
          restarts. Sending a note twice files it once.
        </p>
        {out.filed.map((f) => (
          f.id ? (
            <a key={f.clientId} className={`${s.row} ${s.filed}`} href={`/developer/issues/${f.id}`}>
              <b>Filed as issue <span className="mono">{f.id}</span></b>
              <span>{f.title || 'Untitled'}</span>
            </a>
          ) : (
            <div key={f.clientId} className={`${s.row} ${s.filed}`}>
              <b>Saved</b>
              <span>{f.title}</span>
            </div>
          )
        ))}
        {out.entries.map((e) => (
          <div key={e.clientId} className={s.row}>
            <b>{entryTitle(e)}</b>
            <span className={s.meta}>
              Written {writtenAt(e.createdAt)} · <span className="mono">{e.request.page}</span>
              {entryPictures(e) > 0 ? ` · ${entryPictures(e)} ${entryPictures(e) === 1 ? 'picture' : 'pictures'}` : ''}
            </span>
            <span className={e.refused ? s.bad : s.state}>{status(e)}</span>
            {e.textOnly && (
              <span className={s.bad}>Kept without its pictures: this browser&rsquo;s database was unavailable.</span>
            )}
            <div className={s.acts}>
              <button
                type="button"
                className="btn"
                disabled={out.sending.includes(e.clientId)}
                onClick={() => void retryNow(e.clientId)}
              >
                Retry now
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void copy(entryText(e)).then((ok) => setCopied(ok ? e.clientId : `fail:${e.clientId}`))}
              >
                {copied === e.clientId ? 'Copied' : copied === `fail:${e.clientId}` ? 'Copy failed' : 'Copy text'}
              </button>
              <button
                type="button"
                className={`btn ${s.discard}`}
                onClick={() => {
                  if (window.confirm('Discard this note? It has not been filed, and it cannot be brought back.')) void discardEntry(e.clientId);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        ))}
        {!out.entries.length && !out.filed.length && <p className={s.lede}>Nothing waiting. Everything has been filed.</p>}
      </div>
    </>,
    document.body,
  );
}

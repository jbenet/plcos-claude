'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  discardEntry, retryNow, serverSnapshot, snapshot, startOutbox, subscribe, type OutboxState,
} from '@/lib/feedback-outbox';
import { entryPictures, entryText, entryTitle, type JournalEntry } from '@/lib/feedback-journal';
import s from './FeedbackOutbox.module.css';
import { formatDate } from '@/lib/time';

export const useOutbox = (): OutboxState => useSyncExternalStore(subscribe, snapshot, serverSnapshot);

const plural = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/** "14:05" today, "23 Sep 14:05" before. */
const writtenAt = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${formatDate(d, { day: 'numeric', month: 'short' })} ${time}`;
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
 * Where filed feedback stands (Juan, 27 Sep), so he knows when it is safe to close the tab. Since
 * issue 0114 it is said by the one status mark beside the user (components/shell/SystemStatus.tsx),
 * which also carries the imports; a tap there opens the words, and "Show the notes" opens the list
 * below: each report's state, Retry now and Copy text. "Only on this device" outranks everything,
 * because it is the one state that is not yet safe.
 */
export type OutboxTone = 'device' | 'send' | 'server' | 'done' | 'refused';
/**
 * Where filed feedback stands, in words: `label` in full, `short` for a narrow line, and a tone.
 * Null when there is nothing to say. Shared with the rail's status mark (issue 0114).
 */
export function outboxSummary(out: OutboxState): { label: string; short: string; tone: OutboxTone } | null {
  const device = out.entries.filter((e) => !(out.justSaved === e.clientId && out.sending.includes(e.clientId)));
  const saving = out.entries.length - device.length;
  const server = out.onServer.length;
  const latest = out.filed.at(-1);
  if (!out.entries.length && !server && !latest) return null;

  let label: string;
  let short: string;
  let tone: OutboxTone;
  if (device.length) {
    const refused = device.filter((e) => e.refused).length;
    label = `${plural(device.length)} only on this device${refused ? ` · ${refused} refused` : ''}${server ? ` · ${server} on the server` : ''}`;
    short = `${device.length} on this device`;
    tone = refused ? 'refused' : 'device';
  } else if (saving) {
    label = 'Saving…'; short = 'Saving…'; tone = 'send';
  } else if (server) {
    label = server === 1 ? 'Saved on server · filing…' : `${server} saved on server · filing…`;
    short = 'On the server';
    tone = 'server';
  } else if (latest!.error) {
    label = `Not filed: ${latest!.error}`; short = 'Not filed'; tone = 'refused';
  } else {
    label = latest!.id ? `Filed as issue ${latest!.id}` : 'Connection note saved';
    short = latest!.id ? `Filed ${latest!.id}` : 'Saved';
    tone = 'done';
  }

  return { label, short, tone };
}

export function OutboxList({ anchor, onClose }: { anchor: { left: number; bottom: number } | null; onClose: () => void }) {
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
          <div className="lbl">Feedback{out.entries.length ? ` · ${out.entries.length} only on this device` : ''}</div>
          <button type="button" className={s.x} onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className={s.lede}>
          {out.entries.length
            ? 'The server could not be reached, so these are kept in this browser, through reloads, and sent as soon as it answers. Keep this browser until they say saved. Sending one twice files it once.'
            : 'Saved on the server as soon as you file; it is filed from there, so the tab can be closed.'}
        </p>
        {out.onServer.map((n) => (
          <div key={n.clientId} className={`${s.row} ${s.onServer}`}>
            <b>Saved on the server</b>
            <span>{n.title}</span>
            <span className={s.state}>Filing… Safe to close this tab.</span>
          </div>
        ))}
        {out.filed.map((f) => (
          f.error ? (
            <div key={f.clientId} className={s.row}>
              <b>Not filed</b>
              <span>{f.title}</span>
              <span className={s.bad}>{f.error}</span>
            </div>
          ) : f.id ? (
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
            <span className={e.refused ? s.bad : s.state}>Only on this device · {status(e)}</span>
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
        {!out.entries.length && !out.onServer.length && !out.filed.length && <p className={s.lede}>Nothing waiting. Everything has been filed.</p>}
      </div>
    </>,
    document.body,
  );
}

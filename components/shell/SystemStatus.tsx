'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from '@/components/ui/AppLink';
import { IMPORT_LABELS } from '@/lib/import-jobs/types';
import { active, needsLook, onJobFinished, useJobs, type JobStatus } from '@/lib/import-jobs/client';
import { useRouter } from 'next/navigation';
import { OutboxList, outboxSummary, useOutbox } from './FeedbackOutbox';
import { startOutbox } from '@/lib/feedback-outbox';
import s from './SystemStatus.module.css';

/**
 * The system's state, as one small mark beside the user (issue 0114). Juan: the imports panel over
 * every page "is not good UX for most users; belongs in developer or logs or status… a small
 * indicator in the bottom left (by the username) that has a tooltip or something."
 *
 * One place for what used to be two: the imports that used to sit over every page, and the
 * feedback line that said whether a report was safe (Juan, 27 Sep). The mark says, most urgent first:
 *
 *   !  solid     feedback only on this device: not yet safe to close the tab
 *   !  ring      an import stopped and nobody has looked since
 *   ◌  pulsing   saving feedback, or an import running
 *   ✓            feedback saved on the server, or just filed
 *   ·            nothing to say
 *
 * A tap (not a hover: iPad) opens the words, with a way to the notes and to Developer → Status,
 * where the full detail lives. Colour is never the only signal: the glyph and the words differ.
 */
type Tone = 'unsafe' | 'look' | 'busy' | 'ok' | 'idle';
const SEEN = 'plcos:status-seen';

const readSeen = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[]); } catch { return new Set(); }
};
const writeSeen = (ids: string[]) => { try { localStorage.setItem(SEEN, JSON.stringify(ids.slice(-60))); } catch { /* private mode */ } };
const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const progress = (j: JobStatus) => `${j.phase}${j.total !== null ? ` · ${j.done} of ${j.total}` : ''}`;

export function SystemStatus({ variant = 'rail' }: { variant?: 'rail' | 'bar' }) {
  const out = useOutbox();
  const { jobs, error } = useJobs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  useEffect(() => { startOutbox(); setSeen(readSeen()); }, []);
  // A finished import changes what the page shows: redraw it, as the old panel did.
  useEffect(() => onJobFinished(() => router.refresh()), [router]);

  const feedback = outboxSummary(out);
  const running = jobs.filter(active);
  const stopped = needsLook(jobs);
  const unseen = stopped.filter((j) => !seen.has(j.id));
  const tone: Tone = feedback && (feedback.tone === 'device' || feedback.tone === 'refused') ? 'unsafe'
    : unseen.length ? 'look'
    : (feedback?.tone === 'send' || running.length) ? 'busy'
    : feedback ? 'ok' : 'idle';
  const summary = [
    feedback?.label,
    running.length ? `${running.length === 1 ? IMPORT_LABELS[running[0]!.kind] : `${running.length} imports`} running` : null,
    stopped.length ? `${stopped.length === 1 ? IMPORT_LABELS[stopped[0]!.kind] : `${stopped.length} imports`} stopped` : null,
    error ? 'Import progress unavailable' : null,
  ].filter(Boolean).join(' · ') || 'Nothing running';
  const glyph = tone === 'unsafe' || tone === 'look' ? '!' : tone === 'ok' ? '✓' : '';

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 336)), bottom: Math.max(8, window.innerHeight - r.top + 8) });
    if (!open && stopped.length) {
      const next = [...new Set([...seen, ...stopped.map((j) => j.id)])];
      writeSeen(next); setSeen(new Set(next));
    }
    setOpen((v) => !v);
  };

  return (
    <span className={variant === 'bar' ? s.barWrap : s.wrap}>
      <button type="button" className={s.mark} data-tone={tone} onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={`Status: ${summary}`} title={summary}>
        <span className={s.dot} aria-hidden>{glyph}</span>
      </button>
      {/* Read out as it changes, without anyone opening anything. */}
      <span className={s.live} aria-live="polite">{tone === 'unsafe' || tone === 'look' ? summary : ''}</span>
      {open && createPortal(
        <>
          <div className={`${s.scrim} nocapture`} onClick={() => setOpen(false)} aria-hidden />
          <div className={`${s.panel} nocapture`} role="dialog" aria-label="Status" tabIndex={-1}
            ref={(el) => el?.focus()} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            style={anchor ? ({ '--at-left': `${anchor.left}px`, '--at-bottom': `${anchor.bottom}px` } as CSSProperties) : undefined}>
            <div className={s.head}><span className="lbl">Status</span>
              <button type="button" className={s.x} onClick={() => setOpen(false)} aria-label="Close">×</button></div>

            <div className={s.section}>
              <div className={s.name}>Feedback</div>
              {feedback ? <>
                <p className={s.line} data-tone={feedback.tone === 'device' || feedback.tone === 'refused' ? 'unsafe' : feedback.tone === 'send' ? 'busy' : 'ok'}>{feedback.label}</p>
                <p className={s.note}>{feedback.tone === 'device' || feedback.tone === 'refused'
                  ? 'Kept only in this browser until the server accepts it: keep this browser open, it resends on its own.'
                  : feedback.tone === 'send' ? 'Sending now.' : 'Saved on the server: safe to close this tab.'}</p>
                <button type="button" className="btn" onClick={() => { setOpen(false); setNotes(true); }}>Show the notes</button>
              </> : <p className={s.note}>Nothing waiting to file.</p>}
            </div>

            <div className={s.section}>
              <div className={s.name}>Imports</div>
              {error && <p className={s.note}>{error}</p>}
              {running.map((j) => <p key={j.id} className={s.line} data-tone="busy"><b>{IMPORT_LABELS[j.kind]}</b> · {j.status === 'queued' ? 'queued' : progress(j)}</p>)}
              {stopped.map((j) => <p key={j.id} className={s.line} data-tone="look"><b>{IMPORT_LABELS[j.kind]}</b> stopped {hm(j.finished_at ?? j.created_at)}{j.error ? <span className={s.note}> {j.error}</span> : null}</p>)}
              {!running.length && !stopped.length && !error && <p className={s.note}>
                Nothing running.{jobs[0] ? ` Last: ${IMPORT_LABELS[jobs[0].kind]}, ${jobs[0].status === 'completed' ? 'done' : 'stopped'} ${hm(jobs[0].finished_at ?? jobs[0].created_at)}.` : ''}
              </p>}
              {running.length > 0 && <p className={s.note}>You can keep working; it carries on if you leave the page.</p>}
            </div>

            <div className={s.links}>
              <Link href="/developer/status" onClick={() => setOpen(false)}>Developer → Status</Link>
              <Link href="/developer/logs" onClick={() => setOpen(false)}>Logs</Link>
            </div>
          </div>
        </>, document.body)}
      {notes && <OutboxList anchor={anchor} onClose={() => setNotes(false)} />}
    </span>
  );
}

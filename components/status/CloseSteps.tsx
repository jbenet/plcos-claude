import { shortDate } from '@/lib/time';
import { usdM } from '@/lib/money';
import type { CloseTrack } from '@/modules/pipeline';
import s from './CloseSteps.module.css';

/**
 * How far one commitment has got, on one line (issues 0074, 0075): soft → signed → hard → closed
 * → cash. Five separate states (rule 4): each is recorded here, only a source's claim, or not on
 * file, and each carries its date or says it has none. A later step never fills in an earlier one.
 */
export type StepMark = { label: string; state: 'done' | 'claim' | 'none'; date: Date | null; note: string | null };

export function closeSteps(track: CloseTrack): StepMark[] {
  const x = track.exposure;
  const soft = track.events.find((e) => e.step === 'soft');
  const closed = track.events.filter((e) => e.step === 'closed').at(-1);
  const sig = track.signature;
  const who = (src: string) => (src === 'affinity' ? 'Affinity' : src);
  return [
    {
      label: 'Soft',
      state: soft || x.track === 'soft' || x.track === 'hard' ? ((soft?.source ?? x.source) === 'us' ? 'done' : 'claim') : 'none',
      // As the LP page reads it: the first soft event, else the day we recorded the amount; a
      // source's amount is that source's claim, undated.
      date: soft?.on ?? (x.source === 'us' ? x.openedAt : null),
      note: soft ? null : x.source !== 'us' ? `per ${who(x.source)}` : null,
    },
    {
      label: 'Signed',
      state: sig ? (['us', 'close room'].includes(sig.bySource) ? 'done' : 'claim') : 'none',
      date: sig?.on ?? null,
      note: sig && !['us', 'close room'].includes(sig.bySource) ? `per ${who(sig.bySource)}` : null,
    },
    { label: 'Hard', state: x.track === 'hard' ? 'done' : 'none', date: x.hardenedAt, note: null },
    {
      label: 'Closed',
      state: closed ? (closed.source === 'us' ? 'done' : 'claim') : 'none',
      date: closed?.on ?? null,
      note: closed && closed.source !== 'us' ? `per ${who(closed.source)}` : null,
    },
    {
      label: 'Cash',
      state: track.wired > 0 ? 'done' : track.wiredPerSource ? 'claim' : 'none',
      date: track.wires.at(-1)?.on ?? null,
      note: track.wired > 0 && track.outstanding ? `${usdM(track.outstanding)} to come` : track.wiredPerSource && !track.wired ? 'per source' : null,
    },
  ];
}

/** Short enough for five columns: the year only when it is not this one. */
function stepDate(d: Date, now = new Date()): string {
  return d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear()
    ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', year: '2-digit' });
}

const STATE_WORD: Record<StepMark['state'], string> = { done: 'recorded', claim: 'a source’s claim', none: 'not on file' };

export function CloseSteps({ track, compact = false }: { track: CloseTrack; compact?: boolean }) {
  const steps = closeSteps(track);
  return (
    <ol className={`${s.steps}${compact ? ` ${s.compact}` : ''}`} aria-label="Close track">
      {steps.map((m) => (
        <li key={m.label} className={s[m.state]} title={`${m.label}: ${STATE_WORD[m.state]}${m.date ? `, ${shortDate(m.date)}` : ''}`}>
          <i aria-hidden="true" />
          <b>{m.label}</b>
          <span className={s.when}>
            {m.state === 'none' ? '—' : m.date ? stepDate(m.date) : m.note ?? 'undated'}
          </span>
          <span className="sr-only">{STATE_WORD[m.state]}</span>
        </li>
      ))}
    </ol>
  );
}

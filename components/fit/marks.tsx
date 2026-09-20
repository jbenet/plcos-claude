import type { Certainty, Grade } from '@/modules/fit/client';
import { CERTAINTY_LABEL, GRADE_LABEL } from '@/modules/fit/client';

/**
 * Grade and certainty, rendered as words with colour behind them rather than colour alone.
 * The palette rule in CLAUDE.md is not decoration here: half of these readings are guesses
 * and a reader who cannot see the difference will treat them as findings.
 */

const GRADE_FLAG: Record<Grade, string> = {
  strong: 'f-ok', good: 'f-ok', neutral: 'f-mute', weak: 'f-ev', blocker: 'f-block',
};

export function GradeMark({ grade }: { grade: Grade }) {
  return <span className={`flag ${GRADE_FLAG[grade]}`}>{GRADE_LABEL[grade]}</span>;
}

export function CertaintyMark({ certainty }: { certainty: Certainty }) {
  return (
    <span className={`cert c-${certainty}`} title={certaintyMeans(certainty)}>
      {CERTAINTY_LABEL[certainty]}
    </span>
  );
}

export function certaintyMeans(c: Certainty): string {
  return c === 'known'
    ? 'Recorded from a source we can point at.'
    : c === 'inferred'
      ? 'Reasoned from something adjacent. Defensible, not established.'
      : 'A guess. It belongs in the open, not in a number that looks like a finding.';
}

/** Importance, 1–5, as pips. The label carries the meaning; the pips carry the ordering. */
export function Weight({ n, of = 5 }: { n: number; of?: number }) {
  return (
    <span className="wts" aria-label={`${n} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

/** A 0–1 reading as a bar. Never shown without the number beside it. */
export function Meter({ value }: { value: number }) {
  return (
    <span className="meter">
      <i
        style={{
          width: `${Math.round(value * 100)}%`,
          background: value >= 0.7 ? 'var(--green)' : value >= 0.45 ? 'var(--amber)' : '#B8B2A6',
        }}
      />
    </span>
  );
}

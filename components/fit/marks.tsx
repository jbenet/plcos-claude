import type { Certainty, Grade } from '@/modules/fit/client';
import { CERTAINTY_LABEL, GRADE_SCORE, GRADE_SIGN, GRADE_VERDICT } from '@/modules/fit/client';

/**
 * Grade and certainty, rendered as words with colour behind them rather than colour alone.
 * The palette rule in CLAUDE.md is not decoration here: half of these readings are guesses
 * and a reader who cannot see the difference will treat them as findings.
 */

/**
 * One reading, pointed the same way as every other reading in this module: **up is good
 * for this raise.**
 *
 * The bar carries the strength, the sign carries the direction without relying on colour,
 * and the words say whose side it is on. A grade word on its own ("weak") makes the reader
 * work out the polarity of the dimension first, and on a table of eighteen rows that is a
 * mistake waiting to happen.
 */
export function Reading({ grade, compact = false }: { grade: Grade; compact?: boolean }) {
  return (
    <span className={`reading r-${grade}`} title={GRADE_VERDICT[grade]}>
      <span className="rbar" aria-hidden="true">
        <i style={{ width: `${Math.max(GRADE_SCORE[grade], 0.06) * 100}%` }} />
      </span>
      <span className="rword">
        <span className="rsign" aria-hidden="true">{GRADE_SIGN[grade]}</span>
        {compact ? GRADE_VERDICT[grade].replace(' for us', '').replace('In our favour', 'For us') : GRADE_VERDICT[grade]}
      </span>
    </span>
  );
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

/** Importance, 1–5. A number, because pips at this size read as signal strength. */
export function Weight({ n, of = 5 }: { n: number; of?: number }) {
  return (
    <span className="wt">
      <b className="mono">{n}</b>
      <span className="mono wof">/{of}</span>
    </span>
  );
}

/** A 0–1 reading as a bar. Never shown without the number or word beside it. */
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

import { CERTAINTY_WEIGHT, GRADE_SCORE, type Dimension } from './types';

/**
 * What is actually moving this number (issue 0007).
 *
 * The score is a weighted average, which means every reading contributes a share and every
 * uncertain reading contributes a *smaller* share than its weight suggests. Two different
 * questions fall out of that, and the page was answering neither:
 *
 * - **What is holding it down** — a weak reading on something we care about.
 * - **What would move it without changing anyone's mind** — a reading we are only guessing
 *   at. Verifying it moves the score because the discount goes away, not because the finding
 *   improved, and it moves *down* when the reading is worse than the current average. A
 *   verified weakness scores lower than a suspected one, which is correct and unwelcome.
 *
 * Nothing here is a diff against a previous assessment. This system keeps one assessment per
 * firm and vehicle, so there is no earlier reading to subtract — see the note on the page.
 */
export interface Contribution {
  code: string;
  label: string;
  grade: Dimension['grade'];
  certainty: Dimension['certainty'];
  /** Points of the final 0–1 score this reading currently supplies. */
  supplies: number;
  /** Points it would add if the finding went to strong, at today's certainty. */
  headroom: number;
  /** Points it would add if the same finding were verified rather than guessed. */
  verifying: number;
  weightUs: number;
}

export function contributions(dimensions: Dimension[]): Contribution[] {
  const den = dimensions.reduce((n, d) => n + d.weightUs * CERTAINTY_WEIGHT[d.certainty], 0);
  if (den === 0) return [];
  const current = dimensions.reduce(
    (n, d) => n + GRADE_SCORE[d.grade] * d.weightUs * CERTAINTY_WEIGHT[d.certainty], 0,
  ) / den;

  /** Recompute the whole average with one dimension changed — the only honest way to say
   *  "this would move it by N", because the denominator moves too. */
  const withChange = (code: string, grade: Dimension['grade'], certainty: Dimension['certainty']) => {
    let num = 0;
    let d2 = 0;
    for (const dim of dimensions) {
      const g = dim.code === code ? grade : dim.grade;
      const c = dim.code === code ? certainty : dim.certainty;
      const w = dim.weightUs * CERTAINTY_WEIGHT[c];
      num += GRADE_SCORE[g] * w;
      d2 += w;
    }
    return d2 === 0 ? 0 : num / d2;
  };

  return dimensions
    .map((d): Contribution => ({
      code: d.code,
      label: d.label,
      grade: d.grade,
      certainty: d.certainty,
      weightUs: d.weightUs,
      supplies: (GRADE_SCORE[d.grade] * d.weightUs * CERTAINTY_WEIGHT[d.certainty]) / den,
      headroom: withChange(d.code, 'strong', d.certainty) - current,
      verifying: d.certainty === 'known' ? 0 : withChange(d.code, d.grade, 'known') - current,
    }))
    .sort((a, b) => b.headroom - a.headroom);
}

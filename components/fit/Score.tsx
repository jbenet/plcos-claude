import type { Assessment } from '@/modules/fit/client';

const BAND_FLAG: Record<Assessment['band'], string> = {
  strong: 'f-ok', workable: 'f-ev', weak: 'f-mute', blocked: 'f-block',
};

export interface Standing {
  score: number;
  rank: number;
  pool: number;
  /** Every score in the pool, in the same units, for the strip. */
  scores: Array<{ id: string; score: number; blocked: boolean }>;
  median: number;
  best: number;
  worst: number;
}

/**
 * Where one assessment sits in its own pool.
 *
 * The number on its own answers nothing — 0.60 is meaningless until you know whether the
 * rest of the list is at 0.3 or 0.9. So the rank, the pool and the whole distribution are
 * on the same strip, and the caption says what the ordering actually is.
 */
export function standingFor(a: Assessment, pool: Assessment[]): Standing {
  const scores = pool.map((x) => ({
    id: x.assessmentId, score: Math.round(x.weightedFit * 100), blocked: x.band === 'blocked',
  }));
  const rank = pool.findIndex((x) => x.assessmentId === a.assessmentId) + 1;
  const sorted = [...scores].map((s) => s.score).sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return {
    score: Math.round(a.weightedFit * 100),
    rank,
    pool: pool.length,
    scores,
    median: sorted.length === 0 ? 0
      : sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2),
    best: sorted.at(-1) ?? 0,
    worst: sorted[0] ?? 0,
  };
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
};

export function ScoreStrip({
  a, standing, vehicleName,
}: {
  a: Assessment;
  standing: Standing;
  vehicleName: string;
}) {
  const { score, rank, pool, scores, median, best, worst } = standing;
  const span = Math.max(best - worst, 1);
  const at = (v: number) => ((v - worst) / span) * 100;
  const ahead = pool - rank;

  return (
    <div className="card scorecard">
      <div className="scoregrid">
        <div className="scorenum">
          <div className={`bignum b-${a.band}`}>{score}</div>
          <div className="lbl">fit score · 0–100</div>
          <span className={`flag ${BAND_FLAG[a.band]}`}>{a.band}</span>
        </div>

        <div className="scorerank">
          <div className="rankline">
            <b>{ordinal(rank)}</b> of {pool} assessed for {vehicleName}
          </div>
          <div className="muted">
            {a.band === 'blocked'
              ? 'Ranked last regardless of the score, because a failed hard gate is not a ranking question.'
              : ahead === 0
                ? 'Nothing in this pool ranks below it.'
                : `Ahead of ${ahead} of the other ${pool - 1}.`}
            {' '}Pool runs {worst}–{best}, median {median}.
          </div>

          <div className="dist" role="img"
               aria-label={`Fit score ${score} of 100, ${ordinal(rank)} of ${pool}. The pool runs from ${worst} to ${best}, median ${median}.`}>
            <span className="axis" />
            <span className="medmark" style={{ left: `${at(median)}%` }}>
              <i />
              <em>median {median}</em>
            </span>
            {scores.map((s) => (
              <span
                key={s.id}
                className={`dot${s.id === a.assessmentId ? ' me' : ''}${s.blocked ? ' blocked' : ''}`}
                style={{ left: `${at(s.score)}%` }}
              />
            ))}
            <span className="ends">
              <span>{worst}</span>
              <span>{best}</span>
            </span>
          </div>
        </div>

        <div className="scorewhat">
          <div className="kv"><span>Dimensions in our favour</span><span>{a.strongCount} of {a.gradedCount}</span></div>
          <div className="kv"><span>Rests on things we know</span><span className="mono">{Math.round(a.evidenceCover * 100)}%</span></div>
          <div className="kv">
            <span>Hard gates</span>
            <span>
              {a.gates.filter((g) => g.passed === true).length}/{a.gates.length}
              {a.unknownGates.length > 0 ? ` · ${a.unknownGates.length} open` : ''}
              {a.failedGates.length > 0 ? ` · ${a.failedGates.length} failing` : ''}
            </span>
          </div>
        </div>
      </div>

      <p className="cover">
        <b>What the ordering is:</b> anything failing a hard gate ranks last however good its
        dimensions look; everything else is ordered by the score. <b>What the score is:</b>{' '}
        Σ grade × importance-to-us × how sure we are, over {a.gradedCount} dimensions a person
        wrote down with a finding each — so a guess moves it less than a finding does. It is a way
        of arguing about an order, not a probability of anything, and the pool is small enough
        that a rank is a conversation starter rather than a verdict.
      </p>
    </div>
  );
}

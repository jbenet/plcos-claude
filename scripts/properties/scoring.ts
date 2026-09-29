import type { Check, SeedContext } from './harness';
import { freshDb } from './harness';

export async function scoringProperties({ check, db }: SeedContext) {
  const { ranked: rankedFor } = await import('../../modules/scoring');
  const neurotechId = (await db.one<{ id: string }>("select id from platform.vehicle where slug = 'neurotech'"))!.id;
  const rankedRows = await rankedFor(neurotechId);
  check(
    'A target missing any factor is never given a score',
    rankedRows.every((r) => (r.missing.length > 0) === (r.score === null)),
    `${rankedRows.filter((r) => r.missing.length > 0).length} unscored of ${rankedRows.length}`,
  );

  const badWeights = await db.query<{ n: string }>(
    `select count(*)::text as n from scoring.weights
      where abs(capacity + affinity + propensity + time_to_decision - 1) > 0.0001`,
  );
  check(
    'Every weight set sums to one',
    Number(badWeights[0]!.n) === 0,
    `${badWeights[0]!.n} malformed sets`,
  );

}

export async function scoringVariations(check: Check) {
  // Re-weighting is an argument, and the argument has to move the order in the direction
  // the weights say it should.
  {
    const d = await freshDb();
    const { ranked: rk, setActiveWeights } = await import('../../modules/scoring');
    const vid = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'neurotech'"))!.id;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!.id;

    const before = (await rk(vid)).find((r) => r.entityName === 'Quaresma Foundation')!;
    await setActiveWeights(juan, {
      label: 'Propensity over capacity',
      capacity: 0.1, affinity: 0.3, propensity: 0.4, timeToDecision: 0.2,
    });
    const after = (await rk(vid)).find((r) => r.entityName === 'Quaresma Foundation')!;

    check(
      'Variation — reweight toward propensity',
      (after.score ?? 1) < (before.score ?? 0),
      `Quaresma Foundation ${before.score?.toFixed(2)} → ${after.score?.toFixed(2)}; its weakest ` +
      'dimension is propensity (no LP positions in seven years), so raising that weight has to lower it',
    );
    await d.close();
  }
}

export async function provisionalScoreProperties(check: Check) {
  // A provisional score from a proposed strategy (issue 0022, real): weighted as config.scoring says,
  // "unknown" left out rather than guessed, and no score from fewer than two readings.
  {
    const { provisionalScore, capacityValue } = await import('../../lib/strategy-score');
    const none = provisionalScore({ capacity: { band: 'unknown' }, affinity: { level: 'unknown' }, propensity: { level: 'high' }, timeToDecision: { band: 'unknown' } });
    const two = provisionalScore({ capacity: { band: 'unknown' }, affinity: { level: 'high' }, propensity: { level: 'low' }, timeToDecision: { band: 'unknown' } });
    const all = provisionalScore({ capacity: { band: '$1–5M' }, affinity: { level: 'high' }, propensity: { level: 'medium' }, timeToDecision: { band: 'weeks' } });
    // affinity .30×1 + propensity .25×.25 over .55 = 66; the four: (.25×.65 + .30×1 + .25×.6 + .20×1) = .8125 → 81.
    check('A provisional score weighs the strategy’s known readings as the scoring settings say, and gives none from fewer than two',
      none === null && two === 66 && all === 81 && capacityValue('$250K soft, on the close track (unverified)') === 0.45 && capacityValue('unknown') === null,
      `one reading: ${none}; two readings: ${two}; all four: ${all}`);
  }
}

import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';

/**
 * A provisional score from a proposed strategy (issue 0022, real): where no fit assessment exists,
 * the routes page ranks by the strategy's four readings — capacity, affinity, propensity, time to
 * decide — weighted as `config.scoring.weights` says. It is marked as provisional wherever it is
 * shown: a proposal's levels, not an assessment, and never a status. A reading of "unknown" is left
 * out rather than guessed; with fewer than two known, there is no score.
 */
const LEVEL: Record<string, number> = { high: 1, medium: 0.6, low: 0.25 };

/**
 * A capacity band's size by its lower bound — a range is only as sure as its floor: "$1–5M" reads
 * as $1M, and "<$250K" as below it.
 */
export function capacityValue(band: string | null | undefined): number | null {
  if (!band || /unknown|not known/i.test(band)) return null;
  const unit = (u: string | undefined) => {
    const x = (u ?? '').toLowerCase();
    return x === 'k' ? 1e3 : x === 'm' || x === 'mm' ? 1e6 : x === 'b' || x === 'bn' ? 1e9 : 1;
  };
  const range = band.match(/(\d+(?:\.\d+)?)\s?(k|mm|m|bn|b)?\s?[–-]\s?(\d+(?:\.\d+)?)\s?(k|mm|m|bn|b)\b/i);
  const one = band.match(/(\d+(?:\.\d+)?)\s?(k|mm|m|bn|b)\b/i);
  const low = range ? Number(range[1]) * unit(range[2] ?? range[4]) : one ? Number(one[1]) * unit(one[2]) : null;
  if (low === null || low < 1000) return null;
  // GUESS: finer small-check rankings; a legacy broad band keeps its previous score.
  if (band === '<$25K') return 0.05;
  if (band === '$25–50K') return 0.15;
  if (/</.test(band)) return 0.25;
  return low >= 25e6 ? 1 : low >= 5e6 ? 0.85 : low >= 1e6 ? 0.65 : low >= 250e3 ? 0.45 : 0.25;
}

export function decideValue(band: string | null | undefined): number | null {
  if (!band || /unknown|not known/i.test(band)) return null;
  if (/week/i.test(band)) return 1;
  if (/month/i.test(band)) return 0.65;
  if (/quarter|year/i.test(band)) return 0.3;
  return null;
}

export interface StrategyScores {
  capacity?: { band?: string | null } | null;
  affinity?: { level?: string | null } | null;
  propensity?: { level?: string | null } | null;
  timeToDecision?: { band?: string | null } | null;
}

/**
 * The four readings behind a provisional score, each with its weight and 0–1 value (null when
 * unknown), for a page that shows the argument rather than only the number (issue 0089).
 */
export function provisionalParts(s: StrategyScores | null | undefined) {
  const w = config.scoring.weights;
  return [
    { key: 'capacity', label: 'Capacity', weight: w.capacity, level: s?.capacity?.band ?? null, value: capacityValue(s?.capacity?.band) },
    { key: 'affinity', label: 'Affinity', weight: w.affinity, level: s?.affinity?.level ?? null, value: s?.affinity?.level ? LEVEL[s.affinity.level] ?? null : null },
    { key: 'propensity', label: 'Propensity', weight: w.propensity, level: s?.propensity?.level ?? null, value: s?.propensity?.level ? LEVEL[s.propensity.level] ?? null : null },
    { key: 'timeToDecision', label: 'Time to decision', weight: w.timeToDecision, level: s?.timeToDecision?.band ?? null, value: decideValue(s?.timeToDecision?.band) },
  ];
}

/** 0–100, or null when fewer than two readings are known. */
export function provisionalScore(s: StrategyScores | null | undefined): number | null {
  if (!s) return null;
  const w = config.scoring.weights;
  const parts: Array<[number, number | null]> = [
    [w.capacity, capacityValue(s.capacity?.band)],
    [w.affinity, s.affinity?.level ? LEVEL[s.affinity.level] ?? null : null],
    [w.propensity, s.propensity?.level ? LEVEL[s.propensity.level] ?? null : null],
    [w.timeToDecision, decideValue(s.timeToDecision?.band)],
  ];
  const known = parts.filter((p): p is [number, number] => p[1] !== null);
  if (known.length < 2) return null;
  const weight = known.reduce((a, [wt]) => a + wt, 0);
  return Math.round((100 * known.reduce((a, [wt, v]) => a + wt * v, 0)) / weight);
}

/** Each entity's best provisional score across its pursuits' latest proposed or accepted strategies. */
export async function provisionalScores(entityIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!entityIds.length) return out;
  const db = await getDb();
  const rows = await db.query<{ entity_id: string; scores: StrategyScores | null }>(
    `select distinct on (s.pursuit_id) p.entity_id::text, s.data->'scores' as scores
       from strategy.suggestion s join strategy.active_pursuit p on p.pursuit_id = s.pursuit_id
      where p.entity_id = any($1::uuid[]) and s.status in ('proposed', 'accepted')
      order by s.pursuit_id, s.made_at desc`, [entityIds]);
  for (const r of rows) {
    const score = provisionalScore(r.scores);
    if (score !== null && score > (out.get(r.entity_id) ?? -1)) out.set(r.entity_id, score);
  }
  return out;
}

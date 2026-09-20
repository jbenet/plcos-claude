import { getDb } from '@/lib/db';
import { config } from '@/config/deployment';
import { DIMENSIONS, type Band, type Dimension, type Factor, type Scored, type Weights } from './types';

type WeightRow = {
  weights_id: string; label: string; capacity: string; affinity: string;
  propensity: string; time_to_decision: string; active: boolean;
  created_by_name: string | null; created_at: Date | string;
};

const toWeights = (r: WeightRow): Weights => ({
  weightsId: r.weights_id, label: r.label, capacity: Number(r.capacity),
  affinity: Number(r.affinity), propensity: Number(r.propensity),
  timeToDecision: Number(r.time_to_decision), active: r.active,
  createdByName: r.created_by_name, createdAt: new Date(r.created_at),
});

const WEIGHT_SELECT = `
  select w.weights_id, w.label, w.capacity, w.affinity, w.propensity, w.time_to_decision,
         w.active, u.name as created_by_name, w.created_at
    from scoring.weights w left join platform.app_user u on u.id = w.created_by`;

export async function listWeights(): Promise<Weights[]> {
  const db = await getDb();
  return (await db.query<WeightRow>(`${WEIGHT_SELECT} order by w.created_at desc`)).map(toWeights);
}

export async function activeWeights(): Promise<Weights | null> {
  const db = await getDb();
  const row = await db.one<WeightRow>(`${WEIGHT_SELECT} where w.active`);
  return row ? toWeights(row) : null;
}

/**
 * Rank the universe for one vehicle under the active weights.
 *
 * A target missing any factor is returned unscored. Scoring three quarters of a rubric and
 * calling the result a score is how a ranking becomes a statement about what we happened
 * to look up.
 */
export async function ranked(vehicleId: string): Promise<Scored[]> {
  const db = await getDb();
  const weights = await activeWeights();
  const rows = await db.query<{
    entity_id: string; entity_name: string; vehicle_id: string; vehicle_name: string;
    dimension: Dimension; value: string; basis: string; source: string | null;
    as_of: Date | string; recorded_by_name: string | null;
  }>(
    `select f.entity_id, e.display_name as entity_name, f.vehicle_id, v.name as vehicle_name,
            f.dimension, f.value, f.basis, f.source, f.as_of, u.name as recorded_by_name
       from scoring.factor f
       join identity.entity e on e.entity_id = f.entity_id
       join platform.vehicle v on v.id = f.vehicle_id
       left join platform.app_user u on u.id = f.recorded_by
      where f.vehicle_id = $1
      order by e.display_name`,
    [vehicleId],
  );

  const byEntity = new Map<string, Scored>();
  for (const r of rows) {
    let s = byEntity.get(r.entity_id);
    if (!s) {
      s = {
        entityId: r.entity_id, entityName: r.entity_name, vehicleId: r.vehicle_id,
        vehicleName: r.vehicle_name, factors: [], missing: [], score: null,
        band: 'unscored', leading: null,
      };
      byEntity.set(r.entity_id, s);
    }
    s.factors.push({
      dimension: r.dimension, value: Number(r.value), basis: r.basis, source: r.source,
      asOf: new Date(r.as_of), recordedByName: r.recorded_by_name,
    });
  }

  for (const s of byEntity.values()) {
    s.missing = DIMENSIONS.filter((d) => !s.factors.some((f) => f.dimension === d));
    if (s.missing.length > 0 || !weights) {
      s.band = 'unscored';
      continue;
    }
    const w: Record<Dimension, number> = {
      capacity: weights.capacity, affinity: weights.affinity,
      propensity: weights.propensity, time_to_decision: weights.timeToDecision,
    };
    let total = 0;
    let best: { d: Dimension; contribution: number } | null = null;
    for (const f of s.factors) {
      const contribution = f.value * w[f.dimension];
      total += contribution;
      if (!best || contribution > best.contribution) best = { d: f.dimension, contribution };
    }
    s.score = total;
    s.leading = best?.d ?? null;
    s.band = bandFor(total);
  }

  return [...byEntity.values()].sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.entityName.localeCompare(b.entityName),
  );
}

/**
 * The band cut-offs live in config/deployment.ts with the other labelled guesses. They
 * came from nowhere but judgement and should move once there are outcomes to fit them to.
 */
export function bandFor(score: number): Band {
  if (score >= config.scoringBands.strong) return 'strong';
  if (score >= config.scoringBands.worthALook) return 'worth_a_look';
  return 'weak';
}

export async function setActiveWeights(
  actorId: string,
  w: { label: string; capacity: number; affinity: number; propensity: number; timeToDecision: number },
): Promise<void> {
  const sum = w.capacity + w.affinity + w.propensity + w.timeToDecision;
  if (Math.abs(sum - 1) > 0.0001) {
    throw new Error(`Weights must sum to 1. These sum to ${sum.toFixed(3)}.`);
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query('update scoring.weights set active = false where active');
    await tx.query(
      `insert into scoring.weights
         (label, capacity, affinity, propensity, time_to_decision, active, created_by)
       values ($1,$2,$3,$4,$5,true,$6)`,
      [w.label, w.capacity, w.affinity, w.propensity, w.timeToDecision, actorId],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, detail)
       values ($1, 'scoring.weights_changed', 'weights', $2)`,
      [actorId, JSON.stringify(w)],
    );
  });
}

import { getDb, type Queryable } from '@/lib/db';
import type { Exposure, Instrument, PoolCheck, Track, VehicleTotals } from './types';

type Row = {
  exposure_id: string; entity_id: string; entity_name: string; vehicle_id: string;
  vehicle_name: string; vehicle_slug: string; instrument: Instrument; track: Track;
  amount: string; probability: string | null; owner_name: string;
  evidence_ref: string | null; hardened_at: Date | string | null;
  cash_received_at: Date | string | null; opened_at: Date | string;
};

const SELECT = `
  select x.exposure_id, x.entity_id, e.display_name as entity_name, x.vehicle_id,
         v.name as vehicle_name, v.slug as vehicle_slug, x.instrument, x.track, x.amount,
         x.probability, u.name as owner_name, x.evidence_ref, x.hardened_at,
         x.cash_received_at, x.opened_at
    from pipeline.exposure x
    join identity.entity e on e.entity_id = x.entity_id
    join platform.vehicle v on v.id = x.vehicle_id
    join platform.app_user u on u.id = x.owner_id
   where x.closed_at is null`;

const toExposure = (r: Row): Exposure => ({
  exposureId: r.exposure_id, entityId: r.entity_id, entityName: r.entity_name,
  vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, vehicleSlug: r.vehicle_slug,
  instrument: r.instrument, track: r.track, amount: Number(r.amount),
  probability: r.probability === null ? null : Number(r.probability),
  ownerName: r.owner_name, evidenceRef: r.evidence_ref,
  hardenedAt: r.hardened_at ? new Date(r.hardened_at) : null,
  cashReceivedAt: r.cash_received_at ? new Date(r.cash_received_at) : null,
  openedAt: new Date(r.opened_at),
});

export async function listExposures(vehicleId?: string | null): Promise<Exposure[]> {
  const db = await getDb();
  const rows = vehicleId
    ? await db.query<Row>(`${SELECT} and x.vehicle_id = $1 order by x.amount desc`, [vehicleId])
    : await db.query<Row>(`${SELECT} order by v.sort_order, x.amount desc`);
  return rows.map(toExposure);
}

export async function getExposure(id: string, q?: Queryable): Promise<Exposure | null> {
  const db = q ?? (await getDb());
  const row = await db.one<Row>(`${SELECT} and x.exposure_id = $1`, [id]);
  return row ? toExposure(row) : null;
}

/**
 * Totals per vehicle. Soft and hard are separate fields and nothing here adds them
 * together — not even for convenience, because a convenient blended number is exactly how
 * a $30M gap gets reported as closed three weeks before it is.
 */
export async function vehicleTotals(): Promise<VehicleTotals[]> {
  const db = await getDb();
  const rows = await db.query<{
    id: string; slug: string; name: string; kind: string; exemption: string;
    target_amount: string | null; hard: string; cash: string; soft: string;
    convertible: string; soft_count: string; hard_count: string;
  }>(
    `select v.id, v.slug, v.name, v.kind::text as kind, v.exemption, v.target_amount,
            coalesce(sum(x.amount) filter (where x.track = 'hard'), 0)::text as hard,
            coalesce(sum(x.amount) filter (where x.track = 'hard' and x.cash_received_at is not null), 0)::text as cash,
            coalesce(sum(x.amount) filter (where x.track = 'soft'), 0)::text as soft,
            coalesce(sum(x.amount * coalesce(x.probability, 0)) filter (where x.track = 'soft'), 0)::text as convertible,
            count(*) filter (where x.track = 'soft')::text as soft_count,
            count(*) filter (where x.track = 'hard')::text as hard_count
       from platform.vehicle v
       left join pipeline.exposure x on x.vehicle_id = v.id and x.closed_at is null
      group by v.id, v.slug, v.name, v.kind, v.exemption, v.target_amount, v.sort_order
      order by v.sort_order`,
  );

  return rows.map((r) => {
    const target = r.target_amount === null ? null : Number(r.target_amount);
    const hard = Number(r.hard);
    const soft = Number(r.soft);
    return {
      vehicleId: r.id, vehicleSlug: r.slug, vehicleName: r.name, kind: r.kind,
      exemption: r.exemption, target, hard, cash: Number(r.cash), soft,
      convertibleSoft: Number(r.convertible),
      softCount: Number(r.soft_count), hardCount: Number(r.hard_count),
      coverage: target && target > 0 ? (hard + soft) / target : null,
      gapToTarget: target === null ? null : target - hard,
    };
  });
}

/**
 * The conserved capital pool, checked deterministically. An agent may propose the budget;
 * this does the arithmetic.
 */
export async function poolChecks(): Promise<PoolCheck[]> {
  const db = await getDb();
  const rows = await db.query<{
    entity_id: string; entity_name: string; budget: string | null; source: string | null;
    verified: boolean; vehicle_name: string | null; track: Track | null; amount: string | null;
  }>(
    `select e.entity_id, e.display_name as entity_name, p.budget, p.source,
            (p.verified_by is not null) as verified,
            v.name as vehicle_name, x.track, x.amount
       from identity.entity e
       join pipeline.exposure x on x.entity_id = e.entity_id and x.closed_at is null
       join platform.vehicle v on v.id = x.vehicle_id
       left join pipeline.capital_pool p on p.entity_id = e.entity_id
      order by e.display_name, v.sort_order`,
  );

  const byEntity = new Map<string, PoolCheck>();
  for (const r of rows) {
    let check = byEntity.get(r.entity_id);
    if (!check) {
      check = {
        entityId: r.entity_id, entityName: r.entity_name,
        budget: r.budget === null ? null : Number(r.budget),
        budgetSource: r.source, budgetVerified: r.verified,
        committed: [], total: 0, over: 0, status: 'ok',
      };
      byEntity.set(r.entity_id, check);
    }
    if (r.vehicle_name && r.track && r.amount) {
      check.committed.push({ vehicleName: r.vehicle_name, track: r.track, amount: Number(r.amount) });
      check.total += Number(r.amount);
    }
  }

  for (const check of byEntity.values()) {
    if (check.budget === null) {
      check.status = 'no_budget';
    } else if (!check.budgetVerified) {
      check.status = 'unverified';
    } else if (check.total > check.budget) {
      check.status = 'over';
      check.over = check.total - check.budget;
    }
  }

  return [...byEntity.values()].sort(
    (a, b) => Number(b.status === 'over') - Number(a.status === 'over') || b.total - a.total,
  );
}

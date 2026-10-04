import { getDb, type Queryable } from '@/lib/db';
import { syncIoi } from '@/modules/close';

/**
 * An indication of interest and the amount indicated (Juan, 4 Oct 2026; docs/27-outreach-api.md §1),
 * per LP per vehicle, for a fund or an SPV. A single number is low = high.
 *
 * Rule 1: an indication is not soft money. It is shown beside soft and hard and never added to
 * either; nothing in this file is read by vehicleTotals, and `IndicatedTotals` is its own object
 * with no field that holds soft or hard. It becomes soft only when someone records a soft
 * commitment on the close track.
 *
 * An SPV seat at the IOI stage is the same fact in the war room: recording an indication on an SPV
 * moves an invited seat to "IOI given" (close.syncIoi), and a seat at IOI with no indication
 * recorded here reads as one, sourced "spv seat".
 */

export interface Indication {
  /** Null when read from an SPV seat at the IOI stage rather than recorded here. */
  indicationId: string | null;
  pursuitId: string | null;
  entityId: string;
  vehicleId: string;
  low: number;
  high: number;
  on: Date;
  /** The touchpoint where they said it: the email or the call. */
  touchpointId: string | null;
  source: 'us' | 'spv seat';
  recordedByName: string | null;
}

/** Per vehicle. Its own figure: never added to hard or soft, and no field here holds either. */
export interface IndicatedTotals {
  vehicleId: string;
  /** Σ low and Σ high of the current indications: a range, not a commitment. */
  low: number;
  high: number;
  count: number;
}

export class IndicationRefused extends Error {
  constructor(message: string) { super(message); this.name = 'IndicationRefused'; }
}

const MAX = 1e11; // GUESS — no single LP indicates $100B; past it the input is a typo.

/** Low and high from what was given: one number is both; refused unless 0 ≤ low ≤ high. */
export function indicationRange(low: unknown, high?: unknown): { low: number; high: number } {
  const lo = typeof low === 'string' ? Number(low) : low;
  const hi = high === undefined || high === null || high === '' ? lo : typeof high === 'string' ? Number(high) : high;
  if (typeof lo !== 'number' || typeof hi !== 'number' || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new IndicationRefused('An indicated amount is a number of dollars, or two for a range.');
  }
  if (lo < 0 || hi < lo) throw new IndicationRefused('An indicated range runs from a low to a high that is no smaller.');
  if (hi > MAX) throw new IndicationRefused('That amount is larger than any one LP indicates; check the digits.');
  return { low: Math.round(lo * 100) / 100, high: Math.round(hi * 100) / 100 };
}

/**
 * Record what they indicated, superseding the previous indication on this pursuit. Never touches
 * an exposure: a soft commitment is recorded on the close track, by a person, separately.
 */
export async function recordIndication(
  actorId: string,
  args: { pursuitId: string; low: number; high?: number | null; on?: Date | null; touchpointId?: string | null; updateId?: string | null },
  opts: { q?: Queryable } = {},
): Promise<string> {
  const { low, high } = indicationRange(args.low, args.high);
  const on = args.on ?? new Date();
  if (Number.isNaN(on.getTime())) throw new IndicationRefused('The date they indicated it is not a date.');
  const run = async (tx: Queryable) => {
    const p = await tx.one<{ pursuit_id: string; entity_id: string; vehicle_id: string; kind: string; name: string; vehicle: string }>(
      `select p.pursuit_id::text, identity.canonical_entity_id(p.entity_id)::text entity_id, p.vehicle_id::text, v.kind::text kind,
              e.display_name name, v.name vehicle
         from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id
         join identity.entity e on e.entity_id = identity.canonical_entity_id(p.entity_id)
        where p.pursuit_id = strategy.canonical_pursuit_id($1::uuid)`, [args.pursuitId]);
    if (!p) throw new IndicationRefused('No such LP on that vehicle.');
    if (args.touchpointId) {
      const t = await tx.one(`select 1 from meetings.meeting where meeting_id = $1
        and identity.canonical_entity_id(entity_id) = $2::uuid`, [args.touchpointId, p.entity_id]);
      if (!t) throw new IndicationRefused('The touchpoint named as the source is not one with this LP.');
    }
    await tx.query(`update pipeline.indication set superseded_at = now()
      where superseded_at is null and pursuit_id in (select pursuit_id from strategy.pursuit
        where strategy.canonical_pursuit_id(pursuit_id) = $1::uuid)`, [p.pursuit_id]);
    const row = (await tx.one<{ id: string }>(`insert into pipeline.indication
        (pursuit_id, entity_id, vehicle_id, low, high, indicated_on, source_touchpoint_id, update_id, recorded_by)
      values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9) returning indication_id::text id`,
      [p.pursuit_id, p.entity_id, p.vehicle_id, low, high, on.toISOString().slice(0, 10), args.touchpointId ?? null, args.updateId ?? null, actorId]))!;
    // The war room's IOI stage is the same fact (close.spv_seat): keep it in step.
    const seats = p.kind === 'spv' ? await syncIoi(p.entity_id, p.vehicle_id, on, low, tx) : 0;
    await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
      values ($1, 'pursuit.indication_recorded', 'pursuit', $2, $3)`,
    [actorId, p.pursuit_id, JSON.stringify({ indicationId: row.id, low, high, on: on.toISOString().slice(0, 10),
      touchpointId: args.touchpointId ?? null, updateId: args.updateId ?? null, seatsMovedToIoi: seats })]);
    return row.id;
  };
  if (opts.q) return run(opts.q);
  return (await getDb()).transaction(run);
}

type Row = {
  indication_id: string | null; pursuit_id: string | null; entity_id: string; vehicle_id: string; low: string; high: string;
  on: Date | string; touchpoint_id: string | null; source: 'us' | 'spv seat'; by_name: string | null;
};

const toIndication = (r: Row): Indication => ({
  indicationId: r.indication_id, pursuitId: r.pursuit_id, entityId: r.entity_id, vehicleId: r.vehicle_id,
  low: Number(r.low), high: Number(r.high), on: new Date(r.on), touchpointId: r.touchpoint_id, source: r.source, recordedByName: r.by_name,
});

/**
 * The current indication per LP per vehicle, keyed `${entityId}:${vehicleId}` (canonical entity).
 * Recorded ones first; an SPV seat at the IOI stage with an amount counts where nothing is recorded.
 */
export async function currentIndications(vehicleIds: string[] | null, q?: Queryable): Promise<Map<string, Indication>> {
  const db = q ?? await getDb();
  const rows = await db.query<Row>(`
    select * from (
      select distinct on (identity.canonical_entity_id(i.entity_id), i.vehicle_id)
             i.indication_id::text, strategy.canonical_pursuit_id(i.pursuit_id)::text pursuit_id,
             identity.canonical_entity_id(i.entity_id)::text entity_id, i.vehicle_id::text, i.low::text, i.high::text,
             i.indicated_on "on", i.source_touchpoint_id::text touchpoint_id, 'us' source, u.name by_name
        from pipeline.indication i left join platform.app_user u on u.id = i.recorded_by
       where i.superseded_at is null and ($1::uuid[] is null or i.vehicle_id = any($1::uuid[]))
       order by identity.canonical_entity_id(i.entity_id), i.vehicle_id, i.recorded_at desc
    ) recorded
    union all
    select null, p.pursuit_id::text, identity.canonical_entity_id(s.entity_id)::text, s.vehicle_id::text, s.amount::text, s.amount::text,
           coalesce(s.ioi_at, s.invited_at)::date, null, 'spv seat', null
      from close.spv_seat s
      left join lateral (select pursuit_id from strategy.active_pursuit ap
        where identity.canonical_entity_id(ap.entity_id) = identity.canonical_entity_id(s.entity_id) and ap.vehicle_id = s.vehicle_id
        order by ap.opened_at limit 1) p on true
     where s.stage = 'ioi' and s.amount is not null and ($1::uuid[] is null or s.vehicle_id = any($1::uuid[]))
       and not exists (select 1 from pipeline.indication i where i.superseded_at is null and i.vehicle_id = s.vehicle_id
         and identity.canonical_entity_id(i.entity_id) = identity.canonical_entity_id(s.entity_id))`, [vehicleIds]);
  const out = new Map<string, Indication>();
  for (const r of rows) {
    const key = `${r.entity_id}:${r.vehicle_id}`;
    if (!out.has(key)) out.set(key, toIndication(r));
  }
  return out;
}

/** The current indication for one LP on one vehicle, or null. */
export async function indicationFor(entityId: string, vehicleId: string, q?: Queryable): Promise<Indication | null> {
  const db = q ?? await getDb();
  const canonical = (await db.one<{ id: string }>('select identity.canonical_entity_id($1::uuid)::text id', [entityId]))?.id ?? entityId;
  return (await currentIndications([vehicleId], db)).get(`${canonical}:${vehicleId}`) ?? null;
}

/** Per vehicle: the indicated range and how many LPs. Never added to hard or soft (rule 1). */
export async function indicatedTotals(vehicleIds: string[] | null = null, q?: Queryable): Promise<Map<string, IndicatedTotals>> {
  const out = new Map<string, IndicatedTotals>();
  for (const i of (await currentIndications(vehicleIds, q)).values()) {
    const t = out.get(i.vehicleId) ?? { vehicleId: i.vehicleId, low: 0, high: 0, count: 0 };
    t.low += i.low; t.high += i.high; t.count += 1;
    out.set(i.vehicleId, t);
  }
  return out;
}

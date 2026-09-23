import { getDb, type Queryable } from '@/lib/db';
import type {
  CloseState, CloseTrack, CommitmentEvent, CommitmentStep, Exposure, Instrument, PoolCheck, Track, VehicleTotals,
} from './types';

type Row = {
  exposure_id: string; entity_id: string; entity_name: string; vehicle_id: string;
  vehicle_name: string; vehicle_slug: string; instrument: Instrument; track: Track;
  amount: string; probability: string | null; owner_name: string;
  evidence_ref: string | null; hardened_at: Date | string | null;
  cash_received_at: Date | string | null; opened_at: Date | string;
  source: string; source_as_of: Date | string | null; claim: string | null;
};

const SELECT = `
  select x.exposure_id, x.entity_id, e.display_name as entity_name, x.vehicle_id,
         v.name as vehicle_name, v.slug as vehicle_slug, x.instrument, x.track, x.amount,
         x.probability, u.name as owner_name, x.evidence_ref, x.hardened_at,
         x.cash_received_at, x.opened_at, x.source, x.source_as_of, x.claim
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
  source: r.source, sourceAsOf: r.source_as_of ? new Date(r.source_as_of) : null, claim: r.claim,
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
    convertible: string; soft_count: string; hard_count: string; phase: string;
  }>(
    `select v.id, v.slug, v.name, v.kind::text as kind, v.exemption, v.target_amount, v.phase,
            coalesce(sum(x.amount) filter (where x.track = 'hard'), 0)::text as hard,
            -- Cash is what has wired: the wires recorded here (N52), and for a commitment marked
            -- received before wires had amounts, the whole of it.
            coalesce(sum(coalesce(w.wired, case when x.cash_received_at is not null then x.amount end)) filter (where x.track = 'hard'), 0)::text as cash,
            coalesce(sum(x.amount) filter (where x.track = 'soft'), 0)::text as soft,
            coalesce(sum(x.amount * coalesce(x.probability, 0)) filter (where x.track = 'soft'), 0)::text as convertible,
            count(*) filter (where x.track = 'soft')::text as soft_count,
            count(*) filter (where x.track = 'hard')::text as hard_count
       from platform.vehicle v
       left join pipeline.exposure x on x.vehicle_id = v.id and x.closed_at is null
       left join lateral (
         select sum(ce.amount) as wired from pipeline.commitment_event ce
          where ce.exposure_id = x.exposure_id and ce.step = 'wired' and ce.source = 'us'
       ) w on true
      group by v.id, v.slug, v.name, v.kind, v.exemption, v.target_amount, v.sort_order, v.phase
      order by v.sort_order`,
  );

  return rows.map((r) => {
    const target = r.target_amount === null ? null : Number(r.target_amount);
    const hard = Number(r.hard);
    const soft = Number(r.soft);
    return {
      vehicleId: r.id, vehicleSlug: r.slug, vehicleName: r.name, kind: r.kind,
      exemption: r.exemption, target, hard, cash: Number(r.cash), soft, historical: r.phase === 'historical',
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

// ---------------------------------------------------------------- the close track (N52)

type EventRow = {
  event_id: string; exposure_id: string; step: CommitmentStep; occurred_on: Date | string | null;
  amount: string | null; document: string | null; reason: string | null; reference: string | null;
  source: string; recorded_by_name: string | null; recorded_at: Date | string;
};

const toEvent = (r: EventRow): CommitmentEvent => ({
  eventId: r.event_id, exposureId: r.exposure_id, step: r.step,
  on: r.occurred_on ? new Date(r.occurred_on) : null, amount: r.amount === null ? null : Number(r.amount),
  document: r.document, reason: r.reason, reference: r.reference, source: r.source,
  recordedByName: r.recorded_by_name, recordedAt: new Date(r.recorded_at),
});

async function eventsFor(ids: string[], q?: Queryable): Promise<Map<string, CommitmentEvent[]>> {
  const out = new Map<string, CommitmentEvent[]>();
  if (!ids.length) return out;
  const db = q ?? (await getDb());
  const rows = await db.query<EventRow>(
    `select ce.event_id, ce.exposure_id, ce.step::text as step, ce.occurred_on, ce.amount::text as amount,
            ce.document, ce.reason, ce.reference, ce.source, u.name as recorded_by_name, ce.recorded_at
       from pipeline.commitment_event ce left join platform.app_user u on u.id = ce.recorded_by
      where ce.exposure_id = any($1::uuid[])
      order by coalesce(ce.occurred_on, ce.recorded_at::date), ce.recorded_at`,
    [ids],
  );
  for (const r of rows) out.set(r.exposure_id, [...(out.get(r.exposure_id) ?? []), toEvent(r)]);
  return out;
}

/**
 * The close track, derived (N52, docs/17 §3). Hard is the exposure's track and nothing else;
 * a signature is an event here or a pack item returned in the close room; a source's claim of
 * a signature or a wire is shown as that source's, and moves nothing.
 */
export function deriveTrack(x: Exposure, events: CommitmentEvent[], packReturnedOn: Date | null = null): CloseTrack {
  const sigs = events.filter((e) => e.step === 'signed' || e.step === 'resigned');
  const last = sigs[sigs.length - 1];
  const signature = last
    ? { on: last.on, bySource: last.source, document: last.document }
    : packReturnedOn ? { on: packReturnedOn, bySource: 'close room', document: 'subscription pack' } : null;
  const withdrawn = events.some((e) => e.step === 'withdrawn');
  const closed = events.filter((e) => e.step === 'closed').pop();
  const wiresHere = events.filter((e) => e.step === 'wired' && e.source === 'us' && e.amount !== null);
  const wired = wiresHere.reduce((a, e) => a + e.amount!, 0) || (x.cashReceivedAt && x.track === 'hard' && !events.some((e) => e.step === 'wired') ? x.amount : 0);
  const state: CloseState = withdrawn ? 'withdrawn'
    : x.track === 'hard' && closed ? 'closed'
      : x.track === 'hard' ? 'hard'
        : signature ? 'signed' : 'soft';
  return {
    exposure: x,
    state,
    events,
    signature,
    resigned: sigs.filter((e) => e.step === 'resigned').length,
    closedOn: closed?.on ?? null,
    wires: wiresHere.length ? wiresHere.map((e) => ({ on: e.on, amount: e.amount! })) : wired ? [{ on: x.cashReceivedAt, amount: wired }] : [],
    wired,
    wiredPerSource: events.some((e) => e.step === 'wired' && e.source !== 'us'),
    outstanding: x.track === 'hard' ? Math.max(0, x.amount - wired) : null,
  };
}

/** The close track for an LP on a vehicle: one per open exposure, usually one. */
export async function closeTracksFor(entityId: string, vehicleId: string): Promise<CloseTrack[]> {
  const db = await getDb();
  const rows = await db.query<Row>(`${SELECT} and x.entity_id = $1 and x.vehicle_id = $2 order by x.amount desc`, [entityId, vehicleId]);
  const exposures = rows.map(toExposure);
  const [events, packs] = await Promise.all([
    eventsFor(exposures.map((x) => x.exposureId)),
    db.query<{ returned_at: Date | string | null }>(
      `select max(p.returned_at) as returned_at from close.pack_item p join close.cycle c on c.cycle_id = p.cycle_id
        where p.entity_id = $1 and c.vehicle_id = $2`, [entityId, vehicleId],
    ),
  ]);
  const returned = packs[0]?.returned_at ? new Date(packs[0].returned_at) : null;
  return exposures.map((x) => deriveTrack(x, events.get(x.exposureId) ?? [], returned));
}

/** Close states for the pipeline list, keyed `${entityId}:${vehicleId}` — the largest exposure's. */
export async function closeStates(pairs: Array<{ entityId: string; vehicleId: string }>): Promise<Map<string, CloseTrack>> {
  const out = new Map<string, CloseTrack>();
  if (!pairs.length) return out;
  const db = await getDb();
  const rows = await db.query<Row>(`${SELECT} and x.entity_id = any($1::uuid[]) order by x.amount desc`, [[...new Set(pairs.map((p) => p.entityId))]]);
  const exposures = rows.map(toExposure);
  const events = await eventsFor(exposures.map((x) => x.exposureId));
  const want = new Set(pairs.map((p) => `${p.entityId}:${p.vehicleId}`));
  for (const x of exposures) {
    const key = `${x.entityId}:${x.vehicleId}`;
    if (want.has(key) && !out.has(key)) out.set(key, deriveTrack(x, events.get(x.exposureId) ?? []));
  }
  return out;
}


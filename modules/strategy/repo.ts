import { getDb, type Queryable } from '@/lib/db';
import {
  RUNGS, rungIndex, type Implied, type LadderEvent, type LadderRung, type PassedBy, type PlanStep, type Pursuit,
  type PursuitStatus,
} from './types';

type PursuitRow = {
  pursuit_id: string; entity_id: string; entity_name: string; vehicle_id: string;
  vehicle_name: string; owner_name: string; headline: string | null;
  plan: PlanStep[]; opened_at: Date | string; closed_at: Date | string | null;
  status: PursuitStatus; status_reason: string | null; passed_by: PassedBy | null; status_source: string;
  status_said: PursuitStatus | null;
  status_set_at: Date | string | null; status_set_by_name: string | null; implied: string[] | null;
  next_step: string | null; next_step_on: Date | string | null; source: string;
  source_as_of: Date | string | null; stage_said: string | null; owner_said: string | null; vehicle_phase: string;
};

type EventRow = {
  event_id: string; pursuit_id: string; rung: LadderRung; evidence_kind: string;
  evidence_ref: string; evidence_note: string; recorded_by_name: string;
  occurred_at: Date | string;
};

const PURSUIT_SELECT = `
  select p.pursuit_id, p.entity_id, e.display_name as entity_name, p.vehicle_id,
         v.name as vehicle_name, u.name as owner_name, p.headline, p.plan,
         p.opened_at, p.closed_at, p.status::text as status, p.status_reason, p.passed_by, p.status_source,
         p.status_said::text as status_said,
         p.status_set_at, su.name as status_set_by_name, p.implied, p.next_step, p.next_step_on,
         p.source, p.source_as_of, p.stage_said, p.owner_said, v.phase as vehicle_phase
    from strategy.pursuit p
    join identity.entity e on e.entity_id = p.entity_id
    join platform.vehicle v on v.id = p.vehicle_id
    join platform.app_user u on u.id = p.owner_id
    left join platform.app_user su on su.id = p.status_set_by`;

const toEvent = (r: EventRow): LadderEvent => ({
  eventId: r.event_id, rung: r.rung, evidenceKind: r.evidence_kind,
  evidenceRef: r.evidence_ref, evidenceNote: r.evidence_note,
  recordedByName: r.recorded_by_name, occurredAt: new Date(r.occurred_at),
});

function assemble(row: PursuitRow, events: LadderEvent[]): Pursuit {
  const sorted = [...events].sort((a, b) => rungIndex(a.rung) - rungIndex(b.rung));
  const rung = sorted.length ? sorted[sorted.length - 1]!.rung : null;
  const nextIdx = rungIndex(rung) + 1;
  return {
    pursuitId: row.pursuit_id, entityId: row.entity_id, entityName: row.entity_name,
    vehicleId: row.vehicle_id, vehicleName: row.vehicle_name, ownerName: row.owner_name,
    headline: row.headline, plan: row.plan ?? [], openedAt: new Date(row.opened_at),
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
    events: sorted, rung, nextRung: nextIdx < RUNGS.length ? RUNGS[nextIdx]! : null,
    status: row.status, statusReason: row.status_reason, passedBy: row.passed_by, statusSource: row.status_source,
    statusSaid: row.status_said,
    statusSetAt: row.status_set_at ? new Date(row.status_set_at) : null, statusSetByName: row.status_set_by_name,
    implied: (row.implied ?? []) as Implied[], nextStep: row.next_step,
    nextStepOn: row.next_step_on ? new Date(row.next_step_on) : null, source: row.source,
    sourceAsOf: row.source_as_of ? new Date(row.source_as_of) : null, stageSaid: row.stage_said,
    ownerSaid: row.owner_said, historical: row.vehicle_phase === 'historical',
  };
}

async function eventsFor(ids: string[], q?: Queryable): Promise<Map<string, LadderEvent[]>> {
  if (ids.length === 0) return new Map();
  const db = q ?? (await getDb());
  const rows = await db.query<EventRow>(
    `select l.event_id, l.pursuit_id, l.rung, l.evidence_kind, l.evidence_ref,
            l.evidence_note, u.name as recorded_by_name, l.occurred_at
       from strategy.ladder_event l
       join platform.app_user u on u.id = l.recorded_by
      where l.pursuit_id = any($1::uuid[])`,
    [ids],
  );
  const out = new Map<string, LadderEvent[]>();
  for (const r of rows) {
    const list = out.get(r.pursuit_id) ?? [];
    list.push(toEvent(r));
    out.set(r.pursuit_id, list);
  }
  return out;
}

export async function listPursuits(vehicleId?: string | null, opts: { status?: PursuitStatus } = {}): Promise<Pursuit[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (vehicleId) { params.push(vehicleId); where.push(`p.vehicle_id = $${params.length}`); }
  if (opts.status) { params.push(opts.status); where.push(`p.status = $${params.length}::strategy.pursuit_status`); }
  const rows = await db.query<PursuitRow>(
    `${PURSUIT_SELECT}${where.length ? ` where ${where.join(' and ')}` : ''} order by p.opened_at`, params,
  );
  const events = await eventsFor(rows.map((r) => r.pursuit_id));
  return rows.map((r) => assemble(r, events.get(r.pursuit_id) ?? []));
}

/** How many pursuits sit at each status, per vehicle — the board's column heads. */
export async function statusCounts(): Promise<Array<{ vehicleId: string; status: PursuitStatus; n: number }>> {
  const db = await getDb();
  const rows = await db.query<{ vehicle_id: string; status: PursuitStatus; n: string }>(
    `select vehicle_id, status::text as status, count(*)::text as n from strategy.pursuit group by vehicle_id, status`,
  );
  return rows.map((r) => ({ vehicleId: r.vehicle_id, status: r.status, n: Number(r.n) }));
}

export async function getPursuit(pursuitId: string, q?: Queryable): Promise<Pursuit | null> {
  const db = q ?? (await getDb());
  const row = await db.one<PursuitRow>(`${PURSUIT_SELECT} where p.pursuit_id = $1`, [pursuitId]);
  if (!row) return null;
  const events = await eventsFor([pursuitId], q);
  return assemble(row, events.get(pursuitId) ?? []);
}

export async function pursuitFor(entityId: string, vehicleId: string): Promise<Pursuit | null> {
  const db = await getDb();
  const row = await db.one<PursuitRow>(
    `${PURSUIT_SELECT} where p.entity_id = $1 and p.vehicle_id = $2`,
    [entityId, vehicleId],
  );
  if (!row) return null;
  const events = await eventsFor([row.pursuit_id]);
  return assemble(row, events.get(row.pursuit_id) ?? []);
}

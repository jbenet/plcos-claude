import { getDb, type Queryable } from '@/lib/db';
import { listPeriods } from '@/modules/calendar';
import type {
  BandwidthAlert, Condition, ConditionStatus, Cycle, PackItem, PackStatus, SpvRoom, SpvSeat, SpvStage,
} from './types';

const DAY = 86_400_000;

/** Working days between now and `to`, minus anything the calendar says is suppressed. */
async function workingDaysUntil(to: Date, now = new Date()): Promise<number> {
  const periods = (await listPeriods()).filter((p) => p.suppressUrgency);
  let days = 0;
  for (let t = now.getTime(); t <= to.getTime(); t += DAY) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (periods.some((p) => p.startsOn <= d && p.endsOn >= d)) continue;
    days += 1;
  }
  return days;
}

export async function listCycles(): Promise<Cycle[]> {
  const db = await getDb();
  const rows = await db.query<{
    cycle_id: string; vehicle_id: string; vehicle_name: string; exemption: string;
    label: string; target_date: Date | string; target_amount: string | null; status: string;
  }>(
    `select c.cycle_id, c.vehicle_id, v.name as vehicle_name, v.exemption, c.label,
            c.target_date, c.target_amount, c.status
       from close.cycle c join platform.vehicle v on v.id = c.vehicle_id
      order by c.target_date`,
  );
  return Promise.all(
    rows.map(async (r) => {
      const targetDate = new Date(r.target_date);
      return {
        cycleId: r.cycle_id, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
        exemption: r.exemption, label: r.label, targetDate,
        targetAmount: r.target_amount === null ? null : Number(r.target_amount),
        status: r.status,
        workingDaysLeft: await workingDaysUntil(targetDate),
      };
    }),
  );
}

export async function conditionsFor(cycleId: string): Promise<Condition[]> {
  const db = await getDb();
  const rows = await db.query<{
    condition_id: string; cycle_id: string; entity_name: string | null; label: string;
    detail: string | null; owner_name: string | null; due_on: Date | string | null;
    status: ConditionStatus; evidence_ref: string | null; compliance: boolean;
  }>(
    `select c.condition_id, c.cycle_id, e.display_name as entity_name, c.label, c.detail,
            u.name as owner_name, c.due_on, c.status, c.evidence_ref, c.compliance
       from close.condition c
       left join identity.entity e on e.entity_id = c.entity_id
       left join platform.app_user u on u.id = c.owner_id
      where c.cycle_id = $1
      order by (c.status <> 'open'), c.due_on nulls last`,
    [cycleId],
  );
  const now = Date.now();
  return rows.map((r) => ({
    conditionId: r.condition_id, cycleId: r.cycle_id, entityName: r.entity_name,
    label: r.label, detail: r.detail, ownerName: r.owner_name,
    dueOn: r.due_on ? new Date(r.due_on) : null, status: r.status,
    evidenceRef: r.evidence_ref, compliance: r.compliance,
    overdue: Boolean(r.due_on && r.status === 'open' && new Date(r.due_on).getTime() < now),
  }));
}

export async function packFor(cycleId: string): Promise<PackItem[]> {
  const db = await getDb();
  const rows = await db.query<{
    item_id: string; entity_id: string; entity_name: string; document: string;
    status: PackStatus; sent_at: Date | string | null; returned_at: Date | string | null;
    countersigned_at: Date | string | null; note: string | null;
  }>(
    `select p.item_id, p.entity_id, e.display_name as entity_name, p.document, p.status,
            p.sent_at, p.returned_at, p.countersigned_at, p.note
       from close.pack_item p join identity.entity e on e.entity_id = p.entity_id
      where p.cycle_id = $1
      order by e.display_name, p.document`,
    [cycleId],
  );
  return rows.map((r) => ({
    itemId: r.item_id, entityId: r.entity_id, entityName: r.entity_name,
    document: r.document, status: r.status,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    returnedAt: r.returned_at ? new Date(r.returned_at) : null,
    countersignedAt: r.countersigned_at ? new Date(r.countersigned_at) : null,
    note: r.note,
  }));
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

export async function spvRooms(): Promise<SpvRoom[]> {
  const db = await getDb();
  const rows = await db.query<{
    seat_id: string; vehicle_id: string; vehicle_name: string; target_amount: string | null;
    entity_id: string; entity_name: string; stage: SpvStage; amount: string | null;
    owner_name: string; invited_at: Date | string; ioi_at: Date | string | null;
    allocated_at: Date | string | null; wired_at: Date | string | null; note: string | null;
  }>(
    `select s.seat_id, s.vehicle_id, v.name as vehicle_name, v.target_amount, s.entity_id,
            e.display_name as entity_name, s.stage, s.amount, u.name as owner_name,
            s.invited_at, s.ioi_at, s.allocated_at, s.wired_at, s.note
       from close.spv_seat s
       join platform.vehicle v on v.id = s.vehicle_id
       join identity.entity e on e.entity_id = s.entity_id
       join platform.app_user u on u.id = s.owner_id
      order by v.sort_order, s.invited_at`,
  );

  const byVehicle = new Map<string, SpvRoom>();
  for (const r of rows) {
    let room = byVehicle.get(r.vehicle_id);
    if (!room) {
      room = {
        vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
        target: r.target_amount === null ? null : Number(r.target_amount),
        seats: [], allocated: 0, wired: 0, daysToWire: null, oldestOpenDays: 0,
      };
      byVehicle.set(r.vehicle_id, room);
    }
    const invitedAt = new Date(r.invited_at);
    const wiredAt = r.wired_at ? new Date(r.wired_at) : null;
    const seat: SpvSeat = {
      seatId: r.seat_id, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
      entityId: r.entity_id, entityName: r.entity_name, stage: r.stage,
      amount: r.amount === null ? null : Number(r.amount), ownerName: r.owner_name,
      invitedAt,
      ioiAt: r.ioi_at ? new Date(r.ioi_at) : null,
      allocatedAt: r.allocated_at ? new Date(r.allocated_at) : null,
      wiredAt, note: r.note,
      days: Math.round(((wiredAt ?? new Date()).getTime() - invitedAt.getTime()) / DAY),
      wired: r.stage === 'wired',
    };
    room.seats.push(seat);
    if (seat.stage === 'allocated' || seat.stage === 'wired') room.allocated += seat.amount ?? 0;
    if (seat.stage === 'wired') room.wired += seat.amount ?? 0;
  }

  for (const room of byVehicle.values()) {
    room.daysToWire = median(room.seats.filter((s) => s.wired).map((s) => s.days));
    room.oldestOpenDays = room.seats
      .filter((s) => s.stage !== 'wired' && s.stage !== 'passed')
      .reduce((max, s) => Math.max(max, s.days), 0);
  }

  return [...byVehicle.values()];
}

/**
 * The bandwidth-steal alert. An SPV runs on a days-scale clock and a fund close runs on a
 * long one; the same people and the same investors serve both, and the SPV always feels
 * more urgent. Naming it is most of the fix.
 */
export async function bandwidthAlerts(): Promise<BandwidthAlert[]> {
  const db = await getDb();

  const owners = await db.query<{ name: string; spv_seats: string; fund_pursuits: string }>(
    `select u.name,
            count(distinct s.seat_id) filter (where s.stage in ('invited','ioi','allocated'))::text as spv_seats,
            count(distinct p.pursuit_id)::text as fund_pursuits
       from platform.app_user u
       left join close.spv_seat s on s.owner_id = u.id
       left join strategy.pursuit p on p.owner_id = u.id and p.closed_at is null
          and p.vehicle_id in (select id from platform.vehicle where kind = 'fund')
      group by u.name
     having count(distinct s.seat_id) filter (where s.stage in ('invited','ioi','allocated')) > 0
        and count(distinct p.pursuit_id) > 0`,
  );

  const investors = await db.query<{ name: string; spv: string; fund: string }>(
    `select e.display_name as name, v1.name as spv, v2.name as fund
       from close.spv_seat s
       join identity.entity e on e.entity_id = s.entity_id
       join platform.vehicle v1 on v1.id = s.vehicle_id
       join pipeline.exposure x on x.entity_id = s.entity_id and x.closed_at is null
       join platform.vehicle v2 on v2.id = x.vehicle_id and v2.kind = 'fund'
      where s.stage in ('invited','ioi','allocated')`,
  );

  return [
    ...owners.map((o) => ({
      kind: 'owner' as const,
      name: o.name,
      detail:
        `${o.spv_seats} open SPV seat${Number(o.spv_seats) === 1 ? '' : 's'} and ` +
        `${o.fund_pursuits} fund pursuit${Number(o.fund_pursuits) === 1 ? '' : 's'}. ` +
        'The SPV clock is shorter, so it wins by default unless someone decides otherwise.',
    })),
    ...investors.map((i) => ({
      kind: 'investor' as const,
      name: i.name,
      detail:
        `Open seat on ${i.spv} while also in the ${i.fund} pipeline. Their attention and their ` +
        'budget are both finite — see the conserved capital pool.',
    })),
  ];
}

/**
 * Record the countersignature on the subscription pack.
 *
 * `close.pack_item.countersigned_at` and `pipeline.exposure.hardened_at` describe the same
 * real-world event — a document coming back signed by both sides. They answer different
 * questions (*where is the paperwork* versus *what may appear in a headline*), so both
 * tables keep the fact; what they must not do is disagree. This is the one writer, called
 * from `pipeline.harden` under the same MONEY ticket.
 */
export async function syncCountersignature(
  entityId: string, vehicleId: string, at: Date, q?: Queryable,
): Promise<number> {
  const db = q ?? (await getDb());
  const rows = await db.query<{ item_id: string }>(
    `update close.pack_item p
        set status = 'countersigned', countersigned_at = $3,
            returned_at = coalesce(p.returned_at, $3)
      from close.cycle c
      where c.cycle_id = p.cycle_id
        and c.vehicle_id = $2
        and p.entity_id = $1
        and p.status <> 'countersigned'
      returning p.item_id`,
    [entityId, vehicleId, at],
  );
  return rows.length;
}

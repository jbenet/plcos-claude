import { getDb, type Queryable } from '@/lib/db';
import type {
  Commitment, Handoff, Horizon, Lever, Need, NeedKind, Play, PlayStatus,
} from './types';

const d = (v: Date | string) => new Date(v);

type PlayRow = {
  play_id: string; vehicle_id: string; vehicle_name: string;
  entity_id: string | null; entity_name: string | null;
  horizon: Horizon; lever: Lever; title: string; detail: string; because: string;
  likelihood: number; effort_days: string; reach: number; payoff: string; certainty: string;
  suggested_owner: string | null; suggested_owner_name: string | null;
  status: PlayStatus; assigned_to_name: string | null; assigned_at: Date | string | null;
  gate: string | null; sort: number;
};

const PLAY_SELECT = `
  select p.*, v.name as vehicle_name, e.display_name as entity_name,
         so.name as suggested_owner_name, at.name as assigned_to_name
    from plays.play p
    join platform.vehicle v on v.id = p.vehicle_id
    left join identity.entity e on e.entity_id = p.entity_id
    left join platform.app_user so on so.id = p.suggested_owner
    left join platform.app_user at on at.id = p.assigned_to`;

/**
 * Leverage: expected movement per day of somebody's life.
 *
 * `(likelihood ÷ 5) × reach ÷ days`. Three inputs, all visible beside it — a single number
 * nobody can decompose is a number nobody can argue with, and arguing with it is the point.
 */
const leverage = (r: PlayRow) =>
  (r.likelihood / 5) * r.reach / Number(r.effort_days);

function toPlay(r: PlayRow, weakLevers: Lever[]): Play {
  return {
    playId: r.play_id, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
    entityId: r.entity_id, entityName: r.entity_name,
    horizon: r.horizon, lever: r.lever, title: r.title, detail: r.detail,
    because: r.because, likelihood: r.likelihood, effortDays: Number(r.effort_days),
    reach: r.reach, payoff: r.payoff, certainty: r.certainty,
    suggestedOwner: r.suggested_owner_name, suggestedOwnerId: r.suggested_owner,
    status: r.status, assignedTo: r.assigned_to_name,
    assignedAt: r.assigned_at ? d(r.assigned_at) : null,
    gate: r.gate,
    leverage: leverage(r),
    answersWeakness: weakLevers.includes(r.lever),
  };
}

/** The board for a vehicle. `entityId` null returns whole-vehicle plays only. */
export async function boardFor(
  vehicleId: string, opts: { entityId?: string | null; weakLevers?: Lever[] } = {},
): Promise<Play[]> {
  const db = await getDb();
  const weak = opts.weakLevers ?? [];
  const rows = opts.entityId === undefined
    ? await db.query<PlayRow>(`${PLAY_SELECT} where p.vehicle_id = $1`, [vehicleId])
    : opts.entityId === null
      ? await db.query<PlayRow>(
          `${PLAY_SELECT} where p.vehicle_id = $1 and p.entity_id is null`, [vehicleId])
      : await db.query<PlayRow>(
          `${PLAY_SELECT} where p.vehicle_id = $1 and p.entity_id = $2`,
          [vehicleId, opts.entityId]);
  return rows
    .map((r) => toPlay(r, weak))
    .sort((a, b) =>
      Number(b.answersWeakness) - Number(a.answersWeakness) || b.leverage - a.leverage);
}

export async function getPlay(playId: string, q?: Queryable): Promise<Play | null> {
  const db = q ?? (await getDb());
  const rows = await db.query<PlayRow>(`${PLAY_SELECT} where p.play_id = $1`, [playId]);
  return rows[0] ? toPlay(rows[0], []) : null;
}

export async function needsFor(vehicleId: string, entityId: string): Promise<Need[]> {
  const db = await getDb();
  const rows = await db.query<{
    need_id: string; entity_id: string; entity_name: string; kind: NeedKind;
    statement: string; evidence: string; met: boolean | null; source: string | null;
    as_of: Date | string;
  }>(
    `select n.need_id, n.entity_id, e.display_name as entity_name, n.kind::text as kind,
            n.statement, n.evidence, n.met, n.source, n.as_of
       from plays.need n join identity.entity e on e.entity_id = n.entity_id
      where n.vehicle_id = $1 and n.entity_id = $2 order by n.sort`,
    [vehicleId, entityId],
  );
  return rows.map((r) => ({
    needId: r.need_id, entityId: r.entity_id, entityName: r.entity_name, kind: r.kind,
    statement: r.statement, evidence: r.evidence, met: r.met, source: r.source,
    asOf: d(r.as_of),
  }));
}

type HandoffRow = {
  handoff_id: string; provider: string; payload: Record<string, unknown> | string;
  state: string; external_ref: string | null; note: string | null;
  created_at: Date | string;
};

const toHandoff = (r: HandoffRow): Handoff => ({
  handoffId: r.handoff_id, provider: r.provider,
  payload: typeof r.payload === 'string'
    ? (JSON.parse(r.payload) as Record<string, unknown>) : r.payload,
  state: r.state, externalRef: r.external_ref, note: r.note, createdAt: d(r.created_at),
});

export async function commitmentsFor(
  vehicleId: string, entityId?: string | null,
): Promise<Commitment[]> {
  const db = await getDb();
  const where = entityId === undefined
    ? 'c.vehicle_id = $1'
    : entityId === null ? 'c.vehicle_id = $1 and c.entity_id is null'
      : 'c.vehicle_id = $1 and c.entity_id = $2';
  const args = entityId ? [vehicleId, entityId] : [vehicleId];
  const rows = await db.query<{
    commitment_id: string; vehicle_id: string; entity_id: string | null;
    entity_name: string | null; body: string; written_by_name: string;
    written_at: Date | string; parsed: Commitment['parsed'] | string | null;
  } & Partial<HandoffRow>>(
    `select c.commitment_id, c.vehicle_id, c.entity_id, e.display_name as entity_name,
            c.body, u.name as written_by_name, c.written_at, c.parsed,
            h.handoff_id, h.provider, h.payload, h.state, h.external_ref, h.note, h.created_at
       from plays.commitment c
       join platform.app_user u on u.id = c.written_by
       left join identity.entity e on e.entity_id = c.entity_id
       left join plays.handoff h on h.commitment_id = c.commitment_id
      where ${where} order by c.written_at desc`,
    args,
  );
  return rows.map((r) => ({
    commitmentId: r.commitment_id, vehicleId: r.vehicle_id, entityId: r.entity_id,
    entityName: r.entity_name, body: r.body, writtenByName: r.written_by_name,
    writtenAt: d(r.written_at),
    parsed: typeof r.parsed === 'string'
      ? (JSON.parse(r.parsed) as Commitment['parsed']) : r.parsed ?? null,
    handoff: r.handoff_id ? toHandoff(r as HandoffRow) : null,
  }));
}

export async function handoffsFor(vehicleId: string): Promise<Array<Handoff & { subject: string }>> {
  const db = await getDb();
  const rows = await db.query<HandoffRow & { subject: string }>(
    `select h.*, coalesce(p.title, left(c.body, 72)) as subject
       from plays.handoff h
       left join plays.play p on p.play_id = h.play_id
       left join plays.commitment c on c.commitment_id = h.commitment_id
      where coalesce(p.vehicle_id, c.vehicle_id) = $1
      order by h.created_at desc`,
    [vehicleId],
  );
  return rows.map((r) => ({ ...toHandoff(r), subject: r.subject }));
}

export async function listUsers(): Promise<Array<{ id: string; name: string; role: string }>> {
  const db = await getDb();
  return db.query('select id, name, role from platform.app_user order by name');
}

import { getDb, type Queryable } from '@/lib/db';
import type { Ask, AskOutcome, AskStatus, ConflictCase, ConflictReason, Restriction } from './types';

type AskRow = {
  ask_id: string; entity_id: string; entity_name: string;
  connector_id: string | null; connector_name: string | null;
  vehicle_id: string; vehicle_name: string; status: AskStatus; owner_name: string;
  ticket_id: string | null; purpose: string; scheduled_for: Date | string | null;
  made_at: Date | string | null; channel: string | null; outcome: AskOutcome | null;
  outcome_note: string | null; override_reason: string | null; created_at: Date | string;
};

const ASK_SELECT = `
  select a.ask_id, a.entity_id, e.display_name as entity_name, a.connector_id,
         c.display_name as connector_name, a.vehicle_id, v.name as vehicle_name,
         a.status, u.name as owner_name, a.ticket_id, a.purpose, a.scheduled_for,
         a.made_at, a.channel, a.outcome, a.outcome_note, a.override_reason, a.created_at
    from coordination.ask a
    join identity.entity e on e.entity_id = a.entity_id
    left join identity.entity c on c.entity_id = a.connector_id
    join platform.vehicle v on v.id = a.vehicle_id
    join platform.app_user u on u.id = a.owner_id`;

const toAsk = (r: AskRow): Ask => ({
  askId: r.ask_id, entityId: r.entity_id, entityName: r.entity_name,
  connectorId: r.connector_id, connectorName: r.connector_name,
  vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, status: r.status,
  ownerName: r.owner_name, ticketId: r.ticket_id, purpose: r.purpose,
  scheduledFor: r.scheduled_for ? new Date(r.scheduled_for) : null,
  madeAt: r.made_at ? new Date(r.made_at) : null,
  channel: r.channel, outcome: r.outcome, outcomeNote: r.outcome_note,
  overrideReason: r.override_reason, createdAt: new Date(r.created_at),
});

export async function listAsks(vehicleId?: string | null): Promise<Ask[]> {
  const db = await getDb();
  const rows = vehicleId
    ? await db.query<AskRow>(`${ASK_SELECT} where a.vehicle_id = $1 order by a.created_at desc`, [vehicleId])
    : await db.query<AskRow>(`${ASK_SELECT} order by a.created_at desc`);
  return rows.map(toAsk);
}

export async function getAsk(askId: string, q?: Queryable): Promise<Ask | null> {
  const db = q ?? (await getDb());
  const row = await db.one<AskRow>(`${ASK_SELECT} where a.ask_id = $1`, [askId]);
  return row ? toAsk(row) : null;
}

type ConflictRow = {
  case_id: string; entity_id: string; entity_name: string; window_days: number;
  status: ConflictCase['status']; opened_at: Date | string;
  claimant_a: string; claimant_b: string; winner_ask_id: string | null;
  loser_ask_id: string | null; reason_code: ConflictReason | null;
  loser_followup_at: Date | string | null; adjudicated_by_name: string | null;
  adjudicated_at: Date | string | null; note: string | null;
};

export async function listConflicts(status?: 'open'): Promise<ConflictCase[]> {
  const db = await getDb();
  const rows = await db.query<ConflictRow>(
    `select c.case_id, c.entity_id, e.display_name as entity_name, c.window_days, c.status,
            c.opened_at, c.claimant_a, c.claimant_b, c.winner_ask_id, c.loser_ask_id,
            c.reason_code, c.loser_followup_at, u.name as adjudicated_by_name,
            c.adjudicated_at, c.note
       from coordination.conflict_case c
       join identity.entity e on e.entity_id = c.entity_id
       left join platform.app_user u on u.id = c.adjudicated_by
      ${status ? "where c.status = 'open'" : ''}
      order by c.opened_at desc`,
  );
  const out: ConflictCase[] = [];
  for (const r of rows) {
    const [a, b] = await Promise.all([getAsk(r.claimant_a), getAsk(r.claimant_b)]);
    if (!a || !b) continue;
    out.push({
      caseId: r.case_id, entityId: r.entity_id, entityName: r.entity_name,
      windowDays: r.window_days, status: r.status, openedAt: new Date(r.opened_at),
      claimantA: a, claimantB: b, winnerAskId: r.winner_ask_id, loserAskId: r.loser_ask_id,
      reasonCode: r.reason_code,
      loserFollowupAt: r.loser_followup_at ? new Date(r.loser_followup_at) : null,
      adjudicatedByName: r.adjudicated_by_name,
      adjudicatedAt: r.adjudicated_at ? new Date(r.adjudicated_at) : null,
      note: r.note,
    });
  }
  return out;
}

export async function getConflictForAsk(askId: string): Promise<ConflictCase | null> {
  const all = await listConflicts();
  return all.find((c) => c.claimantA.askId === askId || c.claimantB.askId === askId) ?? null;
}

type RestrictionRow = {
  restriction_id: string; entity_id: string; entity_name: string;
  scope: Restriction['scope']; connector_id: string | null; connector_name: string | null;
  channel: string | null; instruction: string; source: string | null;
  recorded_by_name: string | null; recorded_at: Date | string;
};

const RESTRICTION_SELECT = `
  select r.restriction_id, r.entity_id, e.display_name as entity_name, r.scope,
         r.connector_id, c.display_name as connector_name, r.channel, r.instruction,
         r.source, u.name as recorded_by_name, r.recorded_at
    from coordination.restriction r
    join identity.entity e on e.entity_id = r.entity_id
    left join identity.entity c on c.entity_id = r.connector_id
    left join platform.app_user u on u.id = r.recorded_by`;

const toRestriction = (r: RestrictionRow): Restriction => ({
  restrictionId: r.restriction_id, entityId: r.entity_id, entityName: r.entity_name,
  scope: r.scope, connectorId: r.connector_id, connectorName: r.connector_name,
  channel: r.channel, instruction: r.instruction, source: r.source,
  recordedByName: r.recorded_by_name, recordedAt: new Date(r.recorded_at),
});

export async function listRestrictions(): Promise<Restriction[]> {
  const db = await getDb();
  return (await db.query<RestrictionRow>(`${RESTRICTION_SELECT} order by r.recorded_at desc`)).map(toRestriction);
}

export async function restrictionsFor(entityId: string, q?: Queryable): Promise<Restriction[]> {
  const db = q ?? (await getDb());
  return (
    await db.query<RestrictionRow>(
      `${RESTRICTION_SELECT} where r.entity_id = $1 and (r.expires_at is null or r.expires_at > current_date)`,
      [entityId],
    )
  ).map(toRestriction);
}

/** Asks made to this entity inside the window, across every vehicle. */
export async function asksToEntitySince(entityId: string, since: Date, q?: Queryable): Promise<Ask[]> {
  const db = q ?? (await getDb());
  return (
    await db.query<AskRow>(
      `${ASK_SELECT} where a.entity_id = $1 and a.made_at is not null and a.made_at >= $2
        order by a.made_at desc`,
      [entityId, since],
    )
  ).map(toAsk);
}

/** Asks routed through this connector inside the window. Connector goodwill is the scarce resource. */
export async function asksViaConnectorSince(connectorId: string, since: Date, q?: Queryable): Promise<Ask[]> {
  const db = q ?? (await getDb());
  return (
    await db.query<AskRow>(
      `${ASK_SELECT} where a.connector_id = $1 and a.made_at is not null and a.made_at >= $2
        order by a.made_at desc`,
      [connectorId, since],
    )
  ).map(toAsk);
}

/** Open or made asks on this entity in a different vehicle inside the conflict window. */
export async function competingAsks(
  entityId: string, vehicleId: string, since: Date, q?: Queryable,
): Promise<Ask[]> {
  const db = q ?? (await getDb());
  return (
    await db.query<AskRow>(
      `${ASK_SELECT}
        where a.entity_id = $1 and a.vehicle_id <> $2
          and a.status in ('proposed','approved','made','blocked')
          and coalesce(a.made_at, a.created_at) >= $3
        order by coalesce(a.made_at, a.created_at) desc`,
      [entityId, vehicleId, since],
    )
  ).map(toAsk);
}

export async function connectorLoad(): Promise<Array<{ connectorId: string; name: string; used: number }>> {
  const db = await getDb();
  const rows = await db.query<{ connector_id: string; name: string; n: string }>(
    `select a.connector_id, e.display_name as name, count(*)::text as n
       from coordination.ask a join identity.entity e on e.entity_id = a.connector_id
      where a.connector_id is not null and a.made_at >= now() - interval '3 months'
      group by a.connector_id, e.display_name order by count(*) desc`,
  );
  return rows.map((r) => ({ connectorId: r.connector_id, name: r.name, used: Number(r.n) }));
}

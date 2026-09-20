import { getDb, pgArray, type Queryable } from '@/lib/db';
import type { Asset, Audience, AssetStatus, PermittedUse, Send, SendStatus, WrapRule } from './types';

type AssetRow = {
  asset_id: string; title: string; parent_id: string | null; audience: Audience | null;
  vehicle_id: string | null; vehicle_name: string | null; version: number;
  owner_name: string; permitted_use: PermittedUse; summary: string; body: string;
  status: AssetStatus; approved_at: Date | string | null;
};

const ASSET_SELECT = `
  select a.asset_id, a.title, a.parent_id, a.audience, a.vehicle_id, v.name as vehicle_name,
         a.version, u.name as owner_name, a.permitted_use, a.summary, a.body, a.status,
         a.approved_at
    from content.asset a
    join platform.app_user u on u.id = a.owner_id
    left join platform.vehicle v on v.id = a.vehicle_id`;

async function decorate(rows: AssetRow[], q?: Queryable): Promise<Asset[]> {
  if (rows.length === 0) return [];
  const db = q ?? (await getDb());
  const ids = rows.map((r) => r.asset_id);

  const claims = await db.query<{
    asset_id: string; claim_id: string; field: string; value: string; source: string; entity_name: string;
  }>(
    `select cr.asset_id, c.claim_id, c.field, c.value, c.source, e.display_name as entity_name
       from content.claim_ref cr
       join research.claim c on c.claim_id = cr.claim_id
       join identity.entity e on e.entity_id = c.entity_id
      where cr.asset_id = any($1::uuid[])`,
    [ids],
  );
  const flags = await db.query<{ asset_id: string; flag_id: string; reason: string; flagged_at: Date | string }>(
    `select asset_id, flag_id, reason, flagged_at from content.refresh_flag
      where asset_id = any($1::uuid[]) and cleared_at is null`,
    [ids],
  );

  return rows.map((r) => ({
    assetId: r.asset_id, title: r.title, parentId: r.parent_id, audience: r.audience,
    vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, version: r.version,
    ownerName: r.owner_name, permittedUse: r.permitted_use, summary: r.summary,
    body: r.body, status: r.status,
    approvedAt: r.approved_at ? new Date(r.approved_at) : null,
    claims: claims.filter((c) => c.asset_id === r.asset_id).map((c) => ({
      claimId: c.claim_id, field: c.field, value: c.value, source: c.source, entityName: c.entity_name,
    })),
    flags: flags.filter((f) => f.asset_id === r.asset_id).map((f) => ({
      flagId: f.flag_id, reason: f.reason, flaggedAt: new Date(f.flagged_at),
    })),
  }));
}

export async function listAssets(): Promise<Asset[]> {
  const db = await getDb();
  return decorate(await db.query<AssetRow>(`${ASSET_SELECT} order by a.parent_id nulls first, a.title`));
}

export async function getAsset(assetId: string, q?: Queryable): Promise<Asset | null> {
  const db = q ?? (await getDb());
  const row = await db.one<AssetRow>(`${ASSET_SELECT} where a.asset_id = $1`, [assetId]);
  if (!row) return null;
  return (await decorate([row], q))[0] ?? null;
}

export async function listWrapRules(): Promise<WrapRule[]> {
  const db = await getDb();
  const rows = await db.query<{
    rule_id: string; exemption: string; instrument: string;
    // Cast to text[]: a built-in OID the driver always knows how to parse. Reading
    // content.audience[] directly returns a raw literal on the connection that created
    // the enum. See pgArray in lib/db.
    allowed_audiences: unknown; max_permitted_use: PermittedUse; note: string;
  }>(
    `select rule_id, exemption, instrument::text as instrument,
            allowed_audiences::text[] as allowed_audiences,
            max_permitted_use, note
       from content.wrap_rule order by exemption, instrument`,
  );
  return rows.map((r) => ({
    ruleId: r.rule_id, exemption: r.exemption, instrument: r.instrument,
    allowedAudiences: pgArray(r.allowed_audiences) as Audience[],
    maxPermittedUse: r.max_permitted_use, note: r.note,
  }));
}

type SendRow = {
  send_id: string; asset_title: string; audience: Audience | null; entity_name: string;
  vehicle_name: string; instrument: string; status: SendStatus; ticket_id: string | null;
  requested_by_name: string; refusal: string | null; requested_at: Date | string;
  sent_at: Date | string | null;
};

export async function listSends(): Promise<Send[]> {
  const db = await getDb();
  const rows = await db.query<SendRow>(
    `select s.send_id, a.title as asset_title, a.audience, e.display_name as entity_name,
            v.name as vehicle_name, s.instrument::text as instrument, s.status, s.ticket_id,
            u.name as requested_by_name, s.refusal, s.requested_at, s.sent_at
       from content.send s
       join content.asset a on a.asset_id = s.asset_id
       join identity.entity e on e.entity_id = s.entity_id
       join platform.vehicle v on v.id = s.vehicle_id
       join platform.app_user u on u.id = s.requested_by
      order by s.requested_at desc`,
  );
  return rows.map((r) => ({
    sendId: r.send_id, assetTitle: r.asset_title, audience: r.audience,
    entityName: r.entity_name, vehicleName: r.vehicle_name, instrument: r.instrument,
    status: r.status, ticketId: r.ticket_id, requestedByName: r.requested_by_name,
    refusal: r.refusal, requestedAt: new Date(r.requested_at),
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
  }));
}

/** The hard KPI: sends that went out under the wrong wrap. It must stay at zero. */
export async function wrongWrapSends(): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: string }>(
    "select count(*)::text as n from content.send where status = 'sent' and refusal is not null",
  );
  return Number(row?.n ?? 0);
}

import { getDb, type Queryable } from '@/lib/db';
import type { DocsendConnection, DocsendSpace, DocsendVisit, VisitRow, VisitsFor } from './types';

/**
 * DocSend data-room visits, read only (docs/32-docsend.md). The sync (lib/connectors/docsend/sync.ts) writes;
 * pages and the conversion charts read `visitsFor`, a plain indexed read: nothing here reaches DocSend.
 */

const q = async (x?: Queryable) => x ?? await getDb();
const d = (x: unknown) => (x ? new Date(x as string) : null);
const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export async function docsendConnection(x?: Queryable): Promise<DocsendConnection | null> {
  const r = await (await q(x)).one<{ user_id: string; name: string | null; connected_at: string; last_error: string | null; last_error_at: string | null }>(
    `select c.user_id::text, u.name, c.connected_at, c.last_error, c.last_error_at
       from docsend.connection c left join platform.app_user u on u.id = c.user_id`);
  return r ? { userId: r.user_id, userName: r.name, connectedAt: d(r.connected_at)!, lastError: r.last_error, lastErrorAt: d(r.last_error_at) } : null;
}

export async function setConnection(userId: string, x?: Queryable): Promise<void> {
  await (await q(x)).query(`insert into docsend.connection (only_one, user_id) values (true, $1)
    on conflict (only_one) do update set user_id = excluded.user_id, connected_at = now(), last_error = null, last_error_at = null`, [userId]);
}

export async function clearConnection(x?: Queryable): Promise<string | null> {
  const r = await (await q(x)).one<{ user_id: string }>('delete from docsend.connection returning user_id::text');
  return r?.user_id ?? null;
}

export async function noteConnectionError(message: string | null, x?: Queryable): Promise<void> {
  await (await q(x)).query(`update docsend.connection set last_error = $1, last_error_at = case when $1::text is null then null else now() end`, [message]);
}

export async function upsertSpaces(spaces: Array<{ spaceId: number; name: string }>, x?: Queryable): Promise<void> {
  const db = await q(x);
  for (const s of spaces) {
    await db.query(`insert into docsend.space (space_id, name) values ($1, $2)
      on conflict (space_id) do update set name = excluded.name, seen_at = now()`, [s.spaceId, s.name]);
  }
}

export async function spaceReadThrough(spaceId: number, x?: Queryable): Promise<Date | null> {
  const r = await (await q(x)).one<{ read_through: string | null }>('select read_through from docsend.space where space_id = $1', [spaceId]);
  return d(r?.read_through);
}

export async function markSpaceRead(spaceId: number, through: Date, x?: Queryable): Promise<void> {
  await (await q(x)).query('update docsend.space set read_through = $2, read_at = now() where space_id = $1', [spaceId, through]);
}

/** Insert or refresh visits by their key. Returns how many were new. */
export async function upsertVisits(rows: VisitRow[], x?: Queryable): Promise<number> {
  const db = await q(x);
  let added = 0;
  for (const v of rows) {
    const r = await db.one<{ inserted: boolean }>(`insert into docsend.visit (visit_id, source, started_at, duration_sec, pages_viewed, page_count,
        percent_viewed, page_seconds, viewer_email, viewer_name, link_name, document_id, document_title, space_id, space_name, raw)
      values ($1, 'mcp', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      on conflict (visit_id) do update set duration_sec = excluded.duration_sec, pages_viewed = excluded.pages_viewed,
        page_count = excluded.page_count, percent_viewed = excluded.percent_viewed, page_seconds = excluded.page_seconds,
        viewer_name = excluded.viewer_name, link_name = excluded.link_name, document_title = excluded.document_title,
        space_name = excluded.space_name, raw = excluded.raw, received_at = now()
      returning (xmax = 0) inserted`,
      [v.visitId, v.startedAt, v.durationSec, v.pagesViewed, v.pageCount, v.percentViewed,
        v.pageSeconds ? JSON.stringify(v.pageSeconds) : null, v.viewerEmail, v.viewerName, v.linkName,
        v.documentId, v.documentTitle, v.spaceId, v.spaceName, JSON.stringify(v.raw)]);
    if (r?.inserted) added++;
  }
  return added;
}

/** Every viewer address held, lowercased, for the sync to match. */
export async function viewerEmails(x?: Queryable): Promise<string[]> {
  return (await (await q(x)).query<{ e: string }>('select distinct viewer_email e from docsend.visit where viewer_email is not null')).map((r) => r.e);
}

/** Who each address is: an LP's entity, our team, or nobody on record (both null, false). */
export async function setViewers(found: Map<string, { entityId: string | null; internal: boolean }>, x?: Queryable): Promise<number> {
  const db = await q(x);
  let changed = 0;
  for (const email of await viewerEmails(db)) {
    const f = found.get(email) ?? { entityId: null, internal: false };
    const rows = await db.query(`update docsend.visit set entity_id = $2, internal = $3, matched_at = now()
       where viewer_email = $1 and (entity_id is distinct from $2::uuid or internal <> $3) returning 1`, [email, f.entityId, f.internal]);
    changed += rows.length;
  }
  return changed;
}

/** Each visit's vehicle from the map: its document's row, else its Space's, else none. */
export async function applyVehicleMap(x?: Queryable): Promise<number> {
  const rows = await (await q(x)).query(`update docsend.visit v set vehicle_id = m.vehicle_id
      from (select v2.visit_id, coalesce(doc.vehicle_id, sp.vehicle_id) vehicle_id
              from docsend.visit v2
              left join docsend.vehicle_map doc on doc.kind = 'document' and doc.key = v2.document_id::text
              left join docsend.vehicle_map sp on sp.kind = 'space' and sp.key = v2.space_id::text) m
     where m.visit_id = v.visit_id and v.vehicle_id is distinct from m.vehicle_id returning 1`);
  return rows.length;
}

export async function setSpaceVehicle(spaceId: number, vehicleId: string | null, actorId: string, x?: Queryable): Promise<void> {
  const db = await q(x);
  if (vehicleId) {
    await db.query(`insert into docsend.vehicle_map (kind, key, vehicle_id, set_by) values ('space', $1, $2, $3)
      on conflict (kind, key) do update set vehicle_id = excluded.vehicle_id, set_by = excluded.set_by, set_at = now()`, [String(spaceId), vehicleId, actorId]);
  } else {
    await db.query(`delete from docsend.vehicle_map where kind = 'space' and key = $1`, [String(spaceId)]);
  }
  await applyVehicleMap(db);
}

/** The Spaces seen, with their vehicle and visit counts, for Settings → Connections. */
export async function listSpaces(x?: Queryable): Promise<DocsendSpace[]> {
  const rows = await (await q(x)).query<{ space_id: string; name: string; read_at: string | null; vehicle_id: string | null; vehicle_name: string | null; visits: string; viewers: string }>(
    `select s.space_id::text, s.name, s.read_at, m.vehicle_id::text, pv.name vehicle_name,
            (select count(*) from docsend.visit v where v.space_id = s.space_id and not v.internal) visits,
            (select count(distinct v.viewer_email) from docsend.visit v where v.space_id = s.space_id and not v.internal) viewers
       from docsend.space s
       left join docsend.vehicle_map m on m.kind = 'space' and m.key = s.space_id::text
       left join platform.vehicle pv on pv.id = m.vehicle_id
      order by s.name`);
  return rows.map((r) => ({ spaceId: Number(r.space_id), name: r.name, readAt: d(r.read_at), vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, visits: Number(r.visits), viewers: Number(r.viewers) }));
}

/**
 * Every visit mapped to a vehicle, newest first, for the conversion page (docs/33) and LP timelines. Our team's
 * own visits are left out. `asOf` is the oldest complete read across the vehicle's Spaces, or null if none has
 * finished. Fields DocSend did not give are null, never zero.
 */
export async function visitsFor(vehicleId: string, x?: Queryable): Promise<VisitsFor> {
  const db = await q(x);
  const rows = await db.query<Record<string, unknown>>(`select visit_id, source, started_at, duration_sec, pages_viewed, page_count, percent_viewed,
        page_seconds, viewer_email, entity_id::text, link_name, document_id::text, document_title, space_id::text, space_name, vehicle_id::text
      from docsend.visit where vehicle_id = $1 and not internal order by started_at desc`, [vehicleId]);
  const asOf = await db.one<{ t: string | null }>(`select min(s.read_through) t from docsend.space s
      join docsend.vehicle_map m on m.kind = 'space' and m.key = s.space_id::text where m.vehicle_id = $1`, [vehicleId]);
  const visits = rows.map((r): DocsendVisit => ({
    visitId: String(r.visit_id), source: 'mcp', startedAt: d(r.started_at)!,
    durationSec: num(r.duration_sec), pagesViewed: num(r.pages_viewed), pageCount: num(r.page_count), percentViewed: num(r.percent_viewed),
    pageSeconds: (r.page_seconds as Record<string, number> | null) ?? null,
    viewerEmail: (r.viewer_email as string | null) ?? null, entityId: (r.entity_id as string | null) ?? null,
    linkId: null, linkName: (r.link_name as string | null) ?? null,
    documentId: (r.document_id as string | null) ?? null, documentTitle: (r.document_title as string | null) ?? null,
    spaceId: (r.space_id as string | null) ?? null, spaceName: (r.space_name as string | null) ?? null,
    vehicleId: String(r.vehicle_id),
  }));
  return { visits, asOf: d(asOf?.t) };
}

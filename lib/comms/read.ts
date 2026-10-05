import { getDb, type Queryable } from '@/lib/db';
import { aboutThisRaise, raiseWindows, touchpointsByPair, touchpointsFor, type Touchpoint } from '@/modules/meetings';
import { mergeTrace, type CommsLink, type CommsMessage, type Merged } from './trace';

/**
 * The comms trace from the database (lib/comms/trace.ts is the pure merge): the Gmail messages juanmail
 * reported for a set of LPs, read through the same reach as their touchpoints — the LP, the contacts on
 * their pursuit (their own), and their firm (summed apart) — and the links juanmail made.
 */

type MessageRow = {
  for_entity: string; message_id: string; has_message_id: boolean; gmail_id: string | null; thread_id: string | null;
  sent_at: Date | string; direction: 'ours' | 'theirs'; from_addr: string; to_addrs: string[]; cc_addrs: string[]; subject: string | null;
  pursuit_id: string | null; vehicle_id: string | null; vehicle_name: string | null; about: 'raise' | 'other' | null;
  about_vehicles: string[] | null; about_basis: string | null; mailbox_of: string; own: boolean; contact_name: string | null;
  via_name: string | null; entity_name: string;
};

const REACH = `
  with lp as (select unnest($1::uuid[]) as entity_id),
  reach as (
    select lp.entity_id as for_entity, identity.canonical_entity_id(lp.entity_id) as entity_id, 'own' as how from lp
    union
    select lp.entity_id, identity.canonical_entity_id(a.org_entity), 'firm' from identity.affiliation a
      join lp on identity.canonical_entity_id(lp.entity_id) = identity.canonical_entity_id(a.person_entity) where a.ended_on is null
    union
    select lp.entity_id, identity.canonical_entity_id(c.person_entity), 'contact' from strategy.pursuit_contact c
      join strategy.active_pursuit p on p.pursuit_id = c.pursuit_id
      join lp on identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id(lp.entity_id)
  ),
  hits as (
    select r.for_entity, m.message_id,
           bool_or(r.how <> 'firm') own,
           min(case when r.how = 'contact' and r.entity_id <> identity.canonical_entity_id(r.for_entity) then r.entity_id::text end) contact_id,
           min(case when r.how = 'firm' then r.entity_id::text end) firm_id
      from email.comms_message m cross join lateral unnest(m.entity_ids) x(id)
      join reach r on r.entity_id = identity.canonical_entity_id(x.id)
     group by r.for_entity, m.message_id
  )`;

/** Who on the team an address belongs to, by name. */
export async function teamAddresses(q: Queryable): Promise<Map<string, string>> {
  const rows = await q.query<{ email: string; name: string }>(`select lower(trim(email)) email, name from platform.app_user
    where coalesce(trim(email), '') <> '' and role <> 'system'`);
  return new Map(rows.map((r) => [r.email, r.name]));
}

/** The Gmail messages for each LP, read for that LP. */
export async function commsFor(entityIds: string[], q?: Queryable): Promise<Map<string, CommsMessage[]>> {
  const out = new Map<string, CommsMessage[]>();
  if (!entityIds.length) return out;
  const db = q ?? await getDb();
  const [rows, team] = await Promise.all([
    db.query<MessageRow>(`${REACH}
      select h.for_entity::text, m.message_id, m.has_message_id, m.gmail_id, m.thread_id, m.sent_at, m.direction, m.from_addr, m.to_addrs, m.cc_addrs,
             m.subject, m.pursuit_id::text, p.vehicle_id::text, v.name vehicle_name, m.about, m.about_vehicles, m.about_basis, u.name mailbox_of, h.own,
             ce.display_name contact_name, fe.display_name via_name, le.display_name entity_name
        from hits h join email.comms_message m on m.message_id = h.message_id
        join platform.app_user u on u.id = m.mailbox_of
        join identity.entity le on le.entity_id = identity.canonical_entity_id(h.for_entity)
        left join strategy.pursuit p on p.pursuit_id = strategy.canonical_pursuit_id(m.pursuit_id)
        left join platform.vehicle v on v.id = p.vehicle_id
        left join identity.entity ce on ce.entity_id = h.contact_id::uuid
        left join identity.entity fe on fe.entity_id = h.firm_id::uuid
       order by m.sent_at, m.message_id`, [entityIds]),
    teamAddresses(db),
  ]);
  for (const r of rows) {
    const addresses = [r.from_addr, ...r.to_addrs, ...r.cc_addrs].map((a) => a.toLowerCase());
    const m: CommsMessage = {
      messageId: r.message_id, hasMessageId: r.has_message_id, gmailId: r.gmail_id, threadId: r.thread_id, sentAt: new Date(r.sent_at),
      direction: r.direction, from: r.from_addr, to: r.to_addrs, cc: r.cc_addrs, subject: r.subject,
      entityId: r.for_entity, entityName: r.entity_name,
      viaOrganization: r.own ? null : r.via_name ?? 'their firm', viaContact: r.own ? r.contact_name : null,
      pursuitId: r.pursuit_id, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
      about: r.about, aboutVehicles: r.about_vehicles ?? [], aboutBasis: r.about_basis,
      team: [...new Set(addresses.map((a) => team.get(a)).filter((x): x is string => !!x))],
      mailboxOf: r.mailbox_of,
    };
    // The sender first: "who holds the thread" reads the first name on our own message.
    if (m.direction === 'ours') { const s = team.get(r.from_addr.toLowerCase()); if (s) m.team = [s, ...m.team.filter((x) => x !== s)]; }
    out.set(r.for_entity, [...(out.get(r.for_entity) ?? []), m]);
  }
  return out;
}

/** juanmail's links for these pursuits' LPs, on every pursuit of theirs. */
export async function linksFor(entityIds: string[], q?: Queryable): Promise<Map<string, CommsLink[]>> {
  const out = new Map<string, CommsLink[]>();
  if (!entityIds.length) return out;
  const db = q ?? await getDb();
  const rows = await db.query<{ entity: string; message_id: string; sent_at: Date | string; direction: 'ours' | 'theirs'; subject: string | null;
    pursuit_id: string; ticket_id: string | null; linked_by: string; autonomous: boolean; linked_at: Date | string }>(`
    select identity.canonical_entity_id(p.entity_id)::text entity, l.message_id, l.sent_at, l.direction, l.subject, l.pursuit_id::text,
           l.ticket_id::text, u.name linked_by, l.autonomous, l.linked_at
      from email.message_link l join strategy.pursuit p on p.pursuit_id = strategy.canonical_pursuit_id(l.pursuit_id)
      join platform.app_user u on u.id = l.linked_by
     where identity.canonical_entity_id(p.entity_id) = any(select identity.canonical_entity_id(x) from unnest($1::uuid[]) x)
     order by l.sent_at, l.message_id`, [entityIds]);
  const canon = new Map((await db.query<{ id: string; c: string }>('select x::text id, identity.canonical_entity_id(x)::text c from unnest($1::uuid[]) x', [entityIds])).map((r) => [r.c, r.id]));
  for (const r of rows) {
    const key = canon.get(r.entity) ?? r.entity;
    out.set(key, [...(out.get(key) ?? []), {
      messageId: r.message_id, sentAt: new Date(r.sent_at), direction: r.direction, subject: r.subject, pursuitId: r.pursuit_id,
      ticketId: r.ticket_id, linkedByName: r.linked_by, autonomous: r.autonomous, linkedAt: new Date(r.linked_at),
    }]);
  }
  return out;
}

export interface LpTrace extends Merged { messages: CommsMessage[]; links: CommsLink[] }

/** One LP's whole trace, about anything (the LP page's timeline). */
export async function traceFor(entityId: string, touches?: Touchpoint[]): Promise<LpTrace> {
  const [t, messages, links] = await Promise.all([
    touches ? Promise.resolve(touches) : touchpointsFor(entityId, null), commsFor([entityId]), linksFor([entityId]),
  ]);
  const m = messages.get(entityId) ?? [];
  const l = links.get(entityId) ?? [];
  return { ...mergeTrace(t, m, l), messages: m, links: l };
}

/**
 * Many pursuits' traces at once, keyed `${entityId}:${vehicleId}` (the queue): each pair's touchpoints about
 * that vehicle, merged with the LP's Gmail messages, keeping a message as its own row only when it is about
 * that vehicle's raise — the same rule as a touchpoint (N59, N81).
 */
export async function tracePairs(pairs: Array<{ entityId: string; vehicleId: string }>): Promise<Map<string, Merged>> {
  const out = new Map<string, Merged>();
  if (!pairs.length) return out;
  const entities = [...new Set(pairs.map((p) => p.entityId))];
  const [touches, messages, links, windows] = await Promise.all([touchpointsByPair(pairs), commsFor(entities), linksFor(entities), raiseWindows()]);
  for (const p of pairs) {
    const key = `${p.entityId}:${p.vehicleId}`;
    const w = windows.get(p.vehicleId);
    const merged = mergeTrace(touches.get(key) ?? [], messages.get(p.entityId) ?? [], links.get(p.entityId) ?? []);
    merged.touches = merged.touches.filter((t) => t.source !== 'gmail' || (w ? aboutThisRaise(t, w) : !t.vehicleId || t.vehicleId === p.vehicleId));
    out.set(key, merged);
  }
  return out;
}

/** Linear issues a person linked to this pursuit (docs/24 §4): the trace's notes from Linear, read-only. */
export interface LinearItem { id: string; identifier: string | null; title: string | null; url: string | null; createdAt: Date | null; completedAt: Date | null }
export async function linearFor(pursuitId: string, q?: Queryable): Promise<LinearItem[]> {
  const db = q ?? await getDb();
  return (await db.query<{ id: string; identifier: string | null; title: string | null; url: string | null; created_at: Date | string | null; completed_at: Date | string | null }>(
    `select i.id, i.identifier, i.title, i.url, i.created_at, i.completed_at
       from linear.link l join linear.issue i on i.id = l.linear_id
      where l.target_kind = 'pursuit' and l.linear_kind = 'issue' and l.status = 'accepted' and l.target_id = $1 and i.archived_at is null
      order by coalesce(i.completed_at, i.created_at) desc nulls last, i.id`, [pursuitId]))
    .map((r) => ({ id: r.id, identifier: r.identifier, title: r.title, url: r.url, createdAt: r.created_at ? new Date(r.created_at) : null, completedAt: r.completed_at ? new Date(r.completed_at) : null }));
}

import { getDb, type Queryable } from '@/lib/db';

/** What the mail desk reads back about an entity (docs/27 §5c): its send-to address, its relation, a person's links. */

export const RELATIONS = ['portfolio-company', 'prospect-company', 'service-provider', 'other'] as const;
export type Relation = (typeof RELATIONS)[number];
export const LINK_ROLES = ['team', 'assistant'] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

export interface SendTo { email: string; setBy: string; setAt: string }

/** Each canonical entity's send-to address, through merges: the latest one set on any of its records. */
export async function sendToFor(ids: string[], q?: Queryable): Promise<Map<string, SendTo>> {
  const out = new Map<string, SendTo>();
  if (!ids.length) return out;
  const db = q ?? (await getDb());
  const rows = await db.query<{ id: string; email: string; set_by: string; set_at: Date | string }>(`
    select distinct on (p.canonical_id) p.canonical_id::text id, s.email, u.handle set_by, s.set_at
      from identity.alias_pairs($1::uuid[]) p join identity.send_to s on s.entity_id = p.entity_id
      join platform.app_user u on u.id = s.set_by
     order by p.canonical_id, s.set_at desc`, [[...new Set(ids)]]);
  for (const r of rows) out.set(r.id, { email: r.email, setBy: r.set_by, setAt: new Date(r.set_at).toISOString() });
  return out;
}

/**
 * The send-to address the latest change replaced or cleared, from the audit log (red team, 17 Oct 2026): who set it and
 * when, and who replaced it, so a person can put it back. Null when nothing was replaced, or it is the current one again.
 */
export interface PreviousSendTo { email: string; setBy: string | null; setAt: string; replacedBy: string | null; replacedAt: string; autonomous: boolean }
export async function previousSendTo(entityId: string, q?: Queryable): Promise<PreviousSendTo | null> {
  const db = q ?? (await getDb());
  const r = await db.one<{ previous: { email: string; setBy: string; setAt: string }; autonomous: boolean | null; at: Date | string; by: string | null; set_by: string | null }>(`
    select a.detail->'previous' previous, (a.detail->>'autonomous')::boolean autonomous, a.at, u.name by, su.name set_by
      from platform.audit_log a left join platform.app_user u on u.id = a.actor_id
      left join platform.app_user su on su.id::text = a.detail->'previous'->>'setBy'
     where a.action in ('contact.send_to_set', 'contact.send_to_cleared') and a.subject_type = 'entity'
       and a.subject_id = any(select x::text from unnest(identity.alias_ids(array[$1::uuid])) x)
     order by a.id desc limit 1`, [entityId]);
  if (!r?.previous?.email) return null;
  const now = (await sendToFor([entityId], db)).values().next().value;
  if (now?.email === r.previous.email) return null;
  return { email: r.previous.email, setBy: r.set_by, setAt: r.previous.setAt, replacedBy: r.by, replacedAt: new Date(r.at).toISOString(), autonomous: !!r.autonomous };
}

/** What each canonical entity is to us: a relation set here, else a portfolio company, else an LP, else nothing known. */
export async function relationsFor(ids: string[], q?: Queryable): Promise<Map<string, Relation | 'lp'>> {
  const out = new Map<string, Relation | 'lp'>();
  if (!ids.length) return out;
  const db = q ?? (await getDb());
  const wanted = [...new Set(ids)];
  const [set, portfolio, lps] = await Promise.all([
    db.query<{ id: string; relation: Relation }>(`select distinct on (p.canonical_id) p.canonical_id::text id, r.relation
      from identity.alias_pairs($1::uuid[]) p join identity.entity_relation r on r.entity_id = p.entity_id order by p.canonical_id, r.set_at desc`, [wanted]),
    db.query<{ id: string }>(`select distinct p.canonical_id::text id from identity.alias_pairs($1::uuid[]) p
      join network.portfolio n on n.company_entity = p.entity_id`, [wanted]),
    db.query<{ id: string }>(`select distinct p.canonical_id::text id from identity.alias_pairs($1::uuid[]) p
      join strategy.active_pursuit s on s.entity_id = p.entity_id`, [wanted]),
  ]);
  for (const r of lps) out.set(r.id, 'lp');
  for (const r of portfolio) out.set(r.id, 'portfolio-company');
  for (const r of set) out.set(r.id, r.relation);
  return out;
}

export interface Link { role: LinkRole; entityId: string; name: string }

/** Each canonical person's open team and assistant links, as the mail desk records them. */
export async function linksFor(ids: string[], q?: Queryable): Promise<Map<string, Link[]>> {
  const out = new Map<string, Link[]>();
  if (!ids.length) return out;
  const db = q ?? (await getDb());
  const rows = await db.query<{ id: string; role: LinkRole; org: string; name: string }>(`
    select distinct p.canonical_id::text id, a.role, o.entity_id::text org, o.display_name name
      from identity.alias_pairs($1::uuid[]) p join identity.affiliation a on a.person_entity = p.entity_id
      join identity.entity o on o.entity_id = identity.canonical_entity_id(a.org_entity)
     where a.ended_on is null and a.source = 'mail_desk' and a.role = any($2::text[])
     order by 1, 2, 4`, [[...new Set(ids)], [...LINK_ROLES]]);
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), { role: r.role, entityId: r.org, name: r.name }]);
  return out;
}


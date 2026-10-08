import { getDb } from '@/lib/db';

export interface LpContact { entityId: string; name: string; role: string }

/** The people who speak for an LP unit. An affiliation is capacity, never a new tie. */
export async function lpContactsFor(
  entityIds: string[], vehicleId?: string, options: { excludeDakota?: boolean } = {},
): Promise<Map<string, LpContact[]>> {
  const result = new Map<string, LpContact[]>();
  if (!entityIds.length) return result;
  const rows = await (await getDb()).query<{ org: string; person: string; name: string; role: string | null }>(`
    with wanted as (
      -- Most ids are already canonical: only a merged one walks its chain (8 Oct 2026; the network's
      -- contact signature asks this of every organisation, ~25,000 calls on the live data).
      select distinct e.entity_id from unnest($1::uuid[]) x(id)
        join identity.entity s on s.entity_id=x.id
        join identity.entity e on e.entity_id=case when s.merged_into is null then s.entity_id else identity.canonical_entity_id(s.entity_id) end
       where e.entity_type <> 'person'
    ),
    -- Every alias of the wanted units first, so the joins below are index probes (7 Oct 2026).
    wa as (select * from identity.alias_pairs(array(select entity_id from wanted))),
    contacts as (
      select w.entity_id org, identity.canonical_entity_id(c.person_entity) person, c.role, 0 priority
        from wanted w join wa on wa.canonical_id=w.entity_id join strategy.active_pursuit p on p.entity_id=wa.entity_id
        join strategy.pursuit_contact c using(pursuit_id)
       where ($2::uuid is null or p.vehicle_id=$2::uuid)
         and (not $3::boolean or c.source is distinct from 'dakota')
      union all
      select w.entity_id, identity.canonical_entity_id(a.person_entity), a.role, 1
        from wanted w join wa on wa.canonical_id=w.entity_id join identity.affiliation a on a.org_entity=wa.entity_id
       where a.ended_on is null and a.is_primary and a.kind in ('principal','decision_maker','staff','contact')
         and coalesce(a.role,'') !~* '\\m(board|adviser|advisor|advisory|investor|limited partner)\\M'
         and (not $3::boolean or (a.source is distinct from 'dakota' and not exists (
           select 1 from identity.source_record s where s.source='dakota'
             and s.entity_id in (select x.entity_id from wa x where x.canonical_id=w.entity_id))))
    )
    select distinct on (c.org,c.person) c.org::text, c.person::text, e.display_name name, c.role
      from contacts c join identity.entity e on e.entity_id=c.person and e.entity_type='person'
     order by c.org,c.person,c.priority,c.role nulls last`, [entityIds, vehicleId ?? null, options.excludeDakota ?? false]);
  for (const row of rows) {
    const contacts = result.get(row.org) ?? [];
    contacts.push({ entityId: row.person, name: row.name, role: row.role?.trim() || 'pursuit contact' });
    result.set(row.org, contacts);
  }
  return result;
}

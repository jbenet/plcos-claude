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
      select distinct e.entity_id from unnest($1::uuid[]) x(id)
        join identity.entity e on e.entity_id=identity.canonical_entity_id(x.id)
       where e.entity_type <> 'person'
    ), contacts as (
      select w.entity_id org, identity.canonical_entity_id(c.person_entity) person, c.role, 0 priority
        from wanted w join strategy.active_pursuit p on identity.canonical_entity_id(p.entity_id)=w.entity_id
        join strategy.pursuit_contact c using(pursuit_id)
       where ($2::uuid is null or p.vehicle_id=$2::uuid)
         and (not $3::boolean or c.source is distinct from 'dakota')
      union all
      select w.entity_id, identity.canonical_entity_id(a.person_entity), a.role, 1
        from wanted w join identity.affiliation a on identity.canonical_entity_id(a.org_entity)=w.entity_id
       where a.ended_on is null and a.is_primary and a.kind in ('principal','decision_maker','staff','contact')
         and coalesce(a.role,'') !~* '\\m(board|adviser|advisor|advisory|investor|limited partner)\\M'
         and (not $3::boolean or (a.source is distinct from 'dakota' and not exists (
           select 1 from identity.source_record s where s.source='dakota'
             and identity.canonical_entity_id(s.entity_id)=w.entity_id)))
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

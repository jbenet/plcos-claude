import { getDb } from '@/lib/db';

export type RelationshipRole = 'lp' | 'co_funder' | 'connector' | 'funder' | 'prospect' | 'team';

export const ROLE_LABEL: Record<RelationshipRole, string> = {
  lp: 'LP',
  co_funder: 'Co-funder',
  connector: 'Connector',
  funder: 'Grant funder',
  prospect: 'Prospect',
  team: 'Team',
};

export interface RelationshipRow {
  entityId: string;
  name: string;
  entityType: string;
  roles: RelationshipRole[];
  /** Hard money on file, across every vehicle. Never summed into a headline. */
  hard: number;
  soft: number;
  vehicles: string[];
  connectorAsks: number;
  rung: string | null;
  /** Their furthest status across vehicles (N62); Passed only when every pursuit passed. */
  status: string | null;
}

/**
 * Who someone is to us, derived rather than declared.
 *
 * A person is an LP because money is on file, a connector because asks have gone through
 * them, a funder because they appear on the grants rail. Nobody types a role in, which is
 * why the list cannot drift from what actually happened.
 */
export async function relationshipRoles(): Promise<RelationshipRow[]> {
  const db = await getDb();
  const rows = await db.query<{
    entity_id: string; name: string; entity_type: string;
    hard: string; soft: string; vehicles: string[] | null;
    connector_asks: string; is_team: boolean; is_funder: boolean;
    is_coinvestor: boolean; rung: string | null; status: string | null;
  }>(
    `select e.entity_id, e.display_name as name, e.entity_type::text as entity_type,
            coalesce(sum(x.amount) filter (where x.track = 'hard'), 0)::text as hard,
            coalesce(sum(x.amount) filter (where x.track = 'soft'), 0)::text as soft,
            array_remove(array_agg(distinct v.name), null) as vehicles,
            (select count(*) from coordination.ask a
              where a.connector_id = e.entity_id and a.made_at is not null)::text as connector_asks,
            exists (select 1 from identity.source_record s
                     where s.entity_id = e.entity_id and s.source = 'app_user') as is_team,
            exists (select 1 from grants.funder f where f.entity_id = e.entity_id) as is_funder,
            exists (select 1 from network.edge n
                     where n.kind = 'coinvestor'
                       and (n.from_entity = e.entity_id or n.to_entity = e.entity_id)) as is_coinvestor,
            (select l.rung::text from strategy.pursuit p
               join strategy.ladder_event l on l.pursuit_id = p.pursuit_id
              where p.entity_id = e.entity_id
              order by l.occurred_at desc limit 1) as rung,
            (select p.status::text from strategy.pursuit p
              where p.entity_id = e.entity_id
              order by (p.status = 'passed'), p.status desc limit 1) as status
       from identity.entity e
       left join pipeline.exposure x on x.entity_id = e.entity_id and x.closed_at is null
       left join platform.vehicle v on v.id = x.vehicle_id
      where e.merged_into is null and e.retired_at is null
      group by e.entity_id, e.display_name, e.entity_type
      order by coalesce(sum(x.amount) filter (where x.track = 'hard'), 0) desc, e.display_name`,
  );

  return rows.map((r) => {
    const hard = Number(r.hard);
    const soft = Number(r.soft);
    const roles: RelationshipRole[] = [];
    if (r.is_team) roles.push('team');
    if (hard > 0) roles.push('lp');
    if (r.is_funder) roles.push('funder');
    if (r.is_coinvestor) roles.push('co_funder');
    if (Number(r.connector_asks) > 0) roles.push('connector');
    if (roles.length === 0 || (soft > 0 && !roles.includes('lp'))) roles.push('prospect');
    return {
      entityId: r.entity_id, name: r.name, entityType: r.entity_type, roles,
      hard, soft, vehicles: r.vehicles ?? [],
      connectorAsks: Number(r.connector_asks), rung: r.rung, status: r.status,
    };
  });
}

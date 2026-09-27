import { getDb } from '@/lib/db';

export type RelationshipRole = 'lp' | 'co_funder' | 'connector' | 'funder' | 'prospect' | 'team';
export const ROLE_LABEL: Record<RelationshipRole, string> = {
  lp: 'LP', co_funder: 'Co-funder', connector: 'Connector', funder: 'Grant funder', prospect: 'Prospect', team: 'Team',
};
export interface RelationshipRow {
  entityId: string; name: string; entityType: string; roles: RelationshipRole[];
  /** Per actor only, never an aggregate headline across vehicles. */
  hard: number; soft: number; vehicles: string[]; connectorAsks: number;
  rung: string | null; status: string | null;
}
export const RELATIONSHIP_PAGE_SIZE = 100;
export type RelationshipGroup = 'all' | 'people' | 'firms' | 'lps' | 'co-funders' | 'connectors';
const filters: Record<RelationshipGroup, string> = {
  all: 'true', people: "entity_type = 'person'", firms: "entity_type <> 'person'",
  lps: 'hard > 0', 'co-funders': '(is_coinvestor or is_funder)', connectors: 'connector_asks > 0',
};
/** Resolve each fact once, rather than each fact once per entity. Materialized sets
 * keep the optimizer from inlining canonical lookups into a 94K-row nested loop. */
const FACTS = `with money as materialized (
  select identity.canonical_entity_id(x.entity_id) entity_id,
    coalesce(sum(x.amount) filter(where x.track = 'hard'),0) hard,
    coalesce(sum(x.amount) filter(where x.track = 'soft'),0) soft,
    array_agg(distinct v.name) vehicles
  from pipeline.exposure x join platform.vehicle v on v.id = x.vehicle_id
  where x.closed_at is null group by identity.canonical_entity_id(x.entity_id)
), asks as materialized (
  select identity.canonical_entity_id(connector_id) entity_id, count(*) connector_asks
  from coordination.ask where made_at is not null group by identity.canonical_entity_id(connector_id)
), team as materialized (
  select distinct identity.canonical_entity_id(entity_id) entity_id from identity.source_record where source = 'app_user'
), funders as materialized (
  select distinct identity.canonical_entity_id(entity_id) entity_id from grants.funder
), coinvestors as materialized (
  select distinct identity.canonical_entity_id(id) entity_id from (
    select from_entity id from network.edge where kind = 'coinvestor'
    union select to_entity from network.edge where kind = 'coinvestor'
  ) ids
), base as materialized (
  select e.entity_id, e.display_name name, e.entity_type::text entity_type,
    coalesce(m.hard,0) hard, coalesce(m.soft,0) soft, m.vehicles,
    coalesce(a.connector_asks,0) connector_asks, t.entity_id is not null is_team,
    f.entity_id is not null is_funder, c.entity_id is not null is_coinvestor
  from identity.entity e left join money m using(entity_id) left join asks a using(entity_id)
  left join team t using(entity_id) left join funders f using(entity_id) left join coinvestors c using(entity_id)
  where e.merged_into is null and e.retired_at is null
)`;
type Row = { entity_id: string; name: string; entity_type: string; hard: string; soft: string;
  vehicles: string[] | null; connector_asks: string; is_team: boolean; is_funder: boolean; is_coinvestor: boolean;
  rung: string | null; status: string | null };
const map = (r: Row): RelationshipRow => {
  const hard = Number(r.hard), soft = Number(r.soft), roles: RelationshipRole[] = [];
  if (r.is_team) roles.push('team');
  if (hard > 0) roles.push('lp');
  if (r.is_funder) roles.push('funder');
  if (r.is_coinvestor) roles.push('co_funder');
  if (Number(r.connector_asks) > 0) roles.push('connector');
  if (!roles.length || (soft > 0 && !roles.includes('lp'))) roles.push('prospect');
  return { entityId:r.entity_id, name:r.name, entityType:r.entity_type, roles, hard, soft,
    vehicles:r.vehicles ?? [], connectorAsks:Number(r.connector_asks), rung:r.rung, status:r.status };
};
/** All list reads have a SQL limit; detail callers pass just the requested identity. */
export async function relationshipRoles(ids?: string[], group: RelationshipGroup = 'all', offset = 0): Promise<RelationshipRow[]> {
  if (ids?.length === 0) return [];
  const db = await getDb();
  const rows = await db.query<Row>(`${FACTS}, shown as materialized (
    select * from base where ${ids ? 'entity_id = any($1::uuid[])' : `not is_team and ${filters[group]} and $1::uuid[] is null`}
    order by hard desc, name, entity_id limit ${RELATIONSHIP_PAGE_SIZE} offset $2
  ), pursuits as materialized (
    select p.*, identity.canonical_entity_id(p.entity_id) canonical_id from strategy.active_pursuit p
  ) select s.*,
    (select l.rung::text from pursuits p join strategy.ladder_event l using(pursuit_id)
      where p.canonical_id = s.entity_id order by l.occurred_at desc limit 1) rung,
    (select p.status::text from pursuits p where p.canonical_id = s.entity_id
      order by (p.status = 'passed'), p.status desc limit 1) status
  from shown s order by hard desc, name, entity_id`, [ids ?? null, Math.max(0, Math.floor(offset))]);
  return rows.map(map);
}
export async function relationshipCounts() {
  const db = await getDb();
  return (await db.one<Record<RelationshipGroup | RelationshipRole, number>>(`${FACTS}
    select count(*) filter(where not is_team)::int "all",
      count(*) filter(where not is_team and entity_type = 'person')::int people,
      count(*) filter(where not is_team and entity_type <> 'person')::int firms,
      count(*) filter(where not is_team and hard > 0)::int lps,
      count(*) filter(where not is_team and (is_coinvestor or is_funder))::int "co-funders",
      count(*) filter(where not is_team and connector_asks > 0)::int connectors,
      count(*) filter(where hard > 0)::int lp,
      count(*) filter(where is_coinvestor)::int co_funder,
      count(*) filter(where is_funder)::int funder,
      count(*) filter(where connector_asks > 0)::int connector,
      count(*) filter(where is_team)::int team,
      count(*) filter(where (not is_team and hard <= 0 and not is_funder and not is_coinvestor and connector_asks = 0)
        or (soft > 0 and hard <= 0))::int prospect from base`))!;
}

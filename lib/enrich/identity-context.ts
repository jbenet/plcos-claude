import type { Queryable } from '@/lib/db';

// Keep these lookups shared with the duplicate preview: export executes both paths.
// Each arm has an indexable equality. Exclusions preserve the old OR join's one
// row per source-record/raw-record pair when more than one arm matches.
export const identityRawContextSql = `select s.entity_id::text id,r.payload
  from identity.source_record s cross join lateral (
    select r.payload from sources.raw_record r
      where r.source=s.source and r.source_id=s.source_id
    union all
    select r.payload from sources.raw_record r
      where s.source='affinity' and r.source='affinity'
        and r.kind||':'||r.source_id=s.source_id and r.source_id<>s.source_id
    union all
    select r.payload from sources.raw_record r
      where s.source='affinity' and r.source='affinity' and r.kind='list_entry'
        and (r.payload->>'type')||':'||(r.payload->'entity'->>'id')=s.source_id
        and r.source_id<>s.source_id and r.kind||':'||r.source_id<>s.source_id
  ) r where s.entity_id=any($1::uuid[])`;

// Materialize only incident edges before expanding JSON evidence. A self-edge
// occurs in both arms, then DISTINCT preserves the original affiliation set.
export const identityGraphContextSql = `with candidates as materialized (
    select e.from_entity id,e.to_entity other,e.kind,e.evidence
      from network.edge e where e.from_entity=any($1::uuid[])
    union all
    select e.to_entity id,e.from_entity other,e.kind,e.evidence
      from network.edge e where e.to_entity=any($1::uuid[])
  ) select distinct e.id::text id,o.display_name org
    from candidates e join identity.entity o on o.entity_id=identity.canonical_entity_id(e.other)
    where o.entity_type='org' and (e.kind::text in ('same_firm','employment') or exists(
      select 1 from jsonb_array_elements(e.evidence) v
        where v->>'note' ~* 'affiliation|employment|employed by|works at'))`;

export const identityRawContext = (tx: Queryable, ids: string[]) =>
  tx.query<{ id: string; payload: unknown }>(identityRawContextSql, [ids]);
export const identityGraphContext = (tx: Queryable, ids: string[]) =>
  tx.query<{ id: string; org: string }>(identityGraphContextSql, [ids]);

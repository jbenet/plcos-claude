import type { Queryable } from '@/lib/db';

// Keep these lookups shared with the duplicate preview: export executes both paths.
// Each arm has an indexable equality. Exclusions preserve the old OR join's one
// row per source-record/raw-record pair when more than one arm matches.
export const identityRawContextSql = `select s.entity_id::text id,r.payload
  from identity.source_record s cross join lateral (
    select r.payload,r.kind,r.source_id,r.source_updated_at,r.fetched_at,r.id from sources.raw_record r
      where r.source=s.source and r.source_id=s.source_id
    union all
    select r.payload,r.kind,r.source_id,r.source_updated_at,r.fetched_at,r.id from sources.raw_record r
      where s.source='affinity' and r.source='affinity'
        and r.kind||':'||r.source_id=s.source_id and r.source_id<>s.source_id
    union all
    select r.payload,r.kind,r.source_id,r.source_updated_at,r.fetched_at,r.id from sources.raw_record r
      where s.source='affinity' and r.source='affinity' and r.kind='list_entry'
        and (r.payload->>'type')||':'||(r.payload->'entity'->>'id')=s.source_id
        and r.source_id<>s.source_id and r.kind||':'||r.source_id<>s.source_id
  ) r where s.entity_id=any($1::uuid[])`;

// Materialize only incident edges before expanding JSON evidence. A self-edge
// occurs in both arms, then DISTINCT preserves the original affiliation set.
export const identityGraphContextSql = `with candidates as materialized (
    select e.from_entity id,e.to_entity other,e.kind,e.evidence,e.valid_to,e.valid_from
      from network.edge e where e.from_entity=any($1::uuid[])
    union all
    select e.to_entity id,e.from_entity other,e.kind,e.evidence,e.valid_to,e.valid_from
      from network.edge e where e.to_entity=any($1::uuid[])
  ) select distinct e.id::text id,o.display_name org
    from candidates e join identity.entity o on o.entity_id=identity.canonical_entity_id(e.other)
    where o.entity_type='org' and (e.kind::text in ('same_firm','employment') or exists(
      select 1 from jsonb_array_elements(e.evidence) v
        where v->>'note' ~* 'affiliation|employment|employed by|works at'))`;

export const identityRawContext = (tx: Queryable, ids: string[], latestOnly = false) =>
  tx.query<{ id: string; payload: unknown }>(latestOnly
    ? identityRawContextSql.replace('select s.entity_id::text id,r.payload',
      'select distinct on (s.entity_id,s.source,r.kind,r.source_id) s.entity_id::text id,r.payload')
      + ' order by s.entity_id,s.source,r.kind,r.source_id,r.source_updated_at desc nulls last,r.fetched_at desc,r.id desc'
    : identityRawContextSql, [ids]);
export const identityGraphContext = (tx: Queryable, ids: string[], currentOnly = false) =>
  tx.query<{ id: string; org: string }>(identityGraphContextSql + (currentOnly ? ' and e.valid_to is null and (e.valid_from is null or e.valid_from<=now())' : ''), [ids]);

import { getDb, type Db } from '@/lib/db';
import type { Edge, EdgeKind, EvidenceTier } from './types';

type EdgeRow = {
  edge_id: string; from_entity: string; to_entity: string; from_name: string; to_name: string;
  kind: EdgeKind; tier: EvidenceTier; strength: string | null; tie_band: string | null;
  evidence: Edge['evidence']; reviewed_by_name: string | null;
  reviewed_at: Date | string | null; review_note: string | null;
  valid_from: Date | string; valid_to: Date | string | null;
};

const EDGE_SELECT = `
  select e.edge_id, e.from_entity, e.to_entity, f.display_name as from_name,
         t.display_name as to_name, e.kind, e.tier, e.strength, e.tie_band, e.evidence,
         u.name as reviewed_by_name, e.reviewed_at, e.review_note, e.valid_from, e.valid_to
    from network.edge e
    join identity.entity f on f.entity_id = e.from_entity
    join identity.entity t on t.entity_id = e.to_entity
    left join platform.app_user u on u.id = e.reviewed_by`;

const toEdge = (r: EdgeRow): Edge => ({
  edgeId: r.edge_id, fromEntity: r.from_entity, toEntity: r.to_entity,
  fromName: r.from_name, toName: r.to_name, kind: r.kind, tier: r.tier,
  strength: r.strength === null ? null : Number(r.strength), tieBand: r.tie_band,
  evidence: r.evidence ?? [], reviewedByName: r.reviewed_by_name,
  reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null, reviewNote: r.review_note,
  validFrom: new Date(r.valid_from), validTo: r.valid_to ? new Date(r.valid_to) : null,
});

export async function listEdges(): Promise<Edge[]> {
  const db = await getDb();
  return (await db.query<EdgeRow>(`${EDGE_SELECT} order by e.tier, f.display_name`)).map(toEdge);
}

export async function edgesByIds(ids: string[]): Promise<Map<string, Edge>> {
  if (ids.length === 0) return new Map();
  const db = await getDb();
  const rows = await db.query<EdgeRow>(`${EDGE_SELECT} where e.edge_id = any($1::uuid[])`, [ids]);
  return new Map(rows.map((r) => [r.edge_id, toEdge(r)]));
}

export interface RawPath {
  nodes: string[];
  edges: string[];
  hops: number;
}

/**
 * Enumerate up to 300 currently-valid paths from `fromEntity` to `targetEntity`, up to `maxHops`.
 *
 * Deliberately enumerates unusable paths too. A planner that silently drops the
 * proximity-only path returns an empty list, and an empty list reads as "no route exists"
 * while only justifying "no route in the material available". The caller labels them.
 */
export async function enumeratePaths(
  fromEntity: string, targetEntity: string, maxHops = 3,
): Promise<RawPath[]> {
  return enumeratePathsFromSources([fromEntity], targetEntity, maxHops);
}

/** Same 300 candidates per source (hops, edge IDs), sharing the target-side expansion.
 * Inline valid so each join can use the endpoint indexes; materializing the entire
 * bidirectional graph forces repeated scans of every edge even for a tiny target.
 * Short routes come first. Three-hop paths are read one first edge at a time in
 * UUID order, stopping at the remaining budget, rather than sorting millions of
 * complete paths and then discarding them. Prefixes must have a valid suffix so
 * an unreachable hub does not make the recursive walk visit every dead end.
 * Prefix arrays give the cursor positional access without rescanning a hub’s
 * complete adjacency at every step.
 * PL can start a route but can never be an intermediate connector.
 */
export async function enumeratePathsFromSources(
  fromEntities: string[], targetEntity: string, maxHops = 3, sourceOnlyEntities: string[] = [],
): Promise<RawPath[]> {
  if (!fromEntities.length) return [];
  const db = await getDb();
  return db.query<RawPath>(
    `with recursive pl as (
       select e.entity_id from identity.entity e join identity.source_record s on s.entity_id = e.entity_id
        where s.source = 'w3_person' and e.entity_type = 'org' and e.display_name = 'PL'
       union select unnest($4::uuid[])),
     valid as not materialized (
       select a, b, edge_id from network.link where valid_to is null or valid_to >= current_date),
     y as materialized (
       select l.a as y, l.edge_id as e3 from valid l
        where l.b = $2 and not exists (select 1 from pl where pl.entity_id = l.a)),
     sources as (select distinct unnest($1::uuid[]) as source),
     short as materialized (
       select sources.source, paths.* from sources cross join lateral (
         select * from (
           select array[l.a, l.b] as nodes, array[l.edge_id] as edges, 1 as hops
             from valid l where l.a = sources.source and l.b = $2
           union all
           select array[l.a, y.y, $2::uuid], array[l.edge_id, y.e3], 2
             from y join valid l on l.a = sources.source and l.b = y.y
            where $3 >= 2 and y.y <> l.a
         ) candidates order by hops, edges limit 300
       ) paths),
     prefixes as materialized (
       select l.a, array_agg(l.b order by l.edge_id) as nodes,
              array_agg(l.edge_id order by l.edge_id) as edges
         from valid l where l.a = any($1::uuid[]) and $3 >= 3
          and l.b <> l.a and l.b <> $2
          and not exists (select 1 from pl where pl.entity_id = l.b)
          and exists (select 1 from valid suffix join y on y.y = suffix.b
                       where suffix.a = l.b and y.y <> l.a and y.y <> l.b)
        group by l.a),
     walk as (
       select source, 0 as position, (select count(*) from short where short.source = sources.source) as used,
              '[]'::jsonb as batch from sources
       union all
       select w.source, w.position + 1, w.used + jsonb_array_length(next.batch), next.batch
         from walk w join prefixes p on p.a = w.source and w.position < cardinality(p.edges)
         cross join lateral (
           select coalesce(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb) as batch from (
             select array[p.a, p.nodes[w.position + 1], y.y, $2::uuid] as nodes,
                    array[p.edges[w.position + 1], l.edge_id, y.e3] as edges, 3 as hops
               from valid l join y on y.y = l.b
              where l.a = p.nodes[w.position + 1] and y.y <> p.a and y.y <> p.nodes[w.position + 1]
              order by l.edge_id, y.e3 limit (300 - w.used)
           ) candidate
         ) next
        where w.used < 300),
     paths as (
       select nodes, edges, hops from short
       union all
       select path.nodes, path.edges, path.hops from walk
         cross join lateral jsonb_to_recordset(walk.batch) as path(nodes uuid[], edges uuid[], hops int))
     select nodes, edges, hops from paths
      order by array_position($1::uuid[], nodes[1]), hops, edges`,
    [fromEntities, targetEntity, maxHops, sourceOnlyEntities],
  );
}

type Summary = {
  coverage: { edges: number; from: Date | null; to: Date | null };
  tiers: Array<{ tier: EvidenceTier; n: number; reviewed: number }>;
};
const summaries = new WeakMap<Db, { key: string; value: Promise<Summary> }>();

async function edgeSummary(): Promise<Summary> {
  const db = await getDb();
  // Include the database date: open-ended evidence coverage advances at midnight.
  const revision = await db.one<{ key: string }>(
    `select revision::text || ':' || current_date::text as key from network.edge_revision where singleton`);
  const key = revision!.key;
  const cached = summaries.get(db);
  if (cached?.key === key) return cached.value;
  const value = (async () => {
    const rows = await db.query<{
      tier: EvidenceTier; n: string; reviewed: string; from: Date | string | null; to: Date | string | null;
    }>(`select tier, count(*)::text as n, count(reviewed_by)::text as reviewed,
               min(valid_from) as from, max(coalesce(valid_to, current_date)) as to
          from network.edge group by tier order by tier`);
    const starts = rows.flatMap((r) => r.from ? [new Date(r.from).getTime()] : []);
    const ends = rows.flatMap((r) => r.to ? [new Date(r.to).getTime()] : []);
    return {
      coverage: { edges: rows.reduce((n, r) => n + Number(r.n), 0),
        from: starts.length ? new Date(Math.min(...starts)) : null,
        to: ends.length ? new Date(Math.max(...ends)) : null },
      tiers: rows.map((r) => ({ tier: r.tier, n: Number(r.n), reviewed: Number(r.reviewed) })),
    };
  })();
  summaries.set(db, { key, value });
  try { return await value; }
  catch (err) {
    if (summaries.get(db)?.value === value) summaries.delete(db);
    throw err;
  }
}

export async function edgeCoverage() {
  return (await edgeSummary()).coverage;
}

export async function tierCounts(): Promise<Array<{ tier: EvidenceTier; n: number; reviewed: number }>> {
  return (await edgeSummary()).tiers;
}

/** The entity that represents a member of the team. Linked through identity.source_record. */
export async function entityForUser(handle: string): Promise<{ entityId: string; name: string } | null> {
  const db = await getDb();
  const row = await db.one<{ entity_id: string; display_name: string }>(
    `select e.entity_id, e.display_name
       from identity.source_record s join identity.entity e on e.entity_id = s.entity_id
      where s.source = 'app_user' and s.source_id = $1`,
    [handle],
  );
  return row ? { entityId: row.entity_id, name: row.display_name } : null;
}

/** People on the active team plus the explicit PL organization source. */
export async function routeSources(): Promise<Array<{ entityId: string; name: string }>> {
  const db = await getDb();
  const rows = await db.query<{ id: string; name: string }>(
    `select distinct e.entity_id::text as id, e.display_name as name
       from identity.entity e join identity.source_record s on s.entity_id = e.entity_id
       left join platform.app_user u on s.source = 'app_user' and s.source_id = u.handle
      where (s.source = 'app_user' and u.active)
         or (s.source = 'w3_person' and e.entity_type = 'org' and e.display_name = 'PL')
      order by name`);
  return rows.map((r) => ({ entityId: r.id, name: r.name }));
}


/** Role evidence on the source/connector pair, including edges that did not fit a candidate path. */
export async function sourceEdges(sourceIds: string[], entityIds: string[]): Promise<Edge[]> {
  if (!sourceIds.length || !entityIds.length) return [];
  const db = await getDb();
  return (await db.query<EdgeRow>(`${EDGE_SELECT}
    where (e.valid_to is null or e.valid_to >= current_date)
      and ((e.from_entity = any($1::uuid[]) and e.to_entity = any($2::uuid[]))
        or (e.to_entity = any($1::uuid[]) and e.from_entity = any($2::uuid[])))`, [sourceIds, entityIds])).map(toEdge);
}

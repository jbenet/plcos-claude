import { getDb, type Db } from '@/lib/db';
import { withSharedDb } from '@/lib/db/scheduling';
import { edgeGrade } from './warmth';
import { graphSnapshot, pathsFromSnapshot, yieldRouteWork } from './path-search';
import type { Edge, EdgeKind, EvidenceTier } from './types';

type EdgeRow = {
  edge_id: string; from_entity: string; to_entity: string; from_name: string; to_name: string;
  kind: EdgeKind; tier: EvidenceTier; strength: string | null; tie_band: string | null;
  evidence: Edge['evidence']; reviewed_by_name: string | null;
  reviewed_at: Date | string | null; review_note: string | null;
  valid_from: Date | string; valid_to: Date | string | null;
};

const EDGE_SELECT = `
  select e.edge_id, f.entity_id as from_entity, t.entity_id as to_entity, f.display_name as from_name,
         t.display_name as to_name, e.kind::text as kind, e.tier::text as tier, e.strength::text as strength, e.tie_band::text as tie_band, e.evidence,
         u.name as reviewed_by_name, e.reviewed_at, e.review_note, e.valid_from, e.valid_to
    from network.edge e
    join identity.entity f on f.entity_id = identity.canonical_entity_id(e.from_entity)
    join identity.entity t on t.entity_id = identity.canonical_entity_id(e.to_entity)
    left join platform.app_user u on u.id = e.reviewed_by`;

/** Possible identity is an explicitly uncertain bridge, never a persisted relationship claim. */
const POSSIBLE_SELECT = `
  select p.edge_id, f.entity_id as from_entity, t.entity_id as to_entity,
         f.display_name as from_name, t.display_name as to_name, 'possible_identity' as kind,
         'D' as tier, p.confidence::text as strength, null::text as tie_band,
         jsonb_build_array(jsonb_build_object('doc', 'identity.possible_match:' || p.edge_id,
           'source', 'deterministic identity resolution', 'as_of', p.created_at::date::text,
           'note', 'Possible identity match: same normalized full name across sources without corroboration. These may be different people; no relationship or consent is established. Confidence ' || p.confidence::text,
           'tie', jsonb_build_object('kind', 'proximity'))) as evidence,
         null::text as reviewed_by_name, null::timestamptz as reviewed_at, null::text as review_note,
         p.created_at as valid_from, null::timestamptz as valid_to
    from identity.possible_match p
    join identity.entity f on f.entity_id = identity.canonical_entity_id(p.left_entity)
    join identity.entity t on t.entity_id = identity.canonical_entity_id(p.right_entity)
   where p.active and f.entity_id <> t.entity_id`;

/** Canonical identity of a requested node, including callers holding an old source ID. */
export async function canonicalRouteEntity(id: string): Promise<string> {
  return (await (await getDb()).one<{ id: string }>(
    'select identity.canonical_entity_id($1::uuid)::text as id', [id]))!.id;
}

const toEdge = (r: EdgeRow): Edge => ({
  edgeId: r.edge_id, fromEntity: r.from_entity, toEntity: r.to_entity,
  fromName: r.from_name, toName: r.to_name, kind: r.kind, tier: r.tier > 'B' ? r.tier : edgeGrade({ kind: r.kind, evidence: r.evidence ?? [] }),
  strength: r.strength === null ? null : Number(r.strength), tieBand: r.tie_band,
  evidence: r.evidence ?? [], reviewedByName: r.reviewed_by_name,
  reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null, reviewNote: r.review_note,
  validFrom: new Date(r.valid_from), validTo: r.valid_to ? new Date(r.valid_to) : null,
});

export async function listEdges(): Promise<Edge[]> {
  const db = await getDb();
  return (await db.query<EdgeRow>(`${EDGE_SELECT} union all ${POSSIBLE_SELECT} order by tier, from_name`)).map(toEdge);
}

type EvidenceEntry = { edge: Edge; bytes: number };
type EvidenceCache = { revision: string; entries: Map<string, EvidenceEntry>; bytes: number };
const evidenceCaches = new WeakMap<Db, EvidenceCache>();
const evidenceRevision = async (db: Db) => (await db.one<{ revision: string }>(
  "select revision::text || ':' || current_date::text as revision from network.route_revision where singleton"))!.revision;

/** Shared team edges recur across many targets. Retain a bounded, disposable evidence
 * LRU; topology, entity-label and reviewer changes all advance this revision. */
export async function edgesByIds(ids: string[]): Promise<Map<string, Edge>> {
  if (ids.length === 0) return new Map();
  const db = await getDb(), revision = await evidenceRevision(db);
  let cache = evidenceCaches.get(db);
  if (!cache || cache.revision !== revision) {
    cache = { revision, entries: new Map(), bytes: 0 }; evidenceCaches.set(db, cache);
  }
  const result = new Map<string, Edge>(), missing: string[] = [];
  for (const id of new Set(ids)) {
    const entry = cache.entries.get(id);
    if (entry) {
      cache.entries.delete(id); cache.entries.set(id, entry); result.set(id, entry.edge);
    } else missing.push(id);
  }
  for (let offset = 0; offset < missing.length; offset += 64) {
    const rows = await db.query<EdgeRow>(`${EDGE_SELECT} where e.edge_id = any($1::uuid[]) union all ${POSSIBLE_SELECT} and p.edge_id = any($1::uuid[])`, [missing.slice(offset, offset + 64)]);
    for (const row of rows) {
      const edge = toEdge(row), bytes = JSON.stringify(edge).length * 2;
      result.set(row.edge_id, edge);
      const previous = cache.entries.get(row.edge_id);
      if (previous) { cache.bytes -= previous.bytes; cache.entries.delete(row.edge_id); }
      cache.entries.set(row.edge_id, { edge, bytes }); cache.bytes += bytes;
      while (cache.entries.size > 8192 || cache.bytes > 16 * 1024 * 1024) {
        const first = cache.entries.keys().next().value!;
        cache.bytes -= cache.entries.get(first)!.bytes; cache.entries.delete(first);
      }
    }
    await yieldRouteWork();
  }
  // Do not return a mixture of generations if a network write ran during a yield.
  if (missing.length && await evidenceRevision(db) !== revision) return edgesByIds(ids);
  return result;
}

/** Search nodes already use canonical IDs; names need no whole identity projection. */
export async function routeNodeNames(ids: string[]): Promise<Array<{ entityId: string; displayName: string }>> {
  if (!ids.length) return [];
  const rows = await (await getDb()).query<{ entity_id: string; display_name: string }>(
    'select entity_id::text, display_name from identity.entity where entity_id = any($1::uuid[])', [ids]);
  return rows.map(r => ({ entityId: r.entity_id, displayName: r.display_name }));
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

/** Same 300 candidates per source, with bounded database reads and cooperative CPU slices. */
export async function enumeratePathsFromSources(
  fromEntities: string[], targetEntity: string, maxHops = 3, sourceOnlyEntities: string[] = [],
): Promise<RawPath[]> {
  if (!fromEntities.length) return [];
  const db = await getDb();
  const excluded = (await routeSources()).filter(s => s.sourceOnly);
  const graph = await graphSnapshot(db);
  const canonical = (id: string) => graph.canonicalIds?.get(id) ?? id;
  const pl = new Set(excluded.map(row=>canonical(row.entityId)));
  if (pl.has(canonical(targetEntity))) return [];
  const sources = fromEntities.map(canonical);
  const regular = await pathsFromSnapshot(graph, sources.filter(id=>!pl.has(id)), canonical(targetEntity), maxHops,
    new Set([...sourceOnlyEntities.map(canonical), ...pl]));
  const institutional = await pathsFromSnapshot(graph, sources.filter(id=>pl.has(id)), canonical(targetEntity), maxHops, pl);
  return [...regular,...institutional];
}

// Counts do not need a 437K-edge adjacency graph. Cache only four aggregate rows,
// under the same graph revision/date as graphSnapshot (never page contents).
const summaries = new WeakMap<Db, { key: string; value: Promise<{
  coverage: { edges: number; from: Date | null; to: Date | null };
  tiers: Array<{ tier: EvidenceTier; n: number; reviewed: number }>;
}> }>();
async function edgeSummary(): Promise<{ coverage: { edges: number; from: Date | null; to: Date | null }; tiers: Array<{ tier: EvidenceTier; n: number; reviewed: number }> }> {
  const db = await getDb();
  const key = (await db.one<{ key: string }>(`select revision::text || ':' || current_date::text as key
    from network.edge_revision where singleton`))!.key;
  const prior = summaries.get(db);
  if (prior?.key === key) return prior.value;
  const value = withSharedDb(async () => {
    const rows = await db.query<{ tier: EvidenceTier; n: number; reviewed: number; since: string | null; until: string | null }>(`
      with totals as (
        select tier::text tier, count(*)::int n, count(reviewed_by)::int reviewed,
          min(valid_from)::text since, max(coalesce(valid_to,current_date))::text until
        from network.edge group by tier
        union all
        select 'D', count(*)::int, 0, min(created_at)::text, current_date::text
        from identity.possible_match
        where active and identity.canonical_entity_id(left_entity) <> identity.canonical_entity_id(right_entity)
      ) select tier, sum(n)::int n, sum(reviewed)::int reviewed,
          min(since::timestamptz)::text since, max(until::timestamptz)::text until
        from totals where n > 0 group by tier order by tier limit 4`);
    const dates = rows.flatMap(r => r.since ? [new Date(r.since).getTime()] : []);
    const ends = rows.flatMap(r => r.until ? [new Date(r.until).getTime()] : []);
    const current = (await db.one<{ key: string }>(`select revision::text || ':' || current_date::text as key
      from network.edge_revision where singleton`))!.key;
    if (current !== key) return edgeSummary();
    return { coverage: { edges: rows.reduce((n,r) => n+r.n,0),
      from: dates.length ? new Date(Math.min(...dates)) : null,
      to: ends.length ? new Date(Math.max(...ends)) : null },
      tiers: rows.map(({ tier,n,reviewed }) => ({ tier,n,reviewed })) };
  });
  summaries.set(db,{ key,value });
  try { return await value; } catch(error) { if (summaries.get(db)?.value === value) summaries.delete(db); throw error; }
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
       from identity.source_record s join identity.entity e on e.entity_id = identity.canonical_entity_id(s.entity_id)
      where s.source = 'app_user' and s.source_id = $1`,
    [handle],
  );
  return row ? { entityId: row.entity_id, name: row.display_name } : null;
}

type RouteSource = { entityId: string; name: string; sourceOnly: boolean };
const sourceRosters = new WeakMap<Db, { revision: string; value: Promise<RouteSource[]> }>();
/** A roster is shared across targets, not rebuilt from every identity on each search. */
export async function routeSources(): Promise<RouteSource[]> {
  const db = await getDb();
  const revision = await evidenceRevision(db);
  const previous = sourceRosters.get(db);
  if (previous?.revision === revision) return previous.value;
  // Shared under the revision, so never at maintenance priority: the warm-up and a page read both join it.
  const value = withSharedDb(() => readRouteSources(db));
  sourceRosters.set(db, { revision, value });
  try { return await value; }
  catch (error) { if (sourceRosters.get(db)?.value === value) sourceRosters.delete(db); throw error; }
}
/** People on the active team, evidenced PL staff, and the explicit PL source. */
async function readRouteSources(db: Db): Promise<RouteSource[]> {
  const rows = await db.query<{ id: string; name: string }>(
    `select distinct e.entity_id::text as id, e.display_name as name
       from identity.source_record s join identity.entity e on e.entity_id = identity.canonical_entity_id(s.entity_id)
       left join platform.app_user u on s.source = 'app_user' and s.source_id = u.handle
      where (s.source = 'app_user' and u.active)
         or (((s.source = 'w3_person' and e.display_name = 'PL' and e.entity_type = 'org') or (s.source = 'network_org' and s.source_id = 'pl') or (s.source='warehouse' and s.source_id='organization:protocol-labs')))
      order by name`);
  const pl = new Set((await db.query<{ id: string }>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record where (source='network_org' and source_id='pl') or (source='warehouse' and source_id='organization:protocol-labs') or (source='w3_person' and entity_id in(select entity_id from identity.entity where entity_type='org' and display_name='PL'))`)).map(r => r.id));
  // Recorded PL employment makes someone a source even without an app login.
  // Keep these affiliation edges as evidence, but never draw PL as their introducer.
  const plAliases = pl.size ? (await db.query<{ id: string }>(
    'select entity_id::text id from identity.entity where identity.canonical_entity_id(entity_id) = any($1::uuid[])', [[...pl]])).map(r => r.id) : [];
  const staff = pl.size ? await db.query<{ id: string; name: string }>(`
    select distinct person.entity_id::text id, person.display_name name
    from network.edge edge
    join identity.entity person on person.entity_id = identity.canonical_entity_id(
      case when identity.canonical_entity_id(edge.from_entity) = any($1::uuid[]) then edge.to_entity else edge.from_entity end)
    where (edge.from_entity = any($1::uuid[]) or edge.to_entity = any($1::uuid[]))
      and person.entity_type = 'person' and (edge.valid_to is null or edge.valid_to >= current_date)
      and edge.evidence @> '[{"tie":{"kind":"worked_together","basis":"pl_affiliation"}}]'::jsonb`, [plAliases]) : [];
  return [...new Map([...rows, ...staff].map(r => [r.id, r])).values()]
    .map((r) => ({ entityId: r.id, name: r.name, sourceOnly: pl.has(r.id) }));
}


/** Role evidence on the source/connector pair, including edges that did not fit a candidate path. */
export async function sourceEdges(sourceIds: string[], entityIds: string[]): Promise<Edge[]> {
  if (!sourceIds.length || !entityIds.length) return [];
  const db = await getDb();
  const graph = await graphSnapshot(db);
  const canonical = (id: string) => graph.canonicalIds?.get(id) ?? id;
  const wanted = new Set(entityIds.map(canonical)), ids = new Set<string>();
  for (const source of sourceIds) {
    for (const edge of graph.adjacency.get(canonical(source)) ?? []) {
      if (wanted.has(edge.other)) ids.add(edge.edgeId);
    }
    await yieldRouteWork();
  }
  return [...(await edgesByIds([...ids])).values()];
}

/** A changed endpoint can affect a three-hop route only within two hops of its target.
 * Called only for pending topology changes: ordinary persistent-cache hits need no graph load. */
export async function routeTouchesChanges(targetId: string, changedIds: string[]): Promise<boolean> {
  if (!changedIds.length) return false;
  const graph = await graphSnapshot(await getDb());
  const canonical = (id: string) => graph.canonicalIds?.get(id) ?? id;
  targetId = canonical(targetId);
  const changed = new Set(changedIds.map(canonical));
  if (changed.has(targetId)) return true;
  let checked = 0, slice = performance.now();
  const first = graph.adjacency.get(targetId) ?? [];
  for (const edge of first) {
    if (changed.has(edge.other)) return true;
    for (const next of graph.adjacency.get(edge.other) ?? []) {
      if (changed.has(next.other)) return true;
      if (++checked % 1024 === 0 && performance.now() - slice >= 12) {
        await yieldRouteWork(); slice = performance.now();
      }
    }
  }
  return false;
}

const WANTED = `with recursive wanted(id) as (
  select identity.canonical_entity_id(id) from unnest($1::uuid[]) id
  union select e.entity_id from identity.entity e join wanted w on e.merged_into = w.id
)`;
async function edgeIdsForEntities(ids: string[], limit: number): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await (await getDb()).query<{ edge_id: string }>(`${WANTED}
    select edge_id from (
      select e.edge_id from wanted w cross join lateral (select edge_id from network.edge where from_entity = w.id order by edge_id limit $2) e
      union select e.edge_id from wanted w cross join lateral (select edge_id from network.edge where to_entity = w.id order by edge_id limit $2) e
      union select edge_id from identity.possible_match where active and left_entity in(select id from wanted)
      union select edge_id from identity.possible_match where active and right_entity in(select id from wanted)
    ) edges order by edge_id limit $2`, [ids, limit]);
  return rows.map(r => r.edge_id);
}
/** Detail panels load a bounded neighborhood, never every edge's full evidence. */
export async function listEdgesForEntities(ids: string[], limit = 100): Promise<Edge[]> {
  return [...(await edgesByIds(await edgeIdsForEntities(ids, Math.max(1, Math.min(1000, limit))))).values()];
}
/**
 * Current edges touching one node, with full evidence, for the "routes through" view. Indexed
 * endpoint lookups only (no graph scan). All are counted; evidence is read for the first `limit`,
 * ties to pursued LPs and their contacts first, then by edge id, and the caller says when that cut
 * applies. The PL organization has ~167K edges (2 Oct 2026): this read takes ~0.3 s there.
 */
export async function edgesTouching(id: string, limit = 2000): Promise<{ edges: Edge[]; total: number }> {
  const db = await getDb();
  const keys = await db.query<{ id: string; total: number }>(`${WANTED}, pursued as materialized (
      select p.entity_id as id from strategy.active_pursuit p where p.closed_at is null
      union select c.person_entity from strategy.pursuit_contact c join strategy.active_pursuit p using (pursuit_id) where p.closed_at is null
    )
    select edges.edge_id::text as id, (count(*) over ())::int as total from (
      select edge_id, to_entity as other from network.edge where from_entity in (select id from wanted) and (valid_to is null or valid_to >= current_date)
      union select edge_id, from_entity from network.edge where to_entity in (select id from wanted) and (valid_to is null or valid_to >= current_date)
      union select edge_id, right_entity from identity.possible_match where active and left_entity in (select id from wanted)
      union select edge_id, left_entity from identity.possible_match where active and right_entity in (select id from wanted)
    ) edges order by (edges.other in (select id from pursued)) desc, edges.edge_id limit $2`, [[id], Math.max(1, limit)]);
  const wanted = keys.map((r) => r.id);
  const edges: Edge[] = [];
  for (let offset = 0; offset < wanted.length; offset += 500) {
    const rows = await db.query<EdgeRow>(`${EDGE_SELECT} where e.edge_id = any($1::uuid[]) and f.entity_id <> t.entity_id
      union all ${POSSIBLE_SELECT} and p.edge_id = any($1::uuid[])`, [wanted.slice(offset, offset + 500)]);
    edges.push(...rows.map(toEdge));
    await yieldRouteWork();
  }
  return { edges, total: keys[0]?.total ?? 0 };
}

export async function edgeCountsForEntities(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await (await getDb()).query<{ id: string; n: number }>(`with recursive wanted(id,root) as (
    select identity.canonical_entity_id(id), identity.canonical_entity_id(id) from unnest($1::uuid[]) id
    union select e.entity_id,w.root from identity.entity e join wanted w on e.merged_into = w.id
  ), endpoints as (
    select w.root id,e.edge_id from wanted w cross join lateral (select edge_id from network.edge where from_entity = w.id offset 0) e
    union select w.root,e.edge_id from wanted w cross join lateral (select edge_id from network.edge where to_entity = w.id offset 0) e
    union select w.root,p.edge_id from identity.possible_match p join wanted w on p.left_entity = w.id where p.active
      and identity.canonical_entity_id(p.left_entity) <> identity.canonical_entity_id(p.right_entity)
    union select w.root,p.edge_id from identity.possible_match p join wanted w on p.right_entity = w.id where p.active
      and identity.canonical_entity_id(p.left_entity) <> identity.canonical_entity_id(p.right_entity)
  ) select id::text, count(*)::int n from endpoints group by id limit 2000`, [ids]);
  return new Map(rows.map(r => [r.id,r.n]));
}
export async function listEdgeSummariesForEntities(ids: string[], limit = 1000) {
  limit = Math.min(1000,Math.max(1,limit));
  const keys = await edgeIdsForEntities(ids, limit + 1);
  if (!keys.length) return { edges: [], truncated: false };
  const db = await getDb();
  const select = EDGE_SELECT.replace('e.evidence,', "'[]'::jsonb as evidence,");
  const rows = await db.query<EdgeRow>(`${select} where e.edge_id = any($1::uuid[])
    union all ${POSSIBLE_SELECT} and p.edge_id = any($1::uuid[])`, [keys.slice(0,limit)]);
  return { edges: rows.map(toEdge), truncated: keys.length > limit };
}

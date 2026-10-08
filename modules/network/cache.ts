import { lpContactsFor } from '@/modules/strategy/lp-contacts';
import { buildCache } from '@/lib/build-cache';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { config } from '@/config/deployment';
import { getDb, withDb, type Db } from '@/lib/db';
import { withForegroundDb, withBackgroundDb, withSharedDb, DbBusyError } from '@/lib/db/scheduling';
import { computeStructuralRoutes, routeGraph } from './service';
import { canonicalRouteEntity, routeTouchesChanges, routeSources } from './repo';
import type { Edge, RouteSearch } from './types';

class RevisionChanged extends Error {}
// GUESS — two retries bound cross-process import churn; never return a mixed graph.
const REVISION_RETRIES = 2;

const settings = () => createHash('sha256').update(JSON.stringify([
  'compact-structural-v10-lp-unit-contacts', config.routeScoring, config.routeWarmth, config.routePolicy,
])).digest('hex').slice(0, 16);
const sourceSignatures = new WeakMap<Db, { revision: string; value: Promise<string> }>();
async function sourceSignature(db: Db, revision: string): Promise<string> {
  const prior = sourceSignatures.get(db);
  if (prior?.revision === revision) return prior.value;
  // The warm-up starts this as maintenance and a page read joins it: shared, so foreground (withSharedDb).
  const value = withSharedDb(() => withDb(db, async () => createHash('sha256').update(JSON.stringify(
    (await routeSources()).sort((a, b) => a.entityId.localeCompare(b.entityId)),
  )).digest('hex').slice(0, 16)));
  sourceSignatures.set(db, { revision, value });
  try { return await value; }
  catch (error) { if (sourceSignatures.get(db)?.value === value) sourceSignatures.delete(db); throw error; }
}
// Membership changes are read revisions, not graph edits. Hash the actual resolver output
// so money/notes invalidations do not discard otherwise valid structural searches.
// The resolver reads records, aliases and affiliations, whose every change moves the route revision
// (network 006/016), and pursuit contacts with their pursuits, fingerprinted here. While both are
// unchanged the signature is too, so a status move or a note no longer recomputes it over every
// organisation (about 0.25 s on the invented copy; performance pass, 8 Oct 2026).
const contactInputs = new WeakMap<Db, { key: string; value: string }>();
const contactSignature = buildCache(async () => {
  const db = await getDb();
  const key = (await db.one<{ key: string }>(`select (select revision::text from network.route_revision where singleton) || ':' || (
      select count(*)::text || ':' || coalesce(sum(hashtext(concat_ws('|', c.pursuit_id, c.person_entity, c.role, c.source,
        p.entity_id, p.vehicle_id, p.merged_into)))::text, '0')
      from strategy.pursuit_contact c join strategy.pursuit p using (pursuit_id)) as key`))?.key;
  const prior = contactInputs.get(db);
  if (prior && key && prior.key === key) return prior.value;
  const rows = await db.query<{ id: string }>(`select entity_id::text id from identity.entity where entity_type <> 'person' and merged_into is null order by entity_id`);
  const value = createHash('sha256').update(JSON.stringify([...(await lpContactsFor(rows.map(r => r.id))).entries()])).digest('hex').slice(0, 16);
  if (key) contactInputs.set(db, { key, value });
  return value;
});
export async function revisionFor(db: Db) {
  const row = (await db.one<{ revision: string; epoch: string; day: string }>(
    `select revision::text, epoch::text, current_date::text as day from network.route_revision where singleton`))!;
  return { revision: row.revision, generation: `${row.epoch}:${row.day}:${settings()}:${await withDb(db, () => contactSignature())}:${await sourceSignature(db, `${row.revision}:${row.day}`)}` };
}
function encode(value: unknown): string {
  return JSON.stringify(value, function (key, v) {
    return this[key] instanceof Date ? { $routeDate: this[key].toISOString() } : v;
  });
}
function decode(value: string): RouteSearch {
  const archive = JSON.parse(value, (_key, v) =>
    v && typeof v === 'object' && '$routeDate' in v ? new Date(v.$routeDate) : v);
  const evidence: Edge[] = archive.evidence;
  const search: RouteSearch = { ...archive, routes: archive.routes.map((r: RouteSearch['routes'][number]) => ({
    ...r, hops: r.hops.map((h) => ({ ...h, edge: evidence[h.edge as unknown as number]! })),
  })) };
  delete (search as RouteSearch & { evidence?: Edge[] }).evidence;
  search.topRoutes = search.routes.filter((r) => r.foldedUnder == null && r.verdict === 'recommend');
  search.graph = routeGraph(search.routes, search.targetId, true);
  return search;
}
interface Entry { search: RouteSearch | null; generation: string; revision: string; bytes: number }
const memory = new WeakMap<Db, Map<string, Entry>>();
const pending = new WeakMap<Db, Map<string, Promise<RouteSearch | null>>>();

async function touched(db: Db, targetId: string, since: string, search: RouteSearch | null): Promise<boolean> {
  // Source display names affect route labels even when the source is three hops away.
  const sources = new Set(search?.structural
    ? search.structural.candidates.map((c) => search.structural!.nodes[c.nodes[0]!]!.entityId)
    : search?.routes.map((r) => r.fromEntity) ?? []);
  // Keyset on the uuid itself, so each batch starts where the last ended in the primary key; the
  // text comparison it replaced re-read every earlier entity on each batch (performance pass, 8 Oct
  // 2026). A uuid sorts as its lower-case text does, so the batches are the same.
  let after = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const rows = await db.query<{ id: string; canonical_id: string }>(`select entity_id::text as id,
        identity.canonical_entity_id(entity_id)::text as canonical_id from network.route_changed_entity
      where revision > $1::bigint and entity_id > $2::uuid order by entity_id limit 256`, [since, after]);
    if (!rows.length) return false;
    const ids = rows.map((r) => r.canonical_id);
    if (ids.some((id) => sources.has(id))) return true;
    const contacts = (await lpContactsFor([targetId])).get(targetId) ?? [];
    for (const endpoint of [targetId, ...contacts.map(c => c.entityId)]) if (await routeTouchesChanges(endpoint, ids)) return true;
    after = rows.at(-1)!.id;
    await pause(1);
  }
}

/** Only structural graph state is cached. service applies authoritative guards and
 * dynamic scores to a fresh view on every call, never mutating this shared entry. */
export async function cachedRoutes(targetId: string, kind: string, live: () => Promise<RouteSearch | null>): Promise<RouteSearch | null> {
  // A resolver mutation changes the generation. Holding maintenance across this
  // search's yielded reads prevents repeated generation retries from starving a page.
  // Warm-up calls this once per target; no lease spans the whole warm-up.
  return withForegroundDb(await getDb(), async () => {
    // Shared jobs validate one attempt only. Each caller retains its own retry budget
    // even when a new page request has started another attempt at a newer revision.
    for (let attempt = 0; ; attempt++) {
      try { return await readCachedRoutes(targetId, kind, live); }
      catch (error) {
        if (!(error instanceof RevisionChanged)) throw error;
        if (attempt >= REVISION_RETRIES) throw new DbBusyError();
      }
    }
  });
}
async function readCachedRoutes(targetId: string, kind: string, live: () => Promise<RouteSearch | null>): Promise<RouteSearch | null> {
  targetId = await canonicalRouteEntity(targetId);
  const db = await getDb(), version = await revisionFor(db), key = `${targetId}:${kind}`;
  let entries = memory.get(db);
  if (!entries) { entries = new Map(); memory.set(db, entries); }
  const prior = entries.get(key);
  if (prior?.generation === version.generation && prior.revision === version.revision) return prior.search;
  let jobs = pending.get(db);
  if (!jobs) { jobs = new Map(); pending.set(db, jobs); }
  const jobKey = `${version.generation}:${version.revision}:${key}`;
  if (jobs.has(jobKey)) return jobs.get(jobKey)!;
  const job = (async () => {
    let entry = prior?.generation === version.generation ? prior : undefined;
    if (!entry) {
      const row = await db.one<{ search: string; input_revision: string }>(`select search::text as search, input_revision::text
        from network.route_cache where target_id = $1 and vehicle_kind = $2 and revision = $3`, [targetId, kind, version.generation]);
      if (row) entry = { search: decode(row.search), generation: version.generation,
        revision: row.input_revision, bytes: row.search.length * 2 };
    }
    if (entry && entry.revision !== version.revision && await touched(db, targetId, entry.revision, entry.search)) entry = undefined;
    const search = entry ? entry.search : await live();
    const now = await revisionFor(db);
    if (now.generation !== version.generation || now.revision !== version.revision) throw new RevisionChanged();
    const bytes = entry?.bytes ?? (search ? await store(db, search, kind, version) : 8);
    if (entry && entry.revision !== version.revision) await db.query(`update network.route_cache set input_revision = $3::bigint
      where target_id = $1 and vehicle_kind = $2`, [targetId, kind, version.revision]);
    entries.delete(key);
    entries.set(key, { search, ...version, bytes });
    let total = [...entries.values()].reduce((n, e) => n + e.bytes, 0);
    while (total > 32 * 1024 * 1024 || entries.size > 48) {
      const first = entries.keys().next().value!;
      total -= entries.get(first)!.bytes; entries.delete(first);
    }
    return search;
  })();
  jobs.set(jobKey, job);
  try { return await job; } finally { jobs.delete(jobKey); }
}
async function store(db: Db, search: RouteSearch, kind: string, version: Awaited<ReturnType<typeof revisionFor>>) {
  const { topRoutes: _top, graph: _graph, promotedBasisHashes: _promoted, candidateCounts: _candidates, ...compact } = search;
  // Evidence is shared by many visible prefixes; serialize each selected edge once.
  // Reasons, influence and factor explanations are regenerated by the live overlay.
  const evidence: Edge[] = [], edgeIds = new Map<string, number>();
  const routes = compact.routes.map((r) => ({ ...r, score: undefined, reasons: [], influence: null, askLoad: null,
    hops: r.hops.map((h) => {
      let index = edgeIds.get(h.edge.edgeId);
      if (index === undefined) { index = evidence.length; evidence.push(h.edge); edgeIds.set(h.edge.edgeId, index); }
      return { ...h, edge: index };
    }),
  }));
  const serialized = encode({ ...compact, routes, evidence });
  const shared = search.structural ? sharedNodes(search.structural, search.targetId) : null;
  await db.query(`insert into network.route_cache (target_id, vehicle_kind, revision, input_revision, computed_at, search, best_score, candidate_count, shared_nodes)
    select $1::uuid, $2, $3, $4::bigint, now(), $5::jsonb, $6::numeric, $7::integer, $8::uuid[]
      where exists (select 1 from identity.entity where entity_id = $1::uuid)
    on conflict (target_id, vehicle_kind) do update set revision = excluded.revision,
      input_revision = excluded.input_revision, computed_at = excluded.computed_at, search = excluded.search, best_score = excluded.best_score,
      candidate_count = excluded.candidate_count, shared_nodes = excluded.shared_nodes`,
  [search.targetId, kind, version.generation, version.revision, serialized, search.stats?.bestScore ?? null,
    shared?.candidates ?? null, shared?.nodes ?? null]);
  return serialized.length * 2;
}

/** Every node all candidate paths share, besides the target: "only through X" is X in this list.
 * Stops as soon as the intersection is empty, so a well-connected target costs one or two paths. */
export function sharedNodes(structural: NonNullable<RouteSearch['structural']>, targetId: string): { candidates: number; nodes: string[] } {
  let shared: number[] | null = null;
  for (const candidate of structural.candidates) {
    const nodes = new Set<number>(candidate.nodes);
    shared = shared === null ? [...nodes] : (shared as number[]).filter((n) => nodes.has(n));
    if (!shared.length) break;
  }
  const ids = (shared ?? []).map((n) => structural.nodes[n]?.entityId).filter((id): id is string => Boolean(id) && id !== targetId);
  return { candidates: structural.candidates.length, nodes: [...new Set(ids)] };
}

export interface PrecomputeCounts { targets: number; searches: number; milliseconds: number; complete: boolean }
export interface WarmupProgress { status: string; total: number; completed: number; elapsed_ms: number; started_at: Date | null; updated_at: Date; error: string | null }
export async function routeWarmupProgress(): Promise<WarmupProgress> {
  return (await (await getDb()).one<WarmupProgress>('select status, total, completed, elapsed_ms, started_at, updated_at, error from network.route_warmup where singleton'))!;
}
const warmupGlobal = globalThis as typeof globalThis & { __routes0070Warmup?: WeakMap<Db, Promise<PrecomputeCounts>> };
const warming = warmupGlobal.__routes0070Warmup ??= new WeakMap<Db, Promise<PrecomputeCounts>>();
/** Awaitable for measurements/tests only. Builds use startRouteWarmup below. No
 * transaction spans targets, and search itself cooperatively chunks graph reads. */
export async function precomputeRoutes(at?: Date): Promise<PrecomputeCounts> {
  const db = await getDb();
  const existing = warming.get(db);
  if (existing) return existing;
  const work = withDb(db, async () => {
    const start = performance.now(), version = await revisionFor(db);
    const targets = await db.query<{ target_id: string; kind: string }>(`
    -- Only a merged record walks its chain; resolving every entity first took most of a second at
    -- the live scale on every warm-up (performance pass, 8 Oct 2026).
    with pursuits as materialized (
      select case when e.merged_into is null then e.entity_id else identity.canonical_entity_id(e.entity_id) end entity_id,
             p.vehicle_id, p.closed_at
        from strategy.active_pursuit p left join identity.entity e on e.entity_id = p.entity_id
    ), affiliations as materialized (
      select case when person.merged_into is null then person.entity_id else identity.canonical_entity_id(person.entity_id) end person_entity,
             case when org.merged_into is null then org.entity_id else identity.canonical_entity_id(org.entity_id) end org_entity
        from identity.affiliation a
        left join identity.entity person on person.entity_id = a.person_entity
        left join identity.entity org on org.entity_id = a.org_entity where a.ended_on is null
    ), targets as (
      select p.entity_id as entity_id, v.kind::text as kind, 0 as priority from pursuits p
        join platform.vehicle v on v.id = p.vehicle_id where p.closed_at is null and v.phase = 'active'
      union all
      select a.org_entity, v.kind::text, 1 from pursuits p
        join platform.vehicle v on v.id = p.vehicle_id
        join affiliations a on a.person_entity = p.entity_id
        where p.closed_at is null and v.phase = 'active')
      select entity_id::text as target_id, kind from targets group by entity_id, kind order by min(priority), entity_id, kind`);
    let searches = 0;
    await db.query(`update network.route_warmup set status = 'running', total = $1, completed = 0,
      started_at = now(), updated_at = now(), elapsed_ms = 0, error = null where singleton`, [targets.length]);
    try {
      for (const target of targets) {
        await pause(5); // Reserve a turn for HTTP/I/O before every target, including the first.
        if ((await revisionFor(db)).generation !== version.generation) break;
        await cachedRoutes(target.target_id, target.kind,
          () => computeStructuralRoutes('', target.target_id, 3, target.kind, 'team', at));
        searches++;
        await db.query(`update network.route_warmup set completed = $1, updated_at = now(), elapsed_ms = $2 where singleton`,
          [searches, Math.round(performance.now() - start)]);
      }
      const complete = searches === targets.length;
      await db.query(`update network.route_warmup set status = $1, updated_at = now() where singleton`, [complete ? 'complete' : 'superseded']);
      return { targets: targets.length, searches, milliseconds: performance.now() - start, complete };
    } catch (error) {
      // Progress contains no target identities or raw database errors.
      await db.query(`update network.route_warmup set status = 'failed', error = 'Warm-up stopped; cache misses still compute on demand.', updated_at = now() where singleton`).catch(() => {});
      throw error;
    }
  });
  warming.set(db, work);
  try { return await work; } finally { if (warming.get(db) === work) warming.delete(db); }
}
/** In-process best-effort warming, not durable orchestration. Restart loses the job,
 * not its completed rows. Build response never waits for the cache workload. */
export function startRouteWarmup(db: Db): void {
  if (warming.has(db)) return;
  const timer = setTimeout(() => {
    void withDb(db, async () => {
      const earlier = warming.get(db);
      if (earlier) return earlier;
      return withBackgroundDb(() => precomputeRoutes());
    }).catch(() => { /* cheap progress records failure; foreground misses remain available */ });
  }, 25);
  timer.unref();
}

/** Compact, versioned picker scores; never scan cached route JSON or plan every target on a page read. */
export async function recordedRouteScores(kind: string): Promise<Map<string, number>> {
  const db=await getDb(), version=await revisionFor(db);
  const rows=await db.query<{id:string;score:string}>(`select target_id::text id,best_score::text score from network.route_cache
    where vehicle_kind=$1 and revision=$2 and best_score is not null`,[kind,version.generation]);
  if (!rows.length) startRouteWarmup(db);
  return new Map(rows.map(r=>[r.id,Number(r.score)]));
}

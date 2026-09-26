import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { config } from '@/config/deployment';
import { getDb, type Db } from '@/lib/db';
import { readRevision } from '@/lib/build-cache';
import { planRoutesLive, routeGraph } from './service';
import type { RouteSearch } from './types';

// Change this when the search/serialization contract changes. Config changes invalidate too.
const format = 'scored-folded-team-v1';
const settings = () => createHash('sha256').update(JSON.stringify([
  format, config.routeScoring, config.routeWarmth, config.routeInfluence, config.guard,
])).digest('hex').slice(0, 16);
const revisionFor = async (db: Db) => `${await readRevision(db)}:${settings()}`;

// Dates remain Dates after a persisted cache hit (including influence evidence dates).
function encode(value: unknown): string {
  return JSON.stringify(value, function (key, v) {
    return this[key] instanceof Date ? { $routeDate: this[key].toISOString() } : v;
  });
}
function decode(value: string): RouteSearch {
  const search = JSON.parse(value, (_key, v) =>
    v && typeof v === 'object' && '$routeDate' in v ? new Date(v.$routeDate) : v) as RouteSearch;
  search.topRoutes = search.routes.filter((r) => r.foldedUnder == null && r.verdict === 'recommend');
  search.graph = routeGraph(search.routes, search.targetId, true);
  return search;
}

// Avoid deserializing multi-MB paths on every route click. Bounded by serialized bytes
// as well as entries; database handles and revisions never share results. The
// largest measured targets each need about 31 MiB of serialized text: keep several
// LPs resident so switching targets does not force a fresh JSON decode every time.
const memory = new WeakMap<Db, { revision: string; bytes: number; entries: Map<string, { search: RouteSearch | null; bytes: number }> }>();
const pending = new WeakMap<Db, Map<string, Promise<RouteSearch | null>>>();
export async function cachedRoutes(targetId: string, kind: string, live: () => Promise<RouteSearch | null>): Promise<RouteSearch | null> {
  const db = await getDb(), revision = await revisionFor(db), key = `${targetId}:${kind}`;
  let state = memory.get(db);
  if (state?.revision !== revision) {
    state = { revision, bytes: 0, entries: new Map() };
    memory.set(db, state);
  }
  const hit = state.entries.get(key);
  if (hit) {
    state.entries.delete(key); state.entries.set(key, hit);
    return hit.search;
  }
  let jobs = pending.get(db);
  if (!jobs) { jobs = new Map(); pending.set(db, jobs); }
  const jobKey = `${revision}:${key}`;
  if (jobs.has(jobKey)) return jobs.get(jobKey)!;
  const job = (async () => {
    const row = await db.one<{ search: string }>(`select search::text as search from network.route_cache
      where target_id = $1 and vehicle_kind = $2 and revision = $3`, [targetId, kind, revision]);
    const search = row ? decode(row.search) : await live();
    // A concurrent import must not publish a mixed-revision result.
    if (await revisionFor(db) !== revision) return cachedRoutes(targetId, kind, live);
    const bytes = row ? row.search.length * 2 : search ? await store(db, search, kind, revision) : 8;
    if (bytes <= 256 * 1024 * 1024) {
      state.entries.set(key, { search, bytes }); state.bytes += bytes;
      while (state.bytes > 256 * 1024 * 1024 || state.entries.size > 24) {
        const first = state.entries.keys().next().value!;
        state.bytes -= state.entries.get(first)!.bytes; state.entries.delete(first);
      }
    }
    return search;
  })();
  jobs.set(jobKey, job);
  try { return await job; } finally { jobs.delete(jobKey); }
}

async function store(db: Db, search: RouteSearch, kind: string, revision: string) {
  const { topRoutes: _top, graph: _graph, ...compact } = search;
  const serialized = encode(compact);
  await db.query(`insert into network.route_cache (target_id, vehicle_kind, revision, computed_at, search)
    select $1::uuid, $2, $3, now(), $4::jsonb
      where exists (select 1 from identity.entity where entity_id = $1::uuid)
    on conflict (target_id, vehicle_kind) do update set revision = excluded.revision,
      computed_at = excluded.computed_at, search = excluded.search`,
  [search.targetId, kind, revision, serialized]);
  return serialized.length * 2;
}

export interface PrecomputeCounts { targets: number; searches: number; milliseconds: number; complete: boolean }
/** Runs inside the existing server process, after the graph transaction commits.
 * Includes the current organizations of open person targets, as the picker does.
 * A changed revision stops publication; the next read will search current evidence. */
export async function precomputeRoutes(at = new Date()): Promise<PrecomputeCounts> {
  const db = await getDb(), start = performance.now(), revision = await revisionFor(db);
  const targets = await db.query<{ target_id: string; kind: string }>(`with targets as (
    select p.entity_id, v.kind::text as kind from strategy.pursuit p
      join platform.vehicle v on v.id = p.vehicle_id where p.closed_at is null and v.phase <> 'historical'
    union
    select a.org_entity, v.kind::text from strategy.pursuit p
      join platform.vehicle v on v.id = p.vehicle_id
      join identity.affiliation a on a.person_entity = p.entity_id and a.ended_on is null
      where p.closed_at is null and v.phase <> 'historical')
    select entity_id::text as target_id, kind from targets order by target_id, kind`);
  let searches = 0;
  for (const target of targets) {
    const search = await planRoutesLive('', target.target_id, 3, target.kind, 'team', at);
    if (await revisionFor(db) !== revision) return { targets: targets.length, searches, milliseconds: performance.now() - start, complete: false };
    if (search) { await store(db, search, target.kind, revision); searches++; }
    // PGlite's synchronous work otherwise starves HTTP and progress timers between targets.
    await setImmediate();
  }
  return { targets: targets.length, searches, milliseconds: performance.now() - start, complete: true };
}

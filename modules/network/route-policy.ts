import { getDb, type Db } from '@/lib/db';
import { withSharedDb } from '@/lib/db/scheduling';
import { memoizable } from '@/lib/db/read-memo';
import { yieldRouteWork } from './path-search';

export type OrganizationRouteSize = { members: number; headcount: number | null };
export type RoutePolicyFacts = { blocked: Set<string>; organizations: Map<string, OrganizationRouteSize> };

/** Accept only a count or a bounded range, not narrative numbers, dates or percentages.
 * A range uses its upper bound because overstating the usefulness of a large hub is worse
 * than discounting it. Unbounded values are unknown, not invented upper estimates. */
export function parsePublicHeadcount(value: string): number | null {
  const number = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*[km]?`;
  const match = value.trim().toLowerCase().match(new RegExp(
    `^(${number})(?:\\s*(?:[-–—]|to)\\s*(${number}))?(?:\\s+(?:employees?|people|staff|members?))?$`,
  ));
  if (!match) return null;
  const count = (part: string) => {
    const text = part.replaceAll(',', '').replaceAll(' ', '');
    const multiplier = text.endsWith('k') ? 1_000 : text.endsWith('m') ? 1_000_000 : 1;
    return Number(text.replace(/[km]$/, '')) * multiplier;
  };
  const result = Math.max(count(match[1]!), count(match[2] ?? match[1]!));
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

const normalizedName = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
type PolicyTopology = {
  canonical: Map<string, string>;
  aliases: Map<string, string[]>;
  group: Map<string, string>;
  members: Map<string, number>;
  organizations: Set<string>;
  types: Map<string, string>;
};
/** One page of every entity, in primary-key order. ORDER BY names the table's uuid column
 * (e.entity_id), never the output column `entity_id`, which is the ::text cast: that sorted the
 * whole table for every page — 58 seq scans and top-N sorts; the topology rebuild took 4.45 s on
 * 118K entities (2 Oct 2026) and takes 0.26 s walking the primary key. */
export const topologyPageSql = (after: boolean) => `select e.entity_id::text, e.entity_type::text, e.display_name, e.merged_into::text
  from identity.entity e ${after ? 'where e.entity_id > $1::uuid' : ''} order by e.entity_id limit 2048`;
const topologyCache = new WeakMap<Db, { revision: string; value: Promise<PolicyTopology> }>();
const revisionOf = async (db: Db) => (await db.one<{ revision: string }>(
  `select revision::text || ':' || current_date::text as revision from network.route_revision where singleton`,
))!.revision;

/** Share identity and organization facts across targets under the graph revision.
 * Cached route reads never load the full person-to-person adjacency index. */
async function policyTopology(db: Db): Promise<PolicyTopology> {
  const revision = await revisionOf(db);
  const previous = topologyCache.get(db);
  if (previous?.revision === revision) return previous.value;
  const value = withSharedDb(async () => {
    // Cached route reads need identity and organization facts, not the entire relationship
    // adjacency index. Only uncached path searches pay for graphSnapshot's full edge scan.
    const canonical = new Map<string, string>();
    const records = new Map<string, { entity_type: string; display_name: string; merged_into: string | null }>();
    const resolve = (id: string): string => {
      if (canonical.has(id)) return canonical.get(id)!;
      const path: string[] = [], seen = new Set<string>();
      let current = id;
      while (records.get(current)?.merged_into && !canonical.has(current) && !seen.has(current)) {
        seen.add(current); path.push(current); current = records.get(current)!.merged_into!;
      }
      const root = canonical.get(current) ?? current;
      canonical.set(id, root); for (const alias of path) canonical.set(alias, root);
      return root;
    };
    const types = new Map<string, string>(), group = new Map<string, string>();
    const root = (id: string): string => {
      if (!group.has(id)) group.set(id, id);
      let result = id;
      while (group.get(result)! !== result) result = group.get(result)!;
      while (id !== result) { const parent = group.get(id)!; group.set(id, result); id = parent; }
      return result;
    };
    const union = (a: string, b: string) => {
      const left = root(a), right = root(b);
      if (left !== right) group.set(left < right ? right : left, left < right ? left : right);
    };
    const names = new Map<string, string>();
    let cursor: string | null = null;
    for (;;) {
      const rows: Array<{ entity_id: string; entity_type: string; display_name: string; merged_into: string | null }> = await db.query(
        topologyPageSql(cursor !== null), cursor ? [cursor] : [],
      );
      for (const row of rows) records.set(row.entity_id, row);
      await yieldRouteWork();
      if (rows.length < 2048) break;
      cursor = rows.at(-1)!.entity_id;
    }
    for (const [entity_id, record] of records) {
      const id = resolve(entity_id);
      if (id === entity_id || !types.has(id)) types.set(id, record.entity_type);
      if (record.entity_type !== 'person') continue;
      root(id);
      const name = normalizedName(record.display_name);
      if (!name) continue;
      const other = names.get(name);
      if (other) union(id, other); else names.set(name, id);
    }
    const possible = await db.query<{ edge_id: string; left_entity: string; right_entity: string }>(
      'select edge_id::text, left_entity::text, right_entity::text from identity.possible_match where active',
    );
    for (const match of possible) {
      const left = resolve(match.left_entity), right = resolve(match.right_entity);
      if (types.get(left) === 'person' && types.get(right) === 'person') union(left, right);
    }
    for (const id of group.keys()) root(id);
    const organizations = new Set([...types].filter(([, type]) => type === 'org').map(([id]) => id));
    const members = new Map<string, number>();
    if (await revisionOf(db) !== revision) return policyTopology(db);
    const aliases = new Map<string, string[]>();
    for (const [id, resolved] of canonical) {
      const rows = aliases.get(resolved);
      if (rows) rows.push(id); else aliases.set(resolved, [id]);
    }
    return { canonical, aliases, group, members, organizations, types };
  });
  topologyCache.set(db, { revision, value });
  try { return await value; }
  catch (error) { if (topologyCache.get(db)?.value === value) topologyCache.delete(db); throw error; }
}

// Shared by a long plan of many targets (lib/db/read-memo.ts): the same for every target on a vehicle.
const BLOCKED_SQL = memoizable(`select entity_id::text as id from coordination.restriction
        where scope = 'blanket' and (expires_at is null or expires_at > current_date)
       union
       select entity_id::text as id from strategy.pursuit
        where vehicle_id = $1::uuid and status = 'passed' and status_reason = 'do_not_contact'`);

/** No restriction text or private context leaves this policy reader. Restrictions and
 * public claims are read afresh; neither live safety nor size changes depend on a TTL. */
export async function routePolicyFacts(ids: string[], vehicleId?: string): Promise<RoutePolicyFacts> {
  if (!ids.length) return { blocked: new Set(), organizations: new Map() };
  const db = await getDb(), topology = await policyTopology(db);
  const canonical = (id: string) => topology.canonical.get(id) ?? id;
  const wanted = [...new Set(ids.map(canonical))];
  const orgIds = wanted.filter((id) => topology.organizations.has(id));
  const orgAliases = orgIds.flatMap((id) => topology.aliases.get(id) ?? [id]);
  // Read only the organizations used by this route set. Separate directional scans
  // use endpoint indexes; scanning every organization on startup is unnecessarily costly.
  const missing = orgIds.filter(id => !topology.members.has(id));
  if (missing.length) {
    const aliases = missing.flatMap(id => topology.aliases.get(id) ?? [id]);
    const rows = await db.query<{ org: string; person: string }>(
      `select from_entity::text as org, to_entity::text as person from network.edge
        where from_entity = any($1::uuid[]) and (valid_to is null or valid_to >= current_date)
       union all
       select to_entity::text as org, from_entity::text as person from network.edge
        where to_entity = any($1::uuid[]) and (valid_to is null or valid_to >= current_date)
       union all
       select org_entity::text as org, person_entity::text as person from identity.affiliation
        where org_entity = any($1::uuid[])`, [aliases],
    );
    const people = new Map(missing.map(id => [id, new Set<string>()]));
    for (const row of rows) {
      const person = canonical(row.person);
      if (topology.types.get(person) === 'person') people.get(canonical(row.org))?.add(person);
    }
    for (const [id, members] of people) topology.members.set(id, members.size);
  }
  const [restrictions, claims] = await Promise.all([
    db.query<{ id: string }>(BLOCKED_SQL, [vehicleId ?? null]),
    orgIds.length ? db.query<{ id: string; value: string }>(
      `select c.entity_id::text as id, c.value from research.claim c
        join research.source_doc s on s.doc_id = c.source
        where c.entity_id = any($1::uuid[]) and c.superseded_by is null
          and lower(c.field) in ('headcount','employee_count','employees','number_of_employees',
            'public.headcount','public.employee_count','public.employees','public.number_of_employees')
          and nullif(trim(c.source), '') is not null and c.as_of is not null
          and c.confidence is not null and c.last_verified_by is not null`, [orgAliases],
    ) : Promise.resolve([] as Array<{ id: string; value: string }>),
  ]);
  const prohibited = new Set(restrictions.map(({ id }) => topology.group.get(canonical(id)) ?? canonical(id)));
  const blocked = new Set<string>();
  for (const id of [...wanted, ...ids]) if (prohibited.has(topology.group.get(canonical(id)) ?? canonical(id))) blocked.add(id);
  const organizations = new Map<string, OrganizationRouteSize>(orgIds.map((id) => [id, { members: topology.members.get(id)!, headcount: null }]));
  for (const claim of claims) {
    const count = parsePublicHeadcount(claim.value), size = organizations.get(canonical(claim.id));
    if (count !== null && size) size.headcount = Math.max(size.headcount ?? 0, count);
  }
  return { blocked, organizations };
}

/** Routing may reject a repeated uncertain identity without merging records or adding an
 * inferred relationship. Only the requested IDs leave the cached safety projection. */
export async function routeIdentityGroups(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const topology = await policyTopology(await getDb());
  return new Map(ids.map((id) => {
    const canonical = topology.canonical.get(id) ?? id;
    return [id, topology.group.get(canonical) ?? canonical];
  }));
}

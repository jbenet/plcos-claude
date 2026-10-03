import { getDb } from '@/lib/db';
import { revisionFor } from './cache';
import { routePolicyFacts } from './route-policy';
import { canonicalRouteEntity, edgeCountsForEntities, edgesTouching, routeNodeNames, routeSources } from './repo';
import { warmthReader } from './warmth';
import type { Edge, EdgeKind, EvidenceTier, Route } from './types';

/**
 * "Warm intro routes through X" (Juan, 2 Oct 2026): pick any node, see our routes to it, who it could
 * introduce us to beyond, and where the dataset around it is thin. Our routes to X come from the
 * ordinary planner (the caller passes them in, cached); this file adds X's onward ties, the combined
 * two-hop reading and the gaps counts. Nothing here proposes or sends anything.
 */

const TIER_ORDER: Record<EvidenceTier, number> = { A: 0, B: 1, C: 2, D: 3 };

/** A route is only as good as its weakest hop. `null` first hop means X is one of our own sources. */
export function weakerTier(first: EvidenceTier | null, second: EvidenceTier): EvidenceTier {
  if (first === null) return second;
  return TIER_ORDER[first] >= TIER_ORDER[second] ? first : second;
}

export type SourceClass = 'Affinity' | 'Research' | 'W3 paths' | 'Warehouse' | 'Portfolio'
  | 'PL network' | 'Dakota' | 'Identity match' | 'Other records';
export const SOURCE_CLASSES: SourceClass[] = ['Affinity', 'Research', 'W3 paths', 'Warehouse', 'Portfolio',
  'PL network', 'Dakota', 'Identity match', 'Other records'];
export const SOURCE_MEANS: Record<SourceClass, string> = {
  Affinity: 'meetings and mail in our own records, as translated',
  Research: 'public-source research findings (W1)',
  'W3 paths': 'the research path finder over our records (W3)',
  Warehouse: 'the warehouse relationship graph',
  Portfolio: 'PLC portfolio founder records',
  'PL network': 'the PL own-network rule (rule 6)',
  Dakota: 'the licensed allocator database',
  'Identity match': 'possible same-person matches, not relationships',
  'Other records': 'seeded or hand-entered edges with no named source',
};

type Evidence = Edge['evidence'][number] & { derived?: string; portfolioId?: string; warehouseTie?: string };

/** Which corpus one evidence item came from. Deterministic, ordered from most to least specific. */
export function evidenceSourceClass(kind: EdgeKind, evidence: Evidence): SourceClass {
  const source = evidence.source ?? '';
  if (kind === 'possible_identity') return 'Identity match';
  if (source === 'dakota') return 'Dakota';
  if (evidence.portfolioId || kind === 'portfolio') return 'Portfolio';
  if (evidence.derived === 'records' || /affinity/i.test(source)) return 'Affinity';
  if (evidence.tie?.basis === 'pl_affiliation' || evidence.tie?.basis === 'pl_network' || /AGENTS\.md rule 6/.test(source)) return 'PL network';
  if (evidence.warehouseTie || /warehouse/i.test(source)) return 'Warehouse';
  if (evidence.derived === 'research' || /\bW3\b/.test(source)) return 'W3 paths';
  if (evidence.derived === 'network_nodes' || /^https?:\/\//.test(source) || /enrich\//.test(source)) return 'Research';
  return 'Other records';
}

export function edgeSourceClasses(edge: Pick<Edge, 'kind' | 'evidence'>): SourceClass[] {
  if (!edge.evidence.length) return [edge.kind === 'possible_identity' ? 'Identity match' : 'Other records'];
  return [...new Set(edge.evidence.map((e) => evidenceSourceClass(edge.kind, e as Evidence)))];
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

// GUESS: fewer than five edges on a team member is "almost none" at today's graph size.
export const THIN_TEAM_EDGES = 5;

export interface GapWarning { key: 'no_edges' | 'only_d' | 'one_source' | 'thin_team' | 'lp_no_route' | 'thin_team_list' | 'truncated'; text: string }
export interface ThroughGaps {
  /** Every current edge touching X; `inspected` of them carried evidence into these counts. */
  total: number;
  inspected: number;
  /** An edge carrying evidence from two sources counts under each. */
  bySource: Array<{ source: SourceClass; edges: number; from: string | null; to: string | null }>;
  byKind: Array<{ kind: EdgeKind; edges: number }>;
  byTier: Record<EvidenceTier, number>;
  warnings: GapWarning[];
}

/** Pure counts over invented or real edges; the page and the property tests share it. */
export function throughGaps(input: {
  nodeName: string; edges: Array<Pick<Edge, 'kind' | 'tier' | 'evidence' | 'validFrom'>>; total: number;
  isTeam: boolean; pursuedLp: boolean; usableRoutesToNode: number | null;
  thinTeam?: Array<{ name: string; edges: number }>;
}): ThroughGaps {
  const { nodeName, edges } = input;
  const sources = new Map<SourceClass, { edges: number; from: string | null; to: string | null }>();
  const kinds = new Map<EdgeKind, number>();
  const byTier: Record<EvidenceTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const edge of edges) {
    byTier[edge.tier]++;
    kinds.set(edge.kind, (kinds.get(edge.kind) ?? 0) + 1);
    const items = edge.evidence.length ? edge.evidence : [{ note: '' }];
    const seen = new Set<SourceClass>();
    for (const ev of items) {
      const cls = edge.evidence.length ? evidenceSourceClass(edge.kind, ev as Evidence) : edgeSourceClasses(edge)[0]!;
      const date = /^\d{4}-\d{2}-\d{2}/.test(ev.as_of ?? '') ? ev.as_of!.slice(0, 10) : dayOf(edge.validFrom);
      const row = sources.get(cls) ?? { edges: 0, from: null, to: null };
      if (!seen.has(cls)) { row.edges++; seen.add(cls); }
      if (!row.from || date < row.from) row.from = date;
      if (!row.to || date > row.to) row.to = date;
      sources.set(cls, row);
    }
  }
  const n = edges.length;
  const warnings: GapWarning[] = [];
  if (input.total > n) warnings.push({ key: 'truncated', text: `${nodeName} has ${input.total.toLocaleString('en-US')} edges; the first ${n.toLocaleString('en-US')} (ties to LPs we pursue first, then by edge id) were inspected for these counts and the ties below.` });
  if (input.total === 0) warnings.push({ key: 'no_edges', text: `No relationship edges are on file for ${nodeName}. Nothing routes to or through them in our records: a gap in the material, not proof they know nobody.` });
  if (n > 0 && byTier.D === n) warnings.push({ key: 'only_d', text: `Every edge on ${nodeName} is tier D, proximity only. None establishes a relationship; each is a discovery clue.` });
  if (n > 1 && sources.size === 1) warnings.push({ key: 'one_source', text: `All ${n} edges on ${nodeName} come from one source, ${[...sources.keys()][0]}. The other corpora add nothing here yet.` });
  if (input.isTeam && input.total < THIN_TEAM_EDGES) warnings.push({ key: 'thin_team', text: `${nodeName} is one of our route sources but has only ${input.total} ${input.total === 1 ? 'edge' : 'edges'}. Their own network is mostly missing from the records.` });
  if (input.pursuedLp && input.usableRoutesToNode === 0) warnings.push({ key: 'lp_no_route', text: `${nodeName} is an LP we pursue and no usable route to them is on file.` });
  const thin = input.thinTeam?.filter((t) => t.edges < THIN_TEAM_EDGES) ?? [];
  if (thin.length) warnings.push({ key: 'thin_team_list', text: `Route sources with fewer than ${THIN_TEAM_EDGES} edges: ${thin.map((t) => `${t.name} (${t.edges})`).join(', ')}.` });
  return {
    total: input.total, inspected: n,
    bySource: SOURCE_CLASSES.filter((s) => sources.has(s)).map((source) => ({ source, ...sources.get(source)! })),
    byKind: [...kinds].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind, edges]) => ({ kind, edges })),
    byTier, warnings,
  };
}

export interface LpFlag { entityId: string; name: string; vehicleName: string; vehicleSlug: string; status: string; via: 'self' | 'contact'; role: string | null }
export interface OnwardTie {
  otherId: string;
  otherName: string;
  /** Strongest first: the row's tier, kind and warmth come from edges[0]. */
  edges: Edge[];
  sources: SourceClass[];
  lps: LpFlag[];
  /** Weaker of our best route to X and X's tie to them; null when no usable route to X is on file. */
  combinedTier: EvidenceTier | null;
  warmth: number;
}

/** LPs we pursue first, then the combined route tier, the tie's own tier, warmth and name. */
export function rankOnward<T extends Pick<OnwardTie, 'lps' | 'combinedTier' | 'warmth' | 'otherName'> & { edges: Array<Pick<Edge, 'tier'>> }>(ties: T[]): T[] {
  const tierRank = (t: EvidenceTier | null) => t === null ? 9 : TIER_ORDER[t];
  return [...ties].sort((a, b) => Number(b.lps.length > 0) - Number(a.lps.length > 0)
    || tierRank(a.combinedTier) - tierRank(b.combinedTier)
    || TIER_ORDER[a.edges[0]!.tier] - TIER_ORDER[b.edges[0]!.tier]
    || b.warmth - a.warmth || a.otherName.localeCompare(b.otherName));
}

/** The usable route to X with the strongest weakest hop, then the best score. */
export function bestRouteTo(routes: Route[]): Route | null {
  const usable = routes.filter((r) => r.verdict === 'recommend' && r.foldedUnder == null);
  return usable.sort((a, b) => TIER_ORDER[a.weakestTier] - TIER_ORDER[b.weakestTier]
    || (b.score?.value ?? -1) - (a.score?.value ?? -1))[0] ?? null;
}

export interface ThroughView {
  nodeId: string;
  nodeName: string;
  /** X is a team member, PL staff or the PL organization: our routes start at X. */
  source: { kind: 'team' | 'pl' } | null;
  /** A do-not-approach instruction on X: nothing is offered through them (rule 8). */
  nodeRestricted: boolean;
  bestRoute: Route | null;
  onward: OnwardTie[];
  /** Ties to people with a restriction that applies to this approach; never listed (rule 8). */
  restrictedOnward: number;
  gaps: ThroughGaps;
  /** LPs we pursue whose cached candidate paths all pass through X, or that have none at all. */
  onlyThrough: Array<{ entityId: string; name: string; candidates: number }>;
  /** `failed`: the read did not finish; `uncounted`: stored before shared paths were recorded. */
  onlyThroughCoverage: { lps: number; checked: number; cached: number; uncounted: number; failed: boolean; computedFrom: string | null; computedTo: string | null };
}

async function lpFlags(ids: string[]): Promise<Map<string, LpFlag[]>> {
  const out = new Map<string, LpFlag[]>();
  if (!ids.length) return out;
  const rows = await (await getDb()).query<{ node: string; lp: string; lp_name: string; vehicle: string; slug: string; status: string; via: 'self' | 'contact'; role: string | null }>(`
    with ys as (select distinct identity.canonical_entity_id(x) id from unnest($1::uuid[]) x),
    open as (select p.pursuit_id, identity.canonical_entity_id(p.entity_id) lp, p.status::text status, v.name vehicle, v.slug
      from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id
      where p.closed_at is null and v.phase <> 'historical')
    select y.id::text node, o.lp::text lp, e.display_name lp_name, o.vehicle, o.slug, o.status, 'self' via, null::text role
      from ys y join open o on o.lp = y.id join identity.entity e on e.entity_id = o.lp
    union all
    select y.id::text, o.lp::text, e.display_name, o.vehicle, o.slug, o.status, 'contact', c.role
      from strategy.pursuit_contact c join open o using (pursuit_id)
      join ys y on y.id = identity.canonical_entity_id(c.person_entity) join identity.entity e on e.entity_id = o.lp
     where c.source is distinct from 'dakota' and o.lp <> y.id
    union all
    select y.id::text, o.lp::text, e.display_name, o.vehicle, o.slug, o.status, 'contact', a.role
      from identity.affiliation a join ys y on y.id = identity.canonical_entity_id(a.person_entity)
      join open o on o.lp = identity.canonical_entity_id(a.org_entity) join identity.entity e on e.entity_id = o.lp
     where a.ended_on is null and a.is_primary and a.kind in ('principal','decision_maker','staff','contact')
       and a.source is distinct from 'dakota' and o.lp <> y.id`, [ids]);
  for (const r of rows) {
    const list = out.get(r.node) ?? [];
    if (!list.some((f) => f.entityId === r.lp && f.vehicleSlug === r.slug)) {
      list.push({ entityId: r.lp, name: r.lp_name, vehicleName: r.vehicle, vehicleSlug: r.slug, status: r.status, via: r.via, role: r.role?.trim() || null });
    }
    out.set(r.node, list);
  }
  return out;
}

/** Restrictions attach to the target (rule 8): a blanket or vehicle do-not-contact on Y, or a
 * connector restriction naming X or anyone on our way to X, removes Y from what is offered. */
async function restrictedOnward(ys: string[], pathNodes: string[], vehicleId?: string): Promise<Set<string>> {
  if (!ys.length) return new Set();
  const [policy, rows] = await Promise.all([
    routePolicyFacts(ys, vehicleId),
    (await getDb()).query<{ id: string }>(`select identity.canonical_entity_id(entity_id)::text id from coordination.restriction
      where identity.canonical_entity_id(entity_id) = any(select identity.canonical_entity_id(x) from unnest($1::uuid[]) x)
        and (expires_at is null or expires_at > current_date)
        and (scope = 'blanket' or identity.canonical_entity_id(connector_id) = any(select identity.canonical_entity_id(x) from unnest($2::uuid[]) x))`,
    [ys, pathNodes]),
  ]);
  return new Set([...ys.filter((y) => policy.blocked.has(y)), ...rows.map((r) => r.id)]);
}

/** Which pursued LPs reach us only through X: one primary-key read of what each stored search's
 * candidate paths all share (cache.ts sharedNodes). Searches stored before that column existed are
 * reported as not yet counted, never guessed. */
async function onlyThroughX(nodeId: string, lpIds: string[], vehicleKind: string) {
  const none = { rows: [] as Array<{ id: string; total: number; throughAll: boolean }>, uncounted: 0, computedFrom: null as string | null, computedTo: null as string | null };
  if (!lpIds.length) return none;
  const db = await getDb();
  const { generation } = await revisionFor(db);
  const found = await db.query<{ id: string; total: number | null; through_all: boolean | null; computed_at: string }>(`
    select target_id::text as id, candidate_count as total, shared_nodes @> array[$4::uuid] as through_all, computed_at::text as computed_at
      from network.route_cache where target_id = any($1::uuid[]) and vehicle_kind = $2 and revision = $3`,
  [lpIds, vehicleKind, generation, nodeId]);
  const rows = found.flatMap((r) => r.total === null ? [] : [{ id: r.id, total: r.total, throughAll: Boolean(r.through_all) }]);
  const dates = found.map((r) => r.computed_at.slice(0, 10)).sort();
  return { rows, uncounted: found.length - rows.length, computedFrom: dates[0] ?? null, computedTo: dates.at(-1) ?? null };
}

async function teamEdgeCounts(): Promise<Array<{ name: string; edges: number }>> {
  const team = await (await getDb()).query<{ id: string; name: string }>(`select distinct identity.canonical_entity_id(s.entity_id)::text as id, u.name
    from identity.source_record s join platform.app_user u on u.handle = s.source_id where s.source = 'app_user' and u.active`);
  const counts = await edgeCountsForEntities(team.map((t) => t.id));
  return team.map((t) => ({ name: t.name, edges: counts.get(t.id) ?? 0 }));
}

/** The whole view for one node. `routesToNode` is the planner's (cached) search for X. */
export async function throughNode(nodeId: string, options: { routesToNode: Route[]; vehicleId?: string; vehicleKind?: string; limit?: number }): Promise<ThroughView> {
  nodeId = await canonicalRouteEntity(nodeId);
  const [[named], sources, touching, policy] = await Promise.all([
    routeNodeNames([nodeId]), routeSources(), edgesTouching(nodeId, options.limit ?? 2000),
    routePolicyFacts([nodeId], options.vehicleId),
  ]);
  const nodeName = named?.displayName ?? 'Unknown';
  const own = sources.find((s) => s.entityId === nodeId);
  const source = own ? { kind: own.sourceOnly ? 'pl' as const : 'team' as const } : null;
  const nodeBlanket = (await (await getDb()).query<{ n: number }>(`select count(*)::int n from coordination.restriction
    where identity.canonical_entity_id(entity_id) = $1::uuid and scope = 'blanket' and (expires_at is null or expires_at > current_date)`, [nodeId]))[0]!.n > 0;
  const nodeRestricted = nodeBlanket || policy.blocked.has(nodeId);
  const bestRoute = source ? null : bestRouteTo(options.routesToNode);
  const readWarmth = warmthReader();

  // Group X's edges by the node on the other end; the strongest edge leads its row.
  const byOther = new Map<string, { name: string; edges: Edge[] }>();
  for (const edge of touching.edges) {
    const [otherId, otherName] = edge.fromEntity === nodeId ? [edge.toEntity, edge.toName] : [edge.fromEntity, edge.fromName];
    if (otherId === nodeId) continue;
    const row = byOther.get(otherId) ?? { name: otherName, edges: [] };
    row.edges.push(edge); byOther.set(otherId, row);
  }
  const otherIds = [...byOther.keys()];
  const pathNodes = [nodeId, ...(bestRoute ? [bestRoute.fromEntity!, ...bestRoute.connectorIds] : [])].filter(Boolean);
  const [flags, restricted] = await Promise.all([lpFlags(otherIds), nodeRestricted ? Promise.resolve(new Set<string>()) : restrictedOnward(otherIds, pathNodes, options.vehicleId)]);
  const sourceIds = new Set(sources.map((s) => s.entityId));
  const firstTier = source ? null : bestRoute?.weakestTier;
  const onward: OnwardTie[] = nodeRestricted ? [] : rankOnward(otherIds
    // Our own team and PL are where routes start, not people X introduces us to.
    .filter((id) => !restricted.has(id) && !sourceIds.has(id))
    .map((id) => {
      const { name, edges } = byOther.get(id)!;
      edges.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || readWarmth(b).score - readWarmth(a).score || a.edgeId.localeCompare(b.edgeId));
      return { otherId: id, otherName: name, edges, sources: [...new Set(edges.flatMap(edgeSourceClasses))], lps: flags.get(id) ?? [],
        combinedTier: firstTier === undefined ? null : weakerTier(firstTier, edges[0]!.tier), warmth: readWarmth(edges[0]!).score };
    }));

  const allLpIds = [...new Set(onward.flatMap((t) => t.lps.map((l) => l.entityId)))];
  // GUESS: 2,000 primary-key reads bound one page on a hub; the rest are disclosed as unchecked.
  const lpIds = allLpIds.slice(0, 2000);
  // A section that fails says so; it never takes the page down with it.
  const only = await onlyThroughX(nodeId, lpIds, options.vehicleKind ?? 'fund').catch(() => null);
  const lpName = new Map(onward.flatMap((t) => t.lps.map((l) => [l.entityId, l.name] as const)));
  const cached = new Map((only?.rows ?? []).map((r) => [r.id, r]));
  // No cached path at all counts only when the way through X is usable: then X is the only way we see.
  const viaX = new Set(onward.filter((t) => t.combinedTier !== null).flatMap((t) => t.lps.map((l) => l.entityId)));
  const onlyThrough = lpIds.flatMap((id) => {
    const row = cached.get(id);
    return row && (row.total > 0 ? row.throughAll : viaX.has(id))
      ? [{ entityId: id, name: lpName.get(id) ?? 'Unknown', candidates: row.total }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));

  const ownFlags = (await lpFlags([nodeId])).get(nodeId) ?? [];
  // Through PL: which of the active team (app users, not every PL alumnus) has almost no edges.
  const thinTeam = source?.kind === 'pl' ? await teamEdgeCounts().catch(() => undefined) : undefined;
  const gaps = throughGaps({ nodeName, edges: touching.edges, total: touching.total, isTeam: source?.kind === 'team',
    pursuedLp: ownFlags.some((f) => f.via === 'self'),
    usableRoutesToNode: source ? null : options.routesToNode.filter((r) => r.verdict === 'recommend').length, thinTeam });
  return { nodeId, nodeName, source, nodeRestricted, bestRoute, onward, restrictedOnward: restricted.size, gaps,
    onlyThrough, onlyThroughCoverage: { lps: allLpIds.length, checked: lpIds.length, cached: (only?.rows.length ?? 0) + (only?.uncounted ?? 0), uncounted: only?.uncounted ?? 0,
      failed: only === null, computedFrom: only?.computedFrom ?? null, computedTo: only?.computedTo ?? null } };
}

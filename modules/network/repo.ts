import { getDb } from '@/lib/db';
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
 * Enumerate every currently-valid path from `fromEntity` to `targetEntity` up to `maxHops`.
 *
 * Deliberately enumerates unusable paths too. A planner that silently drops the
 * proximity-only path returns an empty list, and an empty list reads as "no route exists"
 * while only justifying "no route in the material available". The caller labels them.
 */
export async function enumeratePaths(
  fromEntity: string, targetEntity: string, maxHops = 3,
): Promise<RawPath[]> {
  const db = await getDb();
  // Searched from the target's side, which has few links, and joined back to the source, which may have
  // tens of thousands (the PL organization, or a team member tied to the PL network). A walk forward from
  // the source expanded millions of partial paths once the warehouse joined the graph (26 Sep). The PL
  // organization is a route source, never a middle hop (AGENTS.md rule 6). Capped: the caller ranks.
  return db.query<RawPath>(
    `with pl as (
       select e.entity_id from identity.entity e join identity.source_record s on s.entity_id = e.entity_id
        where s.source = 'w3_person' and e.entity_type = 'org' and e.display_name = 'PL'),
     valid as (select a, b, edge_id from network.link where valid_to is null or valid_to >= current_date),
     y as (
       select l.a as y, l.edge_id as e3 from valid l
        where l.b = $2 and l.a <> $1 and not exists (select 1 from pl where pl.entity_id = l.a)),
     p1 as (
       select array[l.a, l.b] as nodes, array[l.edge_id] as edges, 1 as hops
         from valid l where l.a = $1 and l.b = $2),
     p2 as (
       select array[l.a, y.y, $2::uuid] as nodes, array[l.edge_id, y.e3] as edges, 2 as hops
         from y join valid l on l.a = $1 and l.b = y.y
        where $3 >= 2),
     p3 as (
       select array[l1.a, l2.a, y.y, $2::uuid] as nodes, array[l1.edge_id, l2.edge_id, y.e3] as edges, 3 as hops
         from y join valid l2 on l2.b = y.y
         join valid l1 on l1.a = $1 and l1.b = l2.a
        where $3 >= 3 and l2.a <> $1 and l2.a <> $2 and l2.a <> y.y
          and not exists (select 1 from pl where pl.entity_id = l2.a))
     select nodes, edges, hops from (
       select * from p1 union all select * from p2 union all select * from p3) paths
      order by hops, edges limit 300`,
    [fromEntity, targetEntity, maxHops],
  );
}

export async function edgeCoverage() {
  const db = await getDb();
  const row = await db.one<{ n: string; from: Date | string | null; to: Date | string | null }>(
    `select count(*)::text as n, min(valid_from) as from,
            max(coalesce(valid_to, current_date)) as to
       from network.edge`,
  );
  return {
    edges: Number(row?.n ?? 0),
    from: row?.from ? new Date(row.from) : null,
    to: row?.to ? new Date(row.to) : null,
  };
}

export async function tierCounts(): Promise<Array<{ tier: EvidenceTier; n: number; reviewed: number }>> {
  const db = await getDb();
  const rows = await db.query<{ tier: EvidenceTier; n: string; reviewed: string }>(
    `select tier, count(*)::text as n, count(reviewed_by)::text as reviewed
       from network.edge group by tier order by tier`,
  );
  return rows.map((r) => ({ tier: r.tier, n: Number(r.n), reviewed: Number(r.reviewed) }));
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

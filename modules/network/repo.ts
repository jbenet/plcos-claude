import { getDb } from '@/lib/db';
import type { Edge, EdgeKind, EvidenceTier } from './types';

type EdgeRow = {
  edge_id: string; from_entity: string; to_entity: string; from_name: string; to_name: string;
  kind: EdgeKind; tier: EvidenceTier; strength: string | null; tie_band: string | null;
  evidence: Array<{ doc?: string; note: string }>; reviewed_by_name: string | null;
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
  return db.query<RawPath>(
    `with recursive walk as (
       select l.b as node,
              array[l.a, l.b] as nodes,
              array[l.edge_id] as edges,
              1 as hops
         from network.link l
        where l.a = $1
          and (l.valid_to is null or l.valid_to >= current_date)
       union all
       select l.b,
              w.nodes || l.b,
              w.edges || l.edge_id,
              w.hops + 1
         from walk w
         join network.link l on l.a = w.node
        where w.hops < $3
          and not (l.b = any(w.nodes))
          and (l.valid_to is null or l.valid_to >= current_date)
     )
     select nodes, edges, hops from walk where node = $2 order by hops, edges`,
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

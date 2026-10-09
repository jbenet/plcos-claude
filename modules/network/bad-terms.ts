import { getDb } from '@/lib/db';

/**
 * Issue 0143: two people on bad terms. Warmth measures how close a tie is, not whether it is friendly, so a
 * founder at odds with an LP still scored as the best way in. A person marks the pair; every route that would
 * ask one of them about the other is then excluded, with this mark as the reason. Undone, never deleted.
 */
export interface BadTermsMark { markId: string; a: string; b: string; aName: string; bName: string; note: string | null; byName: string; at: Date }

const ordered = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

export async function listBadTerms(entityIds?: string[]): Promise<BadTermsMark[]> {
  const db = await getDb();
  return db.query<BadTermsMark>(
    `select m.mark_id::text "markId", m.a_entity::text a, m.b_entity::text b, ea.display_name "aName", eb.display_name "bName",
            m.note, u.name "byName", m.recorded_at at
       from network.bad_terms m join identity.entity ea on ea.entity_id = m.a_entity join identity.entity eb on eb.entity_id = m.b_entity
       join platform.app_user u on u.id = m.recorded_by
      where m.undone_at is null and ($1::uuid[] is null or m.a_entity = any($1::uuid[]) or m.b_entity = any($1::uuid[]))
      order by m.recorded_at`, [entityIds ?? null]);
}

export async function markBadTerms(actorId: string, x: string, y: string, note: string | null): Promise<string> {
  if (x === y) throw new Error('Pick two different people.');
  const [a, b] = ordered(x, y);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const found = await tx.query<{ id: string }>('select entity_id::text id from identity.entity where entity_id = any($1::uuid[])', [[a, b]]);
    if (found.length !== 2) throw new Error('Unknown person.');
    const existing = await tx.one<{ id: string }>('select mark_id::text id from network.bad_terms where a_entity = $1 and b_entity = $2 and undone_at is null', [a, b]);
    if (existing) return existing.id;
    const row = (await tx.one<{ id: string }>(
      'insert into network.bad_terms (a_entity, b_entity, note, recorded_by) values ($1, $2, $3, $4) returning mark_id::text id', [a, b, note, actorId]))!;
    await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail) values ($1, 'route.bad_terms', 'edge', null, $2)`,
      [actorId, JSON.stringify({ mark: row.id, a, b, note })]);
    return row.id;
  });
}

export async function undoBadTerms(actorId: string, markId: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const done = await tx.query<{ id: string }>(
      'update network.bad_terms set undone_by = $2, undone_at = now() where mark_id = $1 and undone_at is null returning mark_id::text id', [markId, actorId]);
    if (done.length) await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail) values ($1, 'route.bad_terms_undone', 'edge', null, $2)`,
      [actorId, JSON.stringify({ mark: markId })]);
    return done.length > 0;
  });
}

/**
 * Issue 0144: a team member's own tie to someone, stated by that team member. A shared organisation alone never
 * makes a personal tie (a hub path through it is proximity, and big hubs are dropped), so a tie the graph cannot
 * see is said here: a reviewed edge from the team member to the person, graded from what was said like any other.
 * Rebuilds keep it (it carries no derived evidence); declining the edge ends it.
 */
export const OWN_TIE_KINDS = {
  worked_together: { label: 'We worked together', edge: 'colleague' },
  acquaintance: { label: 'I know them directly', edge: 'met' },
  close_friend: { label: 'Close friends', edge: 'other' },
  cofounder: { label: 'We co-founded something together', edge: 'colleague' },
  family: { label: 'Family', edge: 'family' },
} as const;
export type OwnTieKind = keyof typeof OWN_TIE_KINDS;

export interface OwnTie { edgeId: string; kind: string; tier: string; note: string; at: Date }

export async function ownTies(handle: string, entityId: string): Promise<OwnTie[]> {
  const db = await getDb();
  return db.query<OwnTie>(
    `select e.edge_id::text "edgeId", e.kind::text kind, e.tier::text tier, coalesce(e.review_note, '') note, e.reviewed_at at
       from network.edge e join identity.source_record s on s.source = 'app_user' and s.source_id = $1
      where e.from_entity = identity.canonical_entity_id(s.entity_id) and e.to_entity = $2::uuid
        and (e.valid_to is null or e.valid_to >= current_date) and e.evidence @> '[{"derived":"stated"}]'::jsonb
      order by e.reviewed_at desc`, [handle, entityId]);
}

export async function recordOwnTie(actor: { id: string; handle: string }, entityId: string, kind: OwnTieKind, note: string | null,
  lastInteraction: string | null): Promise<string> {
  const { entityForUser } = await import('./repo');
  const { edgeGrade, tieWarmth, tieDetailsProblems } = await import('./warmth');
  const { config } = await import('@/config/deployment');
  if (!Object.hasOwn(OWN_TIE_KINDS, kind)) throw new Error('Unknown kind of tie.');
  const me = await entityForUser(actor.handle);
  if (!me) throw new Error('You are not linked to the graph yet; build the network first.');
  if (me.entityId === entityId) throw new Error('That is you.');
  const tie = { kind, directInteraction: true, ...(lastInteraction ? { lastInteraction } : {}) } as const;
  if (tieDetailsProblems(tie).length) throw new Error(tieDetailsProblems(tie).join('; '));
  const today = new Date().toISOString().slice(0, 10);
  const label = OWN_TIE_KINDS[kind].label;
  const edgeKind = OWN_TIE_KINDS[kind].edge;
  const evidence = [{ derived: 'stated', tie, note: `${label}, as ${actor.handle} said${note ? `: ${note}` : ''}`, source: `stated:${actor.handle}`,
    as_of: today, last_verified_by: actor.handle }];
  const tier = edgeGrade({ kind: edgeKind, evidence });
  const band = tieWarmth(edgeKind, tie).score >= config.routeWarmth.strongFirstHop ? 'strong' : 'moderate';
  const db = await getDb();
  return db.transaction(async (tx) => {
    const target = await tx.one<{ id: string }>('select identity.canonical_entity_id($1::uuid)::text id', [entityId]);
    if (!target?.id) throw new Error('Unknown person.');
    // One stated tie per kind: a second statement replaces the first.
    await tx.query(`update network.edge set valid_to = current_date - 1 where from_entity = $1 and to_entity = $2 and kind = $3::network.edge_kind
      and valid_to is null and evidence @> '[{"derived":"stated"}]'::jsonb`, [me.entityId, target.id, edgeKind]);
    const row = (await tx.one<{ id: string }>(
      `insert into network.edge (from_entity, to_entity, kind, tier, tie_band, evidence, valid_from, reviewed_by, reviewed_at, review_note)
       values ($1, $2, $3::network.edge_kind, $4::network.evidence_tier, $5, $6::jsonb, current_date, $7, now(), $8) returning edge_id::text id`,
      [me.entityId, target.id, edgeKind, tier, band, JSON.stringify(evidence), actor.id, `${label}${note ? `: ${note}` : ''}`]))!;
    await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail) values ($1, 'edge.stated', 'edge', null, $2)`,
      [actor.id, JSON.stringify({ edge: row.id, kind, tier })]);
    return row.id;
  });
}

import { getDb, type Queryable } from '@/lib/db';
import { GROUP_EVENT, isAutoReply } from '@/modules/meetings';
import type { EdgeKind, EvidenceTier } from './types';
import { warehousePathKind, type Path } from '@/lib/enrich/connect';
import { config } from '@/config/deployment';
import { tieWarmth } from './warmth';
import { researchEndpoint, researchTie } from './research-path';

/**
 * The network, built from what we already know (N82).
 *
 * Juan, 24 Sep, on "Routes to —": "How do i fix this? you have our names, can you set these
 * connections yourself, or suggest some for me to verify?" A route is walked from the person
 * record of whoever is looking, and on the real account nobody on the team had one, and no edge
 * existed at all. So:
 *
 *   1. The team. Each active user gets a person record in the graph, joined to their login as the
 *      demo's are (identity.source_record, source 'app_user').
 *   2. The records. A one-to-one meeting or call held with someone on the team is a documented
 *      working relationship — tier A, "met". A message from them to someone on the team is some
 *      interaction — tier B, "corresponded". Our own events (GROUP_EVENT or more of our records on
 *      one calendar entry) are not meetings, and say nothing about who knows whom.
 *   3. The research. The paths W3 found (docs/19), as edges with the tier each was given. A and B
 *      carry routes; C and D route with labelled uncertainty (rule 6).
 *      Organization nodes, including PL, can connect paths too.
 *
 * Idempotent. Each edge built here says where it came from in its evidence — `derived`, with the
 * source and the date — and a rebuild replaces the ones nobody has reviewed. A reported false tie stays ended. Confirmation remains provenance while
 * current evidence can change the modelled tier and warmth.
 */

export interface BuildCounts {
  teamCreated: number;
  fromRecords: number;
  fromResearch: number;
  /** C and D ties with weaker evidence (legacy counter name). */
  toConfirm: number;
  /** Corrections and confirmations on file, kept as recorded. */
  keptReviewed: number;
  /** Research paths with no person at the other end: one of our organizations, or someone not in the tool. */
  notPeople: number;
}

/** How W3's kinds become edge kinds. "The same firm, now" is a colleague. */
const KIND: Record<string, EdgeKind> = {
  met: 'met', colleague: 'colleague', same_firm: 'colleague', alumni: 'alumni', coinvestor: 'coinvestor',
  board: 'board', advisor: 'advisor', corresponded: 'corresponded', portfolio: 'portfolio', other: 'other',
};

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const pairKey = (a: string, b: string, kind: string) => `${[a, b].sort().join('|')}|${kind}`;

interface NewEdge { reviewedBy?: string; reviewedAt?: string; reviewNote?: string | null; from: string; to: string; kind: EdgeKind; tier: EvidenceTier; band: string; since: string; evidence: Array<Record<string, unknown>> }

export async function buildNetwork(): Promise<BuildCounts> {
  const db = await getDb();
  return db.transaction((tx) => build(tx));
}

async function build(tx: Queryable): Promise<BuildCounts> {
  const counts: BuildCounts = { teamCreated: 0, fromRecords: 0, fromResearch: 0, toConfirm: 0, keptReviewed: 0, notPeople: 0 };
  const today = new Date().toISOString().slice(0, 10);

  // 1. The team, as people in the graph.
  const users = await tx.query<{ id: string; handle: string; name: string; entity_id: string | null }>(
    `select u.id::text, u.handle, u.name, s.entity_id::text
       from platform.app_user u
       left join identity.source_record s on s.source = 'app_user' and s.source_id = u.handle
      where u.active`,
  );
  const entityOfUser = new Map<string, string>();
  for (const u of users) {
    let id = u.entity_id;
    if (!id) {
      id = (await tx.one<{ entity_id: string }>(
        `insert into identity.entity (entity_type, display_name) values ('person', $1) returning entity_id::text`, [u.name],
      ))!.entity_id;
      await tx.query(
        `insert into identity.source_record (source, source_id, entity_id, resolved_by)
         values ('app_user', $1, $2, 'rule:handle') on conflict (source, source_id) do nothing`,
        [u.handle, id],
      );
      counts.teamCreated++;
    }
    entityOfUser.set(u.id, id);
  }
  const userByName = new Map(users.map((u) => [norm(u.name), u.id]));
  const userByHandle = new Map(users.map((u) => [u.handle, u.id]));
  const teamEntities = new Set(entityOfUser.values());

  // A false-tie correction stays ended. Confirmation is provenance, not a freeze on
  // the model: rebuild active derived edges from current evidence, retaining attribution.
  const reviewed = await tx.query<{ a: string; b: string; kind: string; reviewer: string; at: string; note: string | null; ended: string | null }>(
    `select from_entity::text as a, to_entity::text as b, kind::text, reviewed_by::text as reviewer, reviewed_at::text as at, review_note as note, valid_to::text as ended from network.edge where reviewed_at is not null`,
  );
  const kept = new Set(reviewed.filter((r) => r.ended).map((r) => pairKey(r.a, r.b, r.kind)));
  const priorReview = new Map(reviewed.filter((r) => !r.ended).map((r) => [pairKey(r.a, r.b, r.kind), r]));
  counts.keptReviewed = reviewed.length;
  await tx.query(
    `delete from network.edge where (reviewed_at is null or valid_to is null)
        and (evidence @> '[{"derived": "records"}]'::jsonb or evidence @> '[{"derived": "research"}]'::jsonb)`,
  );

  const edges = new Map<string, NewEdge>();
  const add = (e: NewEdge) => {
    if (e.from === e.to) return false;
    const k = pairKey(e.from, e.to, e.kind);
    if (kept.has(k)) return false;
    const prior = priorReview.get(k);
    if (prior && !e.reviewedBy) { e.reviewedBy = prior.reviewer; e.reviewedAt = prior.at; e.reviewNote = prior.note; }
    const existing = edges.get(k);
    if (existing) {
      // Keep every basis; take the strongest evidence tier, never derive it from warmth.
      existing.evidence.push(...e.evidence);
      if (e.reviewedBy && e.reviewedAt) { existing.reviewedBy = e.reviewedBy; existing.reviewedAt = e.reviewedAt; }
      if (e.tier < existing.tier) existing.tier = e.tier;
      if (e.since < existing.since) existing.since = e.since;
      return false;
    }
    edges.set(k, e);
    return true;
  };

  // 2. The records: who on the team has met them one to one, or heard from them.
  const rows = await tx.query<{ entity_id: string; owner_id: string; attendees: string[] | null; channel: string; direction: string | null; on: string; group_size: number | null; basis: string | null }>(
    `select m.entity_id::text, m.owner_id::text, m.attendees, m.channel::text, m.direction, m.held_on::text as on, m.group_size, m.about_basis as basis
       from meetings.meeting m
      where m.held_on is not null and m.held_on <= current_date and m.channel in ('meeting', 'call', 'email', 'message')`,
  );
  type Tally = { meetings: string[]; heard: string[] };
  const tally = new Map<string, Tally>();
  for (const r of rows) {
    if (teamEntities.has(r.entity_id)) continue;
    const met = (r.channel === 'meeting' || r.channel === 'call') && (r.group_size ?? 1) < GROUP_EVENT;
    // An automatic reply is nobody's word (N81): no tie rests on an out-of-office note.
    const heard = (r.channel === 'email' || r.channel === 'message') && r.direction === 'theirs'
      && !isAutoReply({ direction: 'theirs', aboutBasis: r.basis });
    if (!met && !heard) continue;
    const who = new Set<string>();
    if (entityOfUser.has(r.owner_id)) who.add(r.owner_id);
    for (const a of r.attendees ?? []) { const u = userByName.get(norm(a)); if (u) who.add(u); }
    for (const u of who) {
      const k = `${u}|${r.entity_id}`;
      const t = tally.get(k) ?? { meetings: [], heard: [] };
      (met ? t.meetings : t.heard).push(r.on);
      tally.set(k, t);
    }
  }
  // "18 Jun to 20 Sep 2026": a span in words, the year once when both ends share it.
  const span = (ds: string[]) => {
    const s = [...ds].sort();
    const d = (x: string, year: boolean) => new Date(`${x}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
    if (s.length === 1 || s[0] === s[s.length - 1]) return `on ${d(s[0]!, true)}`;
    return `${d(s[0]!, s[0]!.slice(0, 4) !== s[s.length - 1]!.slice(0, 4))} to ${d(s[s.length - 1]!, true)}`;
  };
  for (const [k, t] of tally) {
    const [userId, lp] = k.split('|') as [string, string];
    const from = entityOfUser.get(userId)!;
    const last = [...t.meetings, ...t.heard].sort().pop()!;
    const contactCount = new Set([...t.meetings, ...t.heard]).size;
    const tie = { kind: contactCount >= config.routeWarmth.repeatedContacts ? 'repeated_contact' as const : 'acquaintance' as const, lastInteraction: last };
    const warmth = tieWarmth('met', tie);
    if (t.meetings.length) {
      const n = new Set(t.meetings).size;
      if (add({
        from, to: lp, kind: 'met', tier: 'A', band: warmth.score >= config.routeWarmth.strongFirstHop ? 'strong' : 'moderate', since: [...t.meetings].sort()[0]!,
        evidence: [{ derived: 'records', tie, note: `${n} ${n === 1 ? 'meeting' : 'meetings'} held one to one, ${span(t.meetings)}`, source: 'Affinity calendar and notes, as translated', as_of: today }],
      })) counts.fromRecords++;
    } else {
      const n = t.heard.length;
      if (add({
        from, to: lp, kind: 'corresponded', tier: 'B', band: contactCount >= config.routeWarmth.repeatedContacts ? 'moderate' : 'weak', since: [...t.heard].sort()[0]!,
        evidence: [{ derived: 'records', tie, note: `${n} ${n === 1 ? 'message' : 'messages'} from them, ${span(t.heard)}`, source: 'Affinity mail sync, as translated', as_of: today }],
      })) counts.fromRecords++;
    }
  }

  // 3. The research: W3's paths, as the import left them on each LP.
  const notes = await tx.query<{ entity_id: string; at: string; data: { paths?: Path[] } }>(
    `select entity_id::text, created_at::text as at, data from research.note where kind = 'connection_candidates'`,
  );
  const people = await tx.query<{ id: string; name: string }>(`select entity_id::text as id, display_name as name from identity.entity`);
  const known = new Set(people.map((r) => r.id));
  const roster = people.map((p) => ({ ...p, handle: users.find((u) => entityOfUser.get(u.id) === p.id)?.handle }));
  // Warehouse identities are created only during this existing server-side import/build transaction.
  // Their stable source keys never merge ambiguous LP matches or people sharing a name.
  const warehouseEntities = new Map<string, string>();
  const conflictingMatches = new Set<string>();
  for (const n of notes) for (const p of n.data.paths ?? []) {
    const m = p.warehouse?.match;
    if (!m || m.status !== 'confident' || m.lpKey !== p.lp || !known.has(p.lp)) continue;
    const previous = warehouseEntities.get(m.personKey);
    if (previous && previous !== p.lp) conflictingMatches.add(m.personKey);
    warehouseEntities.set(m.personKey, p.lp);
  }
  for (const key of conflictingMatches) warehouseEntities.delete(key);
  const warehousePerson = async (p: NonNullable<Path['warehouse']>['people'][number]): Promise<string | undefined> => {
    if (conflictingMatches.has(p.key)) return undefined;
    if (p.teamKey) return entityOfUser.get(userByHandle.get(p.teamKey) ?? userByName.get(norm(p.name)) ?? '');
    const cached = warehouseEntities.get(p.key);
    if (cached) return cached;
    const existing = await tx.one<{ id: string }>(
      `select entity_id::text as id from identity.source_record where source = 'warehouse' and source_id = $1`, [p.key]);
    const id = existing?.id ?? (await tx.one<{ id: string }>(
      `insert into identity.entity (entity_type, display_name) values ('person', $1) returning entity_id::text as id`, [p.name]))!.id;
    if (!existing) await tx.query(
      `insert into identity.source_record (source, source_id, entity_id, resolved_by) values ('warehouse', $1, $2, 'rule:warehouse-id')`, [p.key, id]);
    warehouseEntities.set(p.key, id);
    return id;
  };
  const builtWarehouseTies = new Set<string>();
  const alreadyMet = new Set([...edges.values()].map((e) => [e.from, e.to].sort().join('|')));
  for (const n of notes) {
    for (const p of n.data.paths ?? []) {
      const lp = known.has(p.lp) ? p.lp : n.entity_id;
      if (!known.has(lp)) { counts.notPeople++; continue; }
      if (p.warehouse) {
        const w = p.warehouse;
        if (w.match.status !== 'confident' || w.match.lpKey !== lp || conflictingMatches.has(w.match.personKey)
          || w.people.at(-1)?.key !== w.match.personKey || w.ties.length !== w.people.length - 1) continue;
        for (let i = 0; i < w.ties.length; i++) {
          const t = w.ties[i]!, left = w.people[i]!, right = w.people[i + 1]!;
          if (!((t.from === left.key && t.to === right.key) || (t.to === left.key && t.from === right.key))) continue;
          const from = await warehousePerson(left), to = await warehousePerson(right);
          if (!from || !to) { counts.notPeople++; continue; }
          const seenKey = `${t.key}|${[from, to].sort().join('|')}`;
          if (builtWarehouseTies.has(seenKey)) continue;
          builtWarehouseTies.add(seenKey);
          const tie = { kind: t.kind, lastInteraction: t.lastSeen };
          const kind = KIND[warehousePathKind(t.kind)] ?? 'other';
          const warmth = tieWarmth(kind, tie);
          if (add({ from, to, kind, tier: t.tier,
            band: warmth.score >= config.routeWarmth.strongFirstHop ? 'strong' : warmth.score >= config.routeWarmth.priors.repeated_contact ? 'moderate' : 'weak',
            since: t.firstSeen ?? n.at.slice(0, 10), evidence: [{ derived: 'research', tie,
              note: `${t.kind.replaceAll('_', ' ')}; ${t.count} warehouse records`, source: t.source,
              as_of: right.as_of, rowIds: t.rowIds, warehouseTie: t.key,
              confidence: right.confidence, last_verified_by: right.last_verified_by }] })) {
            counts.fromResearch++;
            if (t.tier === 'C' || t.tier === 'D') counts.toConfirm++;
          }
        }
        continue;
      }
      const other = researchEndpoint(p.other, roster);
      if (!other) { counts.notPeople++; continue; }
      const kind = KIND[p.kind] ?? 'other';
      const tie = researchTie(p);
      const warmth = tieWarmth(kind, tie);
      // Our own record of meeting them says more than the research's "met".
      if (kind === 'met' && alreadyMet.has([other, lp].sort().join('|'))) continue;
      if (add({
        reviewedBy: p.reviewedBy && p.reviewedAt ? userByHandle.get(p.reviewedBy) : undefined,
        reviewedAt: p.reviewedAt,
        from: other, to: lp, kind, tier: p.tier, band: warmth.score >= config.routeWarmth.strongFirstHop ? 'strong' : warmth.score >= config.routeWarmth.priors.repeated_contact ? 'moderate' : 'weak', since: n.at.slice(0, 10),
        evidence: [{ derived: 'research', tie, note: p.basis, source: p.source ?? 'the research (W3)', as_of: n.at.slice(0, 10) }],
      })) {
        counts.fromResearch++;
        if (p.tier === 'C' || p.tier === 'D') counts.toConfirm++;
      }
    }
  }

  for (const e of edges.values()) {
    await tx.query(
      `insert into network.edge (from_entity, to_entity, kind, tier, strength, tie_band, evidence, valid_from, reviewed_by, reviewed_at, review_note)
       values ($1, $2, $3::network.edge_kind, $4::network.evidence_tier, null, $5, $6, $7::date, $8::uuid, $9::timestamptz, $10)`,
      [e.from, e.to, e.kind, e.tier, e.band, JSON.stringify(e.evidence), e.since, e.reviewedBy ?? null, e.reviewedBy ? e.reviewedAt : null, e.reviewNote ?? null],
    );
  }
  return counts;
}

/**
 * Record a voluntary correction, never an information gate. Confirmation adds provenance;
 * a reported false tie ends the edge, and rebuilds preserve that correction.
 */
export async function reviewEdge(actorId: string, edgeId: string, decision: 'confirm' | 'decline', note: string | null): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const e = await tx.one<{ tier: string; kind: string }>(`select tier::text, kind::text from network.edge where edge_id = $1`, [edgeId]);
    if (!e) throw new Error('No such tie.');
    await tx.query(
      decision === 'confirm'
        ? `update network.edge set reviewed_by = $2, reviewed_at = now(), review_note = $3, valid_to = null where edge_id = $1`
        : `update network.edge set reviewed_by = $2, reviewed_at = now(), review_note = $3, valid_to = current_date - 1 where edge_id = $1`,
      [edgeId, actorId, note ?? (decision === 'confirm' ? 'Confirmed' : 'Not a real tie')],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail) values ($1, $2, 'edge', null, $3)`,
      [actorId, decision === 'confirm' ? 'edge.confirmed' : 'edge.declined', JSON.stringify({ edge: edgeId, tier: e.tier, kind: e.kind, note })],
    );
  });
}

import { getDb, type Queryable } from '@/lib/db';
import { GROUP_EVENT } from '@/modules/meetings';
import type { EdgeKind, EvidenceTier } from './types';

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
 *      carry routes; C and D are shown, and wait for a person to confirm them (rule 6) — the planner
 *      refuses them until then. One of our organizations, rather than a person, is no hop: those
 *      stay candidates on the LP's page.
 *
 * Idempotent. Each edge built here says where it came from in its evidence — `derived`, with the
 * source and the date — and a rebuild replaces the ones nobody has reviewed. A person's confirmation
 * or "not a real tie" stands: the rebuild keeps that edge and makes no other for the same pair and
 * kind.
 */

export interface BuildCounts {
  teamCreated: number;
  fromRecords: number;
  fromResearch: number;
  /** C and D ties built for a person to confirm. */
  toConfirm: number;
  /** Ties a person already confirmed or turned down, kept as they left them. */
  keptReviewed: number;
  /** Research paths with no person at the other end: one of our organizations, or someone not in the tool. */
  notPeople: number;
}

/** How W3's kinds become edge kinds. "The same firm, now" is a colleague. */
const KIND: Record<string, EdgeKind> = {
  met: 'met', colleague: 'colleague', same_firm: 'colleague', alumni: 'alumni', coinvestor: 'coinvestor',
  board: 'board', portfolio: 'portfolio', other: 'other',
};

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const pairKey = (a: string, b: string, kind: string) => `${[a, b].sort().join('|')}|${kind}`;

interface NewEdge { from: string; to: string; kind: EdgeKind; tier: EvidenceTier; band: string; since: string; evidence: Array<Record<string, unknown>> }

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

  // What stands: a person's decision. Everything else built here before is rebuilt.
  const reviewed = await tx.query<{ a: string; b: string; kind: string }>(
    `select from_entity::text as a, to_entity::text as b, kind::text from network.edge where reviewed_at is not null`,
  );
  const kept = new Set(reviewed.map((r) => pairKey(r.a, r.b, r.kind)));
  counts.keptReviewed = reviewed.length;
  await tx.query(
    `delete from network.edge where reviewed_at is null
        and (evidence @> '[{"derived": "records"}]'::jsonb or evidence @> '[{"derived": "research"}]'::jsonb)`,
  );

  const edges = new Map<string, NewEdge>();
  const add = (e: NewEdge) => {
    if (e.from === e.to) return false;
    const k = pairKey(e.from, e.to, e.kind);
    if (kept.has(k) || edges.has(k)) return false;
    edges.set(k, e);
    return true;
  };

  // 2. The records: who on the team has met them one to one, or heard from them.
  const rows = await tx.query<{ entity_id: string; owner_id: string; attendees: string[] | null; channel: string; direction: string | null; on: string; group_size: number | null }>(
    `select m.entity_id::text, m.owner_id::text, m.attendees, m.channel::text, m.direction, m.held_on::text as on, g.n as group_size
       from meetings.meeting m
       left join (select substring(source_ref from '^(interaction:[a-z-]+:[0-9]+):') as iref, count(distinct entity_id)::int as n
                    from meetings.meeting where source = 'affinity' and source_ref like 'interaction:%' group by 1) g
         on g.iref = substring(m.source_ref from '^(interaction:[a-z-]+:[0-9]+):')
      where m.held_on is not null and m.held_on <= current_date and m.channel in ('meeting', 'call', 'email', 'message')`,
  );
  type Tally = { meetings: string[]; heard: string[] };
  const tally = new Map<string, Tally>();
  for (const r of rows) {
    if (teamEntities.has(r.entity_id)) continue;
    const met = (r.channel === 'meeting' || r.channel === 'call') && (r.group_size ?? 1) < GROUP_EVENT;
    const heard = (r.channel === 'email' || r.channel === 'message') && r.direction === 'theirs';
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
    const recent = Date.now() - new Date(last).getTime() < 365 * 86_400_000;
    if (t.meetings.length) {
      const n = new Set(t.meetings).size;
      if (add({
        from, to: lp, kind: 'met', tier: 'A', band: n >= 3 && recent ? 'strong' : 'moderate', since: [...t.meetings].sort()[0]!,
        evidence: [{ derived: 'records', note: `${n} ${n === 1 ? 'meeting' : 'meetings'} held one to one, ${span(t.meetings)}`, source: 'Affinity calendar and notes, as translated', as_of: today }],
      })) counts.fromRecords++;
    } else {
      const n = t.heard.length;
      if (add({
        from, to: lp, kind: 'corresponded', tier: 'B', band: n >= 2 && recent ? 'moderate' : 'weak', since: [...t.heard].sort()[0]!,
        evidence: [{ derived: 'records', note: `${n} ${n === 1 ? 'message' : 'messages'} from them, ${span(t.heard)}`, source: 'Affinity mail sync, as translated', as_of: today }],
      })) counts.fromRecords++;
    }
  }

  // 3. The research: W3's paths, as the import left them on each LP.
  const notes = await tx.query<{ entity_id: string; at: string; data: { paths?: Array<{ lp: string; other: { type: string; name: string; key?: string; handle?: string }; kind: string; tier: EvidenceTier; basis: string; source?: string | null }> } }>(
    `select entity_id::text, created_at::text as at, data from research.note where kind = 'connection_candidates'`,
  );
  const known = new Set((await tx.query<{ id: string }>(`select entity_id::text as id from identity.entity`)).map((r) => r.id));
  const alreadyMet = new Set([...edges.values()].map((e) => [e.from, e.to].sort().join('|')));
  for (const n of notes) {
    for (const p of n.data.paths ?? []) {
      const lp = known.has(p.lp) ? p.lp : n.entity_id;
      const other = p.other.type === 'team'
        ? entityOfUser.get(userByHandle.get(p.other.handle ?? '') ?? userByName.get(norm(p.other.name)) ?? '')
        : (p.other.type === 'lp' || p.other.type === 'backer') && p.other.key && known.has(p.other.key) ? p.other.key : undefined;
      if (!other) { counts.notPeople++; continue; }
      const kind = KIND[p.kind] ?? 'other';
      // Our own record of meeting them says more than the research's "met".
      if (kind === 'met' && alreadyMet.has([other, lp].sort().join('|'))) continue;
      if (add({
        from: other, to: lp, kind, tier: p.tier, band: p.tier === 'A' ? 'strong' : p.tier === 'B' ? 'moderate' : 'weak', since: n.at.slice(0, 10),
        evidence: [{ derived: 'research', note: p.basis, source: p.source ?? 'the research (W3)', as_of: n.at.slice(0, 10) }],
      })) {
        counts.fromResearch++;
        if (p.tier === 'C' || p.tier === 'D') counts.toConfirm++;
      }
    }
  }

  for (const e of edges.values()) {
    await tx.query(
      `insert into network.edge (from_entity, to_entity, kind, tier, strength, tie_band, evidence, valid_from)
       values ($1, $2, $3::network.edge_kind, $4::network.evidence_tier, null, $5, $6, $7::date)`,
      [e.from, e.to, e.kind, e.tier, e.band, JSON.stringify(e.evidence), e.since],
    );
  }
  return counts;
}

/**
 * A person confirms a tie, or says it isn't one (N82, rule 6). Confirming lets a C or D tie carry a
 * route — held, not recommended: confirmation doesn't turn a shared board into a friendship. "Not a
 * real tie" ends it today, so no route walks it, and the next rebuild leaves it ended.
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

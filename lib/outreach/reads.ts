import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { can } from '@/lib/authz';
import { pipelineData } from '@/lib/authz/read/pipeline';
import { getDb } from '@/lib/db';
import { addressesFor, detailsFor } from './addresses';
import { redactHealth } from '@/lib/redact-health';
import { SPV_STAGE_LABEL, spvRooms, workingDaysUntil, type SpvStage } from '@/modules/close';
import { INSUFFICIENT_FOR_506C } from '@/modules/compliance';
import { checkWrap, listAssets, type Audience, type PermittedUse } from '@/modules/content';
import { READS, READ_LABEL, isAutoReply, isEvent, raiseWindows, summarize, type Touchpoint } from '@/modules/meetings';
import { tracePairs } from '@/lib/comms/read';
import { SOURCE_LABEL, traceState, type Merged } from '@/lib/comms/trace';
import { CLOSE_STATE_LABEL, closeStates, currentIndications, indicatedTotals, vehicleTotals, type CloseState } from '@/modules/pipeline';
import { listVehicles, type AppUser, type Vehicle } from '@/modules/platform';
import { STATUS_LABEL, lpContactsFor, type PursuitStatus } from '@/modules/strategy';

/**
 * The mail desk's reads (docs/27-outreach-api.md §3): GET /api/outreach/vehicles and /queue, and the MCP
 * tools outreach_vehicles and outreach_queue — one service for both. Each answer is an explicit projection,
 * and every value passes can() for its vehicle and field class: R1 amounts, R2 words (and contact
 * addresses), R4 restriction reasons. Licensed (Dakota) values never appear: a token is never an Admin
 * (lib/mcp/envelope.ts), so the pipeline facade drops them, and contacts and strategies from Dakota are
 * left out here. Text fields are health-redacted (lib/redact-health.ts), since the desk drafts with Claude.
 *
 * Capital OS's own words come back for its own states, each apart and with its label (§2): the pipeline
 * status (seven), the close track (soft → signed → hard → closed), the SPV seat stage. The desk shows
 * these and invents none.
 */

export class OutreachRefused extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'OutreachRefused'; }
}

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const words = (u: AppUser, vehicle: string) => can(u, 'read', { vehicle, fieldClass: 'R2' });
const amounts = (u: AppUser, vehicle: string) => can(u, 'read', { vehicle, fieldClass: 'R1' });
const reasons = (u: AppUser, vehicle: string) => can(u, 'read', { vehicle, fieldClass: 'R4' });
const KINDS = new Set(['fund', 'spv']);
const instrumentOf = (v: Vehicle) => (v.kind === 'spv' ? 'spv' : 'lp_commitment');

/** Fund and SPV vehicles that are raising and that this principal may read. */
async function deskVehicles(user: AppUser): Promise<Vehicle[]> {
  return (await listVehicles()).filter((v) => v.phase !== 'historical' && KINDS.has(v.kind) && can(user, 'read', { vehicle: v.id }));
}

/** The same answer for "no such vehicle" and "not yours", so a slug's existence is not a probe. */
export async function deskVehicle(user: AppUser, ref: string): Promise<Vehicle> {
  const v = (await deskVehicles(user)).find((x) => x.slug === ref || x.id === ref);
  if (!v) throw new OutreachRefused(404, `No vehicle "${ref.slice(0, 80)}" among yours.`);
  return v;
}

// ── GET /api/outreach/vehicles ──────────────────────────────────────────────────────────

export async function outreachVehicles(user: AppUser) {
  const vehicles = await deskVehicles(user);
  const ids = vehicles.map((v) => v.id);
  const [totals, indicated, rooms, windows] = await Promise.all([vehicleTotals(), indicatedTotals(ids), spvRooms(), raiseWindows()]);
  const rows = await Promise.all(vehicles.map(async (v) => {
    const t = totals.find((x) => x.vehicleId === v.id);
    const i = indicated.get(v.id);
    const room = rooms.find((r) => r.vehicleId === v.id);
    const closes = windows.get(v.id)?.closes ?? null;
    const money = amounts(user, v.id);
    const seats = (stage: SpvStage) => room?.seats.filter((s) => s.stage === stage).length ?? 0;
    return {
      slug: v.slug, name: v.name, kind: v.kind as 'fund' | 'spv', exemption: v.exemption,
      // Rule 1: hard, soft and indicated are three figures, each its own; nothing here adds them.
      target: money ? v.targetAmount : null, hard: money ? t?.hard ?? 0 : null, soft: money ? t?.soft ?? 0 : null,
      indicated: money ? (i ? { low: i.low, high: i.high, count: i.count } : { low: 0, high: 0, count: 0 }) : null,
      windowEnds: day(closes), workingDaysLeft: closes ? await workingDaysUntil(closes) : null,
      seats: v.kind === 'spv' ? { invited: seats('invited'), ioi: seats('ioi'), allocated: seats('allocated'), wired: seats('wired') } : null,
      daysToWire: room?.daysToWire ?? null, daysToWireN: room?.seats.filter((s) => s.wired).length ?? 0,
      ...(money ? {} : { withheld: 'Amounts are withheld at your access.' }),
    };
  }));
  return {
    data: rows,
    coverage: {
      corpus: 'The fund and SPV vehicles raising now that your token reads; hard and soft from the close track, indicated from what LPs said.',
      note: 'Hard, soft and indicated are separate figures and are never added together, within a vehicle or across vehicles (rule 1).',
    },
  };
}

// ── GET /api/outreach/queue ─────────────────────────────────────────────────────────────

export type Bucket = 'reply_owed' | 'money' | 'invite' | 'follow_up' | 'held' | 'passed';
/** The open buckets, in the queue's order. `passed` comes after them, and only with includePassed (docs/27 §4). */
export const BUCKETS: Bucket[] = ['reply_owed', 'money', 'invite', 'follow_up', 'held'];
export const QUEUE_BUCKETS: Bucket[] = [...BUCKETS, 'passed'];
/** `agentOnly`: refuses an autonomous agent's ticket, never holds a person (Juan, 7 Oct 2026). */
export interface Check { rule: 'restriction' | 'accreditation' | 'ask_count' | 'fund_first' | 'wrap'; ok: boolean; blocking: boolean; agentOnly?: boolean; detail: string; choices?: string[] }

/** The choices the desk offers when an SPV meets an open fund discussion (Juan, 4 Oct 2026). */
export const FUND_FIRST_CHOICES = ['mention_both', 'send_separately', 'wait'] as const;
export type FundFirstChoice = (typeof FUND_FIRST_CHOICES)[number];

type PRow = Awaited<ReturnType<typeof pipelineData>>['rows'][number];
const OPEN_FUND = ['connecting', 'discussing', 'committed'];

export interface QueueArgs {
  vehicle: string; bucket?: Bucket; limit?: number; offset?: number; cursor?: string; pursuitId?: string; updatedSince?: string;
  /** Opt in to LPs that passed (docs/27 §4): never included by default; each comes back marked passed. */
  includePassed?: boolean;
}
/** How the answer is carried: over MCP it must fit the response limit, so the page is cut to fit and nextCursor follows. */
export interface QueueFit { maxBytes?: number }

/**
 * Paging (docs/27 §4). `nextCursor` is opaque to the client: base64url of the last row's pursuit id, the position
 * after it, and a hash of the query it pages. The next page starts after that row if it is still in the queue,
 * else at the position; a cursor from another query is refused. A full pass over an unchanging queue returns
 * every row exactly once (a property); a row that changes between pages is seen again with updatedSince.
 */
const queryKey = (a: QueueArgs) => createHash('sha256')
  .update(JSON.stringify([a.vehicle, a.bucket ?? null, a.pursuitId ?? null, a.updatedSince ?? null, a.includePassed === true])).digest('base64url').slice(0, 12);
export function encodeCursor(a: QueueArgs, after: string, position: number): string {
  return Buffer.from(JSON.stringify({ v: 1, a: after, p: position, q: queryKey(a) })).toString('base64url');
}
function decodeCursor(a: QueueArgs, cursor: string): { after: string; position: number } {
  let c: { v?: unknown; a?: unknown; p?: unknown; q?: unknown } | null = null;
  try { c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { /* refused below */ }
  if (!c || c.v !== 1 || typeof c.a !== 'string' || typeof c.p !== 'number' || !Number.isInteger(c.p) || c.p < 0) {
    throw new OutreachRefused(400, 'cursor is not one this server gave. Pass the previous answer\'s nextCursor; its cursor field is the polling time, for updatedSince.');
  }
  if (c.q !== queryKey(a)) throw new OutreachRefused(400, 'That cursor pages a different query. Keep vehicle, bucket, pursuitId, updatedSince and includePassed as they were.');
  return { after: c.a, position: c.p };
}

/**
 * When each pursuit last changed, among those that changed since `since` (docs/27 §4, periodic sync): its status,
 * next step, an update or an indication (the audit log), a touchpoint, a strategy, the close track, the SPV seat, a
 * restriction, a desk send, an address, a message in the comms trace or a link. One query; a pursuit with no change since is absent.
 */
async function changedSince(ids: string[], since: Date): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const rows = await (await getDb()).query<{ id: string; at: Date | string }>(`
    with p as (select p.pursuit_id, identity.canonical_entity_id(p.entity_id) e, p.vehicle_id v, p.status_set_at, p.opened_at
                 from strategy.pursuit p where p.pursuit_id = any($1::uuid[])),
         -- Every alias of these LPs, up front: each join below is then an index probe (7 Oct 2026).
         pa as (select * from identity.alias_pairs(array(select e from p)))
    select id, max(at) at from (
      select p.pursuit_id::text id, greatest(p.status_set_at, p.opened_at) at from p
      union all select a.subject_id, a.at from platform.audit_log a where a.subject_type = 'pursuit' and a.at >= $2 and a.subject_id = any($1::text[])
      union all select p.pursuit_id::text, m.created_at from p join pa on pa.canonical_id = p.e join meetings.meeting m on m.entity_id = pa.entity_id
        and (m.vehicle_id is null or m.vehicle_id = p.v) where m.created_at >= $2
      union all select p.pursuit_id::text, s.created_at from p join strategy.suggestion s on s.pursuit_id = p.pursuit_id where s.created_at >= $2
      union all select p.pursuit_id::text, greatest(x.opened_at, ce.recorded_at) from p join pa on pa.canonical_id = p.e join pipeline.exposure x
        on x.entity_id = pa.entity_id and x.vehicle_id = p.v left join pipeline.commitment_event ce on ce.exposure_id = x.exposure_id
      union all select p.pursuit_id::text, greatest(i.recorded_at, i.superseded_at) from p join pipeline.indication i on i.pursuit_id = p.pursuit_id
      union all select p.pursuit_id::text, greatest(s.invited_at, s.ioi_at, s.allocated_at, s.wired_at) from p join pa on pa.canonical_id = p.e join close.spv_seat s
        on s.entity_id = pa.entity_id and s.vehicle_id = p.v
      union all select p.pursuit_id::text, r.recorded_at from p join pa on pa.canonical_id = p.e join coordination.restriction r on r.entity_id = pa.entity_id
      union all select p.pursuit_id::text, greatest(o.requested_at, o.recorded_at) from p join email.outreach_send o on o.pursuit_id = p.pursuit_id
      union all select p.pursuit_id::text, c.updated_at from p join pa on pa.canonical_id = p.e join email.comms_message c
        on c.entity_ids @> array[pa.entity_id] and c.updated_at >= $2
      union all select p.pursuit_id::text, l.linked_at from p join email.message_link l on l.pursuit_id = p.pursuit_id where l.linked_at >= $2
      union all select p.pursuit_id::text, c.created_at from p join pa on pa.canonical_id = p.e join research.claim c on c.entity_id = pa.entity_id
        where c.field ~ '(^|\\.)email$' and c.created_at >= $2
    ) t where at >= $2 group by id`, [ids, since]);
  return new Map(rows.map((r) => [r.id, new Date(r.at)]));
}

/**
 * A reply is owed when their latest written message (an email or a message from them, not an automatic reply) came
 * after anything of ours: our own message, or a meeting or call together. Before 7 Oct 2026 the queue used the LP
 * page's "they spoke last", which counts a meeting as theirs, so every LP whose latest touch was a meeting read as
 * owed a reply (JuanMail: 41 on Neurotech, far more than its mail shows).
 * A message to a list is not written to us either: one whose Affinity interaction reaches BROADCAST_PARTIES or more of
 * our parties (firms, or people with none), or that the rules read as a company's update to its investors (the overnight
 * review found a "recent inbound reply" that was a company announcement sent to a small list).
 */
// GUESS — a reply with a colleague and one introduction on copy is two parties; a list starts at three.
const BROADCAST_PARTIES = 3;
const isBroadcast = (t: Touchpoint) => (t.groupSize ?? 1) >= BROADCAST_PARTIES || /^a company's update to its investors/.test(t.aboutBasis ?? '');
export function replyOwedFrom(touches: Touchpoint[], now = new Date()): { since: string } | null {
  const held = touches.filter((t) => !t.viaOrganization && t.on && t.on.getTime() <= now.getTime() && t.channel !== 'research' && !isEvent(t));
  const written = held.filter((t) => (t.channel === 'email' || t.channel === 'message') && t.direction === 'theirs' && !isAutoReply(t) && !isBroadcast(t));
  const theirs = written.reduce<Date | null>((a, t) => (!a || t.on! > a ? t.on! : a), null);
  if (!theirs) return null;
  const answered = held.some((t) => t.on! > theirs && (t.direction === 'ours'
    || ((t.channel === 'meeting' || t.channel === 'call') && t.direction === 'both')));
  return answered ? null : { since: day(theirs)! };
}

export async function outreachQueue(user: AppUser, a: QueueArgs, fit: QueueFit = {}) {
  // The next poll's updatedSince: taken before reading, so a change committed while this runs is seen next time.
  const cursor = new Date().toISOString();
  const limit = Math.min(a.limit ?? config.outreach.defaultQueueRows, config.outreach.maxQueueRows);
  if (a.cursor && a.offset !== undefined) throw new OutreachRefused(400, 'Page with cursor or with offset, not both.');
  if (a.bucket === 'passed' && !a.includePassed) throw new OutreachRefused(400, 'Passed LPs are left out unless you ask for them: add includePassed.');
  const start = a.cursor ? decodeCursor(a, a.cursor) : null;
  if (a.vehicle === 'none') {
    return { data: { rows: [], total: 0, offset: 0, limit, nextCursor: null, counts: null, cursor, redacted: null }, coverage: { corpus: 'none', note: 'Every LP in Capital OS is on a vehicle: there are no pursuits without one. Use vehicle=all.' } };
  }
  const since = a.updatedSince ? new Date(a.updatedSince) : null;
  if (since && Number.isNaN(since.getTime())) throw new OutreachRefused(400, 'updatedSince is not a time.');
  const vehicles = a.vehicle === 'all' ? await deskVehicles(user) : [await deskVehicle(user, a.vehicle)];
  const all = (await Promise.all(vehicles.map(async (v) => (await pipelineData(v.id)).rows.filter((r) => r.vehicleId === v.id && (a.includePassed || r.status !== 'passed')))))
    .flat().filter((r) => !a.pursuitId || r.id === a.pursuitId);
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const db = await getDb();
  const pairs = all.map((r) => ({ entityId: r.entityId, vehicleId: r.vehicleId }));
  const entityIds = [...new Set(all.map((r) => r.entityId))];
  const key = (r: { entityId: string; vehicleId: string }) => `${r.entityId}:${r.vehicleId}`;

  // What the bucket needs, for every row: one query each.
  // The comms trace, not the app's log (Juan, 5 Oct 2026): Affinity and the Gmail messages juanmail reported, merged.
  const [traces, closes, seats, indications, fundOpen] = await Promise.all([
    tracePairs(pairs),
    closeStates(pairs),
    db.query<{ entity_id: string; vehicle_id: string; stage: SpvStage; amount: string | null }>(`select identity.canonical_entity_id(entity_id)::text entity_id,
      vehicle_id::text, stage::text stage, amount::text from close.spv_seat where vehicle_id = any($1::uuid[])`, [vehicles.map((v) => v.id)]),
    currentIndications(vehicles.map((v) => v.id)),
    // Fund before SPV (advisory since 4 Oct 2026): an open fund discussion with the same LP.
    entityIds.length ? db.query<{ entity_id: string; vehicle_id: string; name: string; status: PursuitStatus }>(`select identity.canonical_entity_id(p.entity_id)::text entity_id,
      p.vehicle_id::text, v.name, p.status::text status from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id
      where v.kind = 'fund' and v.phase <> 'historical' and p.closed_at is null and p.status::text = any($2::text[])
        and p.entity_id = any(identity.alias_ids($1::uuid[]))`, [entityIds, OPEN_FUND]) : Promise.resolve([]),
  ]);
  const seatOf = new Map(seats.map((s) => [`${s.entity_id}:${s.vehicle_id}`, s]));
  // Whether the wrap matrix covers the vehicle at all (rule 11); each material is checked on its own below.
  const wrapRuleFor = new Map(await Promise.all(vehicles.map(async (v) => {
    const w = await checkWrap({ exemption: v.exemption, instrument: instrumentOf(v), audience: 'lp_memo', permittedUse: 'internal' });
    return [v.id, w.rule !== null] as const;
  })));
  const empty: Merged = { touches: [], sameAs: new Map(), messageOf: new Map(), flags: [] };
  const summaries = new Map(pairs.map((p) => {
    const list = (traces.get(key(p)) ?? empty).touches;
    const s = summarize(list);
    const own = list.filter((t) => !t.viaOrganization && t.on && t.channel !== 'research');
    const last = own.reduce<Touchpoint | null>((x, t) => (!x || t.on! > x.on! ? t : x), null);
    return [key(p), { s, last }] as const;
  }));

  const base = all.map((r) => {
    const v = vById.get(r.vehicleId)!;
    const { s, last } = summaries.get(key(r))!;
    const close = closes.get(key(r)) ?? null;
    const seat = seatOf.get(key(r)) ?? null;
    const indicated = indications.get(key(r)) ?? null;
    const replyOwed = replyOwedFrom((traces.get(key(r)) ?? empty).touches);
    const funds = v.kind === 'spv' ? fundOpen.filter((f) => f.entity_id === r.entityId) : [];
    const restricted = r.doNotContact;
    // Held: a blocking check fails. The ask cap is advisory (config.guard.askLimit) and counted per page row.
    // A missing wrap rule never holds a row for people (Juan, 7 Oct 2026: "Just remove these limitations, i did not
    // ask for these limitations for human apps"); it still refuses an autonomous agent's ticket (agentOnly below).
    const fundBlocks = funds.length > 0 && config.guard.fundFirst === 'enforce';
    const held = restricted || fundBlocks;
    const money = r.status === 'committed' || Boolean(indicated)
      || (close && close.state !== 'closed' && close.state !== 'withdrawn') || (seat && (seat.stage === 'ioi' || seat.stage === 'allocated'));
    // A passed LP is its own bucket, after the open ones; its checks still run, a restriction among them.
    const bucket: Bucket = r.status === 'passed' ? 'passed' : held ? 'held' : replyOwed ? 'reply_owed' : money ? 'money'
      : ['new', 'sourcing', 'selected'].includes(r.status) ? 'invite' : 'follow_up';
    return { r, v, s, last, close, seat, indicated, replyOwed, funds, bucket };
  });
  const changed = since ? await changedSince(base.map((b) => b.r.id), since) : null;
  const chosen = base.filter((b) => (!a.bucket || b.bucket === a.bucket) && (!changed || changed.has(b.r.id)))
    // A total order (the id last), so a position and a row's place are stable between pages.
    .sort((x, y) => QUEUE_BUCKETS.indexOf(x.bucket) - QUEUE_BUCKETS.indexOf(y.bucket) || (y.r.priority ?? -1) - (x.r.priority ?? -1)
      || x.r.name.localeCompare(y.r.name) || (x.r.id < y.r.id ? -1 : x.r.id > y.r.id ? 1 : 0));
  const anchor = start ? chosen.findIndex((b) => b.r.id === start.after) : -1;
  const offset = start ? (anchor >= 0 ? anchor + 1 : Math.min(start.position, chosen.length)) : a.offset ?? 0;
  const page = chosen.slice(offset, offset + limit);
  const counts = Object.fromEntries((a.includePassed ? QUEUE_BUCKETS : BUCKETS).map((b) => [b, base.filter((x) => x.bucket === b).length]));
  const next = (shown: number) => (offset + shown < chosen.length && shown > 0 ? encodeCursor(a, chosen[offset + shown - 1]!.r.id, offset + shown) : null);
  if (!page.length) {
    return { data: { rows: [], total: chosen.length, offset, limit, nextCursor: null, counts, cursor, redacted: null }, coverage: queueCoverage(vehicles, a.includePassed) };
  }

  // The rest only for the page.
  const ids = page.map((b) => b.r.id);
  const pageEntities = [...new Set(page.map((b) => b.r.entityId))];
  const quarterAgo = new Date(Date.now() - 92 * 86_400_000);
  const [meta, strategies, others, restrictions, accreditation, asks, assets, orgContacts] = await Promise.all([
    db.query<{ id: string; set_at: Date | string | null; set_by: string | null; source: string; type: string }>(`select p.pursuit_id::text id,
      p.status_set_at set_at, u.name set_by, p.status_source source, e.entity_type::text type
      from strategy.pursuit p join identity.entity e on e.entity_id = identity.canonical_entity_id(p.entity_id)
      left join platform.app_user u on u.id = p.status_set_by where p.pursuit_id = any($1::uuid[])`, [ids]),
    // The latest strategy that was not dismissed or withdrawn; never one written from licensed (Dakota) data.
    db.query<{ pursuit_id: string; data: Record<string, unknown>; made_at: Date | string }>(`select distinct on (s.pursuit_id) s.pursuit_id::text pursuit_id, s.data, s.made_at
      from strategy.suggestion s where s.pursuit_id = any($1::uuid[]) and s.status not in ('dismissed', 'withdrawn')
        and s.data->>'source' is distinct from 'dakota'
      order by s.pursuit_id, s.created_at desc, s.suggestion_id`, [ids]),
    db.query<{ entity_id: string; vehicle_id: string; name: string; status: PursuitStatus }>(`select identity.canonical_entity_id(p.entity_id)::text entity_id,
      p.vehicle_id::text, v.name, p.status::text status from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id
      where v.phase <> 'historical' and p.entity_id = any(identity.alias_ids($1::uuid[]))`, [pageEntities]),
    db.query<{ entity_id: string; scope: string; channel: string | null; instruction: string }>(`select identity.canonical_entity_id(entity_id)::text entity_id,
      scope::text, channel, instruction from coordination.restriction
      where entity_id = any(identity.alias_ids($1::uuid[])) and (expires_at is null or expires_at >= current_date)`, [pageEntities]),
    db.query<{ entity_id: string; vehicle_id: string; status: string; method: string; expires_on: Date | string | null }>(`select
      identity.canonical_entity_id(entity_id)::text entity_id, vehicle_id::text, status::text, method::text, expires_on
      from compliance.accreditation where entity_id = any(identity.alias_ids($1::uuid[]))`, [pageEntities]),
    db.query<{ entity_id: string; n: number }>(`select identity.canonical_entity_id(entity_id)::text entity_id, count(*)::int n
      from coordination.ask where made_at is not null and made_at >= $2 and entity_id = any(identity.alias_ids($1::uuid[]))
      group by 1`, [pageEntities, quarterAgo]),
    listAssets(),
    Promise.all(vehicles.map(async (v) => [v.id, await lpContactsFor(page.filter((b) => b.r.vehicleId === v.id).map((b) => b.r.entityId), v.id, { excludeDakota: true })] as const)),
  ]);
  const contactsBy = new Map(orgContacts);
  const people = [...new Set([...page.map((b) => b.r.entityId), ...orgContacts.flatMap(([, m]) => [...m.values()].flat().map((c) => c.entityId))])];
  // Addresses only where words are readable (R2), as before: the same reader as the route hops' contacts.
  const emails = await addressesFor(page.some((b) => words(user, b.v.id)) ? people : []);
  const metaOf = new Map(meta.map((m) => [m.id, m]));
  const strategyOf = new Map(strategies.map((s) => [s.pursuit_id, s]));
  const rules = new Map<string, Awaited<ReturnType<typeof checkWrap>>>();
  const materialsFor = async (v: Vehicle) => {
    const list = assets.filter((x) => x.audience && (x.vehicleId === v.id || x.vehicleId === null) && x.status !== 'draft' && x.status !== 'withdrawn').slice(0, 20);
    return Promise.all(list.map(async (x) => {
      const k = `${v.id}:${x.assetId}`;
      if (!rules.has(k)) rules.set(k, await checkWrap({ exemption: v.exemption, instrument: instrumentOf(v), audience: x.audience as Audience, permittedUse: x.permittedUse as PermittedUse }));
      const w = rules.get(k)!;
      return { assetId: x.assetId, title: x.title, permittedUse: x.permittedUse, allowed: w.allowed && x.status === 'approved' && x.flags.length === 0, link: x.link };
    }));
  };
  const materialsByVehicle = new Map(await Promise.all(vehicles.map(async (v) => [v.id, await materialsFor(v)] as const)));

  let redacted = 0;
  const clean = (t: string | null | undefined) => {
    if (!t) return t ?? null;
    const r = redactHealth(t);
    redacted += r.redacted;
    return r.text;
  };

  const rows = page.map((b) => {
    const { r, v, s, last, close, seat, indicated, replyOwed, funds } = b;
    const m = metaOf.get(r.id);
    const w = words(user, v.id), money = amounts(user, v.id), why = reasons(user, v.id);
    const strat = strategyOf.get(r.id);
    const sd = (strat?.data ?? {}) as { angle?: string; next?: { what?: string }; confidence?: string };
    const isPerson = m?.type === 'person';
    const addressOf = (entityId: string) => (emails.get(entityId) ?? []).slice(0, 3);
    const contacts = !w ? [] : isPerson
      ? addressOf(r.entityId).map((x) => ({ name: r.name, ...x }))
      : (contactsBy.get(v.id)?.get(r.entityId) ?? []).flatMap((c) => addressOf(c.entityId).map((x) => ({ name: c.name, ...x })));
    const blanket = restrictions.filter((x) => x.entity_id === r.entityId && x.scope === 'blanket');
    // A channel restriction that names no channel bars email too: fail closed on what it does not say.
    const emailBarred = restrictions.filter((x) => x.entity_id === r.entityId && x.scope === 'channel' && (!x.channel || /mail/i.test(x.channel)));
    const connectorOnly = restrictions.filter((x) => x.entity_id === r.entityId && x.scope === 'connector');
    // Any other restriction (another channel) is surfaced too, never read as "none on file" (5 Oct 2026).
    const otherChannel = restrictions.filter((x) => x.entity_id === r.entityId && x.scope === 'channel' && x.channel && !/mail/i.test(x.channel));
    const acc = accreditation.find((x) => x.entity_id === r.entityId && x.vehicle_id === v.id);
    const strict = v.exemption === '506(c)' || v.exemption === 'unknown';
    const verified = acc && acc.status === 'verified' && !INSUFFICIENT_FOR_506C.includes(acc.method as never) && !(acc.expires_on && new Date(acc.expires_on) < new Date());
    const asked = asks.find((x) => x.entity_id === r.entityId)?.n ?? 0;
    const cap = config.guard.asksPerRelationshipPerQuarter;
    const barred = blanket.length + emailBarred.length > 0;
    const checks: Check[] = [
      {
        // Always surfaced (5 Oct 2026): any restriction on file fails this check; only one that bars email blocks.
        rule: 'restriction', ok: !barred && !connectorOnly.length && !otherChannel.length, blocking: barred,
        detail: barred ? (why ? [...blanket, ...emailBarred].map((x) => clean(x.instruction)).join(' · ') : 'A do-not-approach restriction is on file. Reasons withheld at your access: check with the owner.')
          : connectorOnly.length ? `A restriction on a connector is on file: a direct email is not barred, an intro through that connector is.${why ? ` ${connectorOnly.map((x) => clean(x.instruction)).join(' · ')}` : ''}`
            : otherChannel.length ? `A restriction is on file: not by ${otherChannel.map((x) => x.channel).join(', ')}. Email is not barred.${why ? ` ${otherChannel.map((x) => clean(x.instruction)).join(' · ')}` : ''}`
              : 'No restriction on file.',
      },
      {
        rule: 'accreditation', ok: !strict || Boolean(verified), blocking: false,
        detail: !strict ? `${v.exemption}: verification is not required.` : verified ? 'Verified by reasonable steps, unexpired.'
          : `${v.exemption}: not verified yet (${acc ? acc.status : 'no record'}). Needed before money moves, not before an invitation.`,
      },
      {
        rule: 'ask_count', ok: asked < cap, blocking: asked >= cap && config.guard.askLimit === 'enforce',
        detail: `${asked} ask${asked === 1 ? '' : 's'} made to them this quarter, across every vehicle; the cap is ${cap}${config.guard.askLimit === 'advisory' ? ', advisory (Juan, 4 Oct 2026)' : ''}.`,
      },
      ...(v.kind === 'spv' ? [{
        rule: 'fund_first' as const, ok: funds.length === 0, blocking: funds.length > 0 && config.guard.fundFirst === 'enforce',
        detail: funds.length ? `An open fund discussion: ${funds.map((f) => `${f.name} (${STATUS_LABEL[f.status]})`).join(', ')}. Pitch the SPV alongside it — mention both in one note, send the SPV separately, or wait. Opening a ticket records the overlap with a dated follow-up (rule 5).`
          : 'No open fund discussion with them.',
        ...(funds.length ? { choices: [...FUND_FIRST_CHOICES] } : {}),
      }] : []),
      {
        // Shown to people, never a hold for them; an autonomous agent is still refused (Juan, 7 Oct 2026).
        rule: 'wrap', ok: wrapRuleFor.get(v.id) === true, blocking: false, agentOnly: wrapRuleFor.get(v.id) !== true,
        detail: wrapRuleFor.get(v.id) ? `${v.exemption} × ${instrumentOf(v)}: covered by the wrap matrix; each material says whether it may go.`
          : `No wrap rule on file for ${v.exemption} × ${instrumentOf(v)}, so materials for this vehicle are not checked against one. A person may send; an autonomous agent may not.`,
      },
    ];
    const held = checks.some((c) => !c.ok && c.blocking);
    const closeTrack = close ? {
      state: close.state as CloseState, label: CLOSE_STATE_LABEL[close.state],
      amount: money ? close.exposure.amount : null, wired: money ? close.wired : null,
      // The close module's own record (pipeline.commitment_event): the latest signature, the closing, and once hard
      // the commitment less what has wired. Dates are not amounts; the outstanding amount is R1.
      signedOn: day(close.signature?.on), closedOn: day(close.closedOn), outstanding: money ? close.outstanding : null,
      // How many times documents were signed for this commitment: its signed and re-signed events (5 Oct 2026, docs/27 §4).
      signedCount: close.events.filter((e) => e.step === 'signed' || e.step === 'resigned').length,
      // Capital calls are not recorded yet: "called" stays null until they are (docs/27 §4).
      called: null as number | null,
    } : null;
    const otherVehicles = others.filter((o) => o.entity_id === r.entityId && o.vehicle_id !== v.id).map((o) => can(user, 'read', { vehicle: o.vehicle_id })
      ? { name: o.name, status: { value: o.status, label: STATUS_LABEL[o.status] } }
      // Rule 5: presence on another vehicle stays visible for coordination, without its status.
      : { name: o.name, status: null });
    return {
      pursuitId: r.id, vehicle: v.slug,
      entity: { id: r.entityId, name: r.name, kind: isPerson ? 'person' : 'org', contacts },
      owner: r.owner,
      status: { value: r.status, label: STATUS_LABEL[r.status], setAt: day(m?.set_at), setBy: m?.source === 'us' ? m.set_by : m?.source ?? null },
      ...(w ? {
        nextStep: clean(r.next), nextStepOn: r.nextOn?.slice(0, 10) ?? null,
        read: r.read ? { value: READS.find((x) => READ_LABEL[x] === r.read) ?? null, label: r.read, on: r.readOn?.slice(0, 10) ?? null, suggested: r.readSuggested } : null,
        strategy: strat ? { headline: clean(sd.angle ?? null), firstStep: clean(sd.next?.what ?? null), confidence: sd.confidence ?? null, asOf: day(strat.made_at) } : null,
      } : { nextStep: null, nextStepOn: null, read: null, strategy: null, withheld: 'Words are withheld at your access.' }),
      closeTrack,
      seat: seat ? { stage: seat.stage, label: SPV_STAGE_LABEL[seat.stage], amount: money && seat.amount !== null ? Number(seat.amount) : null } : null,
      indicated: indicated && money ? { low: indicated.low, high: indicated.high, at: day(indicated.on), touchpointId: indicated.touchpointId, source: indicated.source } : null,
      otherVehicles,
      replyOwed,
      lastTouch: last ? { kind: last.channel, on: day(last.on), direction: last.direction } : s.lastTouch ? { kind: s.lastTouchChannel, on: day(s.lastTouch), direction: null } : null,
      // The comms trace for this LP (5 Oct 2026): the latest touches with their source, who owes the next word, the
      // thread and who on the team holds it, and where the app's log disagrees with the trace.
      trace: (() => {
        const t = traceState(traces.get(key(r)) ?? empty);
        return {
          last: t.last.map((x) => ({ on: day(x.on), kind: x.channel, direction: x.direction, source: x.source, sourceLabel: SOURCE_LABEL[x.source],
            subject: w ? clean(x.subject) : null, team: x.team, sameAs: x.sameAs.map((m) => ({ source: m.source, by: m.by, confidence: m.confidence })) })),
          owes: t.owes ? { by: t.owes.by, since: day(t.owes.since) } : null,
          thread: t.thread ? { subject: w ? clean(t.thread.subject) : null, team: t.thread.team, holder: t.thread.holder, messages: t.thread.messages, last: day(t.thread.last) } : null,
          mismatches: (traces.get(key(r))?.flags ?? []).map((f) => ({ kind: f.kind, at: day(f.at), text: f.text })),
        };
      })(),
      checks,
      materials: materialsByVehicle.get(v.id) ?? [],
      bucket: b.bucket === 'passed' ? 'passed' as Bucket : held ? 'held' as Bucket : b.bucket,
      passed: r.status === 'passed',
      updatedAt: changed?.get(r.id)?.toISOString() ?? null,
    };
  });
  // Over MCP the answer must fit the response limit: rows are held back from the end until it does, and nextCursor
  // continues from the last row sent, so nothing is skipped (render would otherwise halve the list with no cursor).
  let fitted = rows;
  if (fit.maxBytes) {
    while (fitted.length > 1 && Buffer.byteLength(JSON.stringify(fitted)) > fit.maxBytes) fitted = fitted.slice(0, -1);
  }
  return {
    data: { rows: fitted, total: chosen.length, offset, limit, nextCursor: next(fitted.length), counts, cursor,
      ...(fitted.length < rows.length ? { heldBack: `${rows.length - fitted.length} row${rows.length - fitted.length === 1 ? '' : 's'} held back to fit the answer's size limit; nextCursor continues from here.` } : {}),
      redacted: redacted ? `${redacted} sentence${redacted === 1 ? '' : 's'} with a health detail redacted.` : null },
    coverage: queueCoverage(vehicles, a.includePassed),
  };
}

function queueCoverage(vehicles: Vehicle[], includePassed = false) {
  return {
    paging: `${config.outreach.defaultQueueRows} rows by default, at most ${config.outreach.maxQueueRows}; pass nextCursor as cursor for the next page (null at the end). total counts every row this query matches.`,
    corpus: `${includePassed ? 'LPs, open and passed (each passed row marked passed),' : 'Open LPs (not passed)'} on ${vehicles.map((v) => v.name).join(', ') || 'no vehicle'}, with the comms trace (Affinity's records and the Gmail messages juanmail reported, merged), close track, SPV seat, indication, restrictions, accreditation and asks this quarter.`,
    buckets: 'reply_owed: their latest email or message (not an automatic reply) came after anything of ours, a message or a meeting together; money: committed, an indication, a close track not yet closed, or an SPV seat at IOI or allocated; invite: new, sourcing or selected; follow_up: the rest; held: a blocking check fails; passed (only with includePassed): the LP passed.',
    note: 'A reply in a mailbox juanmail does not read, and Affinity has not synced, is not seen. An address on file is not proof it is current. comms_trace gives one LP\'s whole timeline.',
  };
}

// ── GET /api/outreach/contacts ──────────────────────────────────────────────────────────

export interface ContactsArgs {
  vehicle: string; updatedSince?: string; includePassed?: boolean; offset?: number;
  /** Also each person's phone, title, firm, postal address and LinkedIn page on file (docs/29). */
  details?: boolean;
  /** The previous answer's version: if this answer would say the same, it is { unchanged: true, version, cursor } instead. */
  ifChanged?: string;
}

/**
 * The light contacts read (docs/27 §4d, JuanMail 7 Oct 2026): for every LP on a vehicle (or "all") its pursuit, name,
 * status and passed, and the addresses on file for it, in one page and nothing else. The mail client matches its mail to
 * LPs with it without paying for the queue's checks, trace and strategy. Addresses are R2, as in the queue: a reader
 * without words on the vehicle gets its rows with contacts empty and `withheld`. `version` hashes the rows (not the
 * polling cursor), so ifChanged answers { unchanged: true } when nothing a row shows has moved.
 */
export async function outreachContacts(user: AppUser, a: ContactsArgs, fit: QueueFit = {}) {
  const cursor = new Date().toISOString();
  const since = a.updatedSince ? new Date(a.updatedSince) : null;
  if (since && Number.isNaN(since.getTime())) throw new OutreachRefused(400, 'updatedSince is not a time.');
  const vehicles = a.vehicle === 'all' ? await deskVehicles(user) : [await deskVehicle(user, a.vehicle)];
  const all = (await Promise.all(vehicles.map(async (v) => (await pipelineData(v.id)).rows
    .filter((r) => r.vehicleId === v.id && (a.includePassed || r.status !== 'passed')).map((r) => ({ r, v })))))
    .flat().sort((x, y) => x.v.slug.localeCompare(y.v.slug) || x.r.name.localeCompare(y.r.name) || (x.r.id < y.r.id ? -1 : x.r.id > y.r.id ? 1 : 0));
  const changed = since ? await changedSince(all.map((b) => b.r.id), since) : null;
  const chosen = changed ? all.filter((b) => changed.has(b.r.id)) : all;
  const readable = vehicles.filter((v) => words(user, v.id));
  const entityIds = [...new Set(chosen.map((b) => b.r.entityId))];
  const db = await getDb();
  // r.entityId is already canonical (the pipeline facade resolves it), so the kind is a plain lookup.
  const [kinds, orgContacts] = await Promise.all([
    entityIds.length ? db.query<{ id: string; type: string }>(`select entity_id::text id, entity_type::text type from identity.entity where entity_id = any($1::uuid[])`, [entityIds]) : Promise.resolve([]),
    Promise.all(readable.map(async (v) => [v.id, await lpContactsFor(chosen.filter((b) => b.v.id === v.id).map((b) => b.r.entityId), v.id, { excludeDakota: true })] as const)),
  ]);
  const kindOf = new Map(kinds.map((k) => [k.id, k.type === 'person' ? 'person' as const : 'org' as const]));
  const contactsBy = new Map(orgContacts);
  const people = [...new Set([...chosen.filter((b) => contactsBy.has(b.v.id)).map((b) => b.r.entityId), ...orgContacts.flatMap(([, m]) => [...m.values()].flat().map((c) => c.entityId))])];
  const [emails, details] = await Promise.all([addressesFor(people), a.details ? detailsFor(people) : Promise.resolve(null)]);
  const addressOf = (entityId: string) => (emails.get(entityId) ?? []).slice(0, 3);
  const detailOf = (entityId: string) => (details ? { details: details.get(entityId) ?? {} } : {});
  const rows = chosen.map(({ r, v }) => {
    const kind = kindOf.get(r.entityId) ?? 'org';
    const w = contactsBy.has(v.id);
    const contacts = !w ? [] : kind === 'person'
      ? addressOf(r.entityId).map((x) => ({ name: r.name, ...x, ...detailOf(r.entityId) }))
      : (contactsBy.get(v.id)?.get(r.entityId) ?? []).flatMap((c) => addressOf(c.entityId).map((x) => ({ name: c.name, ...x, ...detailOf(c.entityId) })));
    return {
      pursuitId: r.id, vehicle: v.slug, entity: { id: r.entityId, name: r.name, kind },
      status: { value: r.status, label: STATUS_LABEL[r.status] }, passed: r.status === 'passed', contacts,
      ...(w ? {} : { withheld: 'Addresses are withheld at your access: they are words (R2) on this vehicle.' }),
    };
  });
  const version = createHash('sha256').update(JSON.stringify(rows)).digest('base64url').slice(0, 16);
  const coverage = {
    corpus: `${a.includePassed ? 'LPs, open and passed,' : 'Open LPs (not passed)'} on ${vehicles.map((v) => v.name).join(', ') || 'no vehicle'}${since ? `, changed since ${since.toISOString()}` : ''}: pursuit, name, status and the addresses on file (gmail, affinity or research; never licensed).`,
    note: 'One page: every matching LP. Over MCP an answer too large for the response limit is cut and nextOffset continues it. Pass version as ifChanged to hear { unchanged: true } when no row moved; pass cursor as updatedSince for only the rows that changed. outreach_queue has the rest.',
  };
  if (a.ifChanged && a.ifChanged === version) return { data: { unchanged: true as const, version, cursor }, coverage };
  const offset = Math.min(a.offset ?? 0, rows.length);
  let fitted = rows.slice(offset);
  if (fit.maxBytes) {
    while (fitted.length > 1 && Buffer.byteLength(JSON.stringify(fitted)) > fit.maxBytes) fitted = fitted.slice(0, fitted.length - Math.max(1, Math.floor(fitted.length / 10)));
  }
  const nextOffset = offset + fitted.length < rows.length ? offset + fitted.length : null;
  return { data: { rows: fitted, total: rows.length, offset, nextOffset, version, cursor }, coverage };
}

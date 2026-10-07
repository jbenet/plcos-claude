import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { pipelineData } from '@/lib/authz/read/pipeline';
import { planRoutes } from '@/lib/authz/read/network';
import { getDb, type Db } from '@/lib/db';
import { routeContacts } from '@/lib/mcp/reads';
import type { AppUser, Vehicle } from '@/modules/platform';
import type { RouteStrength } from '@/modules/network';
import { STATUS_LABEL, type PursuitStatus } from '@/modules/strategy';
import { ADDRESSES_WITHHELD } from './addresses';
import { deskVehicle, OutreachRefused } from './reads';

/**
 * top_connectors (MCP) and GET /api/outreach/connectors (docs/27 §4b–§4c): the people who sit on the most and best warm
 * routes to a vehicle's open LPs, and, with `entityId`, one connector's own list of the LPs they reach. No new scoring
 * model: it reads the routes routes_to reads (modules/network's planRoutes, through the authorization facade, so licensed
 * evidence is redacted as on the routes page) and counts.
 *
 *   - Rows: the vehicle's open pursuits (not passed), on a vehicle the token's owner may read — the queue's rule.
 *   - A route counts only when its verdict is "recommend": held and excluded routes (a restriction, a spent ask cap)
 *     are never counted, so a restriction is never stripped to make a connector look useful (rule 8).
 *   - A connector is anyone between the source (the team, PL) and the LP: the route's connectorIds. The first of them
 *     is the first hop past the team member, the person the team emails (askFirst); the rest are deeper. Each LP counts
 *     once per connector; the best route score (0–100, uncalibrated, never a probability) is the highest of theirs.
 *   - firstHopOnly: only the routes on which they are the first hop count, so the ranking is of people the team can
 *     ask directly. Without it, someone the team reaches only through another person is listed, reachableDirectly: false.
 *   - asksThisQuarter and lastAsk: the intro asks recorded as made to that person (coordination.ask, the ask cap's own
 *     record), and a reply from the mail trace or the ask's outcome. Unrecorded asks are not counted (docs/27 §4b).
 *   - An answer waits for planning up to config.outreach.connectorsBudgetMs and says how many LPs it inspected (rule 7);
 *     the plan is kept per vehicle and principal until its inputs change (planOpen), and ifChanged skips a repeat answer.
 */

const EXAMPLES = 3; // GUESS — enough for the desk to see who they reach, not a list to work from.
const MAX_CONNECTORS = 100;

export interface ConnectorArgs { vehicle: string; limit?: number; firstHopOnly?: boolean; entityId?: string; cursor?: string; ifChanged?: string }
/** Over MCP the answer must fit the response limit: a target page is cut from its end and nextCursor follows. */
export interface ConnectorFit { maxBytes?: number }

type PRow = Awaited<ReturnType<typeof pipelineData>>['rows'][number];
interface Usable { score: number | null; band: RouteStrength | null; ids: string[]; names: string[]; hops: number }
interface Planned { r: PRow; routes: Usable[] }

/**
 * The revision every input of a plan follows: network.read_revision moves on any write to the tables routes and the
 * pipeline read (pursuits, asks, restrictions, edges, entities…), network.route_revision on a graph rebuild, and the
 * date for what is dated (ask caps, warmth). One row read, never a scan.
 */
async function planRevision(db: Db): Promise<string> {
  const row = await db.one<{ revision: string }>(`select r.revision::text || ':' || rr.revision::text || ':' ||
      rr.epoch::text || ':' || current_date::text as revision from network.read_revision r, network.route_revision rr
    where r.singleton and rr.singleton`);
  return row!.revision;
}

/**
 * One vehicle's plan for one principal (licensed evidence is redacted per person) at one revision: planned once, in
 * the background, LP by LP, highest priority first, and kept until anything it read changes (JuanMail, 7 Oct 2026:
 * every call planned again and ran into the 15 s budget). A call waits for it up to the budget and answers with what
 * is planned by then; the planning carries on, so the next call finds more, and once done, all of it at once. A job
 * whose revision is superseded stops at its next LP.
 */
interface PlanJob { key: string; revision: string; asOf: string | undefined; open: PRow[]; planned: Planned[]; notCounted: number; done: Promise<void>; finished: boolean }
// Per database, as the route cache is: a test's fresh database, or a restore, never meets another's plan.
const jobsByDb = new WeakMap<Db, Map<string, PlanJob>>();
// GUESS — vehicles × people asking; a principal's job is replaced, never added to, as revisions move.
const MAX_JOBS = 32;

function startPlan(jobs: Map<string, PlanJob>, user: AppUser, v: Vehicle, key: string, revision: string): PlanJob {
  const job = { key, revision, asOf: undefined, open: [], planned: [], notCounted: 0, finished: false } as unknown as PlanJob;
  job.done = (async () => {
    const { rows, asOf } = await pipelineData(v.id);
    job.asOf = asOf;
    job.open = rows.filter((r) => r.vehicleId === v.id && r.status !== 'passed')
      .sort((x, y) => (y.priority ?? -1) - (x.priority ?? -1) || (x.id < y.id ? -1 : 1));
    for (const r of job.open) {
      if (jobs.get(key) !== job) return;
      const search = await planRoutes(user.handle, r.entityId, 3, v.kind, 'team', undefined, { vehicleId: v.id });
      const routes = search?.routes ?? [];
      const usable = routes.filter((x) => x.verdict === 'recommend');
      job.notCounted += routes.length - usable.length;
      job.planned.push({ r, routes: usable.map((x) => ({ score: x.score?.value ?? null, band: x.score?.band ?? null,
        ids: x.connectorIds ?? [], names: x.connectorNames ?? [], hops: x.hops.length })) });
    }
    job.finished = true;
  })();
  // A failed plan is not kept: the next call plans again.
  job.done.catch(() => { if (jobs.get(key) === job) jobs.delete(key); });
  jobs.set(key, job);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value!);
  return job;
}

/** Plan the routes to a vehicle's open LPs, highest priority first: the kept plan, or as much as the time budget allows. */
async function planOpen(user: AppUser, v: Vehicle) {
  const db = await getDb();
  let jobs = jobsByDb.get(db);
  if (!jobs) { jobs = new Map(); jobsByDb.set(db, jobs); }
  const key = JSON.stringify([v.id, user.handle]);
  const revision = await planRevision(db);
  let job = jobs.get(key);
  if (!job || job.revision !== revision) job = startPlan(jobs, user, v, key, revision);
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([job.done, new Promise<void>((done) => { timer = setTimeout(done, config.outreach.connectorsBudgetMs); })])
    .finally(() => clearTimeout(timer));
  // A copy: the job keeps planning after this answer is built.
  const planned = job.planned.slice();
  const complete = job.finished && planned.length === job.open.length;
  return { asOf: job.asOf, open: job.open, planned, notCounted: job.notCounted, complete, revision };
}

/**
 * The answer's version (docs/27 §4b): a hash of what it says. Pass it back as ifChanged and an answer that would say the
 * same is replaced by { unchanged: true, version }. Only a complete plan has one: a partial one changes as planning goes on.
 */
const versionOf = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('base64url').slice(0, 16);
function unchangedOr<T extends object>(complete: boolean, ifChanged: string | undefined, data: T): T & { version: string | null } | { unchanged: true; version: string } {
  const version = complete ? versionOf(data) : null;
  if (version && ifChanged === version) return { unchanged: true, version };
  return { ...data, version };
}

function coverageOf(v: Vehicle, p: { open: PRow[]; planned: Planned[]; notCounted: number; complete: boolean }) {
  return {
    corpus: `Warm-intro routes (the routes routes_to returns: the team and the PL network, up to three hops) to the open LPs on ${v.name}.`,
    counted: `Only routes the planner recommends; ${p.notCounted} held or excluded route${p.notCounted === 1 ? ' was' : 's were'} not counted (rule 8). Each LP counts once per connector.`,
    score: 'Scores are route scores, 0–100: a relative, uncalibrated estimate, never an investment probability.',
    hops: 'The first hop is the first person past the team member on a route — the one the team emails (askFirst). From the PL node, the first hop is reached through the PL network (rule 6).',
    asks: 'asksThisQuarter and lastAsk read the intro asks recorded as made to that person (the routes page\'s record of an ask, and an agent\'s INTRO_ASK linked by email), across every vehicle, this calendar quarter in UTC. An ask emailed without being recorded is not counted.',
    inspected: p.complete ? `Every open LP (${p.open.length}).` : `${p.planned.length} of ${p.open.length} open LPs, highest priority first, before the time budget ran out. Planning carries on after this answer, so asking again reaches further.`,
    kept: 'The plan is kept until a pursuit, route, ask, restriction or entity changes (or the day does), so a repeat call is quick. version is a hash of this answer: pass it back as ifChanged to get { unchanged: true } when nothing it says has changed.',
    note: 'A connector who is not listed may still know them: no supported route in the material inspected is not proof that none exists (rule 7).',
  };
}

/** The first day of this calendar quarter, in UTC. */
export function quarterStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
}

export interface AskHistory {
  asksThisQuarter: number;
  lastAsk: { on: string; replied: boolean | null; basis: string } | null;
}

/**
 * The intro asks made to each person (docs/27 §4b): coordination.ask rows with them as the connector and a made_at —
 * the record the ask cap reads (config.guard.asksPerConnectorPerQuarter). Whether they replied to the last one: the
 * ask's own status or outcome when one is recorded, else the mail trace juanmail reported (email.comms_message) — a
 * message from their side after the ask is a reply; our own message to them since, with nothing back, is "no reply yet";
 * nothing in the trace is unknown (null), never "no" (rule 7).
 */
export async function askHistory(entityIds: string[], now = new Date()): Promise<Map<string, AskHistory>> {
  const out = new Map<string, AskHistory>();
  const ids = [...new Set(entityIds)];
  if (!ids.length) return out;
  const db = await getDb();
  const asks = await db.query<{ id: string; n: number; made_at: Date | string; status: string; outcome: string | null }>(`
    select distinct on (c.id) c.id, c.n, a.made_at, a.status::text status, a.outcome::text outcome
      from (select identity.canonical_entity_id(connector_id)::text id, count(*) filter (where made_at >= $2)::int n
              from coordination.ask where connector_id is not null and made_at is not null and made_at <= $3
               and identity.canonical_entity_id(connector_id) = any($1::uuid[]) group by 1) c
      join coordination.ask a on identity.canonical_entity_id(a.connector_id)::text = c.id and a.made_at is not null and a.made_at <= $3
     order by c.id, a.made_at desc, a.ask_id`, [ids, quarterStart(now), now]);
  const since = asks.length ? new Date(Math.min(...asks.map((a) => new Date(a.made_at).getTime())) - 86_400_000) : null;
  const mail = since ? await db.query<{ id: string; direction: 'ours' | 'theirs'; sent_at: Date | string }>(`
    select distinct identity.canonical_entity_id(x.id)::text id, m.direction, m.sent_at, m.message_id
      from email.comms_message m cross join lateral unnest(m.entity_ids) x(id)
     where identity.canonical_entity_id(x.id) = any($1::uuid[]) and m.sent_at >= $2`, [asks.map((a) => a.id), since]) : [];
  for (const id of ids) out.set(id, { asksThisQuarter: 0, lastAsk: null });
  for (const a of asks) {
    const at = new Date(a.made_at);
    const theirs = mail.filter((m) => m.id === a.id && m.direction === 'theirs' && new Date(m.sent_at) > at);
    // The ask itself, or a follow-up: our message to them from the day of the ask on.
    const ours = mail.filter((m) => m.id === a.id && m.direction === 'ours' && new Date(m.sent_at).getTime() >= at.getTime() - 86_400_000);
    const replied: { replied: boolean | null; basis: string } =
      a.status === 'answered' || ['opted_in', 'declined', 'deferred'].includes(a.outcome ?? '') ? { replied: true, basis: 'the ask\'s recorded outcome' }
        : a.outcome === 'no_reply' ? { replied: false, basis: 'the ask\'s recorded outcome' }
          : theirs.length ? { replied: true, basis: 'the mail trace: a message from them after the ask' }
            : ours.length ? { replied: false, basis: 'the mail trace: our message to them, nothing from them since' }
              : { replied: null, basis: 'Not known: no outcome is recorded on the ask, and the mail trace holds no message with them since.' };
    out.set(a.id, { asksThisQuarter: a.n, lastAsk: { on: at.toISOString().slice(0, 10), ...replied } });
  }
  return out;
}

/** Paging for a connector's targets (docs/27 §4c): the queue's opaque cursor, keyed to this query. */
const queryKey = (v: Vehicle, entityId: string, firstHopOnly: boolean) => createHash('sha256')
  .update(JSON.stringify(['connector-targets', v.id, entityId, firstHopOnly])).digest('base64url').slice(0, 12);
function encodeCursor(q: string, after: string, position: number) {
  return Buffer.from(JSON.stringify({ v: 1, a: after, p: position, q })).toString('base64url');
}
function decodeCursor(q: string, cursor: string) {
  let c: { v?: unknown; a?: unknown; p?: unknown; q?: unknown } | null = null;
  try { c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { /* refused below */ }
  if (!c || c.v !== 1 || typeof c.a !== 'string' || typeof c.p !== 'number' || !Number.isInteger(c.p) || c.p < 0) {
    throw new OutreachRefused(400, 'cursor is not one this server gave. Pass the previous answer\'s nextCursor.');
  }
  if (c.q !== q) throw new OutreachRefused(400, 'That cursor pages a different query. Keep vehicle, entityId and firstHopOnly as they were.');
  return { after: c.a, position: c.p };
}

export async function topConnectors(user: AppUser, a: ConnectorArgs, fit: ConnectorFit = {}) {
  if (a.entityId) return connectorTargets(user, { ...a, entityId: a.entityId }, fit);
  if (a.cursor) throw new OutreachRefused(400, 'cursor pages one connector\'s targets: pass entityId with it.');
  if ((a.limit ?? 20) > MAX_CONNECTORS) throw new OutreachRefused(400, `At most ${MAX_CONNECTORS} connectors a call; a connector's own targets (entityId) page up to ${config.outreach.maxQueueRows}.`);
  const v = await deskVehicle(user, a.vehicle);
  const p = await planOpen(user, v);
  const firstOnly = a.firstHopOnly === true;
  type Lp = { score: number | null; band: RouteStrength | null };
  const by = new Map<string, { name: string; lps: Map<string, Lp>; firstLps: Map<string, Lp>; asFirstHop: number; asDeeperHop: number }>();
  const keep = (m: Map<string, Lp>, id: string, lp: Lp) => { const prior = m.get(id); if (!prior || (lp.score ?? -1) > (prior.score ?? -1)) m.set(id, lp); };
  let reached = 0;
  for (const { r, routes } of p.planned) {
    if (routes.some((x) => x.ids.length)) reached++;
    for (const route of routes) {
      const lp = { score: route.score, band: route.band };
      route.ids.forEach((id, i) => {
        const c = by.get(id) ?? { name: route.names[i] ?? 'Unknown', lps: new Map(), firstLps: new Map(), asFirstHop: 0, asDeeperHop: 0 };
        if (i === 0) { c.asFirstHop++; keep(c.firstLps, r.id, lp); } else c.asDeeperHop++;
        keep(c.lps, r.id, lp);
        by.set(id, c);
      });
    }
  }
  const ranked = [...by.entries()].flatMap(([entityId, c]) => {
    const counted = firstOnly ? c.firstLps : c.lps;
    if (!counted.size) return [];
    const lps = [...counted.entries()].sort((x, y) => (y[1].score ?? -1) - (x[1].score ?? -1) || (x[0] < y[0] ? -1 : 1));
    return [{ entityId, name: c.name, lps: lps.length, bestScore: lps[0]?.[1].score ?? null, bestBand: lps[0]?.[1].band ?? null,
      examplePursuitIds: lps.slice(0, EXAMPLES).map(([id]) => id),
      asFirstHop: c.asFirstHop, asDeeperHop: c.asDeeperHop, reachableDirectly: c.asFirstHop > 0 }];
  }).sort((x, y) => y.lps - x.lps || (y.bestScore ?? -1) - (x.bestScore ?? -1) || x.name.localeCompare(y.name) || (x.entityId < y.entityId ? -1 : 1));
  const shown = ranked.slice(0, a.limit ?? 20);
  const [c, asks] = await Promise.all([routeContacts(user, v.id, shown), askHistory(shown.map((x) => x.entityId))]);
  return {
    asOf: p.asOf,
    data: unchangedOr(p.complete, a.ifChanged, {
      vehicle: v.slug, firstHopOnly: firstOnly,
      connectors: shown.map((x) => ({ ...c.at(x), ...(asks.get(x.entityId) ?? { asksThisQuarter: 0, lastAsk: null }) })),
      total: ranked.length, lpsOpen: p.open.length, lpsInspected: p.planned.length, lpsReached: reached, complete: p.complete,
      addresses: c.shown ? 'shown' : ADDRESSES_WITHHELD,
    }),
    coverage: { ...coverageOf(v, p), ...(firstOnly ? { ranking: 'firstHopOnly: only routes on which the connector is the first hop past the team member count; anyone the team reaches only through another person is left out.' } : {}) },
  };
}

/**
 * One connector's targets (docs/27 §4c): every open LP on the vehicle the connector reaches by a recommended route, the
 * caller may read (the vehicle is theirs), with the best route score through them, best first. Paged as the queue is.
 */
async function connectorTargets(user: AppUser, a: ConnectorArgs & { entityId: string }, fit: ConnectorFit) {
  const v = await deskVehicle(user, a.vehicle);
  const limit = Math.min(a.limit ?? config.outreach.defaultQueueRows, config.outreach.maxQueueRows);
  const entityId = (await (await getDb()).one<{ id: string }>('select identity.canonical_entity_id($1::uuid)::text id', [a.entityId]))?.id ?? a.entityId;
  const firstOnly = a.firstHopOnly === true;
  const q = queryKey(v, entityId, firstOnly);
  const start = a.cursor ? decodeCursor(q, a.cursor) : null;
  const p = await planOpen(user, v);
  let name: string | null = null, asFirstHop = 0, asDeeperHop = 0;
  const rows = p.planned.flatMap(({ r, routes }) => {
    // The best recommended route through them to this LP (first-hop routes only, with firstHopOnly).
    let best: { route: Usable; at: number } | null = null, through = 0;
    for (const route of routes) {
      const at = route.ids.indexOf(entityId);
      if (at < 0) continue;
      name ??= route.names[at] ?? null;
      if (at === 0) asFirstHop++; else asDeeperHop++;
      if (firstOnly && at !== 0) continue;
      through++;
      if (!best || (route.score ?? -1) > (best.route.score ?? -1)) best = { route, at };
    }
    if (!best) return [];
    const b: { route: Usable; at: number } = best;
    return [{
      pursuitId: r.id, entityId: r.entityId, name: r.name,
      status: { value: r.status, label: STATUS_LABEL[r.status as PursuitStatus] ?? r.status },
      score: b.route.score, band: b.route.band, position: b.at === 0 ? 'first' as const : 'deeper' as const, hops: b.route.hops,
      introducer: b.route.ids.length ? { entityId: b.route.ids.at(-1)!, name: b.route.names.at(-1) ?? 'Unknown' } : null,
      routes: through,
    }];
  }).sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || (x.pursuitId < y.pursuitId ? -1 : x.pursuitId > y.pursuitId ? 1 : 0));
  const anchor = start ? rows.findIndex((x) => x.pursuitId === start.after) : -1;
  const offset = start ? (anchor >= 0 ? anchor + 1 : Math.min(start.position, rows.length)) : 0;
  const page = rows.slice(offset, offset + limit);
  let fitted = page;
  if (fit.maxBytes) while (fitted.length > 1 && Buffer.byteLength(JSON.stringify(fitted)) > fit.maxBytes) fitted = fitted.slice(0, -1);
  const nextCursor = fitted.length && offset + fitted.length < rows.length ? encodeCursor(q, rows[offset + fitted.length - 1]!.pursuitId, offset + fitted.length) : null;
  const [c, asks] = await Promise.all([routeContacts(user, v.id, [{ entityId, name: name ?? 'Unknown' }]), askHistory([entityId])]);
  const who = c.at({ entityId, name: name ?? 'Unknown' });
  return {
    asOf: p.asOf,
    data: unchangedOr(p.complete, a.ifChanged, {
      vehicle: v.slug, firstHopOnly: firstOnly,
      // The name comes from the routes: a connector on no route here is not named (an id is not a way to look anyone up).
      connector: { ...who, name, asFirstHop, asDeeperHop, reachableDirectly: asFirstHop > 0, ...(asks.get(entityId) ?? { asksThisQuarter: 0, lastAsk: null }) },
      rows: fitted, total: rows.length, offset, limit, nextCursor,
      ...(fitted.length < page.length ? { heldBack: `${page.length - fitted.length} row${page.length - fitted.length === 1 ? '' : 's'} held back to fit the answer's size limit; nextCursor continues from here.` } : {}),
      lpsOpen: p.open.length, lpsInspected: p.planned.length, complete: p.complete,
      addresses: c.shown ? 'shown' : ADDRESSES_WITHHELD,
      ...(rows.length ? {} : { empty: 'No recommended route through this person to an open LP on this vehicle in the material inspected. That is not proof that none exists (rule 7).' }),
    }),
    coverage: {
      ...coverageOf(v, p),
      paging: `${config.outreach.defaultQueueRows} rows by default, at most ${config.outreach.maxQueueRows}; pass nextCursor as cursor for the next page (null at the end). total counts every LP they reach among those inspected.`,
      order: 'Best route score through them first, then by pursuit id. position says whether they are the first hop past the team member (first) or further along (deeper) on that route.',
    },
  };
}

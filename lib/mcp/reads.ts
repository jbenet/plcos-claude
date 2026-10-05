import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { can } from '@/lib/authz';
import { licensedAccess } from '@/lib/authz/read/r3';
import { projectRoutes } from '@/lib/authz/read/sections-data';
import { planRoutes, throughNode, redactLicensedRoutes } from '@/lib/authz/read/network';
import { getPursuit, listPursuits, STATUSES, RUNG_LABEL, type PursuitStatus } from '@/lib/authz/read/strategy';
import { pipelineData } from '@/lib/authz/read/pipeline';
import { changelogItems } from '@/lib/changelog';
import { getDb, type Queryable } from '@/lib/db';
import { issues as issueSink } from '@/lib/issues';
import { searchEntities } from '@/modules/identity';
import { touchpointSummaries } from '@/modules/meetings';
import { restrictionsFor } from '@/modules/coordination';
import { suggestionsFor } from '@/modules/strategy';
import { listVehicles, type AppUser, type Vehicle } from '@/modules/platform';
import type { RouteSearch } from '@/modules/network';
import { ADDRESSES_WITHHELD, bestAddresses } from '@/lib/outreach/addresses';
import type { Answer } from './output';

/**
 * The MCP read tools (docs/26-mcp.md). Each answer is an explicit, allowlisted projection — the
 * pattern of lib/authz/read/projection.ts — so a column added to a record cannot widen what a
 * token's owner reads. Every value passes a `can()` check for its vehicle and field class:
 * R1 amounts, R2 words, R4 restriction reasons; R3 (licensed Dakota) values are dropped for
 * anyone but an Admin, by the same facades the pages use. Runs inside actAs(owner), so those
 * facades redact for the token's owner.
 */

export class ToolRefused extends Error {
  constructor(message: string) { super(message); this.name = 'ToolRefused'; }
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const day = (d: Date | string | null | undefined) => iso(d)?.slice(0, 10) ?? null;
/** Every vehicle, or every vehicle the principal may read: Admins and all-vehicle readers see identities across the system. */
const globalReader = (u: AppUser) => u.access === 'admin' || u.vehicles === null;
const words = (u: AppUser, vehicle: string) => can(u, 'read', { vehicle, fieldClass: 'R2' });

export async function resolveVehicle(user: AppUser, ref: string): Promise<Vehicle> {
  const v = (await listVehicles()).find((x) => x.slug === ref || x.id === ref);
  // The same answer for "no such vehicle" and "not yours", so a slug's existence is not a probe.
  if (!v || !can(user, 'read', { vehicle: v.id })) throw new ToolRefused(`No vehicle "${ref}" among yours. Your vehicles: ${(await readableVehicles(user)).map((x) => x.slug).join(', ') || 'none'}.`);
  return v;
}

export async function readableVehicles(user: AppUser): Promise<Vehicle[]> {
  return (await listVehicles()).filter((v) => can(user, 'read', { vehicle: v.id }));
}

// ── search ──────────────────────────────────────────────────────────────────────────────

export async function search(user: AppUser, a: { query: string; kind?: 'any' | 'person' | 'org'; limit?: number }): Promise<Answer> {
  const limit = a.limit ?? 20;
  const found = (await searchEntities(a.query, 200)).filter((e) => !a.kind || a.kind === 'any' || e.entityType === a.kind);
  const ids = found.map((e) => e.entityId);
  const db = await getDb();
  const [pursuits, restricted, vehicles] = await Promise.all([
    ids.length ? db.query<{ id: string; entity: string; vehicleId: string; status: string; owner: string }>(`select p.pursuit_id::text id,
      identity.canonical_entity_id(p.entity_id)::text entity, p.vehicle_id::text "vehicleId", p.status::text status, u.name owner
      from strategy.active_pursuit p join platform.app_user u on u.id = p.owner_id
      where identity.canonical_entity_id(p.entity_id) = any($1::uuid[])`, [ids]) : [],
    ids.length ? db.query<{ entity: string }>(`select distinct identity.canonical_entity_id(entity_id)::text entity from coordination.restriction
      where identity.canonical_entity_id(entity_id) = any($1::uuid[]) and (expires_at is null or expires_at >= current_date)`, [ids]) : [],
    listVehicles(),
  ]);
  const vname = new Map(vehicles.map((v) => [v.id, v]));
  const barred = new Set(restricted.map((r) => r.entity));
  let outsideScope = 0;
  const rows = found.flatMap((e) => {
    const mine = pursuits.filter((p) => p.entity === e.entityId);
    const visible = mine.filter((p) => can(user, 'read', { vehicle: p.vehicleId }));
    if (!visible.length && !globalReader(user)) { if (mine.length) outsideScope++; return []; }
    return [{
      entityId: e.entityId, name: e.displayName, type: e.entityType, doNotApproach: barred.has(e.entityId),
      pursuits: visible.map((p) => ({ pursuitId: p.id, vehicle: vname.get(p.vehicleId)?.slug, vehicleName: vname.get(p.vehicleId)?.name, status: p.status, owner: p.owner })),
      // Cross-vehicle presence stays visible for coordination (rule 5), without status.
      alsoOn: mine.filter((p) => !visible.includes(p)).map((p) => ({ vehicleName: vname.get(p.vehicleId)?.name, owner: p.owner })),
    }];
  });
  return {
    data: rows.slice(0, limit),
    coverage: {
      corpus: 'Names of people and organisations recorded in this system (identity records), matched as a substring, case-insensitive.',
      matched: rows.length, shown: Math.min(limit, rows.length), outsideYourVehicles: outsideScope,
      note: globalReader(user) ? 'No match means none recorded here, not that they do not exist.'
        : 'You read only LPs on your vehicles; people and organisations without a pursuit there are not listed.',
    },
  };
}

// ── LP summary ──────────────────────────────────────────────────────────────────────────

async function canonicalPursuit(id: string, q: Queryable): Promise<string | null> {
  return (await q.one<{ id: string }>('select strategy.canonical_pursuit_id($1::uuid)::text id', [id]))?.id ?? null;
}

const MAX_ROUTES = 5; // GUESS — the top few; the routes page has the rest.

/** Every entity among these with a current restriction on file, of any scope (rule 8): flagged, never dropped. */
export async function restrictedAmong(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await (await getDb()).query<{ entity: string }>(`select distinct identity.canonical_entity_id(entity_id)::text entity from coordination.restriction
    where identity.canonical_entity_id(entity_id) = any($1::uuid[]) and (expires_at is null or expires_at >= current_date)`, [[...new Set(ids)]]);
  return new Set(rows.map((r) => r.entity));
}

type Hop = { entityId: string; name: string; tier: string };
type Person = { entityId: string; name: string };
/**
 * Route hops and introducers with what a desk needs to act on them (docs/27 §4a): each one's entityId, whether a
 * restriction is on file for it (`doNotApproach`, any scope; the route's verdict still says whether it may be used),
 * and, where the reader may read addresses on this vehicle (R2; with no vehicle, every vehicle), its best address
 * with source and confirmation date. A restriction is never stripped to make a route usable; an address the read
 * rules withhold is not sent, and the answer says so.
 */
export async function routeContacts(user: AppUser, vehicleId: string | null, people: Person[]) {
  const ids = [...new Set(people.map((p) => p.entityId))];
  const [{ shown, best }, barred] = await Promise.all([bestAddresses(user, vehicleId, ids), restrictedAmong(ids)]);
  const at = <T extends Person>(p: T) => ({ ...p, doNotApproach: barred.has(p.entityId),
    ...(shown ? { contact: best.has(p.entityId) ? { email: best.get(p.entityId)!.email, source: best.get(p.entityId)!.source, confirmedAt: best.get(p.entityId)!.confirmedAt } : null } : {}) });
  return { shown, at };
}

async function routeAnswer(user: AppUser, vehicleId: string, search: RouteSearch | null, limit: number) {
  const shown = search && !licensedAccess(user) ? redactLicensedRoutes(search) : search;
  const dto = projectRoutes(user, vehicleId, shown);
  if (!dto) return null;
  const routes = dto.routes.slice(0, limit);
  const people = routes.flatMap((r) => [...r.hops, ...(r.introducer ? [r.introducer] : [])]);
  const c = await routeContacts(user, vehicleId, people);
  // askFirst (the person the team emails) is hops[0], so its address is among the hops'; the introducer carries the ask on.
  return { ...dto,
    routes: routes.map((r) => ({ ...r, hops: r.hops.map((h: Hop) => c.at(h)), askFirst: r.askFirst ? c.at(r.askFirst) : null,
      introducer: r.introducer ? c.at(r.introducer) : null })),
    routesFound: dto.routes.length, addresses: c.shown ? 'shown' : ADDRESSES_WITHHELD,
    empty: dto.routes.length ? null : 'No supported route in the material inspected. That is not proof that no route exists (rule 7).' };
}

export async function lpSummary(user: AppUser, a: { pursuitId: string; routes?: boolean }): Promise<Answer> {
  const db = await getDb();
  const id = await canonicalPursuit(a.pursuitId, db);
  const p = id ? await getPursuit(id) : null;
  if (!p || !can(user, 'read', { vehicle: p.vehicleId })) throw new ToolRefused('No such LP on your vehicles.');
  const vehicle = (await listVehicles()).find((v) => v.id === p.vehicleId)!;
  const w = words(user, p.vehicleId);
  const amounts = can(user, 'read', { vehicle: p.vehicleId, fieldClass: 'R1' });
  const reasons = can(user, 'read', { vehicle: p.vehicleId, fieldClass: 'R4' });
  const licensed = licensedAccess(user);
  const [touch, suggestions, restrictions, others, exposures] = await Promise.all([
    touchpointSummaries([{ entityId: p.entityId, vehicleId: p.vehicleId }]).then((m) => m.get(`${p.entityId}:${p.vehicleId}`) ?? null),
    w ? suggestionsFor(p.pursuitId) : Promise.resolve([]),
    restrictionsFor(p.entityId),
    db.query<{ id: string; vehicleId: string; vehicle: string; status: string; owner: string }>(`select p.pursuit_id::text id, p.vehicle_id::text "vehicleId",
      v.name vehicle, p.status::text status, u.name owner from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id
      join platform.app_user u on u.id = p.owner_id
      where identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id($1::uuid) and p.pursuit_id <> $2::uuid`, [p.entityId, p.pursuitId]),
    amounts ? db.query<{ track: string; amount: string | null; instrument: string }>(`select track::text, amount::text, instrument::text from pipeline.exposure
      where identity.canonical_entity_id(entity_id) = identity.canonical_entity_id($1::uuid) and vehicle_id = $2 and closed_at is null`, [p.entityId, p.vehicleId]) : Promise.resolve([]),
  ]);
  // The latest strategy that was not dismissed; a licensed (Dakota) one only for an Admin.
  const s = suggestions.find((x) => x.status !== 'dismissed' && (licensed || x.data?.source !== 'dakota'));
  const sd = (s?.data ?? {}) as { angle?: string; ask?: { shape?: string }; list?: string; confidence?: string; next?: { what?: string }; risks?: string[] };
  const routes = a.routes === false ? null
    : await routeAnswer(user, p.vehicleId, await planRoutes(user.handle, p.entityId, 3, vehicle.kind, 'team', undefined, { vehicleId: p.vehicleId }), MAX_ROUTES);
  return {
    link: `/${vehicle.slug}/pipeline/${p.pursuitId}`,
    data: {
      pursuitId: p.pursuitId, entityId: p.entityId, name: p.entityName, vehicle: vehicle.slug, vehicleName: vehicle.name,
      owner: p.ownerSaid ?? p.ownerName, status: p.status, statusSetAt: day(p.statusSetAt),
      evidenceRung: p.rung ? RUNG_LABEL[p.rung] : 'Nothing on file',
      source: p.source === 'us' ? 'set here' : `read from ${p.source}${p.sourceAsOf ? `, as of ${day(p.sourceAsOf)}` : ''}`,
      ...(w ? { headline: p.headline, statusReason: p.statusReason, nextStep: p.nextStep, nextStepOn: day(p.nextStepOn) } : { words: 'Withheld: your access does not include the words on this vehicle.' }),
      contact: touch && {
        meetingsHeld: touch.meetingDates.length, lastTouch: day(touch.lastTouch), lastFromThem: day(touch.lastFromThem),
        waitingOnThemSince: day(touch.awaitingSince), nextMeeting: day(touch.nextMeeting), records: touch.total,
      },
      strategy: !w ? null : s ? {
        madeBy: s.madeBy, madeAt: day(s.madeAt), status: s.status, list: sd.list ?? null, angle: sd.angle ?? null,
        askShape: sd.ask?.shape ?? null, confidence: sd.confidence ?? null, next: sd.next?.what ?? null, risks: sd.risks ?? [], text: s.body,
      } : 'No strategy on file.',
      // Rule 1: hard and soft are listed apart and never summed.
      money: amounts ? {
        hard: exposures.filter((x) => x.track === 'hard').map((x) => ({ amount: x.amount, instrument: x.instrument })),
        soft: exposures.filter((x) => x.track !== 'hard').map((x) => ({ amount: x.amount, instrument: x.instrument, track: x.track })),
      } : 'Withheld: your access does not include amounts on this vehicle.',
      // Rule 8: a restriction attaches to the target. Its reason only where R4 is readable.
      restrictions: { count: restrictions.length, ...(reasons
        ? { items: restrictions.map((r) => ({ scope: r.scope, connector: r.connectorName, channel: r.channel, instruction: r.instruction, recordedAt: day(r.recordedAt) })) }
        : restrictions.length ? { note: 'Reasons withheld at your access. Do not approach without checking with the owner.' } : {}) },
      otherVehicles: others.map((o) => can(user, 'read', { vehicle: o.vehicleId })
        ? { pursuitId: o.id, vehicleName: o.vehicle, status: o.status, owner: o.owner } : { vehicleName: o.vehicle, owner: o.owner }),
      routes,
    },
    coverage: { corpus: 'This LP\'s pursuit, its log of meetings, calls and emails, its latest strategy, open amounts and restrictions, and the network\'s routes.', routes: routes?.coverage ?? null },
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────────────────

export async function routesTo(user: AppUser, a: { targetId: string; vehicle: string; limit?: number }): Promise<Answer> {
  const v = await resolveVehicle(user, a.vehicle);
  const db = await getDb();
  const target = await db.one<{ id: string; name: string }>('select entity_id::text id, display_name name from identity.entity where entity_id = identity.canonical_entity_id($1::uuid)', [a.targetId]);
  if (!target) throw new ToolRefused('No such person or organisation.');
  if (!globalReader(user)) {
    const ours = await db.one('select 1 from strategy.active_pursuit where identity.canonical_entity_id(entity_id) = $1::uuid and vehicle_id = $2', [target.id, v.id]);
    if (!ours) throw new ToolRefused(`You read routes only to LPs on your vehicles, and ${v.name} has no pursuit of this one.`);
  }
  const answer = await routeAnswer(user, v.id, await planRoutes(user.handle, target.id, 3, v.kind, 'team', undefined, { vehicleId: v.id }), a.limit ?? 10);
  return { data: answer ?? { target: target.name, routes: [], empty: 'No routes were computed for this target.' }, link: `/${v.slug}/routes?target=${target.id}`,
    coverage: answer ? { ...answer.coverage, note: 'Routes start from the team and the PL network, up to three hops, and rank by evidence tier (A strongest).' } : undefined };
}

const THROUGH_BUDGET_MS = 8000; // the routes page's own budget for this read (app/routes/page.tsx)

export async function routesThrough(user: AppUser, a: { nodeId: string; vehicle?: string; limit?: number }): Promise<Answer> {
  if (!globalReader(user)) throw new ToolRefused('Routes through a node list LPs on every vehicle, so they need access to all vehicles.');
  const v = a.vehicle ? await resolveVehicle(user, a.vehicle) : null;
  const toNode = await planRoutes(user.handle, a.nodeId, 3, v?.kind ?? 'fund', 'team', undefined, { vehicleId: v?.id });
  const view = await Promise.race([
    throughNode(a.nodeId, { routesToNode: toNode?.routes ?? [], vehicleId: v?.id, vehicleKind: v?.kind ?? 'fund' }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new ToolRefused('The through view took too long for this node. Try the routes page.')), THROUGH_BUDGET_MS).unref()),
  ]);
  const limit = a.limit ?? 20;
  // The node is the introducer here; its route's hops carry ids, flags and (where readable) addresses, as routes_to's do.
  const best = view.bestRoute;
  const bestHops = best ? best.hops.map((h) => ({ entityId: h.toEntity, name: h.toName, tier: h.edge.tier })) : [];
  const nodeId = (await (await getDb()).one<{ id: string }>('select identity.canonical_entity_id($1::uuid)::text id', [a.nodeId]))?.id ?? a.nodeId;
  const c = await routeContacts(user, v?.id ?? null, [{ entityId: nodeId, name: view.nodeName }, ...bestHops]);
  const node = c.at({ entityId: nodeId, name: view.nodeName });
  return {
    link: `/routes?target=${a.nodeId}&mode=through`,
    data: {
      node: view.nodeName, nodeId, ours: view.source?.kind ?? null, doNotApproach: view.nodeRestricted,
      ...('contact' in node ? { nodeContact: node.contact } : {}), addresses: c.shown ? 'shown' : ADDRESSES_WITHHELD,
      bestRouteToNode: best ? { from: best.fromName ?? null, fromEntityId: best.fromEntity ?? null, hops: bestHops.map((h) => c.at(h)),
        // The first hop past the team member: whom the team emails to reach the node (docs/27 §4a).
        askFirst: bestHops[0] ? c.at({ entityId: bestHops[0].entityId, name: bestHops[0].name, direct: bestHops.length === 1 }) : null } : null,
      onward: view.nodeRestricted ? [] : view.onward.slice(0, limit).map((t) => ({
        entityId: t.otherId, name: t.otherName, tieTier: t.edges[0]?.tier ?? null, routeTier: t.combinedTier, sources: t.sources,
        lps: t.lps.map((l) => ({ name: l.name, vehicle: l.vehicleSlug, status: l.status, via: l.via })),
      })),
      onwardTotal: view.onward.length,
      restrictedOnward: view.restrictedOnward,
      onlyThrough: view.onlyThrough.slice(0, limit).map((o) => ({ entityId: o.entityId, name: o.name, candidatePaths: o.candidates })),
      gaps: view.gaps,
    },
    coverage: { onlyThrough: view.onlyThroughCoverage, note: 'Ties to people with a restriction on this approach are counted, never listed (rule 8).' },
  };
}

// ── Pipeline and target lists ───────────────────────────────────────────────────────────

type Row = Awaited<ReturnType<typeof pipelineData>>['rows'][number];

function pipelineRow(user: AppUser, r: Row) {
  const w = words(user, r.vehicleId), amounts = can(user, 'read', { vehicle: r.vehicleId, fieldClass: 'R1' });
  return {
    pursuitId: r.id, entityId: r.entityId, name: r.name, organisation: r.isOrg ? null : r.org, status: r.status, owner: r.owner,
    doNotApproach: r.doNotContact, evidence: r.rungLabel, meetings: r.meetings, lastTouch: day(r.lastTouch), waitingOnThemSince: day(r.waitingSince),
    priority: r.priority, capacity: r.capacity,
    ...(w ? { next: r.next, nextOn: day(r.nextOn), list: r.list, ended: r.ended } : {}),
    ...(amounts && r.money ? { money: { state: r.money.state, amount: r.money.amount, hard: r.money.hard } } : {}),
  };
}

export async function pipeline(user: AppUser, a: { vehicle: string; status?: PursuitStatus; limit?: number; offset?: number }): Promise<Answer> {
  const v = await resolveVehicle(user, a.vehicle);
  const { rows, asOf } = await pipelineData(v.id);
  const mine = rows.filter((r) => r.vehicleId === v.id);
  const chosen = a.status ? mine.filter((r) => r.status === a.status) : mine;
  const offset = a.offset ?? 0, limit = a.limit ?? 50;
  return {
    asOf, link: `/${v.slug}/pipeline${a.status ? `?status=${a.status}` : ''}`,
    data: {
      vehicle: v.slug, vehicleName: v.name,
      counts: Object.fromEntries(STATUSES.map((s) => [s.id, mine.filter((r) => r.status === s.id).length])),
      rows: chosen.slice(offset, offset + limit).map((r) => pipelineRow(user, r)),
      total: chosen.length, offset,
    },
    coverage: { corpus: `Pursuits recorded in this system for ${v.name}, including those read from Affinity.`, note: 'Someone without a pursuit does not appear; that is a gap in the record, not a judgement.' },
  };
}

const LISTS = { 'this year': 'This year’s close', '2027': 'The 2027 pipeline', 'not now': 'Not now' } as const;

export async function targetLists(user: AppUser, a: { vehicle: string; list?: keyof typeof LISTS | 'none'; limit?: number; offset?: number }): Promise<Answer> {
  const v = await resolveVehicle(user, a.vehicle);
  if (!words(user, v.id)) throw new ToolRefused('Target lists come from the strategies, which your access does not include.');
  const { rows, asOf } = await pipelineData(v.id);
  const open = rows.filter((r) => r.vehicleId === v.id && r.status !== 'passed');
  const key = (r: Row) => (r.list && r.list in LISTS ? r.list : 'none');
  const list = a.list ?? 'this year';
  const chosen = open.filter((r) => key(r) === list).sort((x, y) => (y.priority ?? -1) - (x.priority ?? -1));
  const offset = a.offset ?? 0, limit = a.limit ?? 50;
  return {
    asOf, link: `/${v.slug}/strategy`,
    data: {
      vehicle: v.slug, list, listName: list === 'none' ? 'No list (no strategy yet)' : LISTS[list],
      counts: { ...Object.fromEntries(Object.keys(LISTS).map((k) => [k, open.filter((r) => key(r) === k).length])), none: open.filter((r) => key(r) === 'none').length },
      rows: chosen.slice(offset, offset + limit).map((r) => pipelineRow(user, r)), total: chosen.length, offset,
    },
    coverage: { corpus: `Open pursuits on ${v.name} (not passed), by the list their latest strategy names (docs/04 §0).`, order: 'Highest priority first; no priority last.' },
  };
}

// ── Replies owed ────────────────────────────────────────────────────────────────────────

export async function repliesOwed(user: AppUser, a: { vehicle?: string; withinDays?: number; limit?: number }): Promise<Answer> {
  const vehicles = a.vehicle ? [await resolveVehicle(user, a.vehicle)] : (await readableVehicles(user)).filter((v) => v.phase !== 'historical');
  const allowed = vehicles.filter((v) => words(user, v.id));
  if (!allowed.length) throw new ToolRefused('Replies owed read the log of contact, which your access does not include.');
  const pursuits = (await Promise.all(allowed.map((v) => listPursuits(v.id)))).flat().filter((p) => p.status !== 'passed' && !p.closedAt);
  const sums = await touchpointSummaries(pursuits.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId })));
  const now = Date.now(), within = (a.withinDays ?? 60) * 86_400_000, limit = a.limit ?? 50;
  const slug = new Map(allowed.map((v) => [v.id, v.slug]));
  const row = (p: (typeof pursuits)[number], since: Date) => ({ pursuitId: p.pursuitId, name: p.entityName, vehicle: slug.get(p.vehicleId), status: p.status,
    owner: p.ownerSaid ?? p.ownerName, since: day(since), days: Math.floor((now - since.getTime()) / 86_400_000) });
  // We owe: they were last to speak (a reply, or a meeting), and nothing from us since.
  const owed = pursuits.flatMap((p) => {
    const s = sums.get(`${p.entityId}:${p.vehicleId}`);
    return s?.lastFromThem && !s.awaitingSince && now - s.lastFromThem.getTime() <= within ? [row(p, s.lastFromThem)] : [];
  }).sort((x, y) => x.days - y.days);
  // Waiting on them (Today's list): Connecting, nothing from them on record.
  const waiting = pursuits.filter((p) => p.status === 'connecting').flatMap((p) => {
    const s = sums.get(`${p.entityId}:${p.vehicleId}`);
    return s?.lastFromThem ? [] : [row(p, s?.awaitingSince ?? p.statusSetAt ?? p.openedAt)];
  }).sort((x, y) => y.days - x.days);
  return {
    data: { weOwe: owed.slice(0, limit), weOweTotal: owed.length, waitingOnThem: waiting.slice(0, limit), waitingOnThemTotal: waiting.length },
    coverage: {
      corpus: `The log of meetings, calls and emails on ${allowed.map((v) => v.name).join(', ')}, as recorded here (Affinity's records included).`,
      window: `They spoke last within ${a.withinDays ?? 60} days.`,
      note: 'An automatic reply and our own events do not count as a word from them. A reply sent outside what is recorded here is not seen.',
    },
  };
}

// ── Feedback issues and the changelog ───────────────────────────────────────────────────

export async function feedbackIssues(user: AppUser, a: { id?: string; status?: 'open' | 'done' | 'all'; limit?: number }): Promise<Answer> {
  const sink = await issueSink();
  if (a.id) {
    const issue = await sink.get(a.id);
    if (!issue) throw new ToolRefused('No such issue.');
    return { link: `/developer/issues/${issue.id}`, data: {
      id: issue.id, title: issue.title, status: issue.status, kind: issue.kind, priority: issue.priority, created: issue.created,
      closedAt: issue.closedAt ?? null, page: issue.page, reporter: issue.reporter, labels: issue.labels, fixedIn: issue.fixedIn,
      // A Viewer reads titles, not bodies: a body filed on real data can quote it.
      body: user.access === 'viewer' ? 'Withheld at your access.' : issue.body,
    } };
  }
  const open = ['open', 'triaged', 'agent-ready', 'in-progress'] as const;
  const list = await sink.list(a.status === 'all' ? {} : a.status === 'done' ? { status: ['done'] } : { status: [...open] });
  const rows = list.sort((x, y) => y.created.localeCompare(x.created)).slice(0, a.limit ?? 50)
    .map((i) => ({ id: i.id, title: i.title, status: i.status, kind: i.kind, priority: i.priority, created: i.created, page: i.page }));
  return { link: '/developer/issues', data: { rows, total: list.length }, coverage: { corpus: `Issues filed from the feedback box (${sink.destination}).` } };
}

export async function changelog(_user: AppUser, a: { slug?: string; limit?: number }): Promise<Answer> {
  const items = await changelogItems();
  if (a.slug) {
    const item = items.find((i) => i.slug === a.slug);
    if (!item) throw new ToolRefused('No such changelog entry.');
    return { link: `/developer/changelog/${item.slug}`, data: { slug: item.slug, title: item.label, text: await readFile(join(process.cwd(), item.file), 'utf8') } };
  }
  return { link: '/developer/changelog', data: { latest: items.slice(-(a.limit ?? 20)).reverse().map((i) => ({ slug: i.slug, title: i.label })), total: items.length } };
}

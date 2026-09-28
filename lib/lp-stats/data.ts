import { strategyRouteSummaries } from '@/modules/network';
import { getDb } from '@/lib/db';
import { buildCache } from '@/lib/build-cache';
import { pipelineData } from '@/lib/pipeline-data';
import { vehicleReadings } from '@/lib/vehicle-readings';
import { listVehicles } from '@/modules/platform';
import { listAssessments, type Assessment } from '@/modules/fit';
import { ticketEstimate } from '@/lib/connectors/dakota/rules';
import { countryOf } from './geo';
import {
  bandOfAmount, bandOfText, lpTypeOf, sourceOf, spvBandOf,
  type CheckBand, type CheckBasis, type FitGroup, type LpFact, type Money, type PursuitStatus, type Tier,
} from './model';

/**
 * The facts behind LP stats, one per pursuit, gathered in set-based reads and kept per data
 * generation (lib/build-cache: any write moves the revision, and midnight moves it for recency).
 * The Selection rows (lib/pipeline-data) supply status, owner, score, strategy band and last touch;
 * the reads here add what an LP *is* — type, place, check size, source, path, money — for the same
 * pursuits. Read-only. Dakota values stay in the database and on this server's pages.
 */

const BAND_GROUP: Record<Assessment['band'], FitGroup> = { strong: 'strong', workable: 'good', weak: 'weak', blocked: 'gate' };

/** Resolve the LPs' aliases once: merged-away ids still carry research and Dakota rows. */
const WANTED = `with recursive wanted(entity_id,target) as (
    select entity_id,entity_id from identity.entity where entity_id=any($1::uuid[])
    union all select e.entity_id,w.target from wanted w join identity.entity e on e.merged_into=w.entity_id
  )`;

export interface StatsData {
  facts: LpFact[];
  vehicles: Array<{ slug: string; name: string }>;
  asOf: string;
  /** Pursuits on vehicles kept for their history, left out of the all-vehicles view. */
  onHistory: number;
}

export const lpStatsData = buildCache(async (vehicleId: string): Promise<StatsData> => {
  const db = await getDb();
  const [{ rows, onHistory, asOf }, vehicles, readings, assessments] = await Promise.all([
    pipelineData(vehicleId), listVehicles(), vehicleReadings(vehicleId || null), listAssessments(vehicleId || null),
  ]);
  const ids = [...new Set(rows.map((r) => r.entityId))];
  const pursuitIds = rows.map((r) => r.id);
  const vehicleIds = [...new Set(rows.map((r) => r.vehicleId))];
  const orgIds = [...new Set(rows.filter((r) => r.isOrg).map((r) => r.entityId))];
  // A firm's people now: their research can say what the firm is, and where it is. `speaks` marks the
  // ones whose word counts for the firm's type — its contacts on a pursuit, or people whose primary
  // affiliation it is and who are not on it only as a board member, adviser or investor (a family-office
  // principal on a company's board does not make the company a family office).
  const orgPeople = await db.query<{ org: string; person: string; speaks: boolean }>(
    `select identity.canonical_entity_id(a.org_entity)::text org, identity.canonical_entity_id(a.person_entity)::text person,
       bool_or((a.is_primary and coalesce(a.role,'') !~* '(board|advis|investor|limited partner|member)')
         or exists(select 1 from strategy.pursuit_contact c join strategy.active_pursuit p using(pursuit_id)
           where identity.canonical_entity_id(p.entity_id)=identity.canonical_entity_id(a.org_entity)
             and identity.canonical_entity_id(c.person_entity)=identity.canonical_entity_id(a.person_entity))) speaks
     from identity.affiliation a where identity.canonical_entity_id(a.org_entity)=any($1::uuid[]) and a.ended_on is null
     group by 1,2`, [orgIds]);
  const people = [...new Set(orgPeople.map((p) => p.person))];
  const firmIds = [...new Set(rows.filter((r) => !r.isOrg && r.orgId).map((r) => r.orgId!))];
  /** Everyone whose place or type may be read: the LPs, individuals' firms, and firms' people. */
  const allIds = [...new Set([...ids, ...firmIds, ...people])];

  const [types, accounts, contactsOwn, profiles, claims, claimCounts, pursuits, prospects, strategies, exposures, routes] = await Promise.all([
    db.query<{ id: string; t: string }>(`select entity_id::text id, entity_type::text t from identity.entity where entity_id=any($1::uuid[])`, [ids]),
    db.query<{ id: string; type: string | null; country: string | null; average_ticket_size__c: string | null; check_size_from__c: string | null;
      private_equity_average_ticket_size__c: string | null; lastmodifieddate: Date }>(
      `${WANTED} select w.target::text id, a.type, a.billingcountry country, a.average_ticket_size__c, a.check_size_from__c,
         a.private_equity_average_ticket_size__c, a.lastmodifieddate
       from wanted w join dakota.account a on a.entity_id=w.entity_id order by a.lastmodifieddate desc, a.id`, [allIds]),
    db.query<{ id: string; country: string | null }>(
      `${WANTED} select w.target::text id, c.mailingcountry country from wanted w join dakota.contact c on c.entity_id=w.entity_id
       where c.mailingcountry is not null order by c.lastmodifieddate desc, c.id`, [allIds]),
    db.query<{ id: string; itype: string | null; loc: string | null }>(
      `${WANTED} select distinct on (w.target) w.target::text id, n.data#>>'{profile,investorType}' itype, n.data#>>'{identity,canonical,location}' loc
       from wanted w join research.note n on n.entity_id=w.entity_id and n.kind='public_profile'
       order by w.target, n.created_at desc, n.note_id`, [allIds]),
    db.query<{ id: string; field: string; value: string }>(
      `${WANTED} select w.target::text id, c.field, c.value from wanted w join research.claim c on c.entity_id=w.entity_id
       where c.superseded_by is null and c.field in ('public.location','typical_check_usd')
       order by c.as_of desc, c.created_at desc`, [allIds]),
    db.query<{ id: string; n: string }>(
      `${WANTED} select w.target::text id, count(*)::text n from wanted w join research.claim c on c.entity_id=w.entity_id
       where c.superseded_by is null group by 1`, [ids]),
    db.query<{ id: string; source: string; opened: Date }>(
      `select pursuit_id::text id, source, opened_at opened from strategy.pursuit where pursuit_id=any($1::uuid[])`, [pursuitIds]),
    db.query<{ id: string; vehicle: string | null; band: string | null; key: string | null }>(
      `${WANTED} select w.target::text id, n.data->>'vehicleId' vehicle, n.data#>>'{capacity,band}' band, n.data->>'personKey' key
       from wanted w join research.note n on n.entity_id=w.entity_id and n.kind='context'
       where n.data->>'source'='prospects' order by n.created_at desc, n.note_id`, [ids]),
    db.query<{ id: string }>(
      `select distinct s.pursuit_id::text id from strategy.suggestion s join strategy.active_pursuit p using(pursuit_id)
       join platform.vehicle v on v.id=p.vehicle_id
       where s.pursuit_id=any($1::uuid[]) and s.status in ('proposed','accepted')
         and (nullif(trim(s.data#>>'{ask,vehicle}'),'') is null or lower(trim(s.data#>>'{ask,vehicle}')) in (lower(v.name),lower(v.slug)))`, [pursuitIds]),
    // Rule 1: one row per track. Nothing here adds soft to hard, or one vehicle to another.
    db.query<{ id: string; vehicle: string; track: 'soft' | 'hard'; amount: string }>(
      `select identity.canonical_entity_id(x.entity_id)::text id, x.vehicle_id::text vehicle, x.track::text track, sum(x.amount)::text amount
       from pipeline.exposure x where x.closed_at is null and x.vehicle_id=any($1::uuid[]) group by 1,2,3`, [vehicleIds]),
    Promise.all([...new Set(vehicles.map(v => v.kind))].map(async kind =>
      [...(await strategyRouteSummaries(ids, kind)).values()].map(r => ({ id: r.entityId, kind, tier: r.tier })))).then(groups => groups.flat()),
  ]);

  const first = <T extends { id: string }>(list: T[]) => { const m = new Map<string, T>(); for (const x of list) if (!m.has(x.id)) m.set(x.id, x); return m; };
  const typeOf = new Map(types.map((t) => [t.id, t.t]));
  const accountOf = first(accounts);
  const contactOf = first(contactsOwn);
  const profileOf = new Map(profiles.map((p) => [p.id, p]));
  const claimOf = new Map<string, string>();
  for (const c of claims) if (!claimOf.has(`${c.id}:${c.field}`)) claimOf.set(`${c.id}:${c.field}`, c.value);
  const claimCount = new Map(claimCounts.map((c) => [c.id, Number(c.n)]));
  const pursuitOf = new Map(pursuits.map((p) => [p.id, p]));
  const hasStrategy = new Set(strategies.map((s) => s.id));
  const itypeOf = new Map(profiles.map((p) => [p.id, p.itype]));
  const contactTypes = new Map<string, string[]>();
  for (const { org, person, speaks } of orgPeople) {
    const t = speaks ? itypeOf.get(person) : undefined;
    if (t && t !== 'unknown') contactTypes.set(org, [...(contactTypes.get(org) ?? []), t]);
  }
  const mostCommon = (list: string[]) => {
    const c = new Map<string, number>(); for (const x of list) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([x]) => x);
  };
  const kindOf = new Map(vehicles.map((v) => [v.id, v.kind as string]));
  const slugOf = new Map(vehicles.map((v) => [v.id, v.slug]));
  const tierOf = new Map(routes.map((r) => [`${r.id}:${r.kind}`, r.tier]));
  const moneyOf = new Map<string, Money>();
  for (const x of exposures) {
    const key = `${x.id}:${x.vehicle}`;
    const m = moneyOf.get(key) ?? { hard: 0, soft: 0 };
    m[x.track] += Number(x.amount);
    moneyOf.set(key, m);
  }
  const prospectsOf = new Map<string, typeof prospects>();
  for (const x of prospects) prospectsOf.set(x.id, [...(prospectsOf.get(x.id) ?? []), x]);
  /** An entity's own place: Dakota's country (an account's billing, a person's mailing), else research. */
  const placeOf = (id: string, unit: 'organisation' | 'individual'): { country: string; basis: 'dakota' | 'research' } | null => {
    const dakota = countryOf(unit === 'organisation' ? accountOf.get(id)?.country : contactOf.get(id)?.country ?? accountOf.get(id)?.country);
    if (dakota) return { country: dakota, basis: 'dakota' };
    const research = countryOf(profileOf.get(id)?.loc) ?? countryOf(claimOf.get(`${id}:public.location`));
    return research ? { country: research, basis: 'research' } : null;
  };
  const peopleOf = new Map<string, string[]>();
  for (const { org, person } of orgPeople) peopleOf.set(org, [...(peopleOf.get(org) ?? []), person]);
  const formal = new Map(assessments.map((a) => [`${a.entityId}:${a.vehicleId}`, a]));
  const readingOf = new Map(readings.map((r) => [r.pursuit_id, r]));

  const facts: LpFact[] = rows.map((r) => {
    const unit = r.isOrg ? 'organisation' as const : 'individual' as const;
    const account = accountOf.get(r.entityId);
    const profile = profileOf.get(r.entityId);
    const { type, basis } = lpTypeOf({
      unit, entityType: typeOf.get(r.entityId) ?? null, dakotaType: unit === 'organisation' ? account?.type ?? null : null,
      researchType: profile?.itype ?? null, contactTypes: mostCommon(contactTypes.get(r.entityId) ?? []), name: r.name,
    });

    // Check size: an estimate from the first source that has one (model.ts, CHECK_BASIS_LABEL).
    let check: CheckBand = 'unknown', checkBasis: CheckBasis = 'none', checkText: string | null = null;
    const strategyBand = r.capacity && r.capacity !== 'unknown' ? bandOfText(r.capacity) : 'unknown';
    const ticket = unit === 'organisation' && account ? ticketEstimate(account as unknown as Parameters<typeof ticketEstimate>[0]) : null;
    const listed = Number(claimOf.get(`${r.entityId}:typical_check_usd`) ?? Number.NaN);
    const listedAsProspect = prospectsOf.get(r.entityId) ?? [];
    const prospect = listedAsProspect.find((x) => (!x.vehicle || x.vehicle === r.vehicleId) && x.band);
    if (strategyBand !== 'unknown') { check = strategyBand; checkBasis = 'strategy'; checkText = r.capacity; }
    else if (ticket) { check = bandOfAmount(ticket.amount); checkBasis = 'dakota'; checkText = `$${Math.round(ticket.amount).toLocaleString('en-US')}`; }
    else if (Number.isFinite(listed) && listed > 0) { check = bandOfAmount(listed); checkBasis = 'affinity'; checkText = `$${Math.round(listed).toLocaleString('en-US')}`; }
    else if (prospect && bandOfText(prospect.band) !== 'unknown') { check = bandOfText(prospect.band); checkBasis = 'prospect'; checkText = `${prospect.band} (guess)`; }

    // Country: Dakota's, else the research profile's place, else a sourced location claim.
    const own = placeOf(r.entityId, unit);
    const borrowed = own ? null : unit === 'individual'
      ? (r.orgId ? placeOf(r.orgId, 'organisation') : null)
      : mostCommon((peopleOf.get(r.entityId) ?? []).map((x) => placeOf(x, 'individual')?.country).filter((x): x is string => !!x))[0] ?? null;
    const country = own?.country ?? (typeof borrowed === 'string' ? borrowed : borrowed?.country) ?? null;
    const countryBasis = own ? own.basis : country ? (unit === 'individual' ? 'firm' as const : 'people' as const) : null;

    const reading = readingOf.get(r.id);
    const a = formal.get(`${r.entityId}:${r.vehicleId}`);
    const gates = reading?.fit?.gates ?? [];
    const failing = a ? a.band === 'blocked' || a.gateStatus === 'failed' : gates.some((g) => g.answer === 'no');
    const verdict = reading?.fit?.verdict;
    const fit: FitGroup = failing ? 'gate' : a ? BAND_GROUP[a.band] : !reading?.suggestion_id ? 'missing'
      : verdict && ['strong', 'good', 'possible', 'weak'].includes(verdict) ? verdict as FitGroup : 'unknown';

    const route = tierOf.get(`${r.entityId}:${kindOf.get(r.vehicleId)}`);
    const tier: Tier = route === undefined ? 'unsearched' : route && ['A', 'B', 'C', 'D'].includes(route) ? route as Tier : 'none';
    const p = pursuitOf.get(r.id);
    const slug = slugOf.get(r.vehicleId) ?? r.vehicleSlug;
    const m = moneyOf.get(`${r.entityId}:${r.vehicleId}`);
    return {
      entityId: r.entityId, name: r.name, context: r.isOrg ? null : r.org, unit,
      pursuits: [{ vehicle: slug, id: r.id, status: r.status as PursuitStatus }],
      type, typeBasis: basis, check, checkBasis, checkText,
      score: r.score, scoreKind: r.score === null ? null : r.scoreKind,
      fit, country, countryBasis, spv: spvBandOf(r.spv?.stance ?? 'unknown', r.spv?.minDeals ?? null),
      status: r.status as PursuitStatus, tier,
      source: sourceOf(p?.source ?? null, prospect?.key ?? listedAsProspect[0]?.key ?? null),
      owner: r.owner || 'Unassigned', strategy: hasStrategy.has(r.id),
      research: profile ? 'profile' : (claimCount.get(r.entityId) ?? 0) > 0 ? 'claims' : 'none',
      lastTouch: r.lastTouch, openedAt: p ? new Date(p.opened).toISOString() : null,
      money: m ? { [slug]: m } : {},
    };
  });

  const inScope = new Set(rows.map((r) => r.vehicleId));
  return {
    facts,
    vehicles: vehicles.filter((v) => inScope.has(v.id) || (vehicleId ? v.id === vehicleId : v.phase !== 'historical'))
      .sort((a, b) => a.sortOrder - b.sortOrder).map((v) => ({ slug: v.slug, name: v.name })),
    asOf, onHistory,
  };
});

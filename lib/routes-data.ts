import { createHash } from 'node:crypto';
import { routeComparison, type ComparisonOptions } from '@/components/routes/route-display';
import { buildCache } from '@/lib/build-cache';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { affiliationsFor, listEntities } from '@/modules/identity';
import { listAsks } from '@/modules/coordination';
import { listAssessments, listFirmProfiles, FIRM_CLASS_LABEL, BLOCKER_SHORT } from '@/modules/fit';
import { directContact, type DirectContact } from '@/modules/meetings';
import { listVehicles } from '@/modules/platform';
import { tierCounts, type Route } from '@/modules/network';
import { listPursuits } from '@/modules/strategy';
import { provisionalScores } from '@/lib/strategy-score';
import type { TargetRow } from '@/components/routes/TargetPicker';
const touchWords = (c: DirectContact) => c.via
  ? `${c.how === 'met' ? 'Met' : 'Heard from'} ${c.via}, ${shortDate(c.on)}`
  : `${c.how === 'met' ? 'Met' : 'Heard from them'}, ${shortDate(c.on)}`;

/** Whole picker inputs shared across route clicks. Database writes and midnight
 * invalidate the snapshot; user-specific ownership stays in the page. */
const pickerInputs = buildCache(async (vehicleId: string) => {
  const [tiers, vehicles, fit, team, pursuits, profiles] = await Promise.all([
    tierCounts(), listVehicles(),
    listAssessments(vehicleId || null),
    (await auth()).listUsers(), listPursuits(vehicleId || null), listFirmProfiles(),
  ]);

  // Targets worth showing (issues 0022–0023, real): the LPs in this pipeline and the organisations
  // they act for — not every person and firm in the replica, which made this page 1.7 MB — and
  // never a member of the team, by the team's own list.
  const affiliations = await affiliationsFor([...new Set(pursuits.filter(p => !p.historical).map(p => p.entityId))]);
  const teamNames = new Set(team.map((u) => u.name));
  const inPipeline = new Set(pursuits.filter((p) => !p.historical).map((p) => p.entityId));
  for (const a of affiliations) if (a.current && inPipeline.has(a.personId)) inPipeline.add(a.orgId);
  const entities = await listEntities([...inPipeline]);
  const targets = entities.filter((e) => inPipeline.has(e.entityId) && !teamNames.has(e.displayName));
  /**
   * The picker carries the fit score, because there is no point finding a beautiful route
   * to somebody nobody has qualified — and the records around each name, so searching
   * "Kaplan" turns up the trust and the person who signs for it.
   */
  const best = new Map<string, { score: number; blocker: string | null; provisional?: boolean }>();
  // Whom the team already deals with directly (issue 0027, real): a meeting held, or word from them.
  const [provisional, contact] = await Promise.all([
    provisionalScores([...inPipeline]), directContact(targets.map((t) => t.entityId)),
  ]);
  // Where no fit assessment exists, a provisional score from the proposed strategy (issue 0022).
  for (const [id, score] of provisional) best.set(id, { score, blocker: null, provisional: true });
  for (const a of fit) {
    const hit = best.get(a.entityId);
    const score = Math.round(a.weightedFit * 100);
    // An assessment outranks a provisional score, whatever the numbers.
    if (!hit || hit.provisional || score > hit.score) {
      best.set(a.entityId, { score, blocker: BLOCKER_SHORT[a.diagnosis.blocker] });
    }
  }
  // Index once: scanning the whole affiliation array for every target was quadratic.
  const people = new Map<string, typeof affiliations>();
  const orgs = new Map<string, typeof affiliations>();
  for (const a of affiliations) if (a.current) {
    const person = people.get(a.personId) ?? []; person.push(a); people.set(a.personId, person);
    const org = orgs.get(a.orgId) ?? []; org.push(a); orgs.set(a.orgId, org);
  }
  const rows: TargetRow[] = targets.map((t) => {
    const related = [
      ...(people.get(t.entityId) ?? []).map((x) => x.orgName),
      ...(orgs.get(t.entityId) ?? []).map((x) => x.personName),
    ];
    /**
     * You route to a person; the fit reading sits on the institution they sign for. So a
     * person with no reading of their own borrows the best one from an organisation they
     * currently act for, and the row marks it as borrowed rather than passing it off.
     */
    const own = best.get(t.entityId) ?? null;
    const borrowedFrom = own ? null : (people.get(t.entityId) ?? [])
      .filter((x) => best.has(x.orgId))
      .map((x) => ({ org: x.orgName, ...best.get(x.orgId)! }))
      .sort((a, b) => b.score - a.score)[0] ?? null;
    const reading = own ?? borrowedFrom;
    const assessment = fit.find((a) => a.entityId === t.entityId);
    const profile = profiles.find((p) => p.entityId === t.entityId);
    const roles = affiliations.filter((a) => a.personId === t.entityId && a.current);
    const founder = roles.find((a) => /\b(co[ -]?)?founder\b/i.test(a.role) && a.source);
    const plRole = roles.find((a) => a.orgName === 'Protocol Labs' && a.source);
    const familiar = assessment?.perceptions.filter((p) => ['familiar', 'deep'].includes(p.familiarity)) ?? [];
    const amount = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD', maximumFractionDigits: 1 }).format(n);
    return {
      lpIcon: profile ? ({ individual: 'person', sfo: 'person', mfo: 'list', ria: 'chart', foundation: 'coin', endowment: 'folder', fof: 'coin', institution: 'folder', corporate: 'folder' } as const)[profile.firmClass] : t.entityType === 'person' ? 'person' : 'folder',
      lpType: profile ? FIRM_CLASS_LABEL[profile.firmClass] : t.entityType,
      checkBand: profile?.checkBandMin != null || profile?.checkBandMax != null
        ? `${profile.checkBandMin != null ? amount(profile.checkBandMin) : '?'}–${profile.checkBandMax != null ? amount(profile.checkBandMax) : '?'}` : null,
      signals: [
        ...(founder ? [{ icon: 'status' as const, label: `Active founder role: ${founder.orgName}; ${founder.source}, ${shortDate(founder.asOf)} (${founder.certainty})` }] : []),
        ...(founder && plRole ? [{ icon: 'link' as const, label: `Founder with recorded PL affiliation: ${plRole.source}, ${shortDate(plRole.asOf)} (${plRole.certainty})` }] : []),
        ...familiar.filter((p) => p.subjectKind === 'firm' && p.subject === 'Protocol Labs').map((p) => ({ icon: 'eye' as const, label: `Familiar with PL: ${p.evidence}; ${p.source ?? 'assessment'}, ${shortDate(p.asOf)} (${p.certainty})` })),
        ...familiar.filter((p) => p.subjectKind === 'thesis').map((p) => ({ icon: 'chart' as const, label: `Sector familiarity for ${vehicles.find((v) => v.id === vehicleId)?.name ?? 'this vehicle'}: ${p.subject}; ${p.evidence}; ${p.source ?? 'assessment'}, ${shortDate(p.asOf)} (${p.certainty})` })),
      ],
      entityId: t.entityId,
      name: t.displayName,
      isPerson: t.entityType === 'person',
      score: reading?.score ?? null,
      provisional: Boolean(reading?.provisional),
      borrowedFrom: borrowedFrom?.org ?? null,
      blocker: reading?.blocker ?? null,
      related: [...new Set(related)].slice(0, 3),
      touch: contact.has(t.entityId) ? touchWords(contact.get(t.entityId)!) : null,
    };
  });
  return { tiers, vehicles, affiliations, fit, team, entities, targets, contact, rows };
});

// Ask ownership/status changes on every workflow action, independently of the graph.
export async function routeInputs(vehicleId: string) {
  const [picker, asks] = await Promise.all([pickerInputs(vehicleId), listAsks(null)]);
  return { ...picker, asks };
}

const basesByRoutes = new WeakMap<Route[], ReadonlySet<string>>();
/** The route cache returns immutable arrays. Reuse this full-result evidence scan
 * across route clicks; only the displayed cards need work on each request. */
export function promotedRouteBases(routes: Route[], hashes?: string[]): { has: (basis: string) => boolean } {
  if (hashes) {
    const promoted = new Set(hashes);
    return { has: (basis) => promoted.has(createHash('sha256').update(basis).digest('hex')) };
  }
  const cached = basesByRoutes.get(routes);
  if (cached) return cached;
  const bases = new Set<string>();
  for (const route of routes) if (route.verdict === 'recommend' || route.verdict === 'hold') {
    for (const hop of route.hops) for (const evidence of hop.edge.evidence) bases.add(evidence.note);
  }
  basesByRoutes.set(routes, bases);
  return bases;
}

/** Client graph consumes identities and score summaries, not full source evidence.
 * The server-rendered comparison below it retains every selected edge's evidence. */
export function graphRouteInputs(routes: Route[]): Route[] {
  return routes.map((route) => ({
    ...route, influence: null, askLoad: null,
    score: route.score ? { ...route.score, factors: route.score.factors.slice(0, 3) } : undefined,
    hops: route.hops.map((hop) => ({ ...hop, edge: {
      ...hop.edge, evidence: [], reviewedByName: null, reviewedAt: null, reviewNote: null,
    } })),
  }));
}


/** Keep the merged comparison UI and its explicit show/deep-link controls. Six
 * full evidence cards bound default SSR; show-more still exposes every retained route. */
export function routeComparisonInputs(routes: Route[], options: ComparisonOptions) {
  const comparison = routeComparison(routes, options);
  const position = comparison.eligible.findIndex((entry) => String(entry.index) === options.selected);
  if (options.show !== undefined || (position >= 0 && position % 80 >= 6)) return comparison;
  return { ...comparison, show: 6,
    displayedRoutes: comparison.eligible.slice(comparison.pageNumber * 80, comparison.pageNumber * 80 + 6) };
}

import { buildCache } from '@/lib/build-cache';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { listAffiliations, listEntities } from '@/modules/identity';
import { listAsks } from '@/modules/coordination';
import { listAssessments, BLOCKER_SHORT } from '@/modules/fit';
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
export const routeInputs = buildCache(async (vehicleId: string) => {
  const [tiers, vehicles, affiliations, fit, asks, team, pursuits] = await Promise.all([
    tierCounts(), listVehicles(),
    listAffiliations(), listAssessments(vehicleId || null),
    listAsks(null), (await auth()).listUsers(), listPursuits(vehicleId || null),
  ]);

  // Targets worth showing (issues 0022–0023, real): the LPs in this pipeline and the organisations
  // they act for — not every person and firm in the replica, which made this page 1.7 MB — and
  // never a member of the team, by the team's own list.
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
    return {
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
  return { tiers, vehicles, affiliations, asks, team, entities, targets, contact, rows };
});

const basesByRoutes = new WeakMap<Route[], ReadonlySet<string>>();
/** The route cache returns immutable arrays. Reuse this full-result evidence scan
 * across route clicks; only the displayed cards need work on each request. */
export function promotedRouteBases(routes: Route[]): ReadonlySet<string> {
  const cached = basesByRoutes.get(routes);
  if (cached) return cached;
  const bases = new Set<string>();
  for (const route of routes) if (route.verdict === 'recommend' || route.verdict === 'hold') {
    for (const hop of route.hops) for (const evidence of hop.edge.evidence) bases.add(evidence.note);
  }
  basesByRoutes.set(routes, bases);
  return bases;
}

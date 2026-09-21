import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { assessmentsForEntity } from '@/modules/fit';
import { orgsFor, peopleAt } from '@/modules/identity';
import { listExposures } from '@/modules/pipeline';
import { listAsks } from '@/modules/coordination';
import type { EvidenceTier } from './types';

/**
 * How much weight a connector's introduction actually carries.
 *
 * The safety rules in `planRoutes` decide whether a route may be used at all. This decides,
 * among the routes that may be used, which one is worth spending. They are separate on
 * purpose: influence must never be able to promote a restricted or unreviewed path.
 *
 * Five components, from Report 6 §2–3:
 *
 *   withUs      Skin in the game. An LP who has wired money is making a different kind of
 *               statement from an acquaintance, and a larger LP a stronger one still.
 *   withTarget  Standing with *this* target. The scarce thing, and the one most systems
 *               substitute fame for.
 *   topic       Credibility is domain-specific and **does not transfer**. A crypto name is
 *               not a route into a neuroscience foundation.
 *   tie         Tie strength, on an inverted U. Moderately weak ties move more than either
 *               strangers or close friends — a close tie mostly knows the people we already
 *               know (Rajkumar et al., Science 377:6612, 2022).
 *   willing     Goodwill left this quarter, and whether they have delivered before.
 *
 * Every component is returned with its own basis sentence. A single number nobody can
 * decompose is a number nobody can argue with.
 */

export type StandingDomain = 'neuro' | 'crypto' | 'allocators' | 'science' | 'operating';

export const DOMAIN_LABEL: Record<StandingDomain, string> = {
  neuro: 'Neuro', crypto: 'Crypto', allocators: 'Allocators',
  science: 'Science', operating: 'Operating',
};

/** Which domains matter for a vehicle. A route is judged on the domains it is being used in. */
export const VEHICLE_DOMAINS: Record<string, StandingDomain[]> = {
  fund: ['neuro', 'allocators', 'science'],
  spv: ['neuro', 'operating', 'allocators'],
  grant_rail: ['science', 'neuro'],
};

export interface Standing {
  entityId: string;
  domain: StandingDomain;
  strength: number;
  basis: string;
  source: string | null;
  asOf: Date;
  certainty: string;
}

export interface Component {
  key: 'withUs' | 'withTarget' | 'topic' | 'tie' | 'willing';
  label: string;
  /** 0–1. */
  score: number;
  weight: number;
  basis: string;
}

export interface Influence {
  connectorId: string;
  connectorName: string;
  /** 0–1, weighted. Shown with its components, never alone. */
  score: number;
  components: Component[];
  /** The bounded ask to make of this connector, composed from what they can vouch for. */
  theAsk: string;
  /** What they are, to us, derived rather than declared. */
  standingWithUs: string;
  domains: Standing[];
}

export async function listStandings(): Promise<Standing[]> {
  const db = await getDb();
  const rows = await db.query<{
    entity_id: string; domain: StandingDomain; strength: number; basis: string;
    source: string | null; as_of: Date | string; certainty: string;
  }>(
    `select entity_id, domain::text as domain, strength, basis, source, as_of, certainty
       from network.standing`,
  );
  return rows.map((r) => ({
    entityId: r.entity_id, domain: r.domain, strength: r.strength, basis: r.basis,
    source: r.source, asOf: new Date(r.as_of), certainty: r.certainty,
  }));
}

const TIE_SCORE: Record<string, number> = {
  // The inverted U, as numbers. Moderate wins.
  moderate: 1, weak: 0.78, strong: 0.62,
};

const TIER_SCORE: Record<EvidenceTier, number> = { A: 1, B: 0.8, C: 0.45, D: 0.25 };

/**
 * Score every connector on a set of routes, against one target.
 *
 * Read once, scored many times — the caller passes the whole route set so the expensive
 * reads happen once rather than per hop.
 */
export async function influenceFor(
  connectorIds: string[], targetId: string, vehicleKind: string,
): Promise<Map<string, Influence>> {
  /**
   * A person and the institution they sign for are separate records, and a link recorded
   * on the foundation is evidence about its sole trustee. So the search for "what does
   * this target think of them" widens to the records the target is affiliated with, and
   * says which one it read.
   */
  const [standings, exposures, asks, ownFit, sits, staff] = await Promise.all([
    listStandings(), listExposures(null), listAsks(null), assessmentsForEntity(targetId),
    orgsFor(targetId), peopleAt(targetId),
  ]);
  const neighbours = [
    ...sits.filter((x) => x.current).map((x) => ({ id: x.orgId, name: x.orgName })),
    ...staff.filter((x) => x.current).map((x) => ({ id: x.personId, name: x.personName })),
  ];
  const neighbourFit = (
    await Promise.all(neighbours.map((n) => assessmentsForEntity(n.id)))
  ).flat();
  const nameOfRecord = new Map(neighbours.map((n) => [n.id, n.name]));
  const targetFit = ownFit;

  const db = await getDb();
  const names = new Map(
    (await db.query<{ entity_id: string; display_name: string }>(
      'select entity_id, display_name from identity.entity where entity_id = any($1::uuid[])',
      [connectorIds],
    )).map((r) => [r.entity_id, r.display_name]),
  );

  const wanted = VEHICLE_DOMAINS[vehicleKind] ?? ['allocators'];
  const cap = config.guard.asksPerConnectorPerQuarter;
  const w = config.routeInfluence;

  /** Every fit link on this target, so "what the target thinks of them" is real. */
  const targetLinks = targetFit.flatMap((a) => a.links.map((l) => ({ l, via: null as string | null })));
  const neighbourLinks = neighbourFit.flatMap(
    (a) => a.links.map((l) => ({ l, via: nameOfRecord.get(a.entityId) ?? a.entityName })),
  );
  const allLinks = [...targetLinks, ...neighbourLinks];
  const biggestHard = Math.max(
    1,
    ...exposures.filter((x) => x.track === 'hard').map((x) => x.amount),
  );

  const out = new Map<string, Influence>();

  for (const id of connectorIds) {
    const name = names.get(id) ?? 'Unknown';

    // ---- withUs: what they are to us, derived from money and delivered asks ----------
    const theirHard = exposures
      .filter((x) => x.entityId === id && x.track === 'hard')
      .reduce((s, x) => s + x.amount, 0);
    const theirSoft = exposures
      .filter((x) => x.entityId === id && x.track === 'soft')
      .reduce((s, x) => s + x.amount, 0);
    const carried = asks.filter((a) => a.connectorId === id);
    const delivered = carried.filter((a) => a.outcome === 'opted_in').length;

    let withUs = 0.15;
    let withUsBasis = 'No money on file and no ask has gone through them. An acquaintance introducing a stranger.';
    let standingWithUs = 'Acquaintance';
    if (theirHard > 0) {
      // A larger cheque is a louder statement, but the curve flattens — being an LP at all
      // is most of the signal.
      withUs = 0.7 + 0.3 * Math.min(1, theirHard / biggestHard);
      withUsBasis =
        `An LP with $${(theirHard / 1e6).toFixed(1)}M hard on file. They are vouching with `
        + 'money already committed, which is the strongest form of introduction there is.';
      standingWithUs = `LP · $${(theirHard / 1e6).toFixed(1)}M hard`;
    } else if (theirSoft > 0) {
      withUs = 0.45;
      withUsBasis =
        `$${(theirSoft / 1e6).toFixed(1)}M soft and nothing hardened. Interested, not committed — `
        + 'an introduction from them carries interest rather than endorsement.';
      standingWithUs = `Soft · $${(theirSoft / 1e6).toFixed(1)}M`;
    } else if (delivered > 0) {
      withUs = 0.55;
      withUsBasis =
        `${delivered} of ${carried.length} asks they carried came back opted in. A track record `
        + 'of introductions that actually landed.';
      standingWithUs = `Connector · ${delivered}/${carried.length} delivered`;
    } else if (carried.length > 0) {
      withUs = 0.35;
      withUsBasis = `${carried.length} ask${carried.length === 1 ? '' : 's'} carried, none landed yet.`;
      standingWithUs = `Connector · ${carried.length} carried`;
    }

    // ---- withTarget: standing with this specific target -------------------------------
    const found = allLinks.find((x) => x.l.viaEntityId === id);
    const link = found?.l ?? null;
    let withTarget = 0.2;
    let withTargetBasis =
      'Nothing on file about what this target thinks of them. The graph says they are connected; '
      + 'nobody has established that the opinion carries.';
    if (link) {
      const byWeight: Record<string, number> = {
        strong: 0.95, good: 0.72, neutral: 0.45, weak: 0.25, blocker: 0,
      };
      withTarget = byWeight[link.opinionWeight] ?? 0.4;
      // A link read off an affiliated record is real evidence and slightly weaker evidence.
      if (found?.via) withTarget *= 0.9;
      withTargetBasis = found?.via
        ? `${link.statement} (recorded against ${found.via}, whom they act for.)`
        : link.statement;
    }

    // ---- topic: does their credibility cover what this vehicle is about? --------------
    const theirs = standings.filter((s) => s.entityId === id);
    const match = theirs.filter((s) => wanted.includes(s.domain));
    let topic = 0.25;
    let topicBasis =
      'No standing recorded in any domain this vehicle needs. Credibility does not transfer, '
      + 'so a strong name in the wrong field is a weak route.';
    if (match.length > 0) {
      const best = match.reduce((a, b) => (b.strength > a.strength ? b : a));
      topic = best.strength / 5;
      topicBasis = `${DOMAIN_LABEL[best.domain]} ${best.strength}/5 — ${best.basis}`;
    } else if (theirs.length > 0) {
      const other = theirs.reduce((a, b) => (b.strength > a.strength ? b : a));
      topic = 0.2;
      topicBasis =
        `Standing is in ${DOMAIN_LABEL[other.domain].toLowerCase()}, not in what this vehicle `
        + 'needs. Report 6: credibility is topic-specific and does not carry across.';
    }

    // ---- tie: the inverted U ----------------------------------------------------------
    const band = link?.tieBand ?? null;
    let tie = 0.6;
    let tieBasis =
      'No tie band recorded, so this is the middle of the curve rather than a reading.';
    if (band && TIE_SCORE[band] !== undefined) {
      tie = TIE_SCORE[band]!;
      tieBasis = band === 'moderate'
        ? 'A moderately weak tie — the band that moves most. A close tie mostly knows the people we already know.'
        : band === 'strong'
          ? 'A close tie. Warmer, and reaching mostly into a network that overlaps ours.'
          : 'A weak tie. Reaches further than a close one and carries less weight when it lands.';
    }

    // ---- willing: goodwill left, and whether they deliver ------------------------------
    const used = asks.filter((a) => a.connectorId === id && a.madeAt
      && a.madeAt.getTime() > Date.now() - 92 * 86_400_000).length;
    const left = Math.max(0, cap - used);
    let willing = left / cap;
    let willingBasis = `${left} of ${cap} asks left this quarter.`;
    if (left === 0) {
      willingBasis = `At the cap: ${used} of ${cap} asks this quarter. Goodwill is the resource you cannot buy back.`;
    } else if (delivered > 0) {
      willing = Math.min(1, willing + 0.15);
      willingBasis += ` ${delivered} previous introduction${delivered === 1 ? '' : 's'} landed.`;
    }

    const components: Component[] = [
      { key: 'withUs', label: 'Standing with us', score: withUs, weight: w.withUs, basis: withUsBasis },
      { key: 'withTarget', label: 'Standing with them', score: withTarget, weight: w.withTarget, basis: withTargetBasis },
      { key: 'topic', label: 'Credible on this topic', score: topic, weight: w.topic, basis: topicBasis },
      { key: 'tie', label: 'Tie strength', score: tie, weight: w.tie, basis: tieBasis },
      { key: 'willing', label: 'Goodwill left', score: willing, weight: w.willing, basis: willingBasis },
    ];
    const score = components.reduce((s, c) => s + c.score * c.weight, 0);

    // ---- the ask ------------------------------------------------------------------------
    const bestDomain = match.length > 0
      ? match.reduce((a, b) => (b.strength > a.strength ? b : a))
      : null;
    const theAsk = theirHard > 0
      ? `Ask ${name} to say, in their own words, why they committed — and whether they would `
        + 'forward a note. A bounded ask an LP can answer in two sentences beats "can you introduce me".'
      : bestDomain
        ? `Ask ${name} for a forward on ${DOMAIN_LABEL[bestDomain.domain].toLowerCase()} specifically, `
          + 'and give them the one paragraph you want them to send. The ask should be small enough '
          + 'that saying yes costs them nothing.'
        : `Ask ${name} whether they know the target well enough to introduce, before asking them to. `
          + 'The first question is cheap and the second spends goodwill.';

    out.set(id, {
      connectorId: id, connectorName: name, score, components,
      theAsk, standingWithUs, domains: theirs,
    });
  }

  return out;
}

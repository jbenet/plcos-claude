import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import {
  CERTAINTY_WEIGHT, GRADE_SCORE,
  type Assessment, type Blocker, type Certainty, type DecisionArch, type Diagnosis,
  type Dimension, type Engagement, type Familiarity, type FirmClass, type FirmProfile,
  type Gate, type Grade, type Link, type LinkKind, type Perception, type Sentiment,
  type ValueItem,
} from './types';

const d = (v: Date | string) => new Date(v);

type ProfileRow = {
  entity_id: string; entity_name: string; firm_class: FirmClass;
  iapd_registered: boolean | null; est_aum: string | null; aum_basis: string | null;
  aum_certainty: Certainty; decision_arch: DecisionArch; weeks_min: number; weeks_max: number;
  who_signs: string | null; who_can_kill: string | null;
  check_band_min: string | null; check_band_max: string | null;
  prior_relationship: boolean; provenance_note: string | null;
  provenance_since: Date | string | null;
};

const toProfile = (r: ProfileRow): FirmProfile => ({
  entityId: r.entity_id, entityName: r.entity_name, firmClass: r.firm_class,
  iapdRegistered: r.iapd_registered,
  estAum: r.est_aum === null ? null : Number(r.est_aum),
  aumBasis: r.aum_basis, aumCertainty: r.aum_certainty,
  decisionArch: r.decision_arch, weeksMin: r.weeks_min, weeksMax: r.weeks_max,
  whoSigns: r.who_signs, whoCanKill: r.who_can_kill,
  checkBandMin: r.check_band_min === null ? null : Number(r.check_band_min),
  checkBandMax: r.check_band_max === null ? null : Number(r.check_band_max),
  priorRelationship: r.prior_relationship, provenanceNote: r.provenance_note,
  provenanceSince: r.provenance_since ? d(r.provenance_since) : null,
});

const PROFILE_SELECT = `
  select p.*, e.display_name as entity_name
    from fit.firm_profile p join identity.entity e on e.entity_id = p.entity_id`;

export async function listFirmProfiles(): Promise<FirmProfile[]> {
  const db = await getDb();
  return (await db.query<ProfileRow>(`${PROFILE_SELECT} order by e.display_name`)).map(toProfile);
}

export async function firmProfile(entityId: string): Promise<FirmProfile | null> {
  const db = await getDb();
  const row = await db.one<ProfileRow>(`${PROFILE_SELECT} where p.entity_id = $1`, [entityId]);
  return row ? toProfile(row) : null;
}

/**
 * Weighted fit.
 *
 * Certainty appears in both numerator and denominator on purpose: a dimension we only
 * guessed at contributes less, so the result leans on what we actually know rather than
 * on what we assumed. The band cut-offs are the same ones the selection rubric uses —
 * one set of thresholds for the whole system, already labelled as guesses.
 */
function score(dimensions: Dimension[]): { weighted: number; cover: number } {
  if (dimensions.length === 0) return { weighted: 0, cover: 0 };
  let num = 0;
  let den = 0;
  let rawDen = 0;
  for (const dim of dimensions) {
    const w = dim.weightUs * CERTAINTY_WEIGHT[dim.certainty];
    num += GRADE_SCORE[dim.grade] * w;
    den += w;
    rawDen += dim.weightUs;
  }
  return { weighted: den === 0 ? 0 : num / den, cover: rawDen === 0 ? 0 : den / rawDen };
}

const FAMILIARITY_RANK: Record<Familiarity, number> = {
  unaware: 0, heard_of: 1, familiar: 2, deep: 3,
};
const SENTIMENT_RANK: Record<Sentiment, number> = {
  negative: 0, skeptical: 1, unknown: 2, neutral: 2, positive: 3, champion: 4,
};

/**
 * What is actually in the way.
 *
 * This is a precedence, not a score. A prospect excluded by a gate, one who knows us and
 * disagrees, one who cannot be reached, and one who would say yes in March all look the
 * same in a pipeline and need completely different work — so the first condition that
 * applies wins, and the page says which one.
 */
function diagnose(args: {
  failed: Gate[];
  unknown: Gate[];
  dimensions: Dimension[];
  perceptions: Perception[];
  links: Link[];
  profile: FirmProfile | null;
  weighted: number;
}): Diagnosis {
  const { failed, dimensions, perceptions, links, profile, weighted } = args;

  if (failed.length > 0) {
    const g = failed[0]!;
    return {
      blocker: 'gated',
      statement: `${g.label} does not pass: ${g.detail}`,
      nextMove:
        'Nothing else on this page matters until that changes. Either the gate is wrong and the ' +
        'record needs correcting, or this firm is out and should stop consuming attention.',
    };
  }

  const known = perceptions.filter((p) => FAMILIARITY_RANK[p.familiarity] >= 2);
  const hostile = known.filter((p) => SENTIMENT_RANK[p.sentiment] <= 1);
  if (hostile.length > 0) {
    const p = hostile[0]!;
    return {
      blocker: 'conviction',
      statement:
        `They know us and are not convinced — specifically on “${p.subject}”. ${p.evidence}`,
      nextMove:
        'A warmer introduction will not fix this. Find the objection, answer it with evidence, ' +
        'and put the answer in the library so it is not re-derived next time.',
    };
  }

  const usable = links.filter((l) => l.opinionWeight === 'strong' || l.opinionWeight === 'good');
  if (usable.length === 0 && !profile?.priorRelationship) {
    return {
      blocker: 'access',
      statement:
        'No route in and no pre-existing relationship on file. On a 506(c) vehicle that is not a ' +
        'legal bar, but it is the practical one — and on a 506(b) vehicle it would be a hard stop.',
      nextMove:
        'Find a connector with credibility on this specific topic before anything else. Firm-level ' +
        'content is the one thing that works without a route.',
    };
  }

  /**
   * Gates we have not answered. `accredited` is deliberately not in this set: it is a
   * closing-mechanics question that is normal to leave open until subscription, and
   * treating it as a qualification blocker would flag almost every live prospect.
   */
  const QUALIFYING = new Set(['mandate', 'check_band', 'duration', 'conflict']);
  const blocking = args.unknown.filter((g) => QUALIFYING.has(g.code));
  if (blocking.length > 0) {
    const g = blocking[0]!;
    return {
      blocker: 'evidence',
      statement: `We cannot qualify them yet. The “${g.label}” gate is unanswered: ${g.detail}`,
      nextMove:
        'Answer that question before spending more on this name. An unresolved gate is not a ' +
        'soft no — it is a fact nobody has gone and got.',
    };
  }

  if (weighted < config.scoringBands.worthALook && dimensions.length > 0) {
    const worst = [...dimensions].sort(
      (a, b) => GRADE_SCORE[a.grade] * a.weightUs - GRADE_SCORE[b.grade] * b.weightUs,
    )[0]!;
    return {
      blocker: 'fit',
      statement: `The fit itself is weak. The heaviest miss is ${worst.label.toLowerCase()}: ${worst.finding}`,
      nextMove:
        'Work a better-fitting name instead. Persuasion does not move a mandate, and time spent ' +
        'here is time not spent on a firm that could actually say yes.',
    };
  }

  const timing = dimensions.find(
    (x) => (x.code === 'deployment_tempo' || x.code === 'decision_speed') && (x.grade === 'weak' || x.grade === 'blocker'),
  );
  if (timing) {
    return {
      blocker: 'timing',
      statement: `Right firm, wrong window. ${timing.finding}`,
      nextMove:
        profile && profile.weeksMin > 12
          ? `Their process runs ${profile.weeksMin}–${profile.weeksMax} weeks. Move them to the next-cycle pipeline and keep the relationship warm rather than forcing this close.`
          : 'Keep the relationship warm and diarise a return rather than spending an ask now.',
    };
  }

  // Familiarity with *us* — the firm and the vehicle. A prospect who holds the thesis
  // independently (Report 5 §3: the strongest starting position there is) still has never
  // heard of us, and scoring their thesis familiarity as ours would hide exactly that.
  const aboutUs = perceptions.filter(
    (p) => p.subjectKind === 'firm' || p.subjectKind === 'vehicle',
  );
  const best = aboutUs.reduce((max, p) => Math.max(max, FAMILIARITY_RANK[p.familiarity]), -1);
  if (best < 2) {
    return {
      blocker: 'awareness',
      statement:
        best < 0
          ? 'Nothing is recorded about what they think of us, which is not the same as them thinking nothing.'
          : 'They have heard of us at most. This is an awareness gap, not a conviction gap.',
      nextMove:
        'Prime before asking: send the thesis material through the connector ahead of the ' +
        'introduction, so the first real conversation starts from a shared premise.',
    };
  }

  return {
    blocker: 'none',
    statement:
      'Gates clear, fit holds, they know us, and there is a route. Nothing structural is in the way.',
    nextMove: 'Make the ask. The constraint here is calendar, not qualification.',
  };
}

async function assemble(rows: Array<{
  assessment_id: string; entity_id: string; entity_name: string; vehicle_id: string;
  vehicle_name: string; vehicle_slug: string; exemption: string; owner_name: string | null;
  headline: string;
  updated_at: Date | string;
}>): Promise<Assessment[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const ids = rows.map((r) => r.assessment_id);

  const [gates, dims, values, perceptions, engagement, links, profiles] = await Promise.all([
    db.query<Gate & { assessment_id: string; as_of: Date | string }>(
      'select assessment_id, code, label, passed, detail, certainty, source, as_of from fit.gate where assessment_id = any($1::uuid[]) order by code',
      [ids],
    ),
    db.query<Dimension & { assessment_id: string; as_of: Date | string; weight_us: number; weight_them: number }>(
      'select assessment_id, code, label, question, grade, certainty, finding, source, as_of, weight_us, weight_them from fit.dimension where assessment_id = any($1::uuid[])',
      [ids],
    ),
    db.query<{ assessment_id: string; value_id: string; they_value: string; our_match: string; match_grade: Grade; clear_to_them: boolean; next_action: string; certainty: Certainty; source: string | null; as_of: Date | string }>(
      'select * from fit.value_item where assessment_id = any($1::uuid[])',
      [ids],
    ),
    db.query<{ assessment_id: string; perception_id: string; subject: string; subject_kind: string; familiarity: Familiarity; sentiment: Sentiment; evidence: string; certainty: Certainty; source: string | null; as_of: Date | string }>(
      'select * from fit.perception where assessment_id = any($1::uuid[])',
      [ids],
    ),
    db.query<{ assessment_id: string; engagement_id: string; channel: string; behaviour: string; detail: string; observed_on: Date | string; certainty: Certainty }>(
      'select * from fit.engagement where assessment_id = any($1::uuid[]) order by observed_on desc',
      [ids],
    ),
    db.query<{ assessment_id: string; link_id: string; via_entity: string | null; via_name: string | null; kind: LinkKind; statement: string; tie_band: string; opinion_weight: Grade; certainty: Certainty; source: string | null; as_of: Date | string }>(
      `select l.*, e.display_name as via_name from fit.link l
         left join identity.entity e on e.entity_id = l.via_entity
        where l.assessment_id = any($1::uuid[])`,
      [ids],
    ),
    db.query<ProfileRow>(
      `${PROFILE_SELECT} where p.entity_id = any($1::uuid[])`,
      [rows.map((r) => r.entity_id)],
    ),
  ]);

  return rows.map((r) => {
    const myGates: Gate[] = gates
      .filter((g) => g.assessment_id === r.assessment_id)
      .map((g) => ({ ...g, asOf: d(g.as_of) }));
    const myDims: Dimension[] = dims
      .filter((x) => x.assessment_id === r.assessment_id)
      .map((x) => ({ ...x, asOf: d(x.as_of), weightUs: x.weight_us, weightThem: x.weight_them }));
    const myLinks: Link[] = links
      .filter((l) => l.assessment_id === r.assessment_id)
      .map((l) => ({
        linkId: l.link_id, viaEntityId: l.via_entity, viaName: l.via_name, kind: l.kind,
        statement: l.statement, tieBand: l.tie_band, opinionWeight: l.opinion_weight,
        certainty: l.certainty, source: l.source, asOf: d(l.as_of),
      }));
    const myPerceptions: Perception[] = perceptions
      .filter((p) => p.assessment_id === r.assessment_id)
      .map((p) => ({
        perceptionId: p.perception_id, subject: p.subject, subjectKind: p.subject_kind,
        familiarity: p.familiarity, sentiment: p.sentiment, evidence: p.evidence,
        certainty: p.certainty, source: p.source, asOf: d(p.as_of),
      }));

    const profileRow = profiles.find((p) => p.entity_id === r.entity_id) ?? null;
    const profile = profileRow ? toProfile(profileRow) : null;

    const failed = myGates.filter((g) => g.passed === false);
    const unknown = myGates.filter((g) => g.passed === null);
    const { weighted, cover } = score(myDims);
    const gateStatus = failed.length > 0 ? 'failed' : unknown.length > 0 ? 'unknown' : 'clear';
    const band =
      gateStatus === 'failed' ? 'blocked'
      : weighted >= config.scoringBands.strong ? 'strong'
      : weighted >= config.scoringBands.worthALook ? 'workable'
      : 'weak';

    return {
      assessmentId: r.assessment_id, entityId: r.entity_id, entityName: r.entity_name,
      vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, vehicleSlug: r.vehicle_slug,
      exemption: r.exemption,
      ownerName: r.owner_name, headline: r.headline, updatedAt: d(r.updated_at),
      profile, gates: myGates, dimensions: myDims,
      values: values
        .filter((v) => v.assessment_id === r.assessment_id)
        .map((v): ValueItem => ({
          valueId: v.value_id, theyValue: v.they_value, ourMatch: v.our_match,
          matchGrade: v.match_grade, clearToThem: v.clear_to_them, nextAction: v.next_action,
          certainty: v.certainty, source: v.source, asOf: d(v.as_of),
        })),
      perceptions: myPerceptions,
      engagement: engagement
        .filter((e) => e.assessment_id === r.assessment_id)
        .map((e): Engagement => ({
          engagementId: e.engagement_id, channel: e.channel, behaviour: e.behaviour,
          detail: e.detail, observedOn: d(e.observed_on), certainty: e.certainty,
        })),
      links: myLinks,
      gateStatus, failedGates: failed, unknownGates: unknown,
      band,
      strongCount: myDims.filter((x) => x.grade === 'strong' || x.grade === 'good').length,
      gradedCount: myDims.length,
      weightedFit: weighted,
      evidenceCover: cover,
      diagnosis: diagnose({
        failed, unknown, dimensions: myDims, perceptions: myPerceptions,
        links: myLinks, profile, weighted,
      }),
    };
  });
}

const ASSESSMENT_SELECT = `
  select a.assessment_id, a.entity_id, e.display_name as entity_name, a.vehicle_id,
         v.name as vehicle_name, v.slug as vehicle_slug, v.exemption,
         u.name as owner_name, a.headline, a.updated_at
    from fit.assessment a
    join identity.entity e on e.entity_id = a.entity_id
    join platform.vehicle v on v.id = a.vehicle_id
    left join platform.app_user u on u.id = a.owner_id`;

export async function listAssessments(vehicleId?: string | null): Promise<Assessment[]> {
  const db = await getDb();
  const rows = vehicleId
    ? await db.query<Parameters<typeof assemble>[0][number]>(
        `${ASSESSMENT_SELECT} where a.vehicle_id = $1 order by e.display_name`, [vehicleId])
    : await db.query<Parameters<typeof assemble>[0][number]>(
        `${ASSESSMENT_SELECT} order by v.sort_order, e.display_name`);
  const out = await assemble(rows);
  // Best first, but a blocked assessment sorts last however good its dimensions look.
  const rank = { strong: 0, workable: 1, weak: 2, blocked: 3 } as const;
  return out.sort((a, b) => rank[a.band] - rank[b.band] || b.weightedFit - a.weightedFit);
}

export async function assessmentFor(entityId: string, vehicleId: string): Promise<Assessment | null> {
  const db = await getDb();
  const rows = await db.query<Parameters<typeof assemble>[0][number]>(
    `${ASSESSMENT_SELECT} where a.entity_id = $1 and a.vehicle_id = $2`, [entityId, vehicleId],
  );
  return (await assemble(rows))[0] ?? null;
}

export async function assessmentsForEntity(entityId: string): Promise<Assessment[]> {
  const db = await getDb();
  const rows = await db.query<Parameters<typeof assemble>[0][number]>(
    `${ASSESSMENT_SELECT} where a.entity_id = $1 order by v.sort_order`, [entityId],
  );
  return assemble(rows);
}

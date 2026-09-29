import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Check, Db } from './properties/harness';
import { config } from '../config/deployment';
import { computeStructuralRoutes, planRoutesLive } from '../modules/network/service';
import { overlayRoutes } from '../modules/network/route-overlay';
import { entityForUser } from '../modules/network/repo';
import { edgeWarmth } from '../modules/network/warmth';

/** Invented graph: four prefixes compete for three visible slots at one carrier. */
export async function cacheOverlayProperties(check: Check, db: Db) {
  const source = (await entityForUser('juan'))!.entityId;
  const user = (await db.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!.id;
  const vehicle = (await db.one<{ id: string }>("select id from platform.vehicle where slug = 'rails'"))!.id;
  const ids: string[] = [];
  const prefixes = config.routeScoring.routesPerIntroducer + 1;
  for (let i = 0; i < prefixes + 4; i++) ids.push((await db.one<{ id: string }>(
    `insert into identity.entity (entity_type, display_name) values ('person', $1) returning entity_id::text as id`,
    [`CACHE2 invented person ${i}`]))!.id);
  const [target, carrier] = ids;
  const at = new Date('2026-09-26T12:00:00Z');
  const edge = async (from: string, to: string) => db.query(
    `insert into network.edge (from_entity, to_entity, kind, tier, evidence, valid_from)
     values ($1, $2, 'colleague', 'B', $3::jsonb, '2026-01-01')`,
    [from, to, JSON.stringify([{ note: `CACHE2 invented full evidence retained on the edge ${from} -> ${to}`,
      tie: { kind: 'worked_together', lastInteraction: '2026-09-01' } }])]);
  try {
    await edge(carrier!, target!);
    for (const prefix of ids.slice(2, 2 + prefixes)) { await edge(source, prefix); await edge(prefix, carrier!); }
    const base = (await computeStructuralRoutes('juan', target!, 3, 'fund', 'team', at))!;
    const same = async (date = at) => {
      const actual = await overlayRoutes(base, 'fund', date);
      const live = (await planRoutesLive('juan', target!, 3, 'fund', 'team', date))!;
      return { actual, live, ok: isDeepStrictEqual(actual.routes, live.routes.filter((r) => r.foldedUnder == null))
        && isDeepStrictEqual(actual.stats, live.stats) && isDeepStrictEqual(actual.coverage, live.coverage)
        && isDeepStrictEqual(actual.promotedBasisHashes, live.promotedBasisHashes)
        && isDeepStrictEqual(actual.candidateCounts, live.candidateCounts) };
    };
    const first = await same();
    check('CACHE2 structural snapshots retain compact alternatives and only visible full evidence',
      first.ok && base.routes.length === config.routeScoring.routesPerIntroducer
        && base.structural?.candidates.length === prefixes
        && base.structural.edges.every((e) => e.evidence.every((v) => v.note === '' && v.doc === undefined && v.source === undefined)),
      'Four invented prefixes retain graph/scoring descriptors, while only the visible prefixes carry narrative evidence.');

    const unchangedBase = JSON.stringify(base);
    const repeated = await same(new Date(at.getTime() + 1));
    repeated.actual.routes[0]!.reasons.push('Caller-local explanation');
    repeated.actual.routes[0]!.connectorIds.push('caller-local-connector');
    repeated.actual.stats!.counts.strong = 99999;
    const repeatedAgain = await same(new Date(at.getTime() + 2));
    check('CACHE2 repeated overlay reads reuse selection without sharing mutable output or stale evaluation dates',
      repeated.ok && repeatedAgain.ok && JSON.stringify(base) === unchangedBase
        && repeatedAgain.actual.routes.every((r) => r.score?.evaluatedAt === new Date(at.getTime() + 2).toISOString()),
      'An unchanged live snapshot may reuse its selected paths, but returned reasons, connector IDs, counts and score timestamps remain request-local.');

    const excludedPrefix = base.routes[0]!.connectorIds[0]!;
    const hiddenPrefix = ids.slice(2, 2 + prefixes).find((id) => !base.routes.some((r) => r.connectorIds.includes(id)))!;
    const snapshot = JSON.stringify(base);
    const excluded = await overlayRoutes(base, 'fund', at, { exclude: excludedPrefix });
    const preferred = await overlayRoutes(base, 'fund', at, {
      preferred: (route) => route.hops.some((hop) => hop.edge.fromEntity === hiddenPrefix && hop.edge.toEntity === carrier),
    });
    const tooCool = await overlayRoutes(base, 'fund', at, {
      minimumWarmth: edgeWarmth(first.actual.routes[0]!.hops.at(-1)!.edge, at).score + 1,
    });
    const hiddenNote = `CACHE2 invented full evidence retained on the edge ${hiddenPrefix} -> ${carrier}`;
    const hiddenHash = createHash('sha256').update(hiddenNote).digest('hex');
    check('CACHE2 hidden usable evidence remains promoted despite folding and presentation filters',
      !base.routes.some((r) => r.hops.some((h) => h.edge.evidence.some((e) => e.note === hiddenNote)))
        && [first.actual, excluded, preferred, tooCool].every((r) => r.promotedBasisHashes?.includes(hiddenHash)),
      'A fourth hidden path retains only a SHA-256 evidence identity and does not become a disconnected research candidate.');
    check('CACHE2 presentation filters promote retained prefixes before compact selection',
      excluded.routes.length === config.routeScoring.routesPerIntroducer
        && excluded.routes.every((r) => !r.connectorIds.includes(excludedPrefix))
        && excluded.routes.some((r) => r.connectorIds.includes(hiddenPrefix))
        && preferred.routes[0]?.connectorIds.includes(hiddenPrefix) === true
        && preferred.routes.length === config.routeScoring.routesPerIntroducer && tooCool.routes.length === 0
        && [excluded, preferred, tooCool].every((r) => isDeepStrictEqual(r.stats, first.live.stats))
        && JSON.stringify(base) === snapshot,
      'Excluding one prefix or preferring an evidenced hop reveals the fourth; warmth filtering preserves unfiltered summary counts and the shared snapshot.');

    await db.query(`insert into coordination.restriction (entity_id, connector_id, scope, instruction, source)
      values ($1, $2, 'connector', 'Invented prefix restriction', null)`, [target, excludedPrefix]);
    const guarded = await same();
    const visibleBefore = new Set(base.routes.map((r) => r.connectorIds[0]));
    const promoted = guarded.actual.routes.find((r) => r.verdict === 'recommend' && !visibleBefore.has(r.connectorIds[0]));
    check('CACHE2 a new restriction promotes a retained alternative and hydrates its authoritative evidence',
      guarded.ok && Boolean(promoted) && promoted!.hops.every((h) => h.edge.evidence.some((e) => e.note.includes('CACHE2 invented'))),
      'A changed action guard needs no path search; the previously hidden prefix receives its full stored edge evidence.');

    await db.query(`insert into pipeline.exposure (entity_id, vehicle_id, instrument, track, amount, owner_id, evidence_ref)
      values ($1, $2, 'lp_commitment', 'hard', 1000000, $3, 'fixture:accepted-commitment')`, [carrier, vehicle, user]);
    const funded = await same();
    check('CACHE2 current hard exposure updates route score, explanation and influence without rebuilding paths',
      funded.ok && funded.actual.routes.every((r) => r.score!.factors.some((f) => f.evidenceRefs?.includes('fixture:accepted-commitment')))
        && funded.actual.routes.some((r) => r.score!.value > first.actual.routes[0]!.score!.value),
      'Money affects introducer standing and its confidence adjustment, while the structural snapshot remains unchanged.');

    await db.query(`insert into coordination.ask (entity_id, connector_id, vehicle_id, status, owner_id, purpose, made_at, channel)
      select $1, $2, $3, 'made', $4, 'Invented pressure', now(), 'email' from generate_series(1, $5::int)`,
    [target, carrier, vehicle, user, config.guard.asksPerConnectorPerQuarter]);
    const held = await same();
    check('CACHE2 live connector pressure holds usable paths and keeps restricted paths excluded',
      held.ok && held.actual.routes.some((r) => r.verdict === 'hold') && held.actual.routes.every((r) => r.verdict !== 'recommend'),
      'Verdicts, folds and distinct usable-chain counts agree with the full live-search oracle after new asks.');

    check('CACHE2 full candidate counts survive compaction, presentation filters and live guards',
      first.actual.candidateCounts?.total === prefixes && first.actual.candidateCounts.unavailable === 0
        && tooCool.routes.length === 0 && isDeepStrictEqual(tooCool.candidateCounts, first.actual.candidateCounts)
        && guarded.actual.candidateCounts?.total === prefixes && guarded.actual.candidateCounts.unavailable === 1
        && held.actual.candidateCounts?.total === prefixes && held.actual.candidateCounts.unavailable === prefixes,
      'Recorded paths count every inspected candidate, and held/unavailable totals refresh from all candidates before visible-route selection.');

    const boundary = new Date('2026-09-01T00:00:00Z');
    boundary.setUTCMonth(boundary.getUTCMonth() + config.routeWarmth.currentMonths);
    const midnight = await same(boundary);
    const justAfter = await same(new Date(boundary.getTime() + 1));
    check('CACHE2 memo freshness preserves exact contact-age boundaries within the same UTC day',
      midnight.ok && justAfter.ok && justAfter.actual.routes[0]!.score!.value < midnight.actual.routes[0]!.score!.value,
      'A contact exactly current at midnight becomes ageing one millisecond later; a daily cache key would miss this change.');

    const aged = await same(new Date('2030-09-26T12:00:00Z'));
    check('CACHE2 date-sensitive scores refresh without requiring another topology build', aged.ok
      && aged.actual.routes.some((r) => r.score!.value < held.actual.routes[0]!.score!.value),
      'Old contact dates reduce scores on read, using the same scoring model as live search.');

    await edge(ids.at(-2)!, ids.at(-1)!);
    const refreshed = await same();
    check('CACHE2 unrelated graph changes refresh corpus disclosure even while target topology stays cached',
      refreshed.ok && refreshed.actual.coverage.edges === base.coverage.edges + 1,
      'Coverage reports the current graph rather than the graph size when this target was precomputed.');
    await db.query(`insert into coordination.restriction (entity_id, scope, instruction)
      values ($1, 'blanket', 'Invented blanket restriction')`, [target]);
    const blocked = await same();
    check('CACHE2 blanket restrictions remove all promoted evidence identities from a memoized result',
      blocked.ok && blocked.actual.promotedBasisHashes?.length === 0 && JSON.stringify(base) === snapshot,
      'Excluded evidence does not suppress disconnected candidates, and changing guards leaves the structural snapshot immutable.');
  } finally {
    await db.query('delete from coordination.ask where entity_id = $1', [target]);
    await db.query('delete from coordination.restriction where entity_id = $1', [target]);
    await db.query('delete from pipeline.exposure where entity_id = $1', [carrier]);
    await db.query('delete from network.edge where from_entity = any($1::uuid[]) or to_entity = any($1::uuid[])', [ids]);
    await db.query('delete from identity.possible_match where left_entity= any($1::uuid[]) or right_entity= any($1::uuid[])', [ids]);
    await db.query("delete from research.note where entity_id= any($1::uuid[]) and kind='identity_creation'", [ids]);
    await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [ids]);
  }
}

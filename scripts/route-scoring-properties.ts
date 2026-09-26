import type { Queryable } from '../lib/db';
import type { Edge, Route } from '../modules/network/types';
import { scoreRoute, type TieDetails } from '../modules/network/warmth';
import type { Check } from './properties/harness';

const at = new Date('2026-09-26T12:00:00Z');
const recent = '2026-09-01';

function edge(from: string, to: string, kind: TieDetails['kind'], tier: Edge['tier'] = 'B', extra: Partial<TieDetails> = {}): Edge {
  return { edgeId: `${from}:${to}:${kind}`, fromEntity: from, toEntity: to,
    fromName: from, toName: to, kind: 'colleague', tier, strength: null, tieBand: null,
    evidence: [{ note: 'Invented SCORE2 evidence', source: 'https://example.org/score2', tie: { kind, lastInteraction: recent, ...extra } }],
    reviewedByName: null, reviewedAt: null, reviewNote: null, validFrom: at, validTo: null };
}

function route(edges: Edge[], verdict: Route['verdict'] = 'recommend'): Route {
  const r: Route = { fromEntity: edges[0]!.fromEntity, fromName: edges[0]!.fromName,
    hops: edges.map((e) => ({ edge: e, toEntity: e.toEntity, toName: e.toName })),
    connectorIds: edges.slice(0, -1).map((e) => e.toEntity), connectorNames: edges.slice(0, -1).map((e) => e.toName),
    verdict, reasons: ['Invented fixture'], weakestTier: edges.map((e) => e.tier).sort().at(-1)!,
    askLoad: null, influence: null };
  r.score = scoreRoute(r, at);
  return r;
}

/** SCORE2: invented relationships, fixed evaluation time, and independently asserted outcomes. */
export async function routeScoringProperties(check: Check, db: Queryable) {
  const { selectTopRoutes, routeGraph, summarizeRoutes, summarizePipelineRoutes, planRoutes } = await import('../modules/network/service');
  const directWeak = route([edge('source', 'target', 'acquaintance', 'A')]);
  const indirectWarm = route([edge('source', 'carrier', 'worked_together'), edge('carrier', 'target', 'cofounder')]);
  const directInvestor = route([edge('source', 'target', 'investor_founder', 'B', { raisedFrom: true, withUs: 'investor' })]);
  check('SCORE2 the final relationship outranks a weak direct route despite its better evidence tier',
    indirectWarm.score!.value > directWeak.score!.value,
    `Invented cofounder route ${indirectWarm.score!.value}; direct acquaintance ${directWeak.score!.value}.`);
  check('SCORE2 direct personal investment and fundraising history produces the warmest route',
    directInvestor.score!.value > indirectWarm.score!.value && directInvestor.score!.band === 'strong'
      && directInvestor.score!.factors.some((f) => f.key === 'history' && f.points > 0),
    `Invented direct investor route ${directInvestor.score!.value}; cofounder introduction ${indirectWarm.score!.value}.`);

  const confidenceVariants = (['A', 'B', 'C', 'D'] as const).map((tier) => route([edge('source', 'target', 'cofounder', tier)]));
  check('SCORE2 weaker evidence discounts equal relationship strength without an information gate',
    confidenceVariants.every((r, i) => r.verdict === 'recommend' && (i === 0
      || confidenceVariants[i - 1]!.score!.value > r.score!.value
        && confidenceVariants[i - 1]!.score!.confidence > r.score!.confidence)),
    confidenceVariants.map((r) => `${r.weakestTier}: ${r.score!.value}`).join(', '));

  const agedEdge = edge('source', 'target', 'cofounder', 'B', { lastInteraction: '2010-01-01' });
  const aged = route([agedEdge]);
  const retrieved = route([{ ...agedEdge, validFrom: at, evidence: agedEdge.evidence.map((e) => ({ ...e, as_of: recent })) }]);
  const unknown = route([edge('source', 'target', 'cofounder', 'B', { lastInteraction: null })]);
  check('SCORE2 only contact dates refresh a relationship; retrieval and graph dates do not',
    confidenceVariants[1]!.score!.value > aged.score!.value && retrieved.score!.value === aged.score!.value
      && unknown.score!.value < confidenceVariants[1]!.score!.value,
    `Recent ${confidenceVariants[1]!.score!.value}; historical ${aged.score!.value}; newly retrieved ${retrieved.score!.value}; unknown ${unknown.score!.value}.`);

  const strongest = route([{ ...indirectWarm.hops[1]!.edge, evidence: [
    { note: 'Invented weaker association', tie: { kind: 'proximity', lastInteraction: recent } },
    ...indirectWarm.hops[1]!.edge.evidence,
  ] }]);
  const strongestOnly = route([indirectWarm.hops[1]!.edge]);
  check('SCORE2 the strongest supported relationship survives weaker parallel evidence',
    strongest.score!.value === strongestOnly.score!.value
      && route([{ ...strongest.hops[0]!.edge, evidence: [...strongest.hops[0]!.edge.evidence].reverse() }]).score!.value === strongest.score!.value,
    'Adding a proximity record cannot dilute a sourced cofounder relationship.');

  const invalidTies = [
    { kind: 'investor_founder', lastInteraction: '2026-02-30', raisedFrom: true },
    { kind: 'investor_founder', raisedFrom: 'yes' },
    { kind: 'investor_founder', withUs: 'guessed-investor' },
  ] as unknown as TieDetails[];
  const invalidScores = invalidTies.map((tie) => route([{ ...directInvestor.hops[0]!.edge,
    evidence: [{ note: 'Invented malformed metadata', source: 'https://example.org/invalid', tie }] }]).score!);
  check('SCORE2 malformed structured investment metadata cannot regain warmth through compatibility parsing',
    invalidScores.every((s) => s.value <= directWeak.score!.value
      && s.factors.find((f) => f.key === 'history')?.points === 0),
    'An impossible date, non-boolean fundraising history, and unknown investor role confer no investment-history bonus.');

  const investorAt = (lastInteraction: string | null) => route([edge('source', 'target', 'investor_founder', 'B', { lastInteraction })]);
  const historicalInvestor = investorAt('2010-01-01'), unknownInvestor = investorAt(null), recentInvestor = investorAt(recent);
  const legacyNote = 'A personal angel/backer of Protocol Labs; Invented Morgan is its documented founder. Direct investor–founder tie; willingness is not recorded.';
  const legacy = (note: string, source: string | undefined, lastInteraction: string | null) => route([{
    ...edge('source', 'target', 'acquaintance'), kind: 'portfolio',
    evidence: [{ note, source, tie: { kind: 'acquaintance', lastInteraction } }],
  }]);
  const legacyOld = legacy(legacyNote, 'https://example.org/investor', '2010-01-01');
  const legacyUnknown = legacy(legacyNote, 'https://example.org/investor', null);
  check('SCORE2 historical investor metadata stays historical through legacy compatibility',
    recentInvestor.score!.value > unknownInvestor.score!.value && unknownInvestor.score!.value > historicalInvestor.score!.value
      && legacyOld.score!.value === historicalInvestor.score!.value && legacyUnknown.score!.value === unknownInvestor.score!.value,
    'Neither structured nor legacy investor evidence resets an old contact date; the willingness disclaimer does not deny investment history.');
  const denied = legacy('Not an angel investor in Protocol Labs; knows them directly.', 'https://example.org/denial', recent);
  const unsourced = legacy(legacyNote, undefined, recent);
  check('SCORE2 denied and unsourced legacy investment claims earn no investment bonus',
    [denied, unsourced].every((r) => r.score!.value < unknownInvestor.score!.value
      && r.score!.factors.find((f) => f.key === 'history')?.points === 0),
    'A negated investment claim or missing source cannot confer personal investor history.');

  const roleBase = scoreRoute(indirectWarm, at), investor = scoreRoute(indirectWarm, at, { investor: true, roleEdgeIds: ['invented-role'] });
  const founder = scoreRoute(indirectWarm, at, { plFounder: true, roleEdgeIds: ['invented-founder'] });
  check('SCORE2 evidenced investor and PL founder introducers add explained standing',
    investor.value > roleBase.value && founder.value > roleBase.value
      && investor.factors.some((f) => f.key === 'introducer' && f.edgeIds.includes('invented-role')),
    'Role factors retain their supporting edge references; direct routes need no introducer.');

  const allScores = [...confidenceVariants.map((r) => r.score!), directInvestor.score!, indirectWarm.score!, directWeak.score!, aged.score!, unknown.score!, investor, founder];
  check('SCORE2 score factors reconcile, stay bounded, and repeat deterministically',
    allScores.every((s) => s.value >= 0 && s.value <= 100
      && Math.abs(s.factors.reduce((n, f) => n + f.points, 0) - s.value) <= 0.00501
      && s.factors.every((f) => Boolean(f.basis)))
      && JSON.stringify(scoreRoute(indirectWarm, at)) === JSON.stringify(scoreRoute(indirectWarm, at)),
    'Signed contributions sum to the rounded relative score, at a fixed evaluation date.');

  const directOthers = Array.from({ length: 4 }, (_, i) => route([edge(`other-source-${i}`, 'target', 'cofounder')]));
  const sameCarrier = Array.from({ length: 4 }, (_, i) => route([
    edge('source', `prefix-${i}`, 'worked_together'), edge(`prefix-${i}`, 'shared-carrier', 'worked_together'),
    edge('shared-carrier', 'target', 'cofounder'),
  ]));
  const alternatives = [directInvestor, indirectWarm, ...directOthers, ...sameCarrier, ...Array.from({ length: 5 }, (_, i) => route([
    edge('source', `carrier-${i}`, 'worked_together'), edge(`carrier-${i}`, 'target', 'repeated_contact'),
  ])), directWeak].sort((a, b) => b.score!.value - a.score!.value);
  const duplicate = { ...alternatives[0]!, hops: alternatives[0]!.hops.map((h) => ({ ...h, edge: { ...h.edge, edgeId: `${h.edge.edgeId}:parallel` } })) };
  const selected = selectTopRoutes([...alternatives, duplicate]);
  const visible = selected.filter((r) => r.foldedUnder == null && r.verdict === 'recommend');
  const personChain = (r: Route) => [r.fromEntity, ...r.hops.map((h) => h.toEntity)].join('>');
  check('SCORE2 three prefixes per introducer stay visible without limiting introducers or direct sources',
    selected.length === alternatives.length + 1 && visible.length === 14
      && new Set(visible.map(personChain)).size === visible.length
      && visible.filter((r) => r.hops.at(-2)?.toEntity === 'shared-carrier').length === 3
      && visible.filter((r) => r.hops.length === 1).length === 5
      && visible[0]!.score!.value === directInvestor.score!.value
      && selected.filter((r) => r.foldedUnder != null).every((r) => Number.isInteger(r.foldedUnder)
        && selected[r.foldedUnder!]?.foldedUnder == null),
    `${visible.length} visible routes; ${selected.length} retained; shared introducer has three visible prefixes.`);
  const graph = routeGraph(selected, 'target');
  check('SCORE2 graph nodes are unique people across repeated route and evidence edges',
    new Set(graph.nodes.map((n) => n.entityId)).size === graph.nodes.length
      && graph.nodes.filter((n) => n.entityId === 'target').length === 1
      && graph.nodes.find((n) => n.entityId === 'source')?.source === true
      && graph.links.every((l) => graph.nodes.some((n) => n.entityId === l.fromEntity)
        && graph.nodes.some((n) => n.entityId === l.toEntity)),
    'All repeated routes share canonical endpoint nodes; links preserve their evidence.');
  const graphRows = [{ ...directInvestor, foldedUnder: null }, { ...duplicate, foldedUnder: 0 },
    { ...indirectWarm, foldedUnder: null }, { ...directWeak, verdict: 'hold' as const, foldedUnder: null }];
  const visibleGraph = routeGraph(graphRows, 'target', true);
  check('SCORE2 visible graph links preserve indices in the complete route result',
    visibleGraph.links.some((l) => l.fromEntity === 'carrier' && l.toEntity === 'target' && l.routeIndices.includes(2))
      && visibleGraph.links.every((l) => l.routeIndices.every((i) => i === 0 || i === 2)),
    'A folded parallel route at index 1 and held route at index 3 are skipped; the next visible route keeps index 2.');

  const held = { ...directInvestor, verdict: 'hold' as const }, excluded = { ...directInvestor, verdict: 'excluded' as const };
  const separateWeak = route([edge('other-source', 'target', 'acquaintance', 'A')]);
  const targetStats = summarizeRoutes([directInvestor, directWeak, separateWeak, held, excluded]);
  const pipeline = summarizePipelineRoutes([
    { targetId: 'target', routes: [directInvestor, directWeak] },
    { targetId: 'target', routes: [directInvestor] },
    { targetId: 'weak-target', routes: [directWeak] },
    { targetId: 'held-target', routes: [held] },
    { targetId: 'restricted-target', routes: [excluded] },
    { targetId: 'empty-target', routes: [] },
  ]);
  check('SCORE2 target statistics count only usable routes and report the best score',
    targetStats.routeCount === 2 && targetStats.counts.strong === 1 && targetStats.counts.weak === 1
      && targetStats.bestScore === directInvestor.score!.value && targetStats.strongTargets === 1,
    'Parallel evidence for the same person chain counts once; held and restricted alternatives do not promise actionable route coverage.');
  check('SCORE2 pipeline coverage deduplicates targets and separates unavailable routes',
    pipeline.targetCount === 5 && pipeline.strongTargets === 1 && pipeline.bestRouteCounts.strong === 1
      && pipeline.bestRouteCounts.weak === 1 && pipeline.bestRouteCounts.unavailable === 3
      && pipeline.bestScore === directInvestor.score!.value && /1 target.*at least one strong route/.test(pipeline.confidenceStatement),
    pipeline.confidenceStatement);

  // Isolated database fixture: two team sources, one intermediate connector and a target.
  const ids = Array.from({ length: 4 }, (_, i) => `fdfdfdfd-5252-4000-8000-${(i + 1).toString().padStart(12, '0')}`);
  const [first, second, carrier, target] = ids as [string, string, string, string];
  const handles = ['score2-morgan', 'score2-robin'];
  try {
    await db.query(`insert into identity.entity (entity_id,entity_type,display_name)
      select id,'person','Invented SCORE2 person' from unnest($1::uuid[]) id`, [ids]);
    for (const [i, handle] of handles.entries()) {
      await db.query(`insert into platform.app_user(handle,name,initials,role,email)
        values ($1,$2,'ST','test',$3)`, [handle, `Invented SCORE2 team ${i}`, `${handle}@example.org`]);
      await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values ('app_user',$1,$2,'score2-fixture')`, [handle, ids[i]]);
    }
    const links = [edge(first, second, 'worked_together'), edge(second, target, 'investor_founder', 'B', { raisedFrom: true }),
      edge(first, carrier, 'worked_together'), edge(carrier, target, 'acquaintance', 'A')];
    for (const link of links) await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
      values ($1,$2,'colleague',$3::network.evidence_tier,$4::jsonb,'2026-09-01')`,
    [link.fromEntity, link.toEntity, link.tier, JSON.stringify(link.evidence)]);
    const current = await planRoutes(handles[0]!, target, 3, 'fund', 'current', at);
    const team = await planRoutes(handles[0]!, target, 3, 'fund', 'team', at);
    const teamIds = new Set([first, second]);
    check('SCORE2 a team hop becomes its own source, including current-user route searches',
      Boolean(current?.routes.some((r) => r.fromEntity === second && r.hops.length === 1))
        && Boolean(team?.routes.some((r) => r.fromEntity === second && r.hops.length === 1))
        && [...(current?.routes ?? []), ...(team?.routes ?? [])].every((r) => r.hops.every((h) => !teamIds.has(h.toEntity)))
        && current?.routes[0]?.fromEntity === second && current.routes[0]?.hops.length === 1,
      'The investor relationship starts at its actual team holder; no team member remains an intermediate node.');
    const teamTarget = await planRoutes(handles[0]!, second, 3, 'fund', 'team', at);
    check('SCORE2 no route goes team to team', (teamTarget?.routes.length ?? 0) === 0,
      'Team members supply routes rather than appearing as fundraising destinations.');
    await db.query(`insert into coordination.restriction(entity_id,scope,connector_id,instruction)
      values ($1,'connector',$2,'Invented restriction on this route holder')`, [target, second]);
    const restricted = await planRoutes(handles[0]!, target, 3, 'fund', 'current', at);
    const restrictedSource = restricted?.routes.filter((r) => r.fromEntity === second) ?? [];
    check('SCORE2 normalization preserves restrictions on the new team source despite its strong score',
      restrictedSource.length > 0 && restrictedSource.every((r) => r.verdict === 'excluded')
        && restricted?.topRoutes?.every((r) => r.fromEntity !== second) === true,
      'Moving the relationship holder from the first hop to the source does not bypass connector restrictions.');
    await db.query(`insert into coordination.restriction(entity_id,scope,instruction)
      values ($1,'blanket','Invented target-wide do-not-contact')`, [target]);
    const blanket = await planRoutes(handles[0]!, target, 3, 'fund', 'team', at);
    check('SCORE2 strong investment history never clears a target-wide restriction',
      Boolean(blanket?.routes.length) && blanket!.routes.every((r) => r.verdict === 'excluded')
        && blanket!.stats?.strongTargets === 0 && blanket!.stats.bestRouteCounts.unavailable === 1,
      'The score remains explainable, while every approach stays excluded from usable coverage.');
  } finally {
    await db.query('delete from coordination.restriction where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from network.edge where from_entity=any($1::uuid[]) or to_entity=any($1::uuid[])', [ids]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from platform.app_user where handle=any($1::text[])', [handles]);
  }
}

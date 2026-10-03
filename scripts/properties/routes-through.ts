/** Routes through X (2 Oct 2026). Invented edges and the demo seed only; no real records. */
import type { Edge, EvidenceTier } from '../../modules/network/types';
import { rankOnward, throughGaps, weakerTier, THIN_TEAM_EDGES } from '../../modules/network/through';
import type { Check, SeedContext } from './harness';

const TIERS: EvidenceTier[] = ['A', 'B', 'C', 'D'];

function edge(kind: Edge['kind'], tier: EvidenceTier, evidence: Edge['evidence'], validFrom = '2026-01-15'): Edge {
  return { edgeId: `${kind}:${tier}:${evidence.length}`, fromEntity: 'x', toEntity: 'y', fromName: 'Invented X', toName: 'Invented Y',
    kind, tier, strength: null, tieBand: null, evidence, reviewedByName: null, reviewedAt: null, reviewNote: null,
    validFrom: new Date(`${validFrom}T00:00:00Z`), validTo: null };
}

export function routesThroughProperties(check: Check) {
  // 1. Two-hop tier is the weaker hop, for every pair, and a node of ours adds no first hop.
  const pairs = TIERS.flatMap((a) => TIERS.map((b) => [a, b] as const));
  check('THROUGH two-hop tier is the weaker of the two hops, for all 16 pairs',
    pairs.every(([a, b]) => weakerTier(a, b) === (a > b ? a : b) && weakerTier(a, b) === weakerTier(b, a))
      && TIERS.every((b) => weakerTier(null, b) === b),
    'A then D reads D, B then A reads B; through one of our own sources the route is the onward tie alone.');

  // 2. Gaps counts on invented edges, one per source.
  const invented = [
    edge('met', 'A', [{ note: 'Invented: 3 meetings', source: 'Affinity calendar and notes, as translated', as_of: '2026-09-01' }]),
    edge('colleague', 'B', [{ note: 'Invented PL colleague', source: 'AGENTS.md rule 6; recorded PL affiliation', tie: { kind: 'worked_together', basis: 'pl_affiliation' } }], '2024-03-02'),
    edge('other', 'C', [
      { note: 'Invented public record', source: 'https://example.org/invented', as_of: '2026-08-01', derived: 'network_nodes' } as Edge['evidence'][number],
      { note: 'Invented W3 path', source: 'the research (W3)', as_of: '2026-07-15', derived: 'research' } as Edge['evidence'][number],
    ]),
    edge('possible_identity', 'D', []),
    edge('portfolio', 'B', [{ note: 'Invented founder', source: 'enrich/portfolio/invented.json', as_of: '2026-06-30', portfolioId: 'p1' } as Edge['evidence'][number]]),
    edge('other', 'C', [{ note: 'Invented warehouse tie', source: 'invented warehouse', as_of: '2026-05-05', warehouseTie: 't1' } as Edge['evidence'][number]]),
  ];
  const g = throughGaps({ nodeName: 'Invented X', edges: invented, total: invented.length, isTeam: false, pursuedLp: false, usableRoutesToNode: 2 });
  const src = Object.fromEntries(g.bySource.map((s) => [s.source, s]));
  check('THROUGH gaps count edges by source, kind and tier, with each source’s evidence dates',
    g.total === 6 && g.inspected === 6
      && src.Affinity?.edges === 1 && src.Affinity.from === '2026-09-01'
      && src['PL network']?.edges === 1 && src['PL network'].from === '2024-03-02'
      && src.Research?.edges === 1 && src['W3 paths']?.edges === 1 && src['W3 paths'].to === '2026-07-15'
      && src['Identity match']?.edges === 1 && src.Portfolio?.edges === 1 && src.Warehouse?.edges === 1
      && g.bySource.length === 7 && !src['Other records']
      && g.byTier.A === 1 && g.byTier.B === 2 && g.byTier.C === 2 && g.byTier.D === 1
      && g.byKind.find((k) => k.kind === 'other')?.edges === 2 && g.byKind.reduce((n, k) => n + k.edges, 0) === 6
      && g.warnings.length === 0,
    'An edge with research and W3 evidence counts once under each; undated evidence takes the edge date; a mixed node raises no warning.');

  // 3. Each warning fires on exactly the case it names.
  const keys = (x: ReturnType<typeof throughGaps>) => x.warnings.map((w) => w.key).sort().join(',');
  const none = throughGaps({ nodeName: 'Invented', edges: [], total: 0, isTeam: false, pursuedLp: true, usableRoutesToNode: 0 });
  const onlyD = throughGaps({ nodeName: 'Invented', edges: [edge('event_coattendee', 'D', [{ note: 'n', source: 'https://example.org/a' }]), edge('social_public', 'D', [{ note: 'n', source: 'Affinity mail' }])], total: 2, isTeam: false, pursuedLp: false, usableRoutesToNode: 1 });
  const oneSource = throughGaps({ nodeName: 'Invented', edges: [edge('met', 'A', [{ note: 'n', source: 'Affinity mail' }]), edge('met', 'B', [{ note: 'n', source: 'Affinity calendar' }])], total: 2, isTeam: true, pursuedLp: false, usableRoutesToNode: null });
  const cut = throughGaps({ nodeName: 'Invented', edges: invented.slice(0, 2), total: 9, isTeam: false, pursuedLp: false, usableRoutesToNode: 1,
    thinTeam: [{ name: 'Invented A', edges: THIN_TEAM_EDGES - 1 }, { name: 'Invented B', edges: THIN_TEAM_EDGES }] });
  check('THROUGH gap warnings: no edges, only D, one source, a thin team member, an LP with no route, a cut',
    keys(none) === 'lp_no_route,no_edges' && keys(onlyD) === 'only_d' && keys(oneSource) === 'one_source,thin_team'
      && keys(cut) === 'thin_team_list,truncated' && /Invented A \(4\)/.test(cut.warnings.find((w) => w.key === 'thin_team_list')!.text)
      && !/Invented B/.test(cut.warnings.find((w) => w.key === 'thin_team_list')!.text),
    'Two Affinity sources are one corpus; a source with exactly the threshold is not thin; a truncated read says how many were inspected.');

  // 4. LPs we pursue rank first, then the combined tier.
  const lp = { entityId: 'l', name: 'Invented LP', vehicleName: 'Invented fund', vehicleSlug: 'f', status: 'selected', via: 'self' as const, role: null };
  const ranked = rankOnward([
    { otherName: 'Ann', lps: [], combinedTier: 'A' as const, warmth: 5, edges: [{ tier: 'A' as const }] },
    { otherName: 'Bea', lps: [lp], combinedTier: 'C' as const, warmth: 1, edges: [{ tier: 'C' as const }] },
    { otherName: 'Cy', lps: [lp], combinedTier: 'B' as const, warmth: 1, edges: [{ tier: 'B' as const }] },
    { otherName: 'Di', lps: [], combinedTier: null, warmth: 5, edges: [{ tier: 'A' as const }] },
  ]);
  check('THROUGH onward ties rank LPs we pursue first, then by the combined route tier',
    ranked.map((t) => t.otherName).join(',') === 'Cy,Bea,Ann,Di',
    'A pursued LP at C outranks a non-LP at A; a tie with no route to X sorts after one with a route.');
}

/** Demo seed: Quaresma asked not to be introduced through Anselm Rautio (S05). */
export async function routesThroughDatabaseProperties({ check, db, id }: SeedContext) {
  const { throughNode } = await import('../../modules/network/through');
  const { planRoutes } = await import('../../modules/network/service');
  const view = async (name: string) => throughNode(id(name), {
    routesToNode: (await planRoutes('juan', id(name), 3, 'fund', 'team'))?.routes ?? [] });

  const rautio = await view('Anselm Rautio');
  check('THROUGH a connector restriction on the target removes that target from the onward ties (rule 8)',
    !rautio.onward.some((t) => t.otherId === id('Solveig Quaresma')) && rautio.restrictedOnward >= 1,
    'Quaresma asked not to be introduced through Rautio: through Rautio she is neither listed nor drawn, and the count says one was held back.');

  const umeadi = await view('Orla Umeadi');
  const quaresma = umeadi.onward.find((t) => t.otherId === id('Solveig Quaresma'));
  check('THROUGH the same target stays available through a connector her restriction does not name',
    Boolean(quaresma && quaresma.lps.length > 0 && umeadi.bestRoute
      && quaresma.combinedTier === weakerTier(umeadi.bestRoute.weakestTier, quaresma.edges[0]!.tier)),
    'Through Umeadi, Quaresma is listed as an LP we pursue, and the route tier is the weaker of our best route to Umeadi and her tie.');

  const actor = (await db.one<{ id: string }>(`select id::text from platform.app_user where handle = 'mara'`))!.id;
  const corcoran = id('Renata Corcoran');
  const restrict = async (entity: string) => (await db.one<{ id: string }>(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by)
    values ($1, 'blanket', 'Invented: do not approach (property test)', $2) returning restriction_id::text id`, [entity, actor]))!.id;
  const inserted: string[] = [];
  try {
    const listedBefore = umeadi.onward.some((t) => t.otherId === corcoran);
    inserted.push(await restrict(corcoran));
    const withoutY = await view('Orla Umeadi');
    inserted.push(await restrict(id('Orla Umeadi')));
    const blocked = await view('Orla Umeadi');
    check('THROUGH a do-not-approach on Y removes Y, and one on X offers nothing through X',
      listedBefore && !withoutY.onward.some((t) => t.otherId === corcoran) && withoutY.restrictedOnward === umeadi.restrictedOnward + 1
        && blocked.nodeRestricted && blocked.onward.length === 0 && blocked.gaps.total === umeadi.gaps.total,
      'Corcoran was listed through Umeadi until her restriction; with one on Umeadi nothing is offered through them, though their edges are still counted.');
  } finally {
    await db.query('delete from coordination.restriction where restriction_id = any($1::uuid[])', [inserted]);
  }

  const gaps = umeadi.gaps;
  const seeded = (await db.one<{ n: number }>(`select count(*)::int n from network.edge e
    where (identity.canonical_entity_id(e.from_entity) = $1 or identity.canonical_entity_id(e.to_entity) = $1)
      and (e.valid_to is null or e.valid_to >= current_date)`, [id('Orla Umeadi')]))!.n;
  check('THROUGH gaps total every current edge on the node, and the tier counts add up to it',
    gaps.total === seeded && gaps.inspected === seeded && TIERS.reduce((n, t) => n + gaps.byTier[t], 0) === seeded,
    `${seeded} seeded edges touch Umeadi; each is counted once by tier and at least once by source.`);
}

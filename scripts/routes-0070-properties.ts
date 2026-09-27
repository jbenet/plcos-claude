/** Invented fixtures only. Standalone bootstrap matches harness freshDb, with an isolated temporary database. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Edge, EvidenceTier, Route } from '../modules/network/types';
import type { TieDetails } from '../modules/network/warmth';
import type { PortfolioInput, PortfolioSource } from '../lib/enrich/portfolio';
import type { NetworkNodeInput } from '../modules/network/nodes';

// Set the profile before importing any module that reads configuration. Never use a caller's database.
process.env.DATA_PROFILE = 'demo';
delete process.env.DATABASE_URL;

const at = new Date('2026-09-27T12:00:00Z');
const source: PortfolioSource = { file: 'invented-portfolio.pdf', page: 3, as_of: '2026-09-20', confidence: 0.9, last_verified_by: 'fixture-reviewer' };
function edge(kind: TieDetails['kind'], index = 0, extra: Partial<TieDetails> = {}, edgeKind: Edge['kind'] = 'other'): Edge {
  return { edgeId: `invented-edge-${index}`, fromEntity: `invented-node-${index}`, toEntity: `invented-node-${index + 1}`,
    fromName: `Invented node ${index}`, toName: `Invented node ${index + 1}`, kind: edgeKind, tier: 'A', strength: null, tieBand: null,
    evidence: [{ note: 'Invented sourced relationship', source: 'https://example.org/invented-tie', tie: { kind, lastInteraction: '2026-09-01', ...extra } }],
    reviewedByName: null, reviewedAt: null, reviewNote: null, validFrom: at, validTo: null };
}
const hops = (edges: Edge[]): Pick<Route, 'hops'> => ({ hops: edges.map(e => ({ edge: e, toName: e.toName, toEntity: e.toEntity })) });
function input(id: string, company: string, founders: string[]): PortfolioInput {
  return { version: 1, as_of: source.as_of, coverage: [{ vehicle: 'neurotech', status: 'complete', detail: 'Invented fixture corpus' }],
    rows: [{ id, vehicle: 'neurotech', company: { name: company }, founders: founders.map(name => ({ name, source })), source }] };
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'capital-routes-0070-'));
  process.env.PGLITE_DIR = scratch;
  const { scoreRoute, edgeWarmth, edgeGrade } = await import('../modules/network/warmth');
  const { importPortfolio, portfolioProblems } = await import('../lib/enrich/portfolio');
  const outcomes: Array<{ name: string; failure: string | null }> = [];
  const test = async (name: string, run: () => unknown | Promise<unknown>) => {
    try { await run(); outcomes.push({ name, failure: null }); }
    catch (error) { outcomes.push({ name, failure: error instanceof Error ? error.message : 'Unexpected fixture failure' }); }
  };

  await test('Empty routes score zero even with a strong introducer role', () => {
    assert.equal(scoreRoute(hops([]), at, { investor: true, plFounder: true }).value, 0);
  });
  await test('A zero-strength hop at any position forces a zero route score', () => {
    for (let zero = 0; zero < 3; zero++) {
      const edges = Array.from({ length: 3 }, (_, i) => edge(i === zero ? 'proximity' : 'investor_founder', i, { raisedFrom: true }));
      edges.forEach(e => { e.tier = edgeGrade(e, at); });
      assert.equal(edgeWarmth(edges[zero]!, at).score, 0);
      const score = scoreRoute(hops(edges), at, { investor: true, plFounder: true });
      assert.equal(score.value, 0, `Zero at hop ${zero + 1} cannot be offset by bonuses`);
      assert.ok(score.factors.some(f => f.key === 'weakestHop' && f.points <= 0));
    }
  });
  await test('Mixed grades and relationships always obey the weakest-hop bound', () => {
    const kinds: TieDetails['kind'][] = ['proximity', 'acquaintance', 'repeated_contact', 'worked_together', 'joint_investment', 'cofounder', 'family', 'close_friend', 'investor_founder'];
    const grades: EvidenceTier[] = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < kinds.length; i++) for (let j = 0; j < grades.length; j++) {
      const edges = [edge(kinds[i]!, 0), edge(kinds[(i + 3) % kinds.length]!, 1, { lastInteraction: null }), edge(kinds[(i + 5) % kinds.length]!, 2)];
      edges.forEach((e, n) => { e.tier = grades[(j + n) % grades.length]!; });
      const result = scoreRoute(hops(edges), at, { investor: true, plFounder: true });
      const ceiling = Math.min(...edges.map(e => edgeWarmth(e, at).score)) * 20;
      assert.ok(result.value <= ceiling && result.value >= 0, 'Route strength stays inside its weakest relationship');
      assert.ok(Math.abs(result.factors.reduce((sum, factor) => sum + factor.points, 0) - result.value) < 0.01001,
        'The explanatory factors reconcile to displayed score within flooring precision');
    }
  });
  await test('Warm grades require personal relationship evidence', () => {
    for (const kind of ['cofounder', 'family', 'close_friend'] as const) assert.equal(edgeGrade(edge(kind), at), 'A');
    for (const kind of ['worked_together', 'joint_investment', 'investor_founder', 'recent_contact', 'repeated_contact'] as const) {
      assert.equal(edgeGrade(edge(kind), at), 'B', `${kind} is a warm personal tie`);
    }
    assert.equal(edgeGrade(edge('proximity', 0, {}, 'board'), at), 'C', 'A shared board affiliation alone is not board work together');
    assert.equal(edgeGrade(edge('proximity', 0, {}, 'colleague'), at), 'C', 'The colleague edge kind alone cannot override explicit proximity evidence');
    assert.equal(edgeGrade(edge('proximity', 0, {}, 'event_coattendee'), at), 'D');
    assert.equal(edgeGrade(edge('proximity', 0, {}, 'social_public'), at), 'D');
    assert.equal(edgeGrade(edge('cofounder', 0, {}, 'possible_identity'), at), 'D', 'Namesake bridges never imply a warm relationship');
  });
  await test('Recency and PL affiliation policy stay distinct from generic membership', () => {
    assert.equal(edgeGrade(edge('acquaintance'), at), 'B');
    assert.equal(edgeGrade(edge('acquaintance', 0, { lastInteraction: '2010-01-01' }), at), 'C');
    assert.equal(edgeGrade(edge('acquaintance', 0, { lastInteraction: null }), at), 'C');
    assert.equal(edgeGrade(edge('worked_together', 0, { basis: 'pl_affiliation', lastInteraction: null }), at), 'B');
    assert.equal(edgeGrade(edge('worked_together', 0, { basis: 'pl_network', lastInteraction: null }), at), 'C');
  });
  await test('Malformed relationship metadata cannot establish a warm grade', () => {
    const malformed = edge('family', 0, { lastInteraction: '2026-02-30' });
    assert.equal(edgeWarmth(malformed, at).score, 0);
    assert.equal(edgeGrade(malformed, at), 'D');
  });

  // freshDb itself deletes shared data/demo/props. Its openFresh bootstrap is isolated here
  // so this focused regression run can execute alongside the complete property suite.
  const { openFresh } = await import('../lib/db');
  const db = await openFresh(scratch);
  try {
    async function entity(type: 'person' | 'org', name: string): Promise<string> {
      return (await db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name) values($1::identity.entity_type,$2) returning entity_id::text id`, [type, name]))!.id;
    }
    async function affiliate(person: string, org: string, sourced = true) {
      await db.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of)
        values($1,$2,'principal','Founder',$3,'2026-09-01')`, [person, org, sourced ? 'https://example.org/invented-team' : null]);
    }
    const mapping = async (key: string) => (await db.one<{ id: string }>(`select entity_id::text id from identity.source_record where source='portfolio' and source_id=$1`, [key]))?.id;
    const counts = async () => (await db.one<{ entities: number; mappings: number; matches: number; rows: number }>(`select
      (select count(*)::int from identity.entity) entities,
      (select count(*)::int from identity.source_record where source='portfolio') mappings,
      (select count(*)::int from identity.possible_match) matches,
      (select count(*)::int from network.portfolio) rows`))!;

    await test('Missing company or founder provenance is rejected before mutation', async () => {
      const before = await counts();
      for (const field of ['company', 'founder'] as const) {
        const broken = structuredClone(input(`invented-invalid-${field}`, 'Invented Invalid Company', ['Invented Invalid Founder']));
        if (field === 'company') broken.rows[0]!.source = undefined as unknown as PortfolioSource;
        else broken.rows[0]!.founders[0]!.source.last_verified_by = '';
        assert.ok(portfolioProblems(broken).length > 0);
        await assert.rejects(importPortfolio(db, broken), /provenance/);
      }
      assert.deepEqual(await counts(), before, 'Invalid input writes no portfolio or identity records');
    });
    await test('Name-only company and founder matches remain possible, never merged', async () => {
      const existingCompany = await entity('org', 'Invented Name Only Company');
      const existingFounder = await entity('person', 'Invented Name Only Founder');
      await importPortfolio(db, input('invented-name-only', 'Invented Name Only Company', ['Invented Name Only Founder']));
      const importedCompany = await mapping('invented-name-only:company');
      const importedFounder = await mapping('invented-name-only:founder:invented name only founder');
      assert.ok(importedCompany && importedCompany !== existingCompany);
      assert.ok(importedFounder && importedFounder !== existingFounder);
      const possible = await db.query<{ a: string; b: string }>(`select left_entity::text a,right_entity::text b from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])`, [[existingFounder, existingCompany]]);
      assert.ok(possible.some(pair => [pair.a, pair.b].includes(importedFounder!) && [pair.a, pair.b].includes(existingFounder)));
      assert.ok(possible.some(pair => [pair.a, pair.b].includes(importedCompany!) && [pair.a, pair.b].includes(existingCompany)));
      const untouched = await db.query<{ merged: string | null }>('select merged_into::text merged from identity.entity where entity_id=any($1::uuid[])', [[existingFounder, existingCompany]]);
      assert.ok(untouched.every(row => row.merged === null));
    });
    await test('Name plus a unique sourced company affiliation resolves the founder', async () => {
      const company = await entity('org', 'Invented Sourced Company');
      const founder = await entity('person', 'Invented Sourced Founder');
      await affiliate(founder, company);
      const result = await importPortfolio(db, input('invented-sourced', 'Invented Sourced Company', ['Invented Sourced Founder']));
      assert.equal(await mapping('invented-sourced:founder:invented sourced founder'), founder);
      assert.equal(result.linked, 1);
    });
    await test('An unsourced organization affiliation does not resolve a namesake', async () => {
      const company = await entity('org', 'Invented Unsourced Company');
      const founder = await entity('person', 'Invented Unsourced Founder');
      await affiliate(founder, company, false);
      await importPortfolio(db, input('invented-unsourced', 'Invented Unsourced Company', ['Invented Unsourced Founder']));
      assert.notEqual(await mapping('invented-unsourced:founder:invented unsourced founder'), founder);
    });
    await test('Ambiguous sourced affiliations leave both namesakes as possible matches', async () => {
      const company = await entity('org', 'Invented Ambiguous Company');
      const first = await entity('person', 'Invented Ambiguous Founder');
      const second = await entity('person', 'Invented Ambiguous Founder');
      await affiliate(first, company); await affiliate(second, company);
      const result = await importPortfolio(db, input('invented-ambiguous', 'Invented Ambiguous Company', ['Invented Ambiguous Founder']));
      const resolved = await mapping('invented-ambiguous:founder:invented ambiguous founder');
      assert.ok(resolved && resolved !== first && resolved !== second);
      assert.equal(result.linked, 0);
    });
    await test('A recorded not-same-as assertion prevents automatic affiliation resolution', async () => {
      const company = await entity('org', 'Invented Blocked Company');
      const founder = await entity('person', 'Invented Blocked Founder');
      await affiliate(founder, company);
      await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id)
        values('not_same_as','portfolio','invented-blocked:founder:invented blocked founder','invented-fixture','blocked-founder')`);
      await importPortfolio(db, input('invented-blocked', 'Invented Blocked Company', ['Invented Blocked Founder']));
      assert.notEqual(await mapping('invented-blocked:founder:invented blocked founder'), founder);
    });
    await test('Repeated import preserves entity IDs and creates no duplicate rows, aliases or possible matches', async () => {
      const repeated = input('invented-name-only', 'Invented Name Only Company', ['Invented Name Only Founder']);
      const before = await counts();
      const founderBefore = await mapping('invented-name-only:founder:invented name only founder');
      await importPortfolio(db, repeated);
      assert.deepEqual(await counts(), before);
      assert.equal(await mapping('invented-name-only:founder:invented name only founder'), founderBefore);
      const stored = await db.one<{ source: PortfolioSource; founders: Array<{ source: PortfolioSource }> }>(`select source,founders from network.portfolio where portfolio_id='invented-name-only'`);
      assert.deepEqual(stored!.source, source);
      assert.deepEqual(stored!.founders[0]!.source, source);
    });
    const { planNetworkNodes, importNetworkNodes } = await import('../modules/network/nodes');
    const { connectionPersonKey } = await import('../lib/enrich/connect');
    const institutionKey = 'organization:protocol-labs';
    const w3InstitutionKey = connectionPersonKey('PL', 'https://protocol.ai');
    const institutionalInput: NetworkNodeInput = {
      warehouse: { people: [{ key: institutionKey, name: 'Invented Institution Label', org: null, emailDomain: null,
        roles: [], warehouseIds: { fixture: institutionKey }, source: 'invented.institution', as_of: at.toISOString(),
        confidence: 'fixture', last_verified_by: 'fixture' }], ties: [], matches: [] },
      candidates: [], team: [], graph: [], direct: [], findings: [],
    };
    const institutionMappings = () => db.query<{ source: string; key: string; id: string; type: string }>(`select
      s.source,s.source_id key,identity.canonical_entity_id(s.entity_id)::text id,e.entity_type::text type
      from identity.source_record s join identity.entity e on e.entity_id=identity.canonical_entity_id(s.entity_id)
      where (s.source='network_org' and s.source_id='pl') or (s.source='warehouse' and s.source_id=$1)
        or (s.source='w3_person' and s.source_id=$2)`, [institutionKey, w3InstitutionKey]);
    await test('Reserved warehouse institution is planned as an organization, never a team member', () => {
      const plan = planNetworkNodes(institutionalInput, at);
      assert.equal(plan.nodes.find(node => node.source === 'warehouse' && node.sourceId === institutionKey)?.type, 'org');
      assert.equal(plan.nodes.filter(node => node.type === 'person').length, 0);
      assert.equal(plan.edges.length, 0, 'An institution must not gain a personal membership or colleague edge to itself');
    });
    await test('Warehouse and network institution aliases share one new canonical organization on repeated import', async () => {
      assert.equal((await institutionMappings()).length, 0, 'Isolated fixture starts without reserved aliases');
      const plan = planNetworkNodes(institutionalInput, at);
      const first = await db.transaction(tx => importNetworkNodes(tx, plan, at));
      const aliases = await institutionMappings();
      try {
        assert.equal(first.nodesCreated, 1, 'Two reserved source descriptors create only one organization');
        assert.equal(aliases.length, 2);
        assert.equal(new Set(aliases.map(alias => alias.id)).size, 1);
        assert.ok(aliases.every(alias => alias.type === 'org'));
        const again = await db.transaction(tx => importNetworkNodes(tx, plan, at));
        assert.equal(again.nodesCreated, 0);
        assert.equal(again.sourceRecords, 0);
        assert.deepEqual(await institutionMappings(), aliases);
      } finally {
        const ids = [...new Set(aliases.map(alias => alias.id))];
        await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
        await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
      }
    });
    await test('An existing W3 institutional source is reused by both network and warehouse aliases', async () => {
      const canonical = await entity('org', 'Invented Existing Institution');
      await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('w3_person',$1,$2,'fixture')`, [w3InstitutionKey, canonical]);
      try {
        const result = await db.transaction(tx => importNetworkNodes(tx, planNetworkNodes(institutionalInput, at), at));
        const aliases = await institutionMappings();
        assert.equal(result.nodesCreated, 0, 'An existing canonical organization needs no duplicate source node');
        assert.equal(aliases.length, 3);
        assert.ok(aliases.every(alias => alias.id === canonical && alias.type === 'org'));
      } finally {
        await db.query('delete from identity.source_record where entity_id=$1', [canonical]);
        await db.query('delete from identity.entity where entity_id=$1', [canonical]);
      }
    });
    await test('A reserved warehouse source remains source-only before its legacy person type is corrected', async () => {
      const legacy = await entity('person', 'Invented Legacy Institution Type');
      const origin = await entity('person', 'Invented Origin');
      const target = await entity('person', 'Invented Destination');
      await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('warehouse',$1,$2,'fixture')`, [institutionKey, legacy]);
      await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from) values
        ($1,$2,'colleague','B','[]','2026-01-01'),($2,$3,'colleague','B','[]','2026-01-01')`, [origin, legacy, target]);
      try {
        const { routeSources, enumeratePathsFromSources } = await import('../modules/network/repo');
        const sources = await routeSources();
        assert.ok(sources.some(candidate => candidate.entityId === legacy && candidate.sourceOnly),
          'The reserved source identity must establish the institution independently of its stale entity type');
        const paths = await enumeratePathsFromSources([origin], target, 3);
        assert.ok(paths.every(path => !path.nodes.slice(1).includes(legacy)), 'No route may enter the reserved institutional source');
      } finally {
        await db.query('delete from network.edge where from_entity=any($1::uuid[]) or to_entity=any($1::uuid[])', [[legacy, origin, target]]);
        await db.query('delete from identity.source_record where entity_id=$1', [legacy]);
        await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [[legacy, origin, target]]);
      }
    });
  } finally { await db.close(); await rm(scratch, { recursive: true, force: true }); }

  for (const outcome of outcomes) console.log(`${outcome.failure ? 'FAIL' : 'ok'} ${outcome.name}${outcome.failure ? `: ${outcome.failure}` : ''}`);
  console.log(`${outcomes.filter(outcome => !outcome.failure).length}/${outcomes.length} routes 0070 scoring and portfolio properties hold.`);
  if (outcomes.some(outcome => outcome.failure)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

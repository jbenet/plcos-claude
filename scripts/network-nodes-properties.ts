/** Invented NODES fixtures; standalone scale measurement uses a disposable demo database. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Queryable } from '../lib/db';
import type { NetworkNodeInput, NodeSpec } from '../modules/network/nodes';
import type { WarehousePerson, WarehouseTie } from '../lib/enrich/warehouse-graph';

type Check = (name: string, ok: boolean, detail: string) => void;
const AT = new Date('2026-09-26T12:00:00Z');
const empty = (): NetworkNodeInput => ({ warehouse: { people: [], ties: [], matches: [] }, candidates: [], team: [], graph: [], direct: [], findings: [] });
const person = (key: string, name = `Invented Person ${key}`): WarehousePerson => ({ key, name, org: null, emailDomain: null,
  roles: [], warehouseIds: { fixture: key }, source: 'invented.members', as_of: AT.toISOString(), confidence: 'fixture', last_verified_by: 'fixture' });
const tie = (key: string, from: string, to: string, tier: 'B' | 'C' | 'D' = 'C'): WarehouseTie => ({
  key, from, to, tier, kind: tier === 'B' ? 'acquaintance' : 'proximity', source: 'invented.ties', rowIds: [key], count: 1,
  firstSeen: '2026-09-01', lastSeen: '2026-09-01',
});
function counted(db: Queryable) {
  let calls = 0;
  const tx: Queryable = {
    query: async <T>(sql: string, params?: unknown[]) => { calls++; return db.query<T>(sql, params); },
    one: async <T>(sql: string, params?: unknown[]) => { calls++; return db.one<T>(sql, params); },
    exec: async (sql: string) => { calls++; await db.exec(sql); },
  };
  return { tx, calls: () => calls };
}
async function nodeIds(db: Queryable, nodes: NodeSpec[]) {
  const rows = await db.query<{ source: string; source_id: string; entity_id: string }>(
    `select s.source, s.source_id, s.entity_id::text from identity.source_record s
     join jsonb_to_recordset($1::jsonb) as n(source text, "sourceId" text) on s.source=n.source and s.source_id=n."sourceId"`,
    [JSON.stringify(nodes.map(({ source, sourceId }) => ({ source, sourceId })))]);
  return new Map(rows.map((r) => [JSON.stringify([r.source, r.source_id]), r.entity_id]));
}
const specId = (ids: Map<string, string>, node: NodeSpec) => ids.get(JSON.stringify([node.source, node.sourceId])) ?? node.entityId;

export async function networkNodesProperties(check: Check, db: Queryable) {
  const { planNetworkNodes, importNetworkNodes } = await import('../modules/network/nodes');
  const input = empty();
  input.warehouse.people = [
    { ...person('nodes-isolate', 'Invented Isolated Person'), org: 'Invented Isolated Organization' },
    { ...person('nodes-staff', 'Invented Current Colleague'), roles: ['PL team'] },
    person('nodes-former', 'Invented Former Colleague'),
    { ...person('nodes-team-alias', 'Invented Team Anchor'), teamKey: 'nodes-team' },
    person('nodes-shared', 'Invented Shared Affiliation'),
    person('nodes-event', 'Invented Event Attendee'),
    person('nodes-ambiguous', 'Invented Ambiguous Person'),
  ];
  input.team = [{ handle: 'nodes-team', name: 'Invented Team Anchor', roles: [{ org: 'Protocol Labs', role: 'Engineer' }], prior: [], education: [] }];
  input.findings = [{ key: 'nodes-former', name: 'Invented Former Colleague', identity: { match: 'confirmed', basis: 'Invented source identity' },
    researched: { at: '2026-09-25', by: 'fixture', workflow: 'W1', version: '1' },
    facts: [{ field: 'prior_role', value: 'Previously worked at Protocol Labs', detail: { company: 'Protocol Labs' }, confidence: 'high', source: { kind: 'primary', url: 'https://example.org/former' } }] }];
  input.warehouse.ties = [tie('nodes-c', 'nodes-shared', 'nodes-event'), tie('nodes-d', 'nodes-event', 'nodes-isolate', 'D')];
  // Enough pairs that an accidental per-edge implementation cannot pass the batching check.
  for (let i = 0; i < 80; i++) input.warehouse.people.push(person(`nodes-batch-${i}`));
  for (let i = 0; i < 320; i++) input.warehouse.ties.push(tie(`nodes-batch-tie-${i}`,
    `nodes-batch-${i % 80}`, `nodes-batch-${(i % 80 + Math.floor(i / 80) + 1) % 80}`));
  input.graph = [{ id: 'nodes-research', from: { name: 'Invented Research Connector', type: 'person' },
    to: { name: 'Invented Research Organization', type: 'organization' }, kind: 'affiliation', claim: 'Invented affiliation',
    provenance: { source: 'https://example.org/research', as_of: '2026-09-25', confidence: 'medium', last_verified_by: 'fixture' },
    evidenceTier: { proposed: 'C' } }];
  const createdCandidates: string[] = [];
  for (const name of ['Invented Candidate One', 'Invented Candidate Two']) createdCandidates.push((await db.one<{ id: string }>(
    `insert into identity.entity (entity_type,display_name) values ('person',$1) returning entity_id::text as id`, [name]))!.id);
  input.candidates = createdCandidates.map((key, i) => ({ key, name: `Invented Candidate ${i + 1}`, type: 'person', org: null, domains: [] }));
  input.findings.push({ key: createdCandidates[0]!, name: 'Invented Finding Namesake',
    identity: { match: 'ambiguous', basis: 'Two invented people share a name' },
    researched: { at: '2026-09-25', by: 'fixture', workflow: 'W1', version: '1' }, facts: [] });
  input.direct = [{ lp: createdCandidates[0]!, recordId: 'nodes-direct-record', on: '2026-09-01', channel: 'email', direction: 'theirs',
    team: { name: 'Invented Direct Participant' }, identity: { lp: 'confirmed', team: 'confirmed' }, tier: 'B', eligible: true,
    source: { url: 'https://example.org/direct', as_of: '2026-09-25', last_verified_by: 'fixture' } }];
  input.warehouse.matches = createdCandidates.map((lpKey) => ({ lpKey, personKey: 'nodes-ambiguous', score: .6, status: 'ambiguous', basis: ['invented namesake'] }));
  const before = new Set((await db.query<{ id: string }>('select entity_id::text as id from identity.entity')).map((r) => r.id));
  try {
    const plan = planNetworkNodes(input, AT);
    const find = (name: string) => plan.nodes.find((n) => n.name === name);
    const pl = plan.nodes.find((n) => n.source === 'network_org' && n.sourceId === 'pl');
    const required = ['Invented Isolated Person', 'Invented Isolated Organization', 'Invented Research Connector', 'Invented Research Organization', 'Invented Direct Participant'];
    check('NODES plans every warehouse and research endpoint, including isolated people and organizations',
      required.every((name) => !!find(name)) && input.warehouse.people.every((p) => !!find(p.name)),
      'Nodes do not depend on an LP match or an already discovered route.');
    const connects = (a: NodeSpec, b: NodeSpec, tier: string, kind?: string) => plan.edges.some((e) =>
      ((e.from === a.key && e.to === b.key) || (e.from === b.key && e.to === a.key)) && e.tier === tier && (!kind || e.tie.kind === kind));
    const staff = find('Invented Current Colleague'), former = find('Invented Former Colleague'), anchor = find('Invented Team Anchor');
    check('NODES PL current and former staff retain warm work ties and a PL organization source',
      !!pl && !!staff && !!former && !!anchor && connects(pl, staff, 'B', 'worked_together')
        && connects(pl, former, 'B', 'worked_together') && connects(staff, anchor, 'B', 'worked_together'),
      'Current and previous PL affiliation is sufficient; no interaction or human review is invented.');
    const duplicate = planNetworkNodes({ ...input, warehouse: { ...input.warehouse, people: [...input.warehouse.people, input.warehouse.people[0]!] } }, AT);
    check('NODES stable source keys deduplicate repeated inputs',
      duplicate.nodes.length === plan.nodes.length && new Set(plan.nodes.map((n) => JSON.stringify([n.source, n.sourceId]))).size === plan.nodes.length,
      'The same source identity produces one node.');
    const countedDb = counted(db);
    const first = await importNetworkNodes(countedDb.tx, plan, AT);
    const ids = await nodeIds(db, plan.nodes);
    const isolated = find('Invented Isolated Person')!, ambiguous = find('Invented Ambiguous Person')!;
    check('NODES imports isolated people and organizations into canonical identities',
      required.every((name) => !!specId(ids, find(name)!)) && !!specId(ids, isolated) && first.nodesCreated > 0,
      'Every planned source endpoint has a persisted identity.');
    const teamSpec = plan.nodes.find((n) => n.source === 'app_user' && n.sourceId === 'nodes-team')!;
    const teamAlias = plan.nodes.find((n) => n.source === 'warehouse' && n.sourceId === 'nodes-team-alias')!;
    check('NODES a new team anchor and its explicit warehouse alias share one identity on the first import',
      !!specId(ids, teamSpec) && specId(ids, teamSpec) === specId(ids, teamAlias),
      'Pending source mappings participate in exact team-handle resolution.');
    check('NODES ambiguous LP matches remain separate canonical people',
      !!specId(ids, ambiguous) && !createdCandidates.includes(specId(ids, ambiguous)!),
      'Ambiguous alternatives never reuse either LP entity ID.');
    const findingNamesake = find('Invented Finding Namesake')!;
    check('NODES an ambiguous finding keyed by an LP UUID does not merge its subject into that LP',
      !!findingNamesake && !!specId(ids, findingNamesake) && !createdCandidates.includes(specId(ids, findingNamesake)!),
      'A research filename identifies the request, not a resolved person.');
    const pairNodes = [find('Invented Shared Affiliation')!, find('Invented Event Attendee')!, isolated];
    const pairIds = pairNodes.map((n) => specId(ids, n)!);
    const evidence = await db.query<{ edge_id: string; tier: string; reviewed_at: string | null }>(
      `select edge_id::text,tier::text,reviewed_at::text from network.edge where from_entity=any($1::uuid[]) and to_entity=any($1::uuid[])`, [pairIds]);
    check('NODES C and D evidence imports without a human review gate',
      ['C', 'D'].every((tier) => evidence.some((e) => e.tier === tier && e.reviewed_at === null)),
      'Weak evidence is present for uncertainty-aware ranking.');
    const c = evidence.find((e) => e.tier === 'C')!, d = evidence.find((e) => e.tier === 'D')!;
    const reviewer = (await db.one<{ id: string }>('select id::text from platform.app_user order by id limit 1'))!.id;
    for (const [edge, declined] of [[c, true], [d, false]] as const) await db.query(
      `update network.edge set reviewed_by=$2,reviewed_at=$3::timestamptz,review_note='Invented user decision',valid_to=$4::date where edge_id=$1`,
      [edge.edge_id, reviewer, AT.toISOString(), declined ? '2026-09-25' : null]);
    const externalPair = ['nodes-batch-0', 'nodes-batch-1'].map((sourceId) =>
      specId(ids, plan.nodes.find((n) => n.source === 'warehouse' && n.sourceId === sourceId)!)!);
    const externalEdge = (await db.one<{ id: string }>(
      `select edge_id::text id from network.edge where kind='other' and from_entity=any($1::uuid[]) and to_entity=any($1::uuid[])`, [externalPair]))!;
    await db.query(`update network.edge set tier='A', evidence=evidence || $2::jsonb where edge_id=$1`,
      [externalEdge.id, JSON.stringify([{ derived: 'records', note: 'Invented strong external evidence', source: 'invented.direct',
        tie: { kind: 'repeated_contact', lastInteraction: '2026-09-20' } }])]);
    const countBefore = await db.one<{ n: string }>('select count(*)::text n from network.edge');
    const second = await importNetworkNodes(countedDb.tx, plan, AT);
    const idsAgain = await nodeIds(db, plan.nodes);
    const countAfter = await db.one<{ n: string }>('select count(*)::text n from network.edge');
    const decisions = await db.query<{ edge_id: string; valid_to: string | null; reviewed_by: string; review_note: string }>(
      `select edge_id::text,valid_to::text,reviewed_by::text,review_note from network.edge where edge_id=any($1::uuid[])`, [[c.edge_id, d.edge_id]]);
    check('NODES repeat imports preserve identities and create no duplicate edges',
      second.nodesCreated === 0 && ids.size === idsAgain.size && [...ids].every(([key, value]) => idsAgain.get(key) === value)
        && countBefore?.n === countAfter?.n,
      'The canonical identities and pairwise graph are stable across retries.');
    const externalAfter = await db.one<{ tier: string; evidence: Array<{ note?: string }> }>(
      `select tier::text,evidence from network.edge where edge_id=$1`, [externalEdge.id]);
    check('NODES weaker managed evidence preserves stronger external evidence',
      externalAfter?.tier === 'A' && externalAfter.evidence.some((e) => e.note === 'Invented strong external evidence'),
      'A warehouse rebuild cannot overwrite the existing direct-record basis.');
    check('NODES imports preserve confirmed and declined user decisions',
      decisions.length === 2 && decisions.every((e) => e.reviewed_by === reviewer && e.review_note === 'Invented user decision')
        && decisions.find((e) => e.edge_id === c.edge_id)?.valid_to === '2026-09-25'
        && decisions.find((e) => e.edge_id === d.edge_id)?.valid_to === null,
      'Rebuilding evidence cannot resurrect a declined tie or erase a review.');
    const stalePair = ['nodes-batch-1', 'nodes-batch-2'].map((sourceId) =>
      specId(ids, plan.nodes.find((n) => n.source === 'warehouse' && n.sourceId === sourceId)!)!);
    const staleBefore = await db.one<{ id: string }>(
      `select edge_id::text id from network.edge where kind='other' and from_entity=any($1::uuid[]) and to_entity=any($1::uuid[])`, [stalePair]);
    const reduced = { ...plan, edges: plan.edges.filter((e) => !e.rowIds.some((id) => ['nodes-batch-tie-1', 'nodes-c', 'nodes-d'].includes(id))) };
    await importNetworkNodes(countedDb.tx, reduced, AT);
    const staleAfter = await db.one<{ n: string }>('select count(*)::text n from network.edge where edge_id=$1', [staleBefore!.id]);
    const retainedDecisions = await db.one<{ n: string }>('select count(*)::text n from network.edge where edge_id=any($1::uuid[])', [[c.edge_id, d.edge_id]]);
    check('NODES stale unreviewed managed edges disappear while user decisions survive missing source evidence',
      staleAfter?.n === '0' && retainedDecisions?.n === '2',
      'An outdated source does not leave a live unreviewed route or erase a recorded decision.');
    check('NODES import uses bounded batches rather than one query per edge',
      countedDb.calls() < 60, `${countedDb.calls()} calls for three complete imports.`);
  } finally {
    const added = (await db.query<{ id: string }>('select entity_id::text as id from identity.entity')).map((r) => r.id).filter((id) => !before.has(id));
    const cleanup = [...createdCandidates, ...added];
    await db.query('delete from network.edge where from_entity=any($1::uuid[]) or to_entity=any($1::uuid[])', [cleanup]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [cleanup]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [cleanup]);
  }
}

/** Exact requested scale. Construction/boot are reported separately from planning/import. */
export async function benchmarkNetworkNodes() {
  process.env.DATA_PROFILE = 'demo';
  delete process.env.DATABASE_URL;
  const scratch = await mkdtemp(join(tmpdir(), 'capital-nodes-benchmark-'));
  process.env.PGLITE_DIR = scratch;
  let db: import('../lib/db').Db | undefined;
  try {
    const boot = performance.now();
    db = await (await import('../lib/db')).openFresh(scratch);
    const bootMs = performance.now() - boot;
    const { planNetworkNodes, importNetworkNodes } = await import('../modules/network/nodes');
    const input = empty(), people = 4705, ties = 188000;
    input.warehouse.people = Array.from({ length: people }, (_, i) => ({ ...person(`scale-${i}`), org: `Invented Organization ${i % 100}` }));
    input.warehouse.ties = Array.from({ length: ties }, (_, i) => tie(`scale-tie-${i}`, `scale-${i % people}`, `scale-${(i % people + Math.floor(i / people) + 1) % people}`, i % 2 ? 'C' : 'D'));
    const baseline = (await db.one<{ nodes: string; edges: string }>(`select (select count(*) from identity.entity)::text nodes,(select count(*) from network.edge)::text edges`))!;
    const start = performance.now();
    const plan = planNetworkNodes(input, AT);
    const planned = performance.now();
    const result = await db.transaction((tx) => {
      const wrapped = counted(tx);
      return importNetworkNodes(wrapped.tx, plan, AT).then((result) => ({ result, calls: wrapped.calls() }));
    });
    const elapsed = performance.now() - start;
    const repeatStart = performance.now();
    const repeated = await db.transaction((tx) => {
      const wrapped = counted(tx);
      return importNetworkNodes(wrapped.tx, plan, AT).then((result) => ({ result, calls: wrapped.calls() }));
    });
    const repeatMs = performance.now() - repeatStart;
    const totals = (await db.one<{ nodes: string; edges: string }>(
      `select (select count(*) from identity.entity)::text nodes,(select count(*) from network.edge)::text edges`))!;
    const persisted = { nodes: Number(totals.nodes) - Number(baseline.nodes), edges: Number(totals.edges) - Number(baseline.edges) };
    console.log(JSON.stringify({ synthetic: true, people, ties, plannedNodes: plan.nodes.length, plannedEdges: plan.edges.length,
      bootMs: Math.round(bootMs), planMs: Math.round(planned - start), importMs: Math.round(elapsed - (planned - start)),
      totalMs: Math.round(elapsed), repeatImportMs: Math.round(repeatMs), repeatCalls: repeated.calls, repeatNodesCreated: repeated.result.nodesCreated,
      underOneMinute: elapsed < 60000 && repeatMs < 60000, calls: result.calls,
      nodesCreated: result.result.nodesCreated, edgesWritten: result.result.edgesWritten, persisted }, null, 2));
    if (elapsed >= 60000 || repeatMs >= 60000 || repeated.result.nodesCreated !== 0) process.exitCode = 1;
  } finally { await db?.close(); await rm(scratch, { recursive: true, force: true }); }
}
async function runStandaloneProperties() {
  process.env.DATA_PROFILE = 'demo';
  delete process.env.DATABASE_URL;
  const scratch = await mkdtemp(join(tmpdir(), 'capital-nodes-properties-'));
  process.env.PGLITE_DIR = scratch;
  let db: import('../lib/db').Db | undefined;
  try {
    db = await (await import('../lib/db')).openFresh(scratch);
    const results: Array<{ name: string; ok: boolean; detail: string }> = [];
    await networkNodesProperties((name, ok, detail) => results.push({ name, ok, detail }), db);
    for (const result of results) console.log(`${result.ok ? 'ok' : 'FAIL'} ${result.name}: ${result.detail}`);
    console.log(`${results.filter((r) => r.ok).length}/${results.length} NODES properties hold`);
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  } finally { await db?.close(); await rm(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--benchmark') ? benchmarkNetworkNodes : process.argv.includes('--properties') ? runStandaloneProperties : null;
  if (run) run().catch((error) => { console.error(error); process.exitCode = 1; });
}

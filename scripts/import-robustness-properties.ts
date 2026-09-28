/** ROBUST: invented records only; import runs against the property harness database. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../lib/db';
import { check as findingProblems, type Finding } from '../lib/enrich/schema';
import { connectionPersonKey, type ConnectionPerson, type Path } from '../lib/enrich/connect';
import { connectionIdentityProblems, readPathRecords } from '../lib/enrich/connection-check';
import { connectionCoverage } from '../lib/enrich/connection-summary';
import { resolveConnectionPeople } from '../lib/enrich/connection-people';
import { importFindings } from '../lib/enrich/import';

export async function importRobustnessProperties(check: (name: string, ok: boolean, detail: string) => void, db: Db) {
  const lp = randomUUID();
  const descriptor = (name: string, entityType: 'person' | 'org' = 'person'): ConnectionPerson => ({
    key: connectionPersonKey(name, 'https://example.org/robust'), name, source: 'https://example.org/robust', entityType,
  });
  const org = descriptor('Robust Cedar Company', 'org'), wrong = { ...org, entityType: 'person' as const }, good = descriptor('Robust Iris Lake');
  const path = (person: ConnectionPerson): Path => ({ lp, other: { type: 'backer', name: person.name, key: person.key, person },
    kind: 'other', tier: 'C', basis: 'Invented sourced relationship', source: person.source });
  const finding: Finding = { key: lp, name: 'Robust Willow Vale', researched: { at: '2026-09-26', by: 'fixture', workflow: 'W1', version: '1' },
    identity: { match: 'confirmed', basis: 'Invented identity', canonical: { org: org.name } }, facts: [],
    connections: [{ to: org.name, kind: 'other', tier: 'C', scope: 'person', toType: 'person', basis: 'Invented target type error' }] };
  const invalid = structuredClone(finding) as any;
  invalid.connections[0].kind = 'investor_founder';
  invalid.connections[0].tie = { kind: 'invented_unsupported_warmth' };
  const problems = findingProblems(invalid);
  check('ROBUST findings reject invalid connection and warmth kinds at the connection index',
    problems.some((p) => p.includes('connection 0: unknown connection kind')) && problems.some((p) => p.includes('connection 0: unknown warmth kind')),
    'Connection kinds and warmth metadata have distinct vocabularies.');
  invalid.connections[0].kind = 'other'; invalid.connections[0].tie.kind = 'investor_founder';
  check('ROBUST the existing investor_founder warmth kind remains valid', !findingProblems(invalid).length,
    'The current network vocabulary is authoritative.');
  const locations = [{ file: 'raw/invented.json', index: 0, value: finding }];
  const issues = connectionIdentityProblems(locations, [{ file: 'connections.jsonl', index: 7, value: path(wrong) }]);
  check('ROBUST person targets matching known orgs and cross-file identity conflicts name each location',
    issues.some((p) => p.file === 'raw/invented.json' && p.problems.some((s) => s.includes('connection 0: toType person conflicts with target identity')))
      && issues.some((p) => p.file === 'connections.jsonl' && p.index === 7 && p.problems.some((s) => s.includes('both person and org'))),
    'Exact normalized identities join findings and W3 paths without exposing names in diagnostics.');
  const otherFinding = { ...finding, key: randomUUID(), name: 'Other Invented Person', identity: { match: 'confirmed', basis: 'Fixture' }, connections: [] };
  const cross = connectionIdentityProblems([{ file: 'raw/a.json', index: 0, value: finding },
    { file: 'raw/b.json', index: 0, value: { ...otherFinding, connections: finding.connections } }], []);
  check('ROBUST cross-finding organization knowledge diagnoses a person-typed target', cross.some((p) => p.file === 'raw/b.json' && p.problems.some((s) => s.includes('connection 0'))), 'The target organization may be declared in a different file.');
  const badSource = path({ ...good, source: 'https://example.org/different' });
  const parsed = readPathRecords([JSON.stringify(path(good)), '', '{bad', JSON.stringify({ ...path(good), lp: 'not-a-uuid' }), JSON.stringify(badSource)].join('\n'));
  check('ROBUST malformed JSON, invalid UUIDs and mismatched source identities are isolated by physical index',
    parsed.records.length === 1 && parsed.skipped.map((p) => p.index).join(',') === '2,3,4', 'Blank lines do not shift diagnostics.');
  const malformedFinding = { ...finding, profile: { summary: 'Fixture', investorType: 'angel', cautions: {} }, facts: [{ quote: 12 }] };
  check('ROBUST malformed nested finding fields are reported instead of throwing', findingProblems(malformedFinding).length > 0,
    'Per-file validation can refuse malformed arrays and non-text quotes.');
  const mismatch = readPathRecords(JSON.stringify({ ...path(good), other: { ...path(good).other, key: lp }, tie: { kind: 'invented_unsupported_warmth' } }));
  check('ROBUST W3 checks unsupported warmth and mismatched descriptor endpoints', mismatch.skipped[0]!.problems.some((p) => p.includes('unknown warmth kind'))
    && mismatch.skipped[0]!.problems.some((p) => p.includes('does not match')), 'Bad paths never reach SQL.');
  const coverage = connectionCoverage([path(good), { ...path(good), tier: 'B' }, { ...path(org), lp: good.key }, { ...path(org), lp: org.key }], [lp, randomUUID()]);
  check('ROBUST summary counts only pipeline LPs and separates connector endpoints',
    coverage.reached === 1 && coverage.total === 2 && coverage.nonLpEndpoints === 2 && coverage.warm === 1 && coverage.onlyCD === 0,
    'Connector-only rows cannot make the LP numerator exceed its denominator.');

  const dir = await mkdtemp(join(tmpdir(), 'robust-fixtures-'));
  const extraKeys: string[] = [];
  try {
    await db.query("insert into identity.entity (entity_id,entity_type,display_name) values ($1,'person','Robust Willow Vale')", [lp]);
    for (const order of [[path(org), path(wrong), path(good)], [path(wrong), path(org), path(good)]]) {
      const skips: number[] = [];
      const result = await db.transaction((tx) => resolveConnectionPeople(tx, order, (index) => { skips.push(index); }));
      check('ROBUST conflicts skip both identities in either input order while valid paths resolve',
        result.length === 1 && result[0]!.other.key === good.key && skips.join(',') === '0,1', 'No first-wins identity or whole-batch rejection.');
    }
    const hub = descriptor('Robust PL Hub', 'org');
    const hubPath = (person: ConnectionPerson): Path => ({ ...path(hub), lp: person.key, lpPerson: person });
    const hubResult = await resolveConnectionPeople(db, [hubPath(org), hubPath(wrong), hubPath(good)]);
    extraKeys.push(hub.key);
    check('ROBUST a conflicting endpoint cannot poison its shared hub', hubResult.length === 1 && hubResult[0]!.lp === good.key && hubResult[0]!.other.key === hub.key,
      'The independent good person-to-hub path survives both conflicting company rows.');
    const alternate = { ...good, source: 'https://example.org/robust-alternate', key: connectionPersonKey(good.name, 'https://example.org/robust-alternate') };
    extraKeys.push(alternate.key);
    const sharedPerson = await resolveConnectionPeople(db, [path(good), path(alternate)]);
    check('ROBUST name-only source descriptors retain separate identities until corroborated',
      sharedPerson.length === 2 && sharedPerson[0]!.other.key === good.key && sharedPerson[1]!.other.key === alternate.key,
      'IDRES supersedes name-only reuse: distinct source records remain reversible and require corroboration to merge.');
    const absent = await db.one<{ n: number }>('select count(*)::int as n from identity.entity where entity_id = $1', [org.key]);
    check('ROBUST skipped descriptors create no entities', absent?.n === 0, 'Preflight happens before materialization.');
    const ambiguous = descriptor('Robust Duplicate Person');
    extraKeys.push(ambiguous.key);
    for (let i = 0; i < 2; i++) {
      const key = randomUUID(); extraKeys.push(key);
      await db.query("insert into identity.entity (entity_id,entity_type,display_name) values ($1,'person',$2)", [key, ambiguous.name]);
    }
    const ambiguity: string[] = [];
    const unambiguous = await resolveConnectionPeople(db, [path(ambiguous), path(good)], (_, p) => ambiguity.push(...p));
    check('ROBUST existing namesakes do not prevent materializing a distinct sourced W3 identity',
      unambiguous.length === 2 && ambiguity.length === 0 && unambiguous[0]!.other.key === ambiguous.key,
      'IDRES preserves the new source node and its uncertainty; it never substitutes an existing namesake by name alone.');
    const cliRoot = join(dir, 'cli');
    const cliRaw = join(cliRoot, 'data/demo/enrich/raw');
    await mkdir(cliRaw, { recursive: true });
    invalid.connections[0].tie.kind = 'invented_unsupported_warmth';
    await writeFile(join(cliRaw, `${lp}.json`), JSON.stringify(invalid));
    await writeFile(join(cliRaw, '../connections.jsonl'), [JSON.stringify(path(org)), JSON.stringify(path(wrong))].join('\n'));
    const cli = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(process.cwd(), 'scripts/enrich-check.ts')], {
      cwd: cliRoot, env: { ...process.env, DATA_PROFILE: 'demo', TSX_TSCONFIG_PATH: join(process.cwd(), 'tsconfig.json') }, encoding: 'utf8',
    });
    check('ROBUST enrich-check reports indexed schema and identity failures without crashing', cli.status === 1 && !cli.stderr
      && cli.stdout.includes(`raw/${lp}.json index 0: connection 0: unknown warmth kind`)
      && cli.stdout.includes('connections.jsonl index 1:') && cli.stdout.includes('toType person conflicts with target identity'),
      'The CLI composes cross-file checks even when the finding already has a vocabulary problem.');
    await writeFile(join(cliRaw, `${lp}.json`), JSON.stringify(finding));
    await writeFile(join(cliRaw, '../connections.jsonl'), '');
    const partialCli = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(process.cwd(), 'scripts/enrich-check.ts')], {
      cwd: cliRoot, env: { ...process.env, DATA_PROFILE: 'demo', TSX_TSCONFIG_PATH: join(process.cwd(), 'tsconfig.json') }, encoding: 'utf8',
    });
    check('COLLISION checker separates item drops from rejected findings', partialCli.status === 0
      && partialCli.stdout.includes('0 rejected · 1 kept with dropped items') && partialCli.stdout.includes('drop items: connection 0:'),
      'A collision-only finding remains importable; its indexed problem is still reported.');
    await mkdir(join(dir, 'raw'));
    await writeFile(join(dir, 'raw', `${lp}.json`), JSON.stringify({ ...finding, facts: [{ field: 'role', value: 'Invented operator', source: { url: 'https://example.org/robust-fixture', kind: 'primary' }, confidence: 'high' }, { field: 'board', value: 'Invented conflicting board', detail: { company: good.name }, source: { url: 'https://example.org/robust-fixture', kind: 'primary' }, confidence: 'high' }] }));
    await writeFile(join(dir, 'raw', `${randomUUID()}.json`), '{bad');
    await writeFile(join(dir, 'connections.jsonl'), [JSON.stringify(path(org)), JSON.stringify(path(wrong)), JSON.stringify(path(good)), '{bad', JSON.stringify({ ...path(good), lp: 'invalid' })].join('\n'));
    await writeFile(join(dir, 'triage.jsonl'), '{bad\n' + JSON.stringify({ key: lp, lane: 'cold', first: null }));
    const result = await withDb(db, () => importFindings(null, dir));
    check('ROBUST import commits good findings and paths with complete skipped-row diagnostics',
      result.mapped === 1 && result.claims === 1 && result.paths === 1 && result.rejected === 1 && result.skippedPaths === 4
        && result.skippedRecords.length === 5 && result.skippedRecords.some((p) => p.file === 'triage.jsonl' && p.index === 0),
      'Malformed records and conflicting descriptors do not block unrelated research.');
    const profile = await db.one<{ data: { identity: Finding['identity']; connections: unknown[] } }>(
      "select data from research.note where entity_id = $1 and kind = 'public_profile'", [lp]);
    check('COLLISION import counts retained findings separately and drops only conflicting items',
      result.keptWithDroppedItems === 1 && result.droppedFacts === 1 && result.droppedConnections === 1
        && result.rejected === 1 && result.problems.some(p => p.problems.some(s => s.startsWith('dropped connection 0:')))
        && profile?.data.identity.canonical?.org === org.name && profile.data.connections.length === 0,
      'Valid facts, identity and paths remain importable beside one bad connection and fact.');
    const run = await db.one<{ detail: typeof result }>("select detail from sources.sync_run where source = 'enrich' and kind = 'import' order by id desc limit 1");
    check('ROBUST the persisted Developer Enrich result lists every skipped path', run?.detail.skippedPaths === 4 && run.detail.skippedRecords.length === 5 && run.detail.keptWithDroppedItems === 1,
      'Counts and file/index/reason diagnostics survive the redirect.');
    const retry = await withDb(db, () => importFindings(null, dir));
    check('ROBUST retry keeps valid imports and skip counts stable', retry.paths === 1 && retry.skippedPaths === 4 && retry.claims === 1 && retry.keptWithDroppedItems === 1, 'No duplicate connector identity on retry.');

    await writeFile(join(dir, 'connections.jsonl'), JSON.stringify({ ...path(good), tie: { kind: 'unsupported_fixture_kind' } }));
    const skippedOnly = await withDb(db, () => importFindings(null, dir));
    const previous = await db.one<{ n: number }>("select count(*)::int as n from research.note where entity_id = $1 and kind = 'connection_candidates'", [lp]);
    check('ROBUST a skipped-only replacement preserves the previous imported candidate note', skippedOnly.paths === 0 && skippedOnly.skippedPaths === 1 && previous?.n === 1,
      'A malformed new descriptor cannot erase the last successful path import.');

    // Fail after materializing a fresh node, using actual SQL failure inside the transaction.
    const fresh = descriptor('Robust Rollback Person');
    await writeFile(join(dir, 'connections.jsonl'), JSON.stringify(path(fresh)));
    const broken: Db = { ...db, kind: db.kind, query: db.query.bind(db), one: db.one.bind(db), exec: db.exec.bind(db), close: db.close.bind(db),
      transaction: (work) => db.transaction(async (tx) => work({ ...tx, query: async (sql, params) => {
        if (sql.startsWith('delete from research.claim')) await tx.query('select missing_column from identity.entity');
        return tx.query(sql, params);
      } })) };
    let failed = false;
    try { await withDb(broken, () => importFindings(null, dir)); } catch { failed = true; }
    const rolledBack = await db.one<{ n: number }>('select count(*)::int as n from identity.entity where entity_id = $1', [fresh.key]);
    check('ROBUST real database errors still fail and roll back the import transaction', failed && rolledBack?.n === 0,
      'No catch-all converts SQL or schema failures into successful partial imports.');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await db.query('delete from research.note where entity_id = $1', [lp]);
    await db.query('delete from research.claim where entity_id = $1', [lp]);
    await db.query("delete from research.source_doc where origin = 'https://example.org/robust-fixture'");
    await db.query("delete from identity.source_record where source = 'w3_person' and source_id = any($1::text[])", [[good.key, org.key, ...extraKeys]]);
    await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [[lp, good.key, org.key, ...extraKeys]]);
  }
}

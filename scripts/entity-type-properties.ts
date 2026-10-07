/** Issue 0063: invented local identities, never connector traffic or real files. */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb } from '../lib/db';
import { correctEntityType, reverseEntityTypeCorrection } from '../modules/identity/entity-type';
import { getEntity } from '../modules/identity/repo';
import { correctPipelineEntityTypes, personEvidence, pipelinePeopleNamedLikeOrgs } from '../lib/enrich/entity-types';
import { readEntityTypes, writeEntityType } from '../lib/sync/entity-type';
import { SYNC_ADMIN } from '../lib/sync/scopes';
import { createMcpToken, type AppUser } from '../modules/platform';
import { exportResearchSet } from '../lib/enrich/candidates';
import { connectionPersonKey, type Path } from '../lib/enrich/connect';
import { connectionIdentityProblems } from '../lib/enrich/connection-check';
import { resolveConnectionPeople } from '../lib/enrich/connection-people';
import { importFindings } from '../lib/enrich/import';
import { latestRun } from '../modules/sources';
import { importNetworkNodes, planNetworkNodes } from '../modules/network/nodes';
import type { Finding } from '../lib/enrich/schema';
import type { Check, Db } from './properties/harness';

export async function entityTypeProperties(check: Check, db: Db) {
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const vehicle = (await db.one<{ id: string }>("select id::text from platform.vehicle where phase='active' and kind='fund' limit 1"))!.id;
  const ids: string[] = [], sources: string[] = [];
  const documentId = `entity-type-fixture:${randomUUID()}`;
  const scratch = await mkdtemp(join(tmpdir(), 'entity-type-properties-'));
  const previousDir = process.env.ENRICH_DIR;
  const entity = async (name: string, type: 'person' | 'org' = 'person', pipeline = type === 'person') => {
    const id = randomUUID(); ids.push(id);
    await db.query('insert into identity.entity(entity_id,entity_type,display_name) values($1,$2::identity.entity_type,$3)', [id, type, name]);
    if (pipeline) await db.query("insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source) values($1,$2,$3,'discussing','us')", [id, vehicle, actor]);
    return id;
  };
  const finding = (key: string, name: string): Finding => ({ key, name,
    researched: { at: '2026-09-27', by: 'fixture', workflow: 'W1', version: '1' },
    identity: { match: 'confirmed', basis: 'Invented source fixture' }, facts: [] });
  const run = (findings: Finding[] = [], paths: Path[] = []) => db.transaction(tx => correctPipelineEntityTypes(tx, findings, paths, actor));
  const type = async (id: string) => (await db.one<{ type: string }>('select entity_type::text type from identity.entity where entity_id=$1', [id]))!.type;
  try {
    check('ETYPE empty typed source fields and email domains are not person evidence',
      personEvidence({ fields: [{ name: 'Current Job Title', value: { type: 'text', data: null } },
        { name: 'Email', value: { type: 'text', data: [] } }], emailDomains: ['example.org'] }).length === 0,
      'Empty enriched fields do not turn a source schema label into evidence.');
    const name = 'Type Fixture Cedar Capital';
    const corrected = await entity(`  ${name.toUpperCase()}  `);
    await entity(name, 'org');
    const first = await run(), correction = first.corrected.find(x => x.entityId === corrected);
    const audit = correction && await db.one<{ original_type: string; corrected_type: string; recorded_by: string; rule: string; reason: string; recorded_at: unknown }>(
      'select original_type::text,corrected_type::text,recorded_by,rule,reason,recorded_at from identity.entity_type_correction where correction_id=$1', [correction.correctionId]);
    check('ETYPE exact normalized organization match records actor, time, reason and original type',
      !!audit && audit.original_type === 'person' && audit.corrected_type === 'org' && audit.recorded_by === actor && audit.rule === 'rule:org-name-match' && !!audit.reason && !!audit.recorded_at,
      'The source node remains present; a local correction records its original type.');
    if (!correction) throw new Error('Expected invented company fixture to be corrected');
    const second = await run();
    const count = await db.one<{ n: number }>('select count(*)::int n from identity.entity_type_correction where entity_id=$1', [corrected]);
    check('ETYPE repeated identity passes do not create another correction', !second.corrected.some(x => x.entityId === corrected) && count!.n === 1,
      'Retry preserves the original decision and audit timestamp.');

    process.env.ENRICH_DIR = scratch;
    await withDb(db, () => exportResearchSet());
    const readRows = async (file: string) => (await readFile(join(scratch, file), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l) as { key: string; name: string; type: string });
    const research = await readRows('research-set.jsonl'), candidates = await readRows('candidates.jsonl');
    const identity = await withDb(db, () => getEntity(corrected));
    check('ETYPE identity reads and both research exports use the locally corrected type', identity?.entityType === 'org' && research.find(x => x.key === corrected)?.type === 'org' && candidates.find(x => x.key === corrected)?.type === 'org',
      'The research-set writer and candidate writer agree with identity detail.');
    const connector = { key: connectionPersonKey(name, 'https://example.org/type-fixture'), name, source: 'https://example.org/type-fixture', entityType: 'org' as const };
    const path: Path = { lp: corrected, other: { type: 'backer', name, key: connector.key, person: connector }, kind: 'other', tier: 'C', basis: 'Invented organization relationship', source: connector.source };
    const diagnostics = connectionIdentityProblems([{ file: 'raw/fixture.json', index: 0, value: finding(corrected, name) }], [{ file: 'connections.jsonl', index: 0, value: path }], candidates.filter(c => c.type === 'org').map(c => c.name));
    const imported = await resolveConnectionPeople(db, [path], undefined, { knownOrgs: candidates.filter(c => c.type === 'org').map(c => c.name) });
    ids.push(connector.key);
    check('ETYPE corrected export and W3 accept the same organization descriptor', diagnostics.length === 0 && imported.length === 1,
      'Checker and importer agree without deleting or merging the original pursuit entity.');
    await db.query("update identity.entity set entity_type='person' where entity_id=$1", [corrected]);
    check('ETYPE source-style type refresh cannot overwrite an active local correction', await type(corrected) === 'org',
      'Database enforcement protects all translators; original source mappings remain untouched.');

    const stalePlan = planNetworkNodes({ warehouse: { people: [], ties: [], matches: [] },
      candidates: [{ key: corrected, name, type: 'person', org: null, domains: [] }],
      team: [], graph: [], direct: [], findings: [] });
    const networkResult = await db.transaction(tx => importNetworkNodes(tx, { ...stalePlan,
      nodes: stalePlan.nodes.filter(n => n.source === 'network_candidate'), edges: [] }));
    const networkMapping = await db.one<{ id: string; type: string }>(`select e.entity_id::text id,e.entity_type::text type
      from identity.source_record s join identity.entity e on e.entity_id=identity.canonical_entity_id(s.entity_id)
      where s.source='network_candidate' and s.source_id=$1`, [corrected]);
    check('ETYPE network rebuild honors local correction before the next candidate export', networkResult.nodesCreated === 0 && networkMapping?.id === corrected && networkMapping.type === 'org',
      'A stale person-typed candidate with the corrected stable ID maps to its organization instead of minting a duplicate person.');

    const reversed = await reverseEntityTypeCorrection(db, correction.correctionId, actor, 'Invented operator reversal');
    const replay = await run();
    const twice = await reverseEntityTypeCorrection(db, correction.correctionId, actor, 'Invented retry');
    const reversal = await db.one<{ reversed_by: string; reversal_reason: string; reversed_at: unknown }>('select reversed_by,reversal_reason,reversed_at from identity.entity_type_correction where correction_id=$1', [correction.correctionId]);
    check('ETYPE audited reversal restores original type and prevents automatic reapplication', reversed && !twice && await type(corrected) === 'person' && !replay.corrected.some(x => x.entityId === corrected) && reversal?.reversed_by === actor && !!reversal.reversed_at && reversal.reversal_reason === 'Invented operator reversal',
      'Reversal is idempotent and the automatic rule respects the local decision.');

    const manual = await entity('Type Fixture Manual Organization', 'org');
    const input = { entityId: manual, type: 'person' as const, by: actor, reason: 'Invented manual correction', rule: 'manual:fixture', requestKey: `fixture:${manual}:person` };
    const manualId = await correctEntityType(db, input), retry = await correctEntityType(db, input);
    const changedToPerson = await type(manual) === 'person';
    await reverseEntityTypeCorrection(db, manualId!, actor, 'Restore invented organization');
    const person = await entity('Type Fixture Manual Person');
    const otherId = await correctEntityType(db, { ...input, entityId: person, type: 'org', requestKey: `fixture:${person}:org` });
    const changedToOrg = await type(person) === 'org';
    await reverseEntityTypeCorrection(db, otherId!, actor, 'Restore invented person');
    check('ETYPE manual corrections work in both directions and use stable retry keys', manualId === retry && changedToPerson && changedToOrg && await type(manual) === 'org' && await type(person) === 'person',
      'Each reversal restores that correction’s original type.');

    for (const [label, payload] of [
      ['email', { primaryEmailAddress: 'invented@example.org' }],
      ['title', { fields: [{ name: 'Current Job Title', value: { data: 'Partner' } }] }],
      ['personal LinkedIn', { linkedinUrl: 'https://www.linkedin.com/in/invented-type-fixture' }],
    ] as const) {
      const blockedName = `Type Fixture Evidence ${label}`, blocked = await entity(blockedName);
      await entity(blockedName, 'org');
      const sourceId = `entity-type-fixture-${randomUUID()}`; sources.push(sourceId);
      await db.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values('affinity',$1,$2,'fixture')", [`person:${sourceId}`, blocked]);
      await db.query("insert into sources.raw_record(source,kind,source_id,payload_hash,payload) values('affinity','person',$1,'fixture',$2::jsonb)", [sourceId, JSON.stringify(payload)]);
      const result = await run();
      check(`ETYPE ${label} evidence blocks the automatic organization correction`, await type(blocked) === 'person' && result.ambiguous.some(x => x.entityId === blocked) && !result.corrected.some(x => x.entityId === blocked),
        'Matching a firm name cannot override source evidence that this is a person.');
    }
    const clashName = 'Type Fixture Conflicting Organizations', clash = await entity(clashName);
    await entity(clashName, 'org'); await entity(clashName, 'org');
    const clashResult = await run();
    check('ETYPE two distinct same-name organization roots are ambiguous', await type(clash) === 'person' && clashResult.ambiguous.some(x => x.entityId === clash),
      'Input order cannot choose one of two conflicting organizations.');

    const pageName = 'Type Fixture Source Page Firm', pageId = await entity(pageName);
    await entity(pageName, 'org');
    const pageFinding = finding(pageId, pageName);
    pageFinding.facts = [{ field: 'investment', value: 'Invented firm investment', confidence: 'high',
      source: { url: 'https://example.org/type-fixture-investments', title: 'Our investments', kind: 'primary' } }];
    const pageResult = await run([pageFinding]);
    check('ETYPE a source page title is not a person job title', pageResult.corrected.some(x => x.entityId === pageId) && await type(pageId) === 'org',
      'A sourced company finding remains eligible when its evidence page has ordinary title metadata.');

    const claimName = 'Type Fixture Research Role Firm', claimId = await entity(claimName);
    await entity(claimName, 'org');
    await db.query(`insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body)
      values($1,'Invented role source','fixture','https://example.org/type-fixture-role','2026-09-27','moderate','Invented test role','Invented test role')`, [documentId]);
    await db.query(`insert into research.claim(entity_id,field,value,source,as_of,confidence)
      values($1,'public.role','Partner',$2,'2026-09-27','high')`, [claimId, documentId]);
    const claimResult = await run();
    check('ETYPE a stored public.role claim blocks correction without a profile note', await type(claimId) === 'person' && claimResult.ambiguous.some(x => x.entityId === claimId && x.reason.includes('title')),
      'Namespaced research claim fields retain the same person evidence as newly imported findings.');

    const listName = 'Type Fixture Nested List Firm', listId = await entity(listName);
    await entity(listName, 'org');
    const listSourceId = `entity-type-list-${randomUUID()}`; sources.push(listSourceId);
    await db.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values('affinity',$1,$2,'fixture')", [`person:${listId}`, listId]);
    await db.query("insert into sources.raw_record(source,kind,source_id,payload_hash,payload) values('affinity','list_entry',$1,'fixture',$2::jsonb)",
      [listSourceId, JSON.stringify({ type: 'person', entity: { id: listId, jobTitle: 'Principal', emailAddresses: ['nested-fixture@example.org'] } })]);
    const listResult = await run();
    check('ETYPE nested Affinity list-entry email and camelCase job title block correction', await type(listId) === 'person' && listResult.ambiguous.some(x => x.entityId === listId && x.reason.includes('email') && x.reason.includes('title')),
      'List-entry identity evidence is linked through its nested entity ID, independently of the list-entry source ID.');

    const researchName = 'Type Fixture Research Only Firm', researchId = await entity(researchName);
    const researchFinding = finding(researchId, researchName);
    researchFinding.connections = [{ to: researchName, toType: 'org', kind: 'other', tier: 'C', scope: 'firm', basis: 'Invented sourced firm' }];
    const w3Name = 'Type Fixture W3 Only Firm', w3Id = await entity(w3Name);
    const w3Descriptor = { ...connector, key: connectionPersonKey(w3Name, connector.source), name: w3Name };
    const w3Path: Path = { ...path, lp: w3Id, other: { type: 'backer', name: w3Name, key: w3Descriptor.key, person: w3Descriptor } };
    const fromFiles = await run([researchFinding], [w3Path]);
    check('ETYPE findings and explicit W3 organization descriptors can establish the firm name', [researchId, w3Id].every(id => fromFiles.corrected.some(x => x.entityId === id)),
      'A known database organization is not required when typed research evidence names the firm.');

    const importName = 'Type Fixture Imported Firm', importId = await entity(importName);
    await entity(importName, 'org');
    const importDescriptor = { ...connector, key: connectionPersonKey(importName, connector.source), name: importName };
    ids.push(importDescriptor.key);
    const importPath: Path = { ...path, lp: importId, other: { type: 'backer', name: importName, key: importDescriptor.key, person: importDescriptor } };
    await mkdir(join(scratch, 'raw'));
    await writeFile(join(scratch, 'raw', `${importId}.json`), JSON.stringify(finding(importId, importName)));
    await writeFile(join(scratch, 'connections.jsonl'), JSON.stringify(importPath) + '\n');
    const importedCounts = await withDb(db, () => importFindings(actor, scratch));
    const recordedRun = await withDb(db, () => latestRun('enrich', 'import'));
    const saved = recordedRun?.detail as { entityTypes?: { corrected: Array<{ entityId: string }> }; paths?: number } | undefined;
    check('ETYPE Import the findings corrects types before W3 validation and persists its report',
      importedCounts.mapped === 1 && importedCounts.paths === 1 && importedCounts.skippedPaths === 0 &&
      importedCounts.entityTypes?.corrected.some(x => x.entityId === importId) === true &&
      saved?.entityTypes?.corrected.some(x => x.entityId === importId) === true && saved.paths === 1,
      'The actual import accepts the previously conflicting path and stores linked correction IDs in its run detail.');

    const aliasName = 'Type Fixture Canonical Firm', root = await entity(aliasName);
    const aliasSource = 'https://example.org/type-alias';
    const aliasId = connectionPersonKey(aliasName, aliasSource); ids.push(aliasId);
    await db.query("insert into identity.entity(entity_id,entity_type,display_name,merged_into) values($1,'person',$2,$3)", [aliasId, aliasName, root]);
    await entity(aliasName, 'org');
    await run();
    const aliasDescriptor = { key: aliasId, name: aliasName, source: aliasSource, entityType: 'org' as const };
    const aliasPath: Path = { ...path, lp: root, other: { type: 'backer', name: aliasName, key: aliasId, person: aliasDescriptor } };
    const aliasPaths = await resolveConnectionPeople(db, [aliasPath]);
    const aliasIdentity = await withDb(db, () => getEntity(aliasId));
    check('ETYPE W3 follows a corrected canonical root despite its retained person-typed alias',
      aliasPaths.length === 1 && aliasPaths[0]?.other.key === root && aliasIdentity?.entityType === 'org' && await type(aliasId) === 'person',
      'A merge redirect supplies effective identity without changing or deleting the original source alias.');
    // The review list and the token route (issue 0063): every pipeline person named like an organisation we hold,
    // with the person evidence found; an Admin's token marks one an organisation and can reverse it.
    const listedName = 'Type Fixture Listed Firm', listed = await entity(listedName), listedOrg = await entity(listedName, 'org');
    const titled = 'Type Fixture Evidence title';
    const list = await db.transaction(tx => pipelinePeopleNamedLikeOrgs(tx));
    const row = list.find(c => c.entityId === listed), titledRow = list.find(c => c.name === titled);
    check('ETYPE the review list names pipeline people sharing an organisation name, with their person evidence',
      !!row && row.evidence.length === 0 && row.organizations.includes(listedOrg) && row.pursuits === 1
        && !!titledRow && titledRow.evidence.includes('title') && !list.some(c => c.entityId === listedOrg),
      'The list is read-only, includes held-back matches, and never lists an organisation.');
    const sel = 'id::text, handle, name, initials, role, email, access::text, vehicles, approves';
    const owner = (await db.one<AppUser>(`select ${sel} from platform.app_user where access='admin' and active order by handle limit 1`))!;
    const minted = await createMcpToken(owner, { label: 'props entity type', tools: [SYNC_ADMIN], vehicles: null, callsPerDay: 100, days: 30 }, db);
    const caller = { token: minted.token, user: owner } as unknown as import('../lib/sync/auth').SyncCaller;
    const post = (body: unknown) => withDb(db, () => writeEntityType(caller, new Request('http://localhost/api/sync/entity-type', { method: 'POST', body: JSON.stringify(body) }), db));
    const bad = await post({ operation: 'correct', entityId: listed, type: 'org', requestKey: `props:${listed}` });
    const made = await post({ operation: 'correct', entityId: listed, type: 'org', reason: 'Invented: the firm, typed as a person', requestKey: `props:${listed}` });
    const again = await post({ operation: 'correct', entityId: listed, type: 'org', reason: 'Invented retry', requestKey: `props:${listed}` });
    const after = await withDb(db, () => readEntityTypes(caller, db));
    const correctionId = made.body.correctionId as string;
    const back = await post({ operation: 'reverse', correctionId, reason: 'Invented reversal' });
    check('ETYPE an Admin token corrects a record to an organisation, idempotently, and reverses it',
      bad.status === 400 && made.status === 200 && !!correctionId && again.status === 200
        && !(after.body.items as Array<{ entityId: string }>).some(c => c.entityId === listed)
        && back.status === 200 && back.body.reversed === true && await type(listed) === 'person',
      'The token route records the same local correction the app does, by its owner, with a reason.');
  } finally {
    if (previousDir === undefined) delete process.env.ENRICH_DIR; else process.env.ENRICH_DIR = previousDir;
    await rm(scratch, { recursive: true, force: true });
    await db.query('delete from identity.entity_type_correction where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.note where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.claim where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.source_doc where doc_id=$1', [documentId]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
    await db.query("delete from sources.raw_record where source='affinity' and source_id=any($1::text[])", [sources]);
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])', [ids]);
    await db.query('update identity.entity set merged_into=null where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
  }
}

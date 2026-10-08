/** Identity review uses invented fixtures and a disposable demo database only. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeImportDuplicatesInTransaction } from '../lib/enrich/import-dupes';
import { identityReviewGroupId, readIdentityDecisions, reverseIdentitySeparation, type IdentityDecisionInput } from '../lib/enrich/identity-decisions';
import { exportIdentityReview } from '../lib/enrich/identity-review-export';
import { undoIdentityMerge } from '../modules/identity/resolution';
import { correctEntityType, reverseEntityTypeCorrection } from '../modules/identity/entity-type';
import type { Check, Db } from './properties/harness';
import { identityContextProperties } from './properties/identity-context';

// Fixture labels and public URLs must not accidentally resemble phone numbers.
// Preserve the UUID prefix's entropy, but map its digits to letters g–p.
const fixtureTag = (uuid: string) => uuid.slice(0, 8).replace(/\d/g, digit => String.fromCharCode(103 + Number(digit)));

export async function identityReviewProperties(check: Check, db: Db) {
  await identityContextProperties(check, db);
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active limit 1'))!.id;
  const vehicle = (await db.one<{ id: string }>("select id::text from platform.vehicle where phase='active' and kind='fund' limit 1"))!.id;
  const ids: string[] = [], tag = fixtureTag(randomUUID());
  const scratch = await mkdtemp(join(tmpdir(), 'invented-identity-review-'));
  const document = `identity-review-fixture:${tag}`;
  const label = (suffix: string) => `Invented Identity Review ${tag} ${suffix}`;
  const entity = async (suffix: string, type = 'person', source = 'prospect_key', key?: string): Promise<string> => {
    const id = randomUUID(); ids.push(id);
    await db.query('insert into identity.entity(entity_id,entity_type,display_name) values($1,$2::identity.entity_type,$3)', [id, type, label(suffix)]);
    await db.query('insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,$4)', [source, key ?? id, id, 'rule:sourced-identity-review-fixture']);
    return id;
  };
  const pair = async (suffix: string) => [await entity(suffix), await entity(suffix)];
  const root = async (id: string) => (await db.one<{ id: string }>('select identity.canonical_entity_id($1)::text id', [id]))!.id;
  const kind = async (id: string) => (await db.one<{ type: string }>('select entity_type::text type from identity.entity where entity_id=$1', [id]))!.type;
  const run = (decisions: IdentityDecisionInput[] = []) => db.transaction(tx => mergeImportDuplicatesInTransaction(tx, actor, [], [], { decisions }));
  const exported = () => db.transaction(tx => exportIdentityReview(tx));
  const evidence = [{ source: 'https://example.org/invented-identity', as_of: '2026-09-27', quote: 'The two invented profiles identify the same real person.' }];
  const decision = (members: string[], action = 'merge', extra: Record<string, unknown> = {}): IdentityDecisionInput => ({ line: 1,
    value: { group: identityReviewGroupId(members), decision: action, members, ...(action === 'merge' ? { survivor: members[0] } : {}), evidence, decided_by: 'invented-fixture-reviewer', ...extra } });
  const snapshot = async () => JSON.stringify({
    entities: await db.query('select * from identity.entity where entity_id=any($1::uuid[]) order by entity_id', [ids]),
    assertions: await db.query('select * from identity.match_assertion order by assertion_id'),
    corrections: await db.query('select * from identity.entity_type_correction order by correction_id'),
    notes: await db.query("select * from research.note where entity_id=any($1::uuid[]) or kind='identity_review_decision' order by note_id", [ids]),
  });
  try {
    check('IDENTITY REVIEW fixture labels never contain phone-shaped random tags',
      ['78287679', 'a1234567', '1234567f', 'ffffffff'].every(prefix => /^[a-p]{8}$/.test(fixtureTag(prefix))),
      'The observed all-digit failure and seven-digit runs become alphabetic; contact redaction remains enabled.');
    const plain = await pair('Name Only');
    check('IDENTITY REVIEW group IDs are stable across ordering and distinguish membership',
      identityReviewGroupId(plain) === identityReviewGroupId([...plain].reverse()) && identityReviewGroupId(plain) !== identityReviewGroupId([plain[0]!, randomUUID()]),
      'Group identity depends on sorted entity IDs, not name, ordering or research date.');
    const beforeExport = await snapshot(), initial = await exported();
    check('IDENTITY REVIEW export is read-only and includes unresolved namesakes', beforeExport === await snapshot()
      && initial.some(g => g.group === identityReviewGroupId(plain) && g.members.length === 2 && g.reasons.length > 0),
      'Export retains all ambiguous members and refusal reasons without applying the automatic pass.');
    const auto = [await entity('Read Only Organization', 'org'), await entity('Read Only Organization', 'org')];
    await exported();
    check('IDENTITY REVIEW export does not merge automatically resolvable groups', await root(auto[0]!) === auto[0] && await root(auto[1]!) === auto[1],
      'Even a safe organization pair is unchanged by research export.');

    const privacy = [await entity('Privacy', 'person', 'affinity', `person:privacy-${tag}-a`), await entity('Privacy', 'person', 'warehouse', `person:privacy-${tag}-b`)];
    const org = await entity('Privacy Office', 'org');
    const secretEmail = 'invented.private@example.org', secretPhone = '+1 202 555 0199';
    const linkedin = `https://www.linkedin.com/in/invented-review-${tag}`;
    const numericUrl = 'https://example.org/bio/78287679';
    await db.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of) values($1,$2,'staff','Partner','fixture','2026-09-27')`, [privacy[0], org]);
    await db.query("insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source) values($1,$2,$3,'new','rule')", [privacy[0], vehicle, actor]);
    await db.query("insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body) values($1,'Invented identity source','fixture','https://example.org/invented','2026-09-27','moderate','Invented data','Invented data')", [document]);
    await db.query("insert into research.claim(entity_id,field,value,source,as_of,confidence) values($1,'title','Partner',$2,'2026-09-27','high')", [privacy[0], document]);
    await db.query("insert into research.note(entity_id,kind,body,data) values($1,'public_profile',$2,$3::jsonb)", [privacy[0], `Private ${secretEmail} ${secretPhone}`, JSON.stringify({ email: secretEmail, phone: secretPhone, title: `Partner ${secretEmail} ${secretPhone}`, identity: { links: [{ kind: 'linkedin', url: linkedin }, { kind: 'bio', url: numericUrl }, { kind: 'bio', url: `https://example.org/bio?email=${encodeURIComponent(secretEmail)}&phone=${encodeURIComponent(secretPhone)}` }, { kind: 'bio', url: `mailto:${secretEmail}` }] } })]);
    await db.query("insert into research.note(entity_id,kind,body,data) values($1,'connection_candidates','Invented path',$2::jsonb)", [privacy[0], JSON.stringify({ paths: [{ lp: privacy[0], other: { key: org, name: label('Privacy Office') } }] })]);
    const pathAlias = await entity('Path Alias');
    await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [pathAlias, privacy[0]]);
    const sharedPathKey = `invented-shared-path-${tag}`;
    for (const [index, id] of privacy.entries()) await db.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,'fixture')", [`path-fixture-${index}`, sharedPathKey, id]);
    await db.query("insert into research.note(entity_id,kind,body,data) values($1,'connection_candidates','Invented alias paths',$2::jsonb)", [pathAlias, JSON.stringify({ paths: [
      { lp: sharedPathKey, lpPerson: { key: privacy[0] }, other: { key: pathAlias, person: { key: privacy[1] } } },
      { lp: sharedPathKey, other: { key: pathAlias } },
    ] })]);
    const opaqueKeys = ['company:123456789012', 'person:123456789012', 'warehouse:123456789012:person',
      'finding-123456789012-key', '123456789012', '12345678-1234-1234-1234-123456789012'];
    for (const [index, key] of opaqueKeys.entries()) await db.query(
      "insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,'fixture')",
      [`invented-key-${index}`, key, privacy[0]]);
    await db.query("insert into research.note(entity_id,kind,body,data) values($1,'public_profile','Invented contact redaction fixture',$2::jsonb)", [privacy[0], JSON.stringify({
      title: 'Contact 2025550199 or (202) 555-0199; invented.local@123456789.example.org',
      role: 'Encoded invented%2Elocal%40example.com',
    })]);
    const emailNames = [await entity('Email Name', 'person', 'w3_person'), await entity('Email Name', 'person', 'warehouse')];
    await db.query('update identity.entity set display_name=$2 where entity_id=any($1::uuid[])',
      [emailNames, 'invented.name@example.com']);
    // Email domains (7 Oct 2026): Affinity's person record and research claims give domains; Dakota-sourced claims give none.
    await db.query(`insert into sources.raw_record(source,kind,source_id,payload_hash,payload) values('affinity','person',$1,$2,$3::jsonb)`,
      [`privacy-${tag}-a`, `invented-hash-${tag}`, JSON.stringify({ primaryEmailAddress: secretEmail, emailAddresses: [secretEmail, 'invented.other@affinity-domain.example'] })]);
    await db.query("insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body) values($1,'Invented licensed source','fixture','dakota','2026-09-27','weak','Invented data','Invented data')", [`dakota:invented-${tag}`]);
    await db.query("insert into research.claim(entity_id,field,value,source,as_of,confidence) values($1,'email','invented.licensed@licensed-domain.example',$2,'2026-09-27','low')", [privacy[1], `dakota:invented-${tag}`]);
    await db.query("insert into research.claim(entity_id,field,value,source,as_of,confidence) values($1,'public.email','invented.public@claim-domain.example',$2,'2026-09-27','medium')", [privacy[1], document]);
    const privateGroup = (await exported()).find(g => g.group === identityReviewGroupId(privacy));
    const member = privateGroup?.members.find(m => m.entityId === privacy[0]);
    const serialized = JSON.stringify(privateGroup);
    check('IDENTITY REVIEW export includes source, affiliation, title, URL, pursuit and reference context', !!member
      && member.sources.some(s => s.source === 'affinity') && member.affiliations.some(a => a.org === label('Privacy Office') && a.role === 'Partner')
      && member.titles.some(t => t.includes('Partner')) && member.personalUrls.includes(linkedin) && member.pursuits.some(p => p.status === 'new')
      && member.counts.claims === 1 && member.counts.notes >= 2 && member.counts.paths >= 1 && member.createdBy.length > 0,
      'Allowlisted context is useful for an agent without database access.');
    check('IDENTITY REVIEW excludes contact details even when embedded in URLs or text', !!privateGroup
      && !serialized.includes(secretEmail) && !serialized.includes(encodeURIComponent(secretEmail)) && !serialized.includes(secretPhone)
      && !serialized.includes(encodeURIComponent(secretPhone)) && !serialized.includes(numericUrl) && !serialized.includes('mailto:') && !serialized.includes('Private '),
      'Contact values and arbitrary note bodies never leave in the review set.');
    const otherMember = privateGroup?.members.find(m => m.entityId === privacy[1]);
    check('IDENTITY REVIEW gives email domains from Affinity\'s person record and research claims, never a local part or a Dakota-sourced address',
      JSON.stringify(member?.emailDomains) === JSON.stringify(['affinity-domain.example', 'example.org'])
      && JSON.stringify(otherMember?.emailDomains) === JSON.stringify(['claim-domain.example'])
      && !serialized.includes('licensed-domain') && !serialized.includes('invented.other') && !serialized.includes('invented.public'),
      `${JSON.stringify(member?.emailDomains)} / ${JSON.stringify(otherMember?.emailDomains)}`);
    check('IDENTITY REVIEW preserves long numeric source identifiers in every key format',
      opaqueKeys.every(key => member?.sources.some(source => source.externalId === key)),
      'Affinity company/person IDs, warehouse keys, finding keys, numeric IDs and UUIDs remain exact.');
    check('IDENTITY REVIEW redacts free-text phones and only email local-parts',
      member?.titles.includes('Contact [contact omitted] or [contact omitted]; …@123456789.example.org') === true
      && member.titles.includes('Encoded …@example.com')
      && !serialized.includes('invented.local') && !serialized.includes('2025550199'),
      'Numeric email domains survive, encoded local-parts are removed, and plain/formatted phones stay private.');
    const emailNameGroup = (await exported()).find(g => g.group === identityReviewGroupId(emailNames));
    check('IDENTITY REVIEW retains domains for name-only W3 and warehouse members',
      emailNameGroup?.members.length === 2 && emailNameGroup.members.every(m => m.displayName === '…@example.com'),
      'The domain remains identity context even without affiliations or a profile.');

    check('IDENTITY REVIEW counts each path once per root across aliases and colliding source keys',
      member?.counts.paths === 3 && privateGroup?.members.find(m => m.entityId === privacy[1])?.counts.paths === 2,
      'Repeated endpoint references and note ownership do not double-count; a source key shared by two roots counts for both.');

    await writeFile(join(scratch, 'identity-decisions.jsonl'), `${JSON.stringify(decision(plain).value)}\n{broken\n\n${JSON.stringify({ group: 'unknown', decision: 'separate', evidence: [], decided_by: 'fixture' })}\n`);
    const parsed = await readIdentityDecisions(scratch);
    check('IDENTITY REVIEW malformed JSON is isolated with physical line numbers', parsed.length === 3 && parsed[0]?.line === 1 && parsed[1]?.line === 2 && !!parsed[1]?.error && parsed[2]?.line === 4,
      'A malformed line is reported while subsequent decisions remain available.');
    const noEvidence = await run([decision(plain, 'merge', { evidence: [] }), { line: 2, error: 'Malformed JSON on line 2' }]);
    check('IDENTITY REVIEW empty evidence and malformed lines are refused without redirects', noEvidence.decisions!.applied === 0 && noEvidence.decisions!.refused.length === 2 && await root(plain[0]!) !== await root(plain[1]!),
      'Every decision requires evidence and each invalid line remains visible.');
    const invalidEvidence = await run([decision(plain, 'merge', { evidence: [{ source: '', as_of: 'not-a-date', quote: ' ' }] })]);
    check('IDENTITY REVIEW evidence needs a source, valid date and substantive quotation', invalidEvidence.decisions!.applied === 0 && invalidEvidence.decisions!.refused.length === 1,
      'An object with empty evidence fields does not satisfy the evidence guard.');
    const invalidKinds = await run([decision(plain, 'merge', { decision: ['merge'] }),
      { ...decision(plain, 'retype', { newType: ['org'] }), line: 2 }]);
    check('IDENTITY REVIEW enum fields require strings, never coerced arrays', invalidKinds.decisions!.applied === 0
      && invalidKinds.decisions!.refused.length === 2 && await root(plain[0]!) !== await root(plain[1]!)
      && await kind(plain[0]!) === 'person', 'Malformed JSON shapes cannot become a separation or type correction.');
    const valid = decision(plain), merged = await run([valid]);
    const merge = merged.merges.find(m => m.loserId === plain[1]);
    check('IDENTITY REVIEW evidenced decision merges through reversible canonical redirects', merged.decisions!.applied === 1 && !!merge && await root(plain[1]!) === plain[0],
      'Original entity and source records remain intact.');
    const beforeRetry = await snapshot(), retry = await run([valid]);
    check('IDENTITY REVIEW exact decision retries are idempotent', retry.decisions!.applied === 0 && retry.decisions!.skipped === 1 && beforeRetry === await snapshot(),
      'No additional assertions, corrections or changed timestamps on retry.');
    if (!merge) throw new Error('Expected invented review merge');
    const undone = await undoIdentityMerge(db, merge.assertionId, 'Invented identity review reversal');
    const replay = await run([valid]);
    check('IDENTITY REVIEW undo restores identities and the same decision cannot reapply', undone && await root(plain[1]!) === plain[1] && replay.decisions!.applied === 0,
      'An unchanged decisions file cannot silently override an operator reversal.');

    // Add the conflicting upstream key after exercising unresolved-group export privacy.
    await db.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values('affinity',$1,$2,'rule:fixture')", [`person:privacy-${tag}-b`, privacy[1]]);
    const conflict = await run([decision(privacy)]);
    check('IDENTITY REVIEW generic evidence cannot bypass same-source distinct IDs', conflict.decisions!.applied === 0 && conflict.decisions!.refused.length === 1 && await root(privacy[0]!) !== await root(privacy[1]!),
      'A name match or vague same-person assertion does not establish that two external records are duplicates.');
    const markerOnly = await run([decision(privacy, 'merge', { evidence: [{ ...evidence[0], quote: `Same real person: affinity:person:privacy-${tag}-a = affinity:person:privacy-${tag}-b` }] })]);
    check('IDENTITY REVIEW a bare duplicate marker is not supporting evidence', markerOnly.decisions!.applied === 0 && markerOnly.decisions!.refused.length === 1 && await root(privacy[0]!) !== await root(privacy[1]!),
      'An explicit pair attestation still needs supporting quoted context from the cited source.');
    const explicit = decision(privacy, 'merge', { evidence: [{ ...evidence[0], quote: `Both records link to the same named biography and dated role.\nSame real person: affinity:person:privacy-${tag}-a = affinity:person:privacy-${tag}-b` }] });
    const refused = await run([explicit]);
    check('IDENTITY REVIEW cited duplicate assertions cannot override a recorded different decision', refused.decisions!.applied === 0
      && refused.decisions!.refused.length === 1 && await root(privacy[1]!) !== await root(privacy[0]!),
      'Requested deterministic different-ID rule is a hard constraint, including against the legacy attestation exception.');

    const aliasA = await entity('Alias Conflict', 'person', 'affinity', `person:alias-${tag}-a`), aliasB = await entity('Alias Conflict');
    const inherited = await entity('Inherited Source', 'person', 'affinity', `person:alias-${tag}-b`);
    await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [inherited, aliasB]);
    const aliasRefusal = await run([decision([aliasA, aliasB])]);
    check('IDENTITY REVIEW source conflict guard inspects all aliases in a component', aliasRefusal.decisions!.refused.length === 1 && await root(aliasA) !== await root(aliasB),
      'A source ID attached to an alias cannot be hidden behind a source-free survivor.');

    const separated = await pair('Separate'), separateInput = decision(separated, 'separate');
    const separate = await run([separateInput]), assertion = separate.decisions!.separations.find(s => s.group === identityReviewGroupId(separated));
    const remaining = await run(), review = await exported();
    check('IDENTITY REVIEW separate assertion suppresses the group on later passes and export', separate.decisions!.applied === 1 && !!assertion
      && !remaining.ambiguous.some(g => g.entityIds.includes(separated[0]!)) && !review.some(g => g.group === identityReviewGroupId(separated))
      && await root(separated[0]!) !== await root(separated[1]!), 'A resolved namesake does not keep returning as ambiguous.');
    const separateBefore = await snapshot(), separateRetry = await run([separateInput]);
    check('IDENTITY REVIEW separation retries do not add assertions', separateRetry.decisions!.applied === 0 && separateRetry.decisions!.skipped === 1 && separateBefore === await snapshot(),
      'One evidenced separation remains one durable decision.');
    if (!assertion) throw new Error('Expected invented separation assertion');
    const reversed = await reverseIdentitySeparation(db, assertion.assertionId, actor, 'Invented separation reversal');
    const reversedRows = await exported();
    const separateReplay = await run([separateInput]);
    check('IDENTITY REVIEW separation undo restores review without replaying the old decision', !!reversed && reversedRows.some(g => g.group === identityReviewGroupId(separated)) && separateReplay.decisions!.applied === 0,
      'Reopening a namesake decision restores review while preserving its history.');

    const typed = await pair('Retype'), typedInput = decision(typed, 'retype', { members: [typed[0]], newType: 'org' });
    const retyped = await run([typedInput]);
    const correction = await db.one<{ id: string }>('select correction_id::text id from identity.entity_type_correction where entity_id=$1 and reversed_at is null', [typed[0]]);
    check('IDENTITY REVIEW retype uses the existing journal and changes only specified members', retyped.decisions!.applied === 1 && !!correction && await kind(typed[0]!) === 'org' && await kind(typed[1]!) === 'person',
      'A type decision is independent of merging a namesake.');
    if (!correction) throw new Error('Expected invented type correction');
    await reverseEntityTypeCorrection(db, correction.id, actor, 'Invented type review reversal');
    const typeReplay = await run([typedInput]);
    check('IDENTITY REVIEW retype reversal restores type and prevents replay', await kind(typed[0]!) === 'person' && typeReplay.decisions!.applied === 0,
      '0063 correction reversal remains authoritative over an unchanged research decision.');

    const allPairs = [await entity('Three Source Records', 'person', 'affinity', `person:three-${tag}-a`), await entity('Three Source Records', 'person', 'affinity', `person:three-${tag}-b`), await entity('Three Source Records', 'person', 'affinity', `person:three-${tag}-c`)];
    const insufficient = await run([decision(allPairs, 'merge', { evidence: [{ ...evidence[0], quote: `Both records link to the same named biography and dated role.\nSame real person: affinity:person:three-${tag}-a = affinity:person:three-${tag}-b` }] })]);
    check('IDENTITY REVIEW each conflicting source pair needs explicit evidence', insufficient.decisions!.applied === 0 && insufficient.decisions!.refused.length === 1
      && (await Promise.all(allPairs.map(root))).every((id, i) => id === allPairs[i]),
      'Evidence for two records never licenses silently absorbing a third upstream identity.');

    const mixedBatch = await pair('Valid Neighbor');
    const neighbors = await run([{ line: 4, error: 'Malformed JSON' }, { ...decision(mixedBatch), line: 5 }]);
    check('IDENTITY REVIEW refused lines do not prevent independent valid decisions', neighbors.decisions!.applied === 1 && neighbors.decisions!.refused.some(r => r.line === 4)
      && await root(mixedBatch[1]!) === mixedBatch[0], 'A malformed record is isolated while a valid following record applies.');

    const rollback = await pair('Atomic Type Correction');
    const ordered = [...rollback].sort();
    await db.query("update identity.entity set entity_type='org' where entity_id=$1", [ordered[1]]);
    await correctEntityType(db, { entityId: ordered[1]!, type: 'person', by: actor, reason: 'Invented preexisting correction', rule: 'manual:fixture', requestKey: `identity-review-atomic:${tag}` });
    const beforeRollback = await snapshot();
    const rolledBack = await run([decision(rollback, 'retype', { newType: 'org' })]);
    check('IDENTITY REVIEW a later member failure rolls back earlier type changes in that decision', rolledBack.decisions!.applied === 0 && rolledBack.decisions!.refused.length === 1
      && rolledBack.corrected.every(c => !rollback.includes(c.entityId)) && beforeRollback === await snapshot(),
      'The first correction is rolled back when the second member already has an active local correction.');

    const sequential = await pair('Retype Then Merge');
    const retype = decision(sequential, 'retype', { newType: 'org' });
    const firstRetype = await run([retype]);
    await exported();
    const appendOnly = [retype, { ...decision(sequential), line: 2 }];
    const afterRetype = await run(appendOnly);
    check('IDENTITY REVIEW applied retype does not conflict with a later merge', firstRetype.decisions!.applied === 1
      && afterRetype.decisions!.applied === 1 && afterRetype.decisions!.skipped === 1
      && afterRetype.decisions!.refused.length === 0 && await root(sequential[1]!) === sequential[0],
      'The append-only history keeps the applied retype while the fresh export permits the merge.');
    const sequentialRetry = await run(appendOnly);
    check('IDENTITY REVIEW applied history remains idempotent after retype then merge', sequentialRetry.decisions!.skipped === 2
      && sequentialRetry.decisions!.applied === 0 && sequentialRetry.decisions!.refused.length === 0,
      'Both receipts remain consumed after the group disappears from the export.');

    const growing = await pair('Growing Group');
    const olderMerge = decision(growing);
    const expanded = [...growing, await entity('Growing Group')];
    const growingHistory = [olderMerge, { ...decision(expanded), line: 2 }];
    const grown = await run(growingHistory);
    check('IDENTITY REVIEW older unapplied merge is superseded by an expanded group', grown.decisions!.applied === 1
      && grown.decisions!.refused.length === 0 && grown.decisions!.superseded.length === 1
      && grown.decisions!.superseded[0]!.line === 1 && grown.decisions!.superseded[0]!.byLine === 2
      && await root(expanded[2]!) === growing[0],
      'The old full member set is contained in the later proposal; it is superseded, not refused.');
    const grownRetry = await run(growingHistory);
    check('IDENTITY REVIEW superseded history remains superseded on retry', grownRetry.decisions!.skipped === 1
      && grownRetry.decisions!.superseded.length === 1 && grownRetry.decisions!.refused.length === 0,
      'Explicit full-group hashes preserve supersession after the newer merge has applied.');

    const conflicting = await pair('Conflicting Proposals');
    const beforeConflict = await snapshot();
    const conflicts = await run([decision(conflicting, 'merge'), { ...decision(conflicting, 'separate'), line: 2 }]);
    check('IDENTITY REVIEW conflicting proposals for one group are all refused without order dependence', conflicts.decisions!.applied === 0
      && conflicts.decisions!.superseded.length === 0 && conflicts.decisions!.skipped === 0
      && conflicts.decisions!.refused.length === 2 && conflicts.decisions!.refused.every(r => r.reason.includes('Conflicting')) && beforeConflict === await snapshot(),
      'A merge and a separation for the same group cannot silently race by file order.');

    // Issue 0138: the import's own different-external-ID separation is cleared by a full attestation; a person's is not.
    const trio = async (suffix: string) => [await entity(suffix, 'org', 'affinity', `org:${suffix.toLowerCase()}-${tag}-a`),
      await entity(suffix, 'org', 'affinity', `org:${suffix.toLowerCase()}-${tag}-b`), await entity(suffix, 'org')];
    const attest = (suffix: string) => ({ evidence: [{ ...evidence[0], quote: `Both company records give the same website and founding year.\nSame real organization: affinity:org:${suffix.toLowerCase()}-${tag}-a = affinity:org:${suffix.toLowerCase()}-${tag}-b` }] });
    const accel = await trio('Accel');
    const autoPass = await run();
    const autoGroup = autoPass.ambiguous.find(g => g.entityIds.includes(accel[0]!));
    const autoSeparation = await db.one<{ id: string }>(`select assertion_id::text id from identity.match_assertion where kind='not_same_as'
      and rule='identity:v1:different_external_id' and undone_at is null and merged_entity=any($1::uuid[]) and canonical_entity=any($1::uuid[])`, [accel]);
    const autoMerge = autoGroup ? await run([decision(autoGroup.entityIds, 'merge', { survivor: accel[0], ...attest('Accel') })]) : null;
    const cleared = autoSeparation ? await db.one<{ undone: boolean; reason: string | null }>('select undone_at is not null undone, undo_reason reason from identity.match_assertion where assertion_id=$1', [autoSeparation.id]) : null;
    const roots = await Promise.all(accel.map(root));
    check('IDENTITY REVIEW an attested merge clears the import\'s own different-ID separation and records why (0138)',
      !!autoGroup && !!autoSeparation && autoMerge?.decisions!.applied === 1 && roots.every(r => r === accel[0]) && !!cleared?.undone && /0138/.test(cleared.reason ?? ''),
      `group ${autoGroup?.entityIds.length ?? 0} members; separation ${autoSeparation ? 'found' : 'missing'}; applied ${autoMerge?.decisions!.applied}; refused ${JSON.stringify(autoMerge?.decisions!.refused)}; cleared ${cleared?.undone}`);
    const manual = await trio('Manual');
    await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
      values('not_same_as','affinity',$1,'affinity',$2,$3,$4,'manual:fixture','{}'::jsonb,'Invented reviewer: different firms')`,
      [`org:manual-${tag}-a`, `org:manual-${tag}-b`, manual[0], manual[1]]);
    const manualGroup = (await run()).ambiguous.find(g => g.entityIds.includes(manual[2]!));
    const manualMerge = manualGroup ? await run([decision(manualGroup.entityIds, 'merge', { survivor: manualGroup.entityIds.includes(manual[0]!) ? manual[0] : manual[2], ...attest('Manual') })]) : null;
    check('IDENTITY REVIEW an attestation never clears a separation a person recorded',
      (!manualGroup || (manualMerge?.decisions!.applied === 0 && manualMerge.decisions!.refused.length === 1)) && await root(manual[0]!) !== await root(manual[1]!),
      `group ${manualGroup?.entityIds.length ?? 'none'}; refused ${JSON.stringify(manualMerge?.decisions!.refused)}`);

    // Issue 0138: two records the import keeps apart by their different keys form no review group; a merge naming them,
    // with no group hash, applies on a full attestation and clears only that deterministic separation.
    const keyed = async (suffix: string) => [await entity(suffix, 'org', 'warehouse', `org:${suffix.toLowerCase()}-${tag}-a`), await entity(suffix, 'org', 'warehouse', `org:${suffix.toLowerCase()}-${tag}-b`)];
    const attestKeyed = (suffix: string) => ({ evidence: [{ ...evidence[0], quote: `Both company records give the same website and founding year.\nSame real organization: warehouse:org:${suffix.toLowerCase()}-${tag}-a = warehouse:org:${suffix.toLowerCase()}-${tag}-b` }] });
    const groupless = (members: string[], extra: Record<string, unknown> = {}): IdentityDecisionInput => {
      const input = decision(members, 'merge', extra), { group: _, ...value } = input.value as Record<string, unknown>;
      return { ...input, value };
    };
    const lone = await keyed('PairOnly');
    const lonePass = await run();
    const loneSeparation = await db.one<{ id: string }>(`select assertion_id::text id from identity.match_assertion where kind='not_same_as'
      and rule='identity:v1:different_external_id' and undone_at is null and merged_entity=any($1::uuid[]) and canonical_entity=any($1::uuid[])`, [lone]);
    const unattested = await run([groupless(lone)]);
    const loneMerge = await run([groupless(lone, attestKeyed('PairOnly'))]);
    const loneCleared = loneSeparation ? await db.one<{ undone: boolean }>('select undone_at is not null undone from identity.match_assertion where assertion_id=$1', [loneSeparation.id]) : null;
    check('IDENTITY REVIEW a merge naming two records with no group hash applies on a full attestation and clears the import\'s separation (0138)',
      !lonePass.ambiguous.some(g => g.entityIds.includes(lone[0]!)) && !!loneSeparation && unattested.decisions!.applied === 0 && unattested.decisions!.refused.length === 1
        && loneMerge.decisions!.applied === 1 && await root(lone[1]!) === lone[0] && !!loneCleared?.undone,
      `separation ${loneSeparation ? 'found' : 'missing'}; unattested refused ${unattested.decisions!.refused.length}; applied ${loneMerge.decisions!.applied}; refused ${JSON.stringify(loneMerge.decisions!.refused)}`);
    const keptApart = await keyed('PairKept');
    await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
      values('not_same_as','warehouse',$1,'warehouse',$2,$3,$4,'manual:fixture','{}'::jsonb,'Invented reviewer: different firms')`,
      [`org:pairkept-${tag}-a`, `org:pairkept-${tag}-b`, keptApart[0], keptApart[1]]);
    const keptMerge = await run([groupless(keptApart, attestKeyed('PairKept'))]);
    const notMerge = await run([groupless(keptApart, { decision: 'separate' })]);
    check('IDENTITY REVIEW a group-less merge still refuses a separation a person recorded, and only a merge may leave out the group',
      keptMerge.decisions!.applied === 0 && keptMerge.decisions!.refused.length === 1 && await root(keptApart[1]!) === keptApart[1]
        && notMerge.decisions!.applied === 0 && notMerge.decisions!.refused.length === 1,
      `merge refused ${JSON.stringify(keptMerge.decisions!.refused)}; separate refused ${notMerge.decisions!.refused.length}`);

    // Issue 0138: a retype and a merge for one group, in one file, both apply (they were refused as conflicting).
    const mixed = [await entity('Mixed', 'person', 'warehouse', `mixed-${tag}-w`), await entity('Mixed', 'org', 'affinity', `org:mixed-${tag}-a`), await entity('Mixed', 'org', 'affinity', `org:mixed-${tag}-b`)];
    const mixedGroup = (await run()).ambiguous.find(g => g.entityIds.includes(mixed[1]!));
    const both = mixedGroup ? await run([
      { line: 1, value: { group: identityReviewGroupId(mixedGroup.entityIds), decision: 'retype', members: [mixed[0]], newType: 'org', evidence, decided_by: 'invented-fixture-reviewer' } },
      { line: 2, value: { group: identityReviewGroupId(mixedGroup.entityIds), decision: 'merge', members: [mixed[1], mixed[2]], survivor: mixed[1], ...attest('Mixed'), decided_by: 'invented-fixture-reviewer' } },
    ]) : null;
    check('IDENTITY REVIEW a retype and a merge for one group in one file both apply, in order (0138)',
      !!mixedGroup && both?.decisions!.applied === 2 && both.decisions!.refused.length === 0 && await kind(mixed[0]!) === 'org' && await root(mixed[2]!) === mixed[1],
      `group ${mixedGroup?.entityIds.length ?? 'none'}; applied ${both?.decisions!.applied}; refused ${JSON.stringify(both?.decisions!.refused)}`);

    // Issue 0138: the same merge pushed twice with other evidence applies once; the copy is superseded, not a conflict.
    const twice = await pair('Pushed Twice');
    const copies = await run([decision(twice), { ...decision(twice, 'merge', { decided_by: 'second-invented-reviewer' }), line: 2 }]);
    const copiesAgain = await run([decision(twice), { ...decision(twice, 'merge', { decided_by: 'second-invented-reviewer' }), line: 2 }]);
    check('IDENTITY REVIEW the same decision pushed twice applies once and the copy is superseded (0138)',
      copies.decisions!.applied === 1 && copies.decisions!.refused.length === 0 && copies.decisions!.superseded.some(x => x.line === 2 && x.byLine === 1)
        && await root(twice[1]!) === twice[0] && copiesAgain.decisions!.applied === 0 && copiesAgain.decisions!.refused.length === 0,
      `first run ${JSON.stringify(copies.decisions)}; second run applied ${copiesAgain.decisions!.applied}, refused ${copiesAgain.decisions!.refused.length}`);

    const stale = await pair('Stale'), outsider = await entity('Unrelated');
    const beforeInvalid = await snapshot();
    const invalidInputs = [decision(stale, 'merge', { survivor: outsider }), decision(stale, 'merge', { members: [...stale, outsider] }), decision(stale, 'merge', { group: identityReviewGroupId([...stale, randomUUID()]) })];
    const invalid = [];
    for (const input of invalidInputs) invalid.push(await run([input]));
    check('IDENTITY REVIEW invalid survivors, out-of-group members and stale hashes are atomic refusals', invalid.every(r => r.decisions!.applied === 0 && r.decisions!.refused.length === 1) && beforeInvalid === await snapshot(),
      'No partially applied correction, merge or assertion survives invalid membership.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await db.query("delete from research.note where kind='identity_review_decision' and exists(select 1 from jsonb_array_elements_text(data->'decision'->'members') m(id) where m.id=any($1::text[]))", [ids]);
    await db.query('delete from research.note where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.claim where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from research.source_doc where doc_id=any($1::text[])', [[document, `dakota:invented-${tag}`]]);
    await db.query("delete from sources.raw_record where source='affinity' and kind='person' and source_id=$1", [`privacy-${tag}-a`]);
    await db.query('delete from identity.affiliation where person_entity=any($1::uuid[]) or org_entity=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity_type_correction where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.match_assertion where merged_entity=any($1::uuid[]) or canonical_entity=any($1::uuid[]) or left_source_id=any($1::text[]) or right_source_id=any($1::text[])', [ids]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])', [ids]);
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
    await db.query('update identity.entity set merged_into=null where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
  }
}

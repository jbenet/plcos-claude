/** Entirely invented prospects; uses only the harness's demo database. */
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Check, Db } from './properties/harness';
import { withDb } from '../lib/db';
import { addProspects, readProspectFiles, prospectPersonKey, type Prospect, type ProspectFile } from '../lib/enrich/prospects';

export async function prospectsProperties(check: Check, db: Db) {
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const vehicle = (await db.one<{ id: string; slug: string }>("select id::text, slug from platform.vehicle where phase <> 'historical' order by slug limit 1"))!;
  const inventedIds: string[] = [];
  const initialIds = new Set((await db.query<{ id: string }>('select entity_id::text id from identity.entity')).map(r => r.id));
  const makePerson = async (name: string, type = 'person'): Promise<string> => {
    const id = randomUUID();
    await db.query('insert into identity.entity (entity_id, entity_type, display_name) values ($1, $2::identity.entity_type, $3)', [id, type, name]);
    inventedIds.push(id);
    return id;
  };
  const alias = async (source: string, key: string, id: string) => {
    await db.query("insert into identity.source_record (source, source_id, entity_id, resolved_by) values ($1,$2,$3,'invented:prospects-properties')", [source, key, id]);
  };
  const prospect = (personKey: string | null, name: string, extra: Partial<Prospect> = {}): Prospect => ({
    personKey, name, org: 'Invented Prospect Office', vehicle: vehicle.slug, status: 'new',
    capacity: { band: '$500K–$1M', basis: 'Invented fixture estimate.', guess: true },
    reason: 'An invented allocator whose interests match this vehicle.', strategic: false,
    route: { best: 'Invented colleague', score: 0.7 }, sources: ['https://example.org/invented-prospect'], ...extra,
  });
  const files = (...rows: unknown[]): ProspectFile[] => [{ file: 'invented-prospects.jsonl', text: rows.map(row => JSON.stringify(row)).join('\n') + '\n' }];
  const n = async (sql: string, params: unknown[] = []) => Number((await db.one<{ n: string }>(sql, params))!.n);
  const snapshot = async () => JSON.stringify(await db.query(`select
    (select count(*) from strategy.pursuit)::text pursuits,
    (select count(*) from research.note)::text notes,
    (select count(*) from strategy.ladder_event)::text rungs,
    (select count(*) from identity.entity)::text entities,
    (select count(*) from identity.source_record)::text sources,
    (select count(*) from identity.affiliation)::text affiliations`));
  const ladderBefore = await n('select count(*)::text n from strategy.ladder_event');

  const direct = await makePerson('Invented Prospect Alder');
  // A namesake exists, but an explicit entity key still identifies the correct person.
  await makePerson('Invented Prospect Alder');
  const warehouse = await makePerson('Invented Prospect Birch');
  const w3 = await makePerson('Invented Prospect Cedar');
  await alias('warehouse', 'invented-prospect:warehouse', warehouse);
  await alias('w3_person', 'invented-prospect:w3', w3);
  const inputs = files(prospect(direct, 'Invented Prospect Alder'),
    prospect('invented-prospect:warehouse', 'Invented Prospect Birch', { status: 'sourcing' }),
    prospect('invented-prospect:w3', 'Invented Prospect Cedar', { strategic: true, route: null }));
  const first = await addProspects(db, actor, inputs);
  const second = await addProspects(db, actor, inputs);
  const matchedAliases = await db.query<{ key: string; id: string }>(
    `select source_id key, entity_id::text id from identity.source_record
      where source = 'prospect_key' and source_id = any($1::text[])`, [[direct, 'invented-prospect:warehouse', 'invented-prospect:w3']]);
  check('PROSPECT-KEYS matched people record each supplied personKey exactly once on retry',
    matchedAliases.length === 3 && matchedAliases.some(r => r.key === direct && r.id === direct)
    && matchedAliases.some(r => r.key === 'invented-prospect:warehouse' && r.id === warehouse)
    && matchedAliases.some(r => r.key === 'invented-prospect:w3' && r.id === w3),
    'Direct, warehouse and W3 matches all have stable prospect_key aliases.');
  const notes = await db.query<{ body: string; kind: string; data: Record<string, unknown> }>(
    "select body, kind, data from research.note where entity_id = any($1::uuid[]) and kind <> 'identity_creation'", [[direct, warehouse, w3]]);
  check('PROSPECTS keyed entity, warehouse and W3 imports create once, with traceable capacity notes',
    first.added === 3 && first.existing === 0 && first.ambiguous === 0 && second.added === 0 && second.existing === 3 && notes.length === 3
    && notes.every(note => note.kind === 'context' && !/Added by rule|instruction/.test(note.body) && note.data.rule === 'juan-prospects-2026-09-26'
      && note.body.includes('Capacity $500K–$1M (guess)') && typeof note.data.inputHash === 'string' && !!note.data.pursuitId),
    `First added ${first.added}; repeated added ${second.added}, existing ${second.existing}; ${notes.length} context notes.`);

  const raceId = await makePerson('Invented Prospect Concurrent');
  const raceFile = files(prospect(raceId, 'Invented Prospect Concurrent'));
  const raced = await Promise.all([addProspects(db, actor, raceFile), addProspects(db, actor, raceFile)]);
  check('PROSPECTS concurrent imports create exactly one pursuit and one note',
    raced.reduce((sum, r) => sum + r.added, 0) === 1 && raced.reduce((sum, r) => sum + r.existing, 0) === 1
    && await n("select count(*)::text n from research.note where entity_id = $1 and kind <> 'identity_creation'", [raceId]) === 1,
    `Two calls added ${raced.map(r => r.added).join('/')}, skipped existing ${raced.map(r => r.existing).join('/')}.`);

  const oldId = await makePerson('Invented Prospect Existing');
  const existing = (await db.one<{ id: string }>(`insert into strategy.pursuit
    (entity_id, vehicle_id, owner_id, status, passed_by, status_reason, headline, plan, closed_at, close_reason, next_step, source)
    values ($1,$2,$3,'passed','them','Invented decline','Keep this headline','[{"what":"Keep this plan"}]',
      '2026-09-20','Keep this close reason','Keep this next step','us') returning pursuit_id::text id`, [oldId, vehicle.id, actor]))!.id;
  await db.query("insert into research.note (entity_id, author_id, kind, body) values ($1,$2,'context','Keep existing note')", [oldId, actor]);
  const beforeRow = JSON.stringify(await db.query('select * from strategy.pursuit where pursuit_id = $1', [existing]));
  const beforeNotes = JSON.stringify(await db.query("select * from research.note where entity_id = $1 and kind <> 'identity_creation' order by note_id", [oldId]));
  const oldResult = await addProspects(db, actor, files(prospect(oldId, 'Invented Prospect Existing', { status: 'sourcing' })));
  check('PROSPECTS existing closed/passed pursuits and their notes remain byte-for-byte unchanged',
    oldResult.kept === 1 && oldResult.added === 0
    && beforeRow === JSON.stringify(await db.query('select * from strategy.pursuit where pursuit_id = $1', [existing]))
    && beforeNotes === JSON.stringify(await db.query("select * from research.note where entity_id = $1 and kind <> 'identity_creation' order by note_id", [oldId])),
    `Person-set kept ${oldResult.kept}; whole pursuit row and all notes compared.`);

  const conflictA = await makePerson('Invented Prospect Namesake');
  const conflictB = await makePerson('Invented Prospect Namesake');
  await alias('warehouse', 'invented-prospect:conflict', conflictA);
  await alias('w3_person', 'invented-prospect:conflict', conflictB);
  const wrongType = await makePerson('Invented Prospect Organization', 'org');
  const merged = await makePerson('Invented Prospect Merged');
  await db.query('update identity.entity set merged_into = $2 where entity_id = $1', [merged, direct]);
  const retired = await makePerson('Invented Prospect Retired');
  await db.query('update identity.entity set retired_at = now() where entity_id = $1', [retired]);
  const ambiguousBefore = await snapshot();
  const ambiguous = await addProspects(db, actor, files(
    prospect('invented-prospect:conflict', 'Invented Prospect Namesake'),
    prospect(direct, 'Invented Wrong Name'),
    prospect(wrongType, 'Invented Prospect Organization'),
    prospect(merged, 'Invented Prospect Merged'),
    prospect(retired, 'Invented Prospect Retired')));
  check('PROSPECTS conflicting aliases, wrong explicit names/types and inactive entities are listed and skipped',
    ambiguous.ambiguous === 5 && ambiguous.skipped.length === 5 && ambiguous.added === 0 && ambiguousBefore === await snapshot(),
    `${ambiguous.ambiguous} ambiguous records listed; no pursuits, notes, identities or rungs added.`);
  check('PROSPECTS identity conflicts list database candidate IDs and names for row repair',
    ambiguous.skipped[0]!.reason.includes(conflictA) && ambiguous.skipped[0]!.reason.includes(conflictB)
    && ambiguous.skipped[0]!.reason.includes('Invented Prospect Namesake') && ambiguous.skipped[0]!.reason.includes('entityId'),
    'Both candidates in the conflicting source mapping are shown with their database names.');
  const pinned = await addProspects(db, actor, files(
    prospect('invented-prospect:conflict', 'Stale supplied name', { entityId: conflictA }),
    prospect(merged, 'Stale merged name', { entityId: merged }),
    prospect(wrongType, 'Invented Prospect Organization', { entityId: wrongType, entityType: 'org' })));
  check('PROSPECTS entityId pins resolve conflicting keys, canonical redirects and explicitly typed organizations',
    pinned.added === 2 && pinned.existing === 1 && pinned.ambiguous === 0
    && await n('select count(*)::text n from strategy.pursuit where entity_id=$1', [conflictB]) === 0
    && await n('select count(*)::text n from strategy.pursuit where entity_id=$1', [wrongType]) === 1,
    'Explicit pins pick one known canonical entity; org requires entityType org.');
  const pinBefore = await snapshot();
  const invalidPins = await addProspects(db, actor, files(
    prospect(direct, 'Invented Prospect Alder', { entityId: 'not-a-uuid' }),
    prospect(direct, 'Invented Prospect Alder', { entityId: randomUUID() }),
    prospect(wrongType, 'Invented Prospect Organization', { entityId: wrongType }),
    prospect(direct, 'Invented Prospect Alder', { entityId: direct, entityType: 'org' }),
    prospect(retired, 'Invented Prospect Retired', { entityId: retired })));
  check('PROSPECTS malformed, absent, retired and wrong-type entityId pins skip without creating fallback identities',
    invalidPins.ambiguous === 5 && invalidPins.skipped.every(r => r.reason.includes('entityId')) && pinBefore === await snapshot(),
    'Every rejected pin has a reason; no fallback alias, person, pursuit or note is written.');
  const redirectedSource = await makePerson('Invented Consolidated Prospect');
  const redirectedTarget = await makePerson('Invented Consolidated Prospect');
  const redirectedRow = prospect(redirectedSource, 'Invented Consolidated Prospect', { org: null });
  await addProspects(db, actor, files(redirectedRow));
  const survivor = (await db.one<{ id: string }>('select pursuit_id::text id from strategy.pursuit where entity_id=$1', [redirectedSource]))!.id;
  const loser = (await db.one<{ id: string }>(`insert into strategy.pursuit
    (entity_id,vehicle_id,owner_id,status,status_source,merged_into)
    values ($1,$2,$3,'new','rule',$4) returning pursuit_id::text id`, [redirectedTarget, vehicle.id, actor, survivor]))!.id;
  await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [redirectedSource, redirectedTarget]);
  const consolidated = await addProspects(db, actor, files({ ...redirectedRow, status: 'sourcing' }));
  check('PROSPECTS canonical identity resolves exactly one active pursuit despite retained merged losers',
    consolidated.moved === 1 && consolidated.added === 0 && consolidated.ambiguous === 0,
    'A source identity redirect selects the active survivor and ignores the retained pursuit redirect.');
  await db.query("update strategy.pursuit set status_source='us' where pursuit_id=$1", [loser]);
  const humanLoser = await addProspects(db, actor, files({ ...redirectedRow, status: 'passed' }));
  await db.query("update strategy.pursuit set status_source='rule' where pursuit_id=$1", [loser]);
  await db.query(`insert into platform.audit_log (actor_id,action,subject_type,subject_id,detail)
    values ($1,'pursuit.status_set','pursuit',$2,'{"fromId":"new","toId":"sourcing"}'::jsonb)`, [actor, loser]);
  const humanLoserAudit = await addProspects(db, actor, files({ ...redirectedRow, status: 'passed' }));
  check('PROSPECTS merged member person provenance and immutable human status history each protect the survivor',
    humanLoser.kept === 1 && humanLoserAudit.kept === 1 && humanLoser.moved === 0 && humanLoserAudit.moved === 0,
    'Both unaudited legacy person statuses and original loser audit subjects remain protected through redirects.');

  const newOrg = 'Invented Prospects2 Observatory';
  const unseen = prospect('invented-prospects2:unseen', 'Invented Prospects2 Dawn', { org: newOrg, status: 'sourcing' });
  const noOrg = prospect('invented-prospects2:no-org', 'Invented Prospects2 Ember', { org: null });
  const newResult = await addProspects(db, actor, files(unseen, noOrg));
  const sourcePerson = async (key: string | null | undefined) => db.one<{ id: string; name: string }>(
    `select e.entity_id::text id, e.display_name name from identity.entity e join identity.source_record s on s.entity_id = e.entity_id
      where s.source = 'prospect' and s.source_id = $1`, [key]);
  const born = await sourcePerson(unseen.personKey);
  const bornNoOrg = await sourcePerson(noOrg.personKey);
  const bornAliasBefore = JSON.stringify(await db.query(
    `select * from identity.source_record where source = 'prospect_key' and source_id = $1`, [unseen.personKey]));
  await db.query(`delete from identity.source_record where source = 'prospect_key' and source_id = $1`, [unseen.personKey]);
  const backfill = await addProspects(db, actor, files(unseen));
  const bornAlias = await db.one<{ id: string }>(
    `select entity_id::text id from identity.source_record where source = 'prospect_key' and source_id = $1`, [unseen.personKey]);
  check('PROSPECT-KEYS new people record aliases and old prospect imports backfill them without new pursuits',
    bornAliasBefore !== '[]' && bornAlias?.id === born?.id && backfill.existing === 1 && backfill.added === 0,
    'Rerunning Add prospects repairs pre-existing prospect mappings.');
  const affiliation = born ? await db.one<{ org: string; role: string; certainty: string; source: string; as_of: string }>(
    `select o.display_name org, a.role, a.certainty, a.source, a.as_of::text from identity.affiliation a
      join identity.entity o on o.entity_id = a.org_entity where a.person_entity = $1`, [born.id]) : null;
  check('PROSPECTS2 sourced unseen people become stable identities with optional sourced affiliations',
    newResult.added === 2 && newResult.ambiguous === 0 && born?.name === unseen.name && bornNoOrg?.name === noOrg.name
    && affiliation?.org === newOrg && !!affiliation.source && !!affiliation.as_of
    && await n('select count(*)::text n from identity.affiliation where person_entity = $1', [bornNoOrg?.id]) === 0,
    `Added ${newResult.added}; sourced person mappings and optional organization checked.`);

  // Issue 0138: an organization field that reads as a short biography names its organizations.
  {
    const { affiliationParts } = await import('../lib/enrich/affiliation-text');
    const bio = 'Former Invented 0138 Accelerator / Invented 0138 Works (former CEO)';
    const bioRow = prospect('invented-0138:bio', 'Invented 0138 Harbor', { org: bio });
    const bioResult = await addProspects(db, actor, files(bioRow));
    const bioPerson = await sourcePerson(bioRow.personKey);
    const rows = bioPerson ? await db.query<{ org: string; role: string; former: boolean; primary: boolean }>(
      `select o.display_name org, a.role, a.ended_on is not null former, a.is_primary primary from identity.affiliation a
        join identity.entity o on o.entity_id = a.org_entity where a.person_entity = $1 order by o.display_name`, [bioPerson.id]) : [];
    const whole = await n('select count(*)::text n from identity.entity where display_name = $1', [bio]);
    const kept = ['Invented 0138 Ventures', 'Invented 0138 (UK)', 'Invented 0138 Works (Invented 0138 Accelerator)']
      .every(x => JSON.stringify(affiliationParts(x)) === JSON.stringify([{ org: x, role: null, former: false }]));
    const personal = affiliationParts('Personal investing (formerly Invented 0138 Accelerator)');
    check('PROSPECTS 0138 an organization field like "Former X / Y" records affiliations with X and Y, not an organization named after it',
      bioResult.added === 1 && whole === 0 && rows.length === 2 && rows.every(r => r.former) && rows.some(r => r.role === 'CEO')
        && !rows.some(r => r.primary) && kept
        && personal.length === 1 && personal[0]!.org === 'Invented 0138 Accelerator' && personal[0]!.former,
      `${rows.length} affiliations (${rows.map(r => `${r.former ? 'former' : 'current'}${r.role !== 'not recorded' ? ` ${r.role}` : ''}`).join(', ')}); ` +
        `an organization named after the whole field: ${whole}; plain names kept whole: ${kept}; "Personal investing (formerly X)": ${JSON.stringify(personal.map(p => [p.former ? 'former' : 'current']))}`);
  }

  const stableBefore = await snapshot();
  const bornPursuitBefore = JSON.stringify(await db.query('select * from strategy.pursuit where entity_id = $1 order by pursuit_id', [born?.id]));
  const bornNotesBefore = JSON.stringify(await db.query("select * from research.note where entity_id = $1 and kind <> 'identity_creation' order by note_id", [born?.id]));
  const reordered = await addProspects(db, actor, [{ file: 'renamed-invented-file.jsonl', text: [noOrg,
    { ...unseen, reason: 'Same status with edited evidence needs no disposition change.' }].map(r => JSON.stringify(r)).join('\n') }]);
  check('PROSPECTS2 row identity survives renamed files, row order and edited planning fields on rerun',
    reordered.added === 0 && reordered.existing === 2 && stableBefore === await snapshot()
    && bornPursuitBefore === JSON.stringify(await db.query('select * from strategy.pursuit where entity_id = $1 order by pursuit_id', [born?.id]))
    && bornNotesBefore === JSON.stringify(await db.query("select * from research.note where entity_id = $1 and kind <> 'identity_creation' order by note_id", [born?.id])),
    `Rerun skipped ${reordered.existing}; identities, affiliations, pursuits and notes unchanged.`);

  const otherVehicle = (await db.one<{ slug: string }>('select slug from platform.vehicle where id <> $1 order by slug limit 1', [vehicle.id]))!;
  const across = prospect('invented-prospects2:two-vehicles', 'Invented Prospects2 Fern', { org: null });
  const twoVehicles = await addProspects(db, actor, files(across, { ...across, vehicle: otherVehicle.slug }));
  const acrossPerson = await sourcePerson(across.personKey);
  check('PROSPECTS2 one newly discovered person is reused across two vehicles in the same batch',
    twoVehicles.added === 2 && !!acrossPerson
    && await n('select count(*)::text n from identity.entity where display_name = $1', [across.name]) === 1
    && await n('select count(*)::text n from strategy.pursuit where entity_id = $1', [acrossPerson?.id]) === 2,
    `Added ${twoVehicles.added} pursuits sharing one source-mapped person.`);

  const unseenRace = prospect('invented-prospects2:race', 'Invented Prospects2 Gale', { org: 'Invented Prospects2 Race Office' });
  const unseenRaced = await Promise.all([addProspects(db, actor, files(unseenRace)), addProspects(db, actor, files(unseenRace))]);
  const racedPerson = await sourcePerson(unseenRace.personKey);
  check('PROSPECTS2 concurrent unseen-row imports create one person, affiliation, pursuit and note',
    unseenRaced.reduce((sum, r) => sum + r.added, 0) === 1 && unseenRaced.reduce((sum, r) => sum + r.existing, 0) === 1
    && await n('select count(*)::text n from identity.entity where display_name = $1', [unseenRace.name]) === 1
    && await n('select count(*)::text n from identity.affiliation where person_entity = $1', [racedPerson?.id]) === 1
    && await n("select count(*)::text n from research.note where entity_id = $1 and kind <> 'identity_creation'", [racedPerson?.id]) === 1,
    `Two unseen calls added ${unseenRaced.map(r => r.added).join('/')}.`);

  const single = await makePerson('Invented Prospects2 Hazel');
  const reused = await addProspects(db, actor, files(prospect('invented-prospects2:single-name', '  INVENTED   Prospects2 Hazel ', { org: null })));
  check('PROSPECTS2 a new source key never aliases an existing person on name alone',
    reused.added === 1 && (await sourcePerson('invented-prospects2:single-name'))?.id !== single,
    `IDRES preserves distinct sourced identities until corroboration supports a reversible merge; added ${reused.added} pursuit.`);
  const namesakeRow = prospect('invented-prospect:missing', 'Invented Prospect Alder', { org: null });
  const namesakes = await addProspects(db, actor, files(namesakeRow));
  const namesakeRetry = await addProspects(db, actor, files(namesakeRow));
  check('PROSPECTS2 multiple existing namesakes still permit a separate idempotent source identity',
    namesakes.added === 1 && namesakes.ambiguous === 0 && namesakeRetry.existing === 1
      && (await sourcePerson(namesakeRow.personKey))?.id !== direct,
    'IDRES records the sourced person independently; existing namesakes neither select its identity nor gate the import.');
  await makePerson(unseen.name);
  const explicitProspect = await addProspects(db, actor, files(unseen));
  check('PROSPECTS2 a stable prospect alias wins over a later same-name entity',
    explicitProspect.existing === 1 && explicitProspect.ambiguous === 0 && (await sourcePerson(unseen.personKey))?.id === born?.id,
    `Known source mapping skipped ${explicitProspect.existing} existing pursuit despite a namesake.`);
  const conflictingAliasKey = 'invented-prospect:alias-conflict';
  await alias('prospect', conflictingAliasKey, conflictA);
  await alias('prospect_key', conflictingAliasKey, conflictB);
  const conflictingAlias = await addProspects(db, actor, files(prospect(conflictingAliasKey, 'Invented Prospect Namesake')));
  check('PROSPECT-KEYS the same-source prospect mapping wins without overwriting another alias',
    conflictingAlias.ambiguous === 0 && conflictingAlias.skipped.length === 0 && conflictingAlias.existing === 1
    && (await sourcePerson(conflictingAliasKey))?.id === conflictA
    && (await db.one<{ id: string }>(`select entity_id::text id from identity.source_record
      where source = 'prospect_key' and source_id = $1`, [conflictingAliasKey]))?.id === conflictB,
    'The prospect external ID attaches to its existing person; the prospect_key alias remains unchanged.');
  const mergedAlias = await makePerson(unseen.name);
  await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [born?.id, mergedAlias]);
  const aliasBeforeMergeRetry = JSON.stringify(await db.query(
    `select * from identity.source_record where source = 'prospect_key' and source_id = $1`, [unseen.personKey]));
  const mergeRetry = await addProspects(db, actor, files(unseen));
  check('PROSPECT-KEYS aliases follow merges without overwriting the original source record',
    mergeRetry.existing === 1 && mergeRetry.ambiguous === 0 && aliasBeforeMergeRetry === JSON.stringify(await db.query(
      `select * from identity.source_record where source = 'prospect_key' and source_id = $1`, [unseen.personKey])),
    'Canonical comparison recognizes equal identities while leaving the alias row untouched.');
  // Keep the existing reader assertions below anchored to their original fixture person.
  await db.query('update identity.entity set merged_into=null where entity_id=$1', [born?.id]);
  const knownOrg = await makePerson('Invented Prospects2 Known Office', 'org');
  const knownOrgRow = prospect('invented-prospects2:known-org', 'Invented Prospects2 Iris', { org: 'Invented Prospects2 Known Office' });
  const knownOrgResult = await addProspects(db, actor, files(knownOrgRow));
  const knownOrgPerson = await sourcePerson(knownOrgRow.personKey);
  const sourcedOrg = await db.one<{ id: string }>('select org_entity::text id from identity.affiliation where person_entity=$1', [knownOrgPerson?.id]);
  check('PROSPECTS2 an organization name alone creates a separate identity and immediately queues the pair',
    knownOrgResult.added === 1
    && !!sourcedOrg && sourcedOrg.id !== knownOrg
    && await n('select count(*)::text n from identity.entity where display_name = $1', [knownOrgRow.org]) === 2
    && await n('select count(*)::text n from identity.possible_match where active and left_entity=least($1::uuid,$2::uuid) and right_entity=greatest($1::uuid,$2::uuid)', [knownOrg, sourcedOrg?.id]) === 1,
    'A sourced affiliation links the newly created organization; its namesake is queued before export.');

  const unkeyed = prospect(null, 'Invented Prospects3 Juniper', { org: 'Invented Prospects3 Office',
    sources: ['https://example.org/juniper', { url: 'https://example.org/juniper-bio', title: 'Invented biography' }] });
  const absent = { ...unkeyed, personKey: undefined, name: '  INVENTED   Prospects3 Juniper ', org: 'INVENTED PROSPECTS3 OFFICE',
    vehicle: otherVehicle.slug, sources: [{ title: 'Edited biography', url: 'https://example.org/juniper-bio' }, 'https://example.org/juniper'] };
  const unkeyedResult = await addProspects(db, actor, files(unkeyed, absent));
  const unkeyedPerson = await sourcePerson(prospectPersonKey(unkeyed));
  const unkeyedBefore = await snapshot();
  const unkeyedRetry = await addProspects(db, actor, [{ file: 'moved.jsonl', text: JSON.stringify({ ...absent, reason: 'Edited reason' }) }]);
  check('PROSPECTS3 null and absent keys share a stable source identity across vehicles, files and source order',
    unkeyedResult.added === 2 && unkeyedResult.invalid.length === 0 && !!unkeyedPerson
    && prospectPersonKey(unkeyed) === prospectPersonKey(absent)
    && unkeyedRetry.existing === 1 && unkeyedBefore === await snapshot(),
    `Added ${unkeyedResult.added}; retry existing ${unkeyedRetry.existing}; unchanged counts.`);
  const canonical = await makePerson(unkeyed.name);
  await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [unkeyedPerson?.id, canonical]);
  const redirected = await addProspects(db, actor, files(unkeyed));
  check('PROSPECTS3 an unkeyed source follows its canonical identity after resolution without a duplicate pursuit',
    redirected.existing === 1 && redirected.added === 0
    && await n('select count(*)::text n from strategy.pursuit where identity.canonical_entity_id(entity_id)=$1', [canonical]) === 2,
    'Canonical redirect preserves the original two vehicle pursuits on retry.');
  const { identityEvidence } = await import('../modules/identity/resolution-input');
  const evidence = identityEvidence(null, files(unkeyed, null, { ...unkeyed, status: 'committed' }));
  check('PROSPECTS3 identity evidence uses the same generated key and ignores invalid rows',
    evidence.length === 1 && evidence[0]?.sourceId === prospectPersonKey(unkeyed)
    && evidence[0]?.organizations?.[0] === unkeyed.org,
    'Unkeyed organization evidence remains available to cross-source resolution.');

  const validId = await makePerson('Invented Prospect Batch');
  const valid = prospect(validId, 'Invented Prospect Batch');
  const partial = await addProspects(db, actor, [{ file: 'mixed.jsonl', text: [
    JSON.stringify({ ...valid, status: 'committed' }), '{broken', JSON.stringify(valid),
    JSON.stringify({ ...valid, vehicle: 'invented-absent-vehicle', name: 'Conflicting invalid vehicle row' }),
    JSON.stringify({ ...valid, personKey: 42 }), JSON.stringify({ ...valid, sources: [] }),
  ].join('\n') }, { file: 'document.jsonl', text: JSON.stringify(valid, null, 2) },
  { file: 'array.jsonl', text: JSON.stringify([valid]) }, { file: 'broken.jsonl', text: 'not json at all' }]);
  check('PROSPECTS3 invalid rows retain file/line while valid rows import despite structural errors in other files',
    partial.added === 1 && partial.ambiguous === 0 && partial.invalid.length === 8
    && [1, 2, 4, 5, 6].every(line => partial.invalid.some(p => p.file === 'mixed.jsonl' && p.line === line))
    && ['document.jsonl', 'array.jsonl', 'broken.jsonl'].every(file => partial.invalid.some(p => p.file === file && p.reason.startsWith('File skipped:'))),
    `Added ${partial.added}; ${partial.invalid.length} invalid rows/files listed.`);
  const invalidBefore = await snapshot();
  const contradictory = await addProspects(db, actor, files(valid, { ...valid, name: 'Invented Conflicting Description' }));
  check('PROSPECTS conflicting descriptions cannot select an identity by input order',
    contradictory.ambiguous === 2 && contradictory.added === 0 && invalidBefore === await snapshot(),
    `${contradictory.ambiguous} conflicting descriptions skipped.`);

  const dir = await mkdtemp(join(tmpdir(), 'prospects3-invented-'));
  try {
    const fresh = prospect(null, 'Invented Prospects3 Writing', { org: null });
    await writeFile(join(dir, 'writing.jsonl'), JSON.stringify(fresh));
    await writeFile(join(dir, 'settled.jsonl'), JSON.stringify(valid));
    await writeFile(join(dir, 'ignored.txt'), 'not a prospect input');
    const old = new Date(Date.now() - 180_000);
    await utimes(join(dir, 'settled.jsonl'), old, old);
    const inputs = await readProspectFiles(dir);
    check('PROSPECTS settled file reader preserves modification time for precedence',
      Math.abs((inputs.find(f => f.file === 'settled.jsonl')?.mtimeMs ?? 0) - old.getTime()) < 1,
      'Filesystem modification time accompanies the settled text.');
    const waiting = await addProspects(db, actor, inputs);
    check('PROSPECTS3 recent files are listed as in progress, are not read, and do not block settled files',
      waiting.inProgress.join() === 'writing.jsonl' && waiting.existing === 1 && waiting.invalid.length === 0
      && inputs.find(f => f.file === 'writing.jsonl')?.text === '' && inputs.length === 2
      && !await sourcePerson(prospectPersonKey(fresh)),
      `In progress ${waiting.inProgress.length}; settled existing ${waiting.existing}.`);
    await utimes(join(dir, 'writing.jsonl'), old, old);
    const settled = await addProspects(db, actor, await readProspectFiles(dir));
    check('PROSPECTS3 a file imports on retry once its two-minute quiet period has elapsed',
      settled.inProgress.length === 0 && settled.added === 1 && settled.existing === 1,
      `Added ${settled.added} formerly in-progress prospect.`);
  } finally { await rm(dir, { recursive: true, force: true }); }

  const { getPursuit, listPursuits } = await import('../modules/strategy');
  const { researchSet } = await import('../lib/enrich/candidates');
  await withDb(db, async () => {
    const list = await listPursuits(vehicle.id);
    const created = list.filter(p => [direct, warehouse, w3].includes(p.entityId));
    const lp = created[0] ? await getPursuit(created[0].pursuitId, db) : null;
    const exported = await researchSet();
    check('PROSPECTS appear in normal pipeline/LP readers and the next W0 research set',
      created.length === 3 && lp !== null && created.every(p => p.rung === null && p.source === 'prospects' && p.statusSource === 'rule')
      && created.find(p => p.entityId === direct)?.status === 'new' && created.find(p => p.entityId === warehouse)?.status === 'sourcing'
      && exported.some(c => c.key === direct && c.pursuits.some(p => p.status === 'new'))
      && exported.some(c => c.key === warehouse && c.pursuits.some(p => p.status === 'sourcing'))
      && exported.some(c => c.key === direct && c.context.some(note => note.text.includes('Capacity '))),
      `${created.length} normal pursuits; LP readable ${lp !== null}; new/sourcing and their notes checked in W0 data.`);
    check('PROSPECTS2 newly created people and their organization are included in the next W0 export',
      exported.some(c => c.key === born?.id && c.name === unseen.name && c.org === newOrg && c.pursuits.some(p => p.status === 'sourcing'))
      && exported.some(c => c.key === bornNoOrg?.id && c.name === noOrg.name && c.pursuits.some(p => p.status === 'new')),
      'Newly sourced identities export with the supplied organization and pipeline status.');
  });
  check('PROSPECTS never write consent ladder evidence',
    ladderBefore === await n('select count(*)::text n from strategy.ladder_event'),
    'The full suite leaves the ladder event count unchanged.');
  // Restore the shared demo fixture for later suites, including its merged-entity pair.
  for (const row of await db.query<{ id: string }>('select entity_id::text id from identity.entity')) {
    if (!initialIds.has(row.id) && !inventedIds.includes(row.id)) inventedIds.push(row.id);
  }
  await db.transaction(async tx => {
    await tx.query('delete from research.note where entity_id = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from strategy.pursuit where entity_id = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from identity.source_record where entity_id = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from identity.affiliation where person_entity = any($1::uuid[]) or org_entity = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from identity.possible_match where left_entity = any($1::uuid[]) or right_entity = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from identity.entity where entity_id = any($1::uuid[])', [inventedIds]);
  });
}

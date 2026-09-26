/** Entirely invented prospects; uses only the harness's demo database. */
import { randomUUID } from 'node:crypto';
import type { Check, Db } from './properties/harness';
import { withDb } from '../lib/db';
import { addProspects, type Prospect, type ProspectFile } from '../lib/enrich/prospects';

export async function prospectsProperties(check: Check, db: Db) {
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const vehicle = (await db.one<{ id: string; slug: string }>("select id::text, slug from platform.vehicle where phase <> 'historical' order by slug limit 1"))!;
  const inventedIds: string[] = [];
  const makePerson = async (name: string, type = 'person'): Promise<string> => {
    const id = randomUUID();
    await db.query('insert into identity.entity (entity_id, entity_type, display_name) values ($1, $2::identity.entity_type, $3)', [id, type, name]);
    inventedIds.push(id);
    return id;
  };
  const alias = async (source: string, key: string, id: string) => {
    await db.query("insert into identity.source_record (source, source_id, entity_id, resolved_by) values ($1,$2,$3,'invented:prospects-properties')", [source, key, id]);
  };
  const prospect = (personKey: string, name: string, extra: Partial<Prospect> = {}): Prospect => ({
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
    (select count(*) from identity.entity)::text entities`));
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
  const notes = await db.query<{ body: string; kind: string; data: Record<string, unknown> }>(
    'select body, kind, data from research.note where entity_id = any($1::uuid[])', [[direct, warehouse, w3]]);
  check('PROSPECTS keyed entity, warehouse and W3 imports create once, with traceable capacity notes',
    first.added === 3 && first.existing === 0 && first.ambiguous === 0 && second.added === 0 && second.existing === 3 && notes.length === 3
    && notes.every(note => note.kind === 'context' && note.body.startsWith("Added by rule on Juan's instruction (26 Sep):")
      && note.body.includes('capacity $500K–$1M (guess)') && typeof note.data.inputHash === 'string' && !!note.data.pursuitId),
    `First added ${first.added}; repeated added ${second.added}, existing ${second.existing}; ${notes.length} context notes.`);

  const raceId = await makePerson('Invented Prospect Concurrent');
  const raceFile = files(prospect(raceId, 'Invented Prospect Concurrent'));
  const raced = await Promise.all([addProspects(db, actor, raceFile), addProspects(db, actor, raceFile)]);
  check('PROSPECTS concurrent imports create exactly one pursuit and one note',
    raced.reduce((sum, r) => sum + r.added, 0) === 1 && raced.reduce((sum, r) => sum + r.existing, 0) === 1
    && await n('select count(*)::text n from research.note where entity_id = $1', [raceId]) === 1,
    `Two calls added ${raced.map(r => r.added).join('/')}, skipped existing ${raced.map(r => r.existing).join('/')}.`);

  const oldId = await makePerson('Invented Prospect Existing');
  const existing = (await db.one<{ id: string }>(`insert into strategy.pursuit
    (entity_id, vehicle_id, owner_id, status, passed_by, status_reason, headline, plan, closed_at, close_reason, next_step, source)
    values ($1,$2,$3,'passed','them','Invented decline','Keep this headline','[{"what":"Keep this plan"}]',
      '2026-09-20','Keep this close reason','Keep this next step','us') returning pursuit_id::text id`, [oldId, vehicle.id, actor]))!.id;
  await db.query("insert into research.note (entity_id, author_id, kind, body) values ($1,$2,'context','Keep existing note')", [oldId, actor]);
  const beforeRow = JSON.stringify(await db.query('select * from strategy.pursuit where pursuit_id = $1', [existing]));
  const beforeNotes = JSON.stringify(await db.query('select * from research.note where entity_id = $1', [oldId]));
  const oldResult = await addProspects(db, actor, files(prospect(oldId, 'Invented Prospect Existing', { status: 'sourcing' })));
  check('PROSPECTS existing closed/passed pursuits and their notes remain byte-for-byte unchanged',
    oldResult.existing === 1 && oldResult.added === 0
    && beforeRow === JSON.stringify(await db.query('select * from strategy.pursuit where pursuit_id = $1', [existing]))
    && beforeNotes === JSON.stringify(await db.query('select * from research.note where entity_id = $1', [oldId])),
    `Existing skipped ${oldResult.existing}; whole pursuit row and all notes compared.`);

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
    prospect('invented-prospect:missing', 'Invented Prospect Alder'),
    prospect(direct, 'Invented Wrong Name'),
    prospect(wrongType, 'Invented Prospect Organization'),
    prospect(merged, 'Invented Prospect Merged'),
    prospect(retired, 'Invented Prospect Retired')));
  check('PROSPECTS conflicting aliases, name-only matches, wrong names/types and inactive entities are listed and skipped',
    ambiguous.ambiguous === 6 && ambiguous.skipped.length === 6 && ambiguous.added === 0 && ambiguousBefore === await snapshot(),
    `${ambiguous.ambiguous} ambiguous records listed; no pursuits, notes, identities or rungs added.`);

  const validId = await makePerson('Invented Prospect Batch');
  const valid = prospect(validId, 'Invented Prospect Batch');
  const invalidBefore = await snapshot();
  const malformed = await addProspects(db, actor, [...files(valid), { file: 'broken.jsonl', text: '{broken\n' }]);
  const badShape = await addProspects(db, actor, files(valid, { ...valid, status: 'committed' }));
  const badVehicle = await addProspects(db, actor, files(valid, { ...valid, vehicle: 'invented-absent-vehicle' }));
  check('PROSPECTS malformed JSON, invalid statuses and unknown vehicles reject the entire batch before writes',
    [malformed, badShape, badVehicle].every(result => result.invalid.length > 0 && result.added === 0)
    && invalidBefore === await snapshot(),
    `Invalid rows ${malformed.invalid.length}/${badShape.invalid.length}/${badVehicle.invalid.length}; database counts unchanged.`);
  const contradictory = await addProspects(db, actor, files(valid, { ...valid, name: 'Invented Conflicting Description' }));
  check('PROSPECTS conflicting descriptions cannot select an identity by input order',
    contradictory.ambiguous === 2 && contradictory.added === 0 && invalidBefore === await snapshot(),
    `${contradictory.ambiguous} conflicting descriptions skipped.`);

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
      && exported.some(c => c.key === direct && c.context.some(note => note.text.startsWith("Added by rule on Juan's instruction"))),
      `${created.length} normal pursuits; LP readable ${lp !== null}; new/sourcing and their notes checked in W0 data.`);
  });
  check('PROSPECTS never write consent ladder evidence',
    ladderBefore === await n('select count(*)::text n from strategy.ladder_event'),
    'The full suite leaves the ladder event count unchanged.');
  // Restore the shared demo fixture for later suites, including its merged-entity pair.
  await db.transaction(async tx => {
    await tx.query('delete from research.note where entity_id = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from strategy.pursuit where entity_id = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from identity.source_record where entity_id = any($1::uuid[])', [inventedIds]);
    await tx.query('delete from identity.entity where entity_id = any($1::uuid[])', [inventedIds]);
  });
}

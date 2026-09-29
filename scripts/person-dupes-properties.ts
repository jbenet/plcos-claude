/** 0105: invented people only; the real data is neither opened nor needed. */
import { randomUUID } from 'node:crypto';
import { mergeImportDuplicates, mergeImportDuplicatesInTransaction } from '../lib/enrich/import-dupes';
import { undoIdentityMerge } from '../modules/identity/resolution';
import { reversePursuitMerge } from '../modules/strategy/merge';
import { addProspects, type Prospect } from '../lib/enrich/prospects';
import type { Finding } from '../lib/enrich/schema';
import type { Check, Db } from './properties/harness';

export async function personDupesProperties(check: Check, db: Db) {
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active limit 1'))!.id;
  const vehicle = (await db.one<{ id: string; slug: string }>("select id::text,slug from platform.vehicle where phase='active' and kind='fund' limit 1"))!;
  const ids: string[] = [], tag = randomUUID().slice(0, 8);
  const name = (s: string) => `Invented Person ${tag} ${s}`;
  const entity = async (label: string, source = 'prospect_key', resolver = 'rule:sourced-prospect', type = 'person') => {
    const id = randomUUID(); ids.push(id);
    await db.query('insert into identity.entity(entity_id,entity_type,display_name) values($1,$2::identity.entity_type,$3)', [id, type, label]);
    if (source) await db.query('insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2::text,$2::uuid,$3)', [source, id, resolver]);
    return id;
  };
  const note = (id: string, data: unknown, kind = 'public_profile') => db.query(
    'insert into research.note(entity_id,kind,body,data) values($1,$2,\'Invented identity evidence\',$3::jsonb)', [id, kind, JSON.stringify(data)]);
  const affiliate = (person: string, org: string) => db.query(`insert into identity.affiliation
    (person_entity,org_entity,kind,role,source,as_of,certainty) values($1,$2,'contact','not recorded','fixture',current_date,'claimed')`, [person, org]);
  const root = async (id: string) => (await db.one<{ id: string }>('select identity.canonical_entity_id($1)::text id', [id]))!.id;
  const run = () => mergeImportDuplicates(db, actor);
  try {
    const org = await entity(name('Cedar Office'), 'prospect_org', 'rule:sourced-prospect-organization', 'org');
    // The same exact names may occur in several independent sources. Corroboration, not a name, authorizes a redirect.
    for (const [source, signal] of [['affinity', 'affiliation'], ['warehouse', 'prospect row'], ['dakota', 'finding']] as const) {
      const existing = await entity(name(source), source, 'rule:source-owned');
      const imported = await entity(`  ${name(source).toUpperCase()}  `, source === 'warehouse' ? 'w3_person' : 'prospect_key');
      await affiliate(existing, org);
      if (signal === 'affiliation') await affiliate(imported, org);
      else await note(imported, signal === 'prospect row' ? { source: 'prospects', org: name('Cedar Office') }
        : { identity: { match: 'confirmed', canonical: { org: name('Cedar Office') } } }, signal === 'prospect row' ? 'context' : 'public_profile');
      const result = await run();
      check(`0105 imported person matches ${source} through ${signal}`, await root(imported) === existing
        && result.merges.some(m => m.loserId === imported && m.survivorId === existing), 'Same normalized name plus an explicit shared organisation; the established identity survives.');
    }
    const old = await entity(name('Accent Élise'), 'affinity', 'rule:source-owned');
    const fresh = await entity(name('Accent Elise'), 'w3_person');
    await note(old, { identity: { links: [{ kind: 'linkedin', url: `https://www.linkedin.com/in/invented-${tag}/?trk=fixture` }] } });
    await note(fresh, { source: 'prospects', sources: [`http://linkedin.com/in/invented-${tag}`] }, 'context');
    const linked = await run();
    check('0105 personal LinkedIn corroborates accent-normalized names', await root(fresh) === old && linked.merges.some(m => m.loserId === fresh), 'Scheme, www, tracking query and trailing slash do not change the profile identity.');
    const bioOld = await entity(name('Bio'), 'warehouse', 'rule:source-owned'), bioNew = await entity(name('Bio'), 'rule:sourced-custom');
    await note(bioOld, { personal_url: `https://invented-${tag}.example.org/` });
    await note(bioNew, { identity: { links: [{ kind: 'bio', url: `https://invented-${tag}.example.org` }] } });
    await run();
    check('0105 explicit personal websites corroborate import-created people', await root(bioNew) === bioOld, 'Personal locators are distinct from shared firm homepages.');

    const noOld = await entity(name('No Evidence'), 'affinity', 'rule:source-owned'), noNew = await entity(name('No Evidence'));
    await note(noOld, { sources: ['https://example.org/news/shared-article'], identity: { links: [{ kind: 'website', url: 'https://example.org' }] } });
    await note(noNew, { sources: ['https://example.org/news/shared-article'], identity: { links: [{ kind: 'website', url: 'https://example.org' }] } });
    const no = await run();
    check('0105 name-only candidates stay separate and are listed as ambiguous', await root(noOld) !== await root(noNew)
      && no.ambiguous.some(a => a.entityIds.includes(noOld) && a.entityIds.includes(noNew) && a.reason.includes('without corroborating')), 'A shared article or firm homepage cannot serve as personal URL corroboration.');
    for (const source of ['affinity', 'warehouse', 'dakota']) {
      const a = await entity(name(`Conflict ${source}`), source, 'rule:source-owned');
      const b = await entity(name(`Conflict ${source}`), source, 'rule:sourced-prospect');
      const alias = await entity(name(`Alias ${source}`));
      await db.query('update identity.entity set merged_into=$2 where entity_id=$1', [b, alias]);
      await db.query('update identity.entity set display_name=$2 where entity_id=$1', [alias, name(`Conflict ${source}`)]);
      await affiliate(a, org); await affiliate(alias, org);
      const result = await run();
      check(`0105 conflicting ${source} person IDs across aliases veto merging`, await root(a) !== await root(b)
        && !result.ambiguous.some(x => x.entityIds.includes(alias))
        && result.rules?.different_external_id === 1, 'A sourced resolver label and a shared employer never erase distinct upstream IDs.');
    }
    for (const [label, urls] of [['Placeholder URL', ['unknown', 'unknown']], ['Distinct query URLs', ['https://example.org/profile?id=one', 'https://example.org/profile?id=two']]] as const) {
      const a = await entity(name(label), 'warehouse', 'rule:source-owned'), b = await entity(name(label));
      await note(a, { personal_url: urls[0] }); await note(b, { personal_url: urls[1] });
      const result = await run();
      check(`0105 ${label} cannot corroborate a name`, await root(a) !== await root(b) && result.ambiguous.some(x => x.entityIds.includes(b)),
        'Missing values are not locators; identity-bearing query parameters remain significant.');
    }
    const rawOld = await entity(name('Stored Locator'), 'affinity', 'rule:source-owned'), rawNew = await entity(name('Stored Locator'), 'w3_person');
    const locator = `https://linkedin.com/in/invented-raw-${tag}`;
    await db.query("insert into sources.raw_record(source,kind,source_id,payload_hash,payload) values('affinity','person',$1,'fixture',$2::jsonb)", [rawOld, JSON.stringify({ linkedin: locator })]);
    await db.query(`insert into identity.external_identifier(entity_id,kind,value,source,as_of,confidence,last_verified_by)
      values($1,'linkedin',$2,'fixture',now(),'high',$3)`, [rawNew, locator, actor]);
    await run();
    check('0105 stored source snapshots and typed identifiers corroborate people', await root(rawNew) === rawOld,
      'The standalone repair works with stored evidence, without reading enrichment files or connecting to a source.');
    const separateA = await entity(name('Separated'), 'warehouse', 'rule:source-owned'), separateB = await entity(name('Separated'));
    await affiliate(separateA, org); await affiliate(separateB, org);
    await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,rule)
      values('not_same_as','warehouse',$1,'prospect_key',$2,'identity:v1:fixture')`, [separateA, separateB]);
    await run();
    check('0105 source-only person separation vetoes an otherwise corroborated merge', await root(separateA) !== await root(separateB),
      'Prior negative assertions apply even without entity-ID columns.');
    const one = await entity(name('Fork'), 'affinity', 'rule:source-owned'), two = await entity(name('Fork'), 'warehouse', 'rule:source-owned'), fork = await entity(name('Fork'));
    for (const id of [one, two, fork]) await affiliate(id, org);
    const forks = await run();
    check('duplicate rule: current affiliation identifies multiple established sources', await root(fork) === await root(one) && await root(one) === await root(two)
      && forks.rules?.same_name_current_affiliation === 2, 'Requested rule: distinct sources with a shared current employer corroborate the normalized name.');
    const otherOrg = await entity(name('Other Office'), 'prospect_org', 'rule:sourced-prospect-organization', 'org');
    const correct = await entity(name('Namesake'), 'affinity', 'rule:source-owned'), namesake = await entity(name('Namesake'), 'warehouse', 'rule:source-owned'), candidate = await entity(name('Namesake'));
    await affiliate(correct, org); await affiliate(candidate, org); await affiliate(namesake, otherOrg);
    await run();
    check('0105 a corroborated match does not absorb an unrelated namesake', await root(candidate) === correct && await root(namesake) === namesake, 'Unconnected same-name identities remain separate.');

    const findingOld = await entity(name('Incoming'), 'warehouse', 'rule:source-owned'), findingNew = await entity(name('Incoming'));
    await affiliate(findingOld, org);
    const finding: Finding = { key: findingNew, name: name('Incoming'), researched: { at: '2026-09-27', by: 'fixture', workflow: 'W1', version: '1' },
      identity: { match: 'confirmed', basis: 'Invented affiliation', canonical: { org: name('Cedar Office') } }, facts: [] };
    const incoming = await db.transaction(tx => mergeImportDuplicatesInTransaction(tx, actor, [finding]));
    check('0105 the current import findings corroborate before they are stored', await root(findingNew) === findingOld && incoming.merges.some(m => m.loserId === findingNew), 'The transactional import can repair identities before it maps facts.');

    const endOld = await entity(name('Roundtrip'), 'affinity', 'rule:source-owned');
    const prospect: Prospect = { personKey: `fixture-${tag}`, name: name('Roundtrip'), org: null, vehicle: vehicle.slug,
      status: 'new', capacity: { band: 'unknown', basis: 'Invented', guess: true }, reason: 'Invented duplicate fixture', strategic: false, route: null, sources: ['https://example.org/fixture'] };
    await db.query("insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status) values($1,$2,$3,'new')", [endOld, vehicle.id, actor]);
    const files = [{ file: 'invented-0105.jsonl', text: JSON.stringify(prospect) }];
    const added = await addProspects(db, actor, files);
    const endNew = (await db.one<{ id: string }>("select entity_id::text id from identity.source_record where source='prospect_key' and source_id=$1", [prospect.personKey]))!.id;
    ids.push(endNew);
    check('0105 name-only prospect identity remains separate before corroboration arrives', added.added === 1 && endNew !== endOld, 'A name alone does not attach a newly sourced person.');
    await affiliate(endOld, org);
    await affiliate(endNew, org);
    const repaired = await run();
    const personMerge = repaired.merges.find(m => m.loserId === endNew)!;
    const count = async () => (await db.one<{ n: number }>('select count(*)::int n from strategy.active_pursuit where entity_id=any($1::uuid[])', [[endOld, endNew]]))!.n;
    check('0105 person repair consolidates same-vehicle pursuits', await root(endNew) === endOld && await count() === 1
      && !!personMerge && repaired.pursuitMerges!.merges.length > 0, 'Identity redirects precede the existing reversible pursuit consolidation.');
    const retry = await run(), reimport = await addProspects(db, actor, files);
    check('0105 repair and prospect reimport are idempotent', !retry.merges.some(m => [endOld, endNew].includes(m.loserId))
      && await count() === 1 && reimport.added === 0 && reimport.existing + reimport.kept === 1, 'Source keys follow the canonical survivor.');
    for (const merge of repaired.pursuitMerges!.merges) await reversePursuitMerge(db, merge.id, actor, 'Invented person fixture undo');
    await undoIdentityMerge(db, personMerge.assertionId, 'Invented person fixture undo');
    const veto = await run();
    check('0105 person and pursuit merges reverse and remain reversed on retry', await root(endNew) === endNew && await count() === 2
      && !veto.merges.some(m => m.loserId === endNew), 'Original source ownership and pursuits survive; reversal is a durable negative constraint.');
  } finally {
    const pursuits = (await db.query<{ id: string }>('select pursuit_id::text id from strategy.pursuit where entity_id=any($1::uuid[])', [ids])).map(p => p.id);
    await db.query('delete from strategy.pursuit_merge where survivor_id=any($1::uuid[]) or loser_ids && $1::uuid[]', [pursuits]);
    for (const table of ['strategy.suggestion', 'strategy.pursuit_update', 'strategy.pursuit_owner']) await db.query(`delete from ${table} where pursuit_id=any($1::uuid[])`, [pursuits]);
    await db.query('delete from research.note where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.affiliation where person_entity=any($1::uuid[]) or org_entity=any($1::uuid[])', [ids]);
    await db.query('delete from identity.match_assertion where merged_entity=any($1::uuid[]) or canonical_entity=any($1::uuid[]) or left_source_id=any($1::text[])', [ids]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])', [ids]);
    await db.query('delete from sources.raw_record where source_id=any($1::text[])', [ids]);
    await db.query('delete from identity.external_identifier where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])', [ids]);
    await db.query('update identity.entity set merged_into=null where entity_id=any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [ids]);
  }
}

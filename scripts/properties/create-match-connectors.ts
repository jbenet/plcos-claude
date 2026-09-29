/** Invented creation inputs only; rollback leaves the shared suite unchanged. */
import { randomUUID } from 'node:crypto';
import type { Check, Db } from './harness';
import { resolveEntity } from '../../modules/identity/create';
import { entityFor, type TranslationCounts } from '../../lib/connectors/affinity/translate';
import { participantIndex } from '../../lib/connectors/affinity/participants';
import { resolveExternalIdentity } from '../../modules/identity/external';

export async function connectorCreationProperties(check: Check, db: Db) {
  const rollback = new Error('invented connector creation rollback');
  try {
    await db.transaction(async tx => {
      const suffix = randomUUID(), actor = randomUUID();
      await tx.query(`insert into platform.app_user(id,handle,name,initials,role,email)
        values($1,$2,'Invented creation operator','IC','fixture','')`, [actor, `invented-create-${suffix}`]);
      const name = `Invented Creation Person ${suffix}`;
      const original = await resolveEntity(tx, { type: 'person', name, source: 'invented', sourceId: suffix, domains: ['fixture.example'] });
      const counts = { people: 0, organizations: 0 } as TranslationCounts;
      const matched = await entityFor(tx, 'person', `person:${suffix}`, name.toUpperCase(), counts, { domains: ['contact@fixture.example'] });
      const repeated = await entityFor(tx, 'person', `person:${suffix}`, 'Source spelling change', counts);
      const storedName = await tx.one<{ name: string }>('select display_name name from identity.entity where entity_id=$1', [original.id]);
      check('CREATE Affinity attaches corroborated identities and preserves another source name', matched === original.id && repeated === matched
        && counts.people === 0 && storedName?.name === name, 'Name and non-free email domain attach; repeated source ID does not clobber an existing source name.');
      const orgName = `Invented Creation Organization ${suffix}`;
      const org = await resolveEntity(tx, { type: 'org', name: orgName, source: 'affinity', sourceId: `company:${suffix}` });
      const namesake = await entityFor(tx, 'org', `company:other-${suffix}`, orgName, counts);
      const queue = await tx.one(`select 1 from identity.possible_match where active and left_entity=least($1::uuid,$2::uuid)
        and right_entity=greatest($1::uuid,$2::uuid)`, [org.id,namesake]);
      check('CREATE Affinity organization namesakes enter review immediately', namesake !== org.id && !!queue && counts.organizations === 1,
        'No export or merge pass is required to see the name-only pair.');
      const contactName = `Invented Contact ${suffix}`;
      const contact = await resolveEntity(tx, { type: 'person', name: contactName, organizations: [orgName] });
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values('affinity','company:999991',$1,'invented fixture')`, [org.id]);
      const index = await participantIndex(tx, [{ id: 999992, firstName: 'Invented', lastName: `Contact ${suffix}`,
        fields: [{ name: 'Current Organization', value: { type: 'organization', data: { id: 999991, name: orgName } } }] }]);
      check('CREATE Affinity contact creation shares the affiliation resolver', index.byId.get('person:999992') === contact.id,
        'The participant-only contact path attaches by normalized name plus affiliation.');
      const personal = `https://linkedin.com/in/invented-${suffix}`;
      const person = await resolveEntity(tx, { type: 'person', name: `Invented Dakota ${suffix}`, personalUrls: [personal] });
      const attached = await resolveExternalIdentity(tx, { source: 'dakota', sourceId: `contact:${suffix}`, type: 'person',
        name: `Invented Dakota ${suffix}`, identifiers: { linkedin: personal }, asOf: '2026-09-01', verifiedBy: actor });
      const secondSourceRecord = await resolveExternalIdentity(tx, { source: 'dakota', sourceId: `contact:duplicate-${suffix}`, type: 'person',
        name: `Invented Dakota ${suffix}`, identifiers: { linkedin: personal }, asOf: '2026-09-02', verifiedBy: actor });
      check('CREATE Dakota duplicate source records share identifiers without conflicting inserts', secondSourceRecord.id === person.id,
        'Distinct external IDs attach through name and personal URL; identifier persistence remains idempotent.');
      const different = await resolveExternalIdentity(tx, { source: 'dakota', sourceId: `contact:other-${suffix}`, type: 'person',
        name: `Different Dakota ${suffix}`, identifiers: { linkedin: personal }, asOf: '2026-09-01', verifiedBy: actor });
      check('CREATE Dakota requires a matching name alongside a personal URL', attached.id === person.id && different.id !== person.id && attached.merged === 0,
        'A personal URL corroborates the name; identifier-only matching cannot create a redirect.');
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

import { searchNames } from '../../modules/identity';
import { freshDb, type Check } from './harness';

/**
 * The search page's names (issues 0150–0152), on invented records only: every word in the name or in the name of a firm
 * or person it is tied to; the same name and kind is one row, led by the record with the most sources.
 */
export async function searchProperties(check: Check) {
  const db = await freshDb();
  const entity = async (type: string, name: string) => (await db.one<{ id: string }>(
    `insert into identity.entity(entity_type, display_name) values ($1::identity.entity_type, $2) returning entity_id::text id`, [type, name]))!.id;
  const firm = await entity('org', 'Zephyrine Holdings'), rhea = await entity('person', 'Rhea Quillon'), old = await entity('person', 'Osmo Quillon');
  const twinA = await entity('person', 'Tamsin Varga'), twinB = await entity('person', 'Tamsin Varga'), twinC = await entity('person', 'tamsin varga ');
  const sameOrg = await entity('org', 'Tamsin Varga');
  await db.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, source, as_of, certainty, ended_on) values
    ($1, $3, 'staff', 'Invented', 'fixture', now(), 'inferred', null), ($2, $3, 'staff', 'Invented', 'fixture', now(), 'inferred', '2025-01-01')`, [rhea, old, firm]);
  await db.query(`insert into identity.source_record(source, source_id, entity_id, resolved_by) values
    ('affinity', 'person:910001', $1, 'human:fixture'), ('dakota', 'contact:910002', $1, 'human:fixture'), ('affinity', 'person:910003', $2, 'human:fixture')`, [twinB, twinC]);

  const both = await searchNames('rhea zephyrine');
  check('Search: a person’s name with their firm’s finds the person, shown with the firm (and the firm, with them)',
    both.length === 2 && both.some((x) => x.entityId === firm) && both[0]!.entityId === rhea && both[0]!.via.includes('Zephyrine Holdings'), JSON.stringify(both.map((x) => [x.displayName, x.via])));
  const byFirm = await searchNames('zephyrine');
  check('Search: a firm’s name finds the firm first, then its current people; someone who has left is not brought in',
    byFirm[0]?.entityId === firm && byFirm.some((x) => x.entityId === rhea) && !byFirm.some((x) => x.entityId === old),
    JSON.stringify(byFirm.map((x) => x.displayName)));
  const byPerson = await searchNames('quillon');
  check('Search: a person’s name also brings their current firm',
    byPerson.some((x) => x.entityId === firm && x.via.includes('Rhea Quillon')) && byPerson.some((x) => x.entityId === old),
    JSON.stringify(byPerson.map((x) => [x.displayName, x.via])));
  const twins = await searchNames('tamsin varga');
  const person = twins.filter((x) => x.entityType === 'person');
  check('Search: records with the same name and kind are one row, led by the one with the most sources, the others listed with it; an organisation of that name stays its own row',
    person.length === 1 && person[0]!.entityId === twinB && [...person[0]!.sameName].sort().join() === [twinA, twinC].sort().join()
      && twins.some((x) => x.entityId === sameOrg),
    JSON.stringify(twins.map((x) => [x.entityType, x.entityId === twinB ? 'B' : x.entityId, x.sameName.length])));
}

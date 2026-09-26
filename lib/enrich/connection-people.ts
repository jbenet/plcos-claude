import type { Queryable } from '@/lib/db';
import { connectionPersonKey, type Path, type ConnectionPerson } from './connect';

/** Materialize sourced connector people, never organizations inferred from a name.
 * Reuse one exact person, refuse ambiguous names; source mappings remain stable on reimport.
 */
export async function resolveConnectionPeople(tx: Queryable, paths: Path[]): Promise<Path[]> {
  const descriptors = new Map<string, ConnectionPerson>();
  for (const p of paths) for (const [key, person] of [[p.lp, p.lpPerson], [p.other.key, p.other.person]] as const) if (person) {
    if (key !== person.key) throw new Error('Connector descriptor does not match its endpoint.');
    if (!/^https?:\/\//.test(person.source) || person.key !== connectionPersonKey(person.name, person.source)) throw new Error('Invalid connector identity source.');
    const previous = descriptors.get(person.key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(person)) throw new Error('Conflicting connector identities.');
    descriptors.set(person.key, person);
  }
  const ids = new Map<string, string | null>();
  for (const person of descriptors.values()) {
    const mapped = await tx.one<{ id: string }>(`select entity_id::text as id from identity.source_record where source = 'w3_person' and source_id = $1`, [person.key]);
    if (mapped) { ids.set(person.key, mapped.id); continue; }
    const matches = await tx.query<{ id: string }>(`select entity_id::text as id from identity.entity where entity_type = 'person' and lower(trim(display_name)) = lower(trim($1))`, [person.name]);
    if (matches.length > 1) { ids.set(person.key, null); continue; }
    const id = matches[0]?.id ?? (await tx.one<{ id: string }>(`insert into identity.entity (entity_id, entity_type, display_name) values ($1, 'person', $2) returning entity_id::text as id`, [person.key, person.name]))!.id;
    await tx.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by) values ('w3_person', $1, $2, 'rule:sourced-person')`, [person.key, id]);
    ids.set(person.key, id);
  }
  return paths.map((p) => ({ ...p,
    lp: ids.get(p.lp) ?? p.lp,
    // Ambiguous endpoints remain unresolvable candidates. Never substitute a namesake.
    other: p.other.key && ids.get(p.other.key) ? { ...p.other, key: ids.get(p.other.key)! } : p.other,
  }));
}

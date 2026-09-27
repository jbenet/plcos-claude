import type { Queryable } from '@/lib/db';
import { norm, type Path, type ConnectionPerson } from './connect';
import { connectionIdentityProblems, pathProblems, type LocatedRecord } from './connection-check';

/** Preflight the entire batch before writes: input order cannot choose a conflicting
 * identity. Only explicit record problems are skipped; SQL/schema errors propagate.
 */
export async function resolveConnectionPeople(tx: Queryable, paths: Path[],
  onSkip: (index: number, problems: string[]) => void = () => {},
  context: { findings?: LocatedRecord[]; knownOrgs?: string[]; records?: LocatedRecord[]; onResolved?: (index: number, path: Path) => void } = {}): Promise<Path[]> {
  const rejected = new Map<number, string[]>();
  const reject = (index: number, reason: string) => rejected.set(index, [...(rejected.get(index) ?? []), reason]);
  const descriptors = new Map<string, ConnectionPerson>();
  const badKeys = new Map<string, string>();
  for (const [index, p] of paths.entries()) {
    const problems = pathProblems(p);
    if (problems.length) { rejected.set(index, problems); continue; }
    for (const person of [p.lpPerson, p.other.person]) if (person) {
      const previous = descriptors.get(person.key);
      if (previous && (norm(previous.name) !== norm(person.name) || previous.source !== person.source || (previous.entityType ?? 'person') !== (person.entityType ?? 'person'))) {
        badKeys.set(person.key, 'Conflicting connector identities');
      }
      descriptors.set(person.key, person);
    }
  }
  for (const issue of connectionIdentityProblems(context.findings ?? [], context.records ?? paths.map((value, index) => ({ file: 'connections.jsonl', index, value })), context.knownOrgs)) {
    if (issue.file !== 'connections.jsonl') continue;
    const index = context.records ? context.records.findIndex((r) => r.index === issue.index) : issue.index;
    for (const reason of issue.problems) reject(index, reason);
    for (const key of issue.conflictingKeys ?? []) badKeys.set(key, 'Conflicting connector identities');
  }
  const ids = new Map<string, string>();
  const mappedKeys = new Set<string>();
  // Resolve existing identities first. No node is created for a skipped-only path.
  for (const person of descriptors.values()) {
    if (badKeys.has(person.key)) continue;
    const type = person.entityType ?? 'person';
    const mapped = await tx.one<{ id: string; type: string }>(`select e.entity_id::text as id, e.entity_type::text as type from identity.source_record s join identity.entity e on e.entity_id = identity.canonical_entity_id(s.entity_id) where s.source = 'w3_person' and s.source_id = $1`, [person.key]);
    if (mapped) {
      if (mapped.type !== type) badKeys.set(person.key, 'Connector type conflicts with its existing source mapping');
      else { ids.set(person.key, mapped.id); mappedKeys.add(person.key); }
      continue;
    }
    const existing = await tx.one<{ name: string; type: string }>(`select display_name as name, entity_type::text as type from identity.entity where entity_id = identity.canonical_entity_id($1::uuid)`, [person.key]);
    if (existing && (existing.type !== type || norm(existing.name) !== norm(person.name))) {
      badKeys.set(person.key, 'Connector identity conflicts with an existing entity'); continue;
    }
    const opposite = await tx.one<{ n: number }>(`select count(*)::int as n from identity.entity where merged_into is null and retired_at is null and lower(trim(display_name)) = lower(trim($1)) and entity_type::text <> $2`, [person.name, type]);
    if (opposite && opposite.n > 0) { badKeys.set(person.key, 'Connector name conflicts with an existing entity type'); continue; }
    // Namesakes are separate sourced identities until deterministic corroboration merges them.
    if (existing) {
      const canonical = await tx.one<{id:string}>('select identity.canonical_entity_id($1::uuid)::text id', [person.key]);
      ids.set(person.key, canonical!.id);
    }
  }
  const usable = paths.filter((p, index) => {
    for (const key of [p?.lp, p?.other?.key]) if (key && badKeys.has(key)) reject(index, badKeys.get(key)!);
    if (!rejected.has(index)) return true;
    onSkip(index, [...new Set(rejected.get(index)!)]);
    return false;
  });
  const needed = new Set(usable.flatMap((p) => [p.lp, p.other.key]));
  for (const person of descriptors.values()) {
    if (!needed.has(person.key)) continue;
    let id = ids.get(person.key);
    if (!id) {
      id = (await tx.one<{ id: string }>(`insert into identity.entity (entity_id, entity_type, display_name) values ($1, $3::identity.entity_type, $2) returning entity_id::text as id`, [person.key, person.name, person.entityType ?? 'person']))!.id;
    }
    ids.set(person.key, id);
    if (mappedKeys.has(person.key)) continue;
    await tx.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by) values ('w3_person', $1, $2, 'rule:sourced-person')`, [person.key, id]);
  }
  const indices = new Map(paths.map((p, index) => [p, index]));
  return usable.map((p) => {
    const resolved = { ...p, lp: ids.get(p.lp) ?? p.lp,
      other: p.other.key && ids.has(p.other.key) ? { ...p.other, key: ids.get(p.other.key)! } : p.other };
    context.onResolved?.(indices.get(p)!, resolved);
    return resolved;
  });
}

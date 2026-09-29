import { check as findingProblems, type Finding } from './schema';
import { resolveEntity } from '@/modules/identity/create';
import { TooManyRows, type Queryable } from '@/lib/db';
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
  // Preflight with bounded set reads instead of three round trips per descriptor.
  const descriptorKeys = [...descriptors.keys()].filter(key => !badKeys.has(key));
  const mappedRows = await tx.query<{ key: string; id: string; type: string }>(
    `select s.source_id key,e.entity_id::text id,e.entity_type::text type from identity.source_record s
     join identity.entity e on e.entity_id=identity.canonical_entity_id(s.entity_id)
     where s.source='w3_person' and s.source_id=any($1::text[])`, [descriptorKeys]);
  const mappedByKey = new Map<string, typeof mappedRows[number]>();
  for (const row of mappedRows) {
    // The previous one() refused corrupt duplicate mappings; keep that refusal.
    if (mappedByKey.has(row.key)) throw new TooManyRows(mappedRows.filter(candidate => candidate.key === row.key).length);
    mappedByKey.set(row.key, row);
  }
  const existingByKey = new Map((await tx.query<{ key: string; id: string; name: string; type: string }>(
    `select requested.key::text key,e.entity_id::text id,e.display_name name,e.entity_type::text type
     from unnest($1::uuid[]) requested(key)
     join identity.entity e on e.entity_id=identity.canonical_entity_id(requested.key)`, [descriptorKeys],
  )).map(row => [row.key, row]));
  const oppositeTypes = new Map<string, Set<string>>();
  for (const row of await tx.query<{ name: string; type: string }>(
    `select distinct names.name,e.entity_type::text type from unnest($1::text[]) names(name)
     join identity.entity e on lower(trim(e.display_name))=lower(trim(names.name))
     where e.merged_into is null and e.retired_at is null`,
    [[...descriptors.values()].map(person => person.name)],
  )) oppositeTypes.set(row.name, (oppositeTypes.get(row.name) ?? new Set()).add(row.type));
  // Resolve existing identities first. No node is created for a skipped-only path.
  for (const person of descriptors.values()) {
    if (badKeys.has(person.key)) continue;
    const type = person.entityType ?? 'person';
    const mapped = mappedByKey.get(person.key);
    if (mapped) {
      if (mapped.type !== type) badKeys.set(person.key, 'Connector type conflicts with its existing source mapping');
      else { ids.set(person.key, mapped.id); mappedKeys.add(person.key); }
      continue;
    }
    const existing = existingByKey.get(person.key.toLowerCase());
    if (existing && (existing.type !== type || norm(existing.name) !== norm(person.name))) {
      badKeys.set(person.key, 'Connector identity conflicts with an existing entity'); continue;
    }
    if ([...(oppositeTypes.get(person.name) ?? [])].some(other => other !== type)) {
      badKeys.set(person.key, 'Connector name conflicts with an existing entity type'); continue;
    }
    if (existing) ids.set(person.key, existing.id);
  }
  const usable = paths.filter((p, index) => {
    for (const key of [p?.lp, p?.other?.key]) if (key && badKeys.has(key)) reject(index, badKeys.get(key)!);
    if (!rejected.has(index)) return true;
    onSkip(index, [...new Set(rejected.get(index)!)]);
    return false;
  });
  const needed = new Set(usable.flatMap((p) => [p.lp, p.other.key]));
  const mappings: Array<{ key: string; id: string }> = [];
  for (const person of descriptors.values()) {
    if (!needed.has(person.key)) continue;
    let id = ids.get(person.key);
    if (!id) {
      const finding=context.findings?.map(r=>r.value as Finding).find(f=>f && f.key===person.key && !findingProblems(f,person.key).length && ['confirmed','probable'].includes(f.identity.match));
      id = (await resolveEntity(tx, { type: person.entityType ?? 'person', name: person.name,
        source: 'w3_person', sourceId: person.key, id: person.key.toLowerCase(),
        organizations: finding?.identity?.canonical?.org ? [finding.identity.canonical.org] : [],
        personalUrls: finding?.identity?.links?.filter(l=>['bio','linkedin','x'].includes(l.kind)).map(l=>l.url),
        resolvedBy: 'rule:sourced-person' })).id;
      mappedKeys.add(person.key);
    }
    ids.set(person.key, id);
    if (!mappedKeys.has(person.key)) mappings.push({ key: person.key, id });
  }
  for (let i = 0; i < mappings.length; i += 500) await tx.query(
    `insert into identity.source_record (source,source_id,entity_id,resolved_by)
     select 'w3_person',key,id,'rule:sourced-person' from jsonb_to_recordset($1::jsonb) as r(key text,id uuid)`,
    [JSON.stringify(mappings.slice(i, i + 500))]);
  const indices = new Map(paths.map((p, index) => [p, index]));
  return usable.map((p) => {
    const resolved = { ...p, lp: ids.get(p.lp) ?? p.lp,
      other: p.other.key && ids.has(p.other.key) ? { ...p.other, key: ids.get(p.other.key)! } : p.other };
    context.onResolved?.(indices.get(p)!, resolved);
    return resolved;
  });
}

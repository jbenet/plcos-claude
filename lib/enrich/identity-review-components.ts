import type { ImportDuplicateReport } from './import-dupes';

type Group = ImportDuplicateReport['ambiguous'][number];
type Pair = { a: string; b: string; name: string };
const creationReason = 'creation name-only match requires identity review';

/** Fold queued edges and existing review groups once, including transitive bridges.
 * Reasons are atomic: nesting a prior group's joined reason on every edge makes
 * dense name-only components accumulate megabytes of repeated prose.
 */
export function foldIdentityReviewComponents(groups: Group[], pairs: Pair[]): Group[] {
  if (!pairs.length) return groups;
  const parent = new Map<string, string>(), sizes = new Map<string, number>();
  const root = (id: string): string => {
    if (!parent.has(id)) { parent.set(id, id); sizes.set(id, 1); }
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (id !== r) { const next = parent.get(id)!; parent.set(id, r); id = next; }
    return r;
  };
  const union = (a: string, b: string) => {
    let x = root(a), y = root(b);
    if (x === y) return;
    if (sizes.get(x)! < sizes.get(y)!) [x, y] = [y, x];
    parent.set(y, x); sizes.set(x, sizes.get(x)! + sizes.get(y)!);
  };
  for (const group of groups) for (const id of group.entityIds) union(group.entityIds[0]!, id);
  for (const pair of pairs) union(pair.a, pair.b);
  const touched = new Map<string, { name: string; order: number; ids: Set<string>; reasons: Set<string> }>();
  pairs.forEach((pair, order) => {
    const key = root(pair.a), component = touched.get(key);
    if (component) { component.name = pair.name; component.order = order; }
    else touched.set(key, { name: pair.name, order, ids: new Set(), reasons: new Set([creationReason]) });
  });
  for (const id of parent.keys()) touched.get(root(id))?.ids.add(id);
  const untouched: Group[] = [];
  for (const group of groups) {
    const component = group.entityIds.length ? touched.get(root(group.entityIds[0]!)) : undefined;
    if (!component) untouched.push(group);
    else for (const reason of group.reason.split('; ')) component.reasons.add(reason);
  }
  return [...untouched, ...[...touched.values()].sort((a, b) => a.order - b.order).map(c => ({
    name: c.name, entityIds: [...c.ids].sort(), reason: [...c.reasons].join('; '),
  }))];
}

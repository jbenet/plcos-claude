/** Read-only LP grouping. Identity and vehicle scope, never matching display names, join rows.
 * Children remain real pursuits/readings: a heading neither invents a pursuit nor transfers
 * a person's status, evidence or money to their organisation. */
export interface LpGroupIdentity {
  id: string; entityId: string; vehicleId: string;
  isOrg: boolean; orgId: string | null; org: string | null; orgFirst?: boolean;
}
export interface LpGroup<T> { id: string; org: string | null; people: T[] }

export function groupLps<T>(rows: T[], identity: (row: T) => LpGroupIdentity,
  compare: (a: T, b: T) => number, universe: T[] = rows): LpGroup<T>[] {
  const orgs = new Set<string>();
  const members = new Map<string, Set<string>>();
  for (const row of universe) {
    const r = identity(row), org = r.isOrg ? r.entityId : r.orgId;
    if (!org) continue;
    const key = `${r.vehicleId}:${org}`;
    if (r.isOrg || r.orgFirst) orgs.add(key);
    if (!r.isOrg) {
      const ids = members.get(key) ?? new Set<string>();
      ids.add(r.entityId); members.set(key, ids);
      if (ids.size > 1) orgs.add(key);
    }
  }
  const groups = new Map<string, LpGroup<T>>();
  for (const row of rows) {
    const r = identity(row), org = r.isOrg ? r.entityId : r.orgId;
    const key = org && orgs.has(`${r.vehicleId}:${org}`) ? `${r.vehicleId}:${org}` : `row:${r.id}`;
    const group = groups.get(key) ?? { id: key, org: org && orgs.has(key) ? r.org : null, people: [] };
    group.people.push(row); groups.set(key, group);
  }
  const best = (g: LpGroup<T>) => g.people.reduce((a, b) => compare(a, b) <= 0 ? a : b);
  return [...groups.values()].sort((a, b) => compare(best(a), best(b)) || a.id.localeCompare(b.id)).map(g => {
    g.people.sort(compare);
    const own = g.people.findIndex(r => identity(r).isOrg);
    if (own > 0) g.people.unshift(...g.people.splice(own, 1));
    return g;
  });
}

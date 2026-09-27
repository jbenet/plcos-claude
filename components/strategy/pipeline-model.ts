import type { PipelineRow } from './PipelineTable';
export type SortKey = 'score' | 'priority' | 'name' | 'vehicle' | 'owner' | 'status' | 'where' | 'capacity' | 'route' | 'meetings' | 'touch' | 'read' | 'ladder';
export const SORT_KEYS: SortKey[] = ['score','priority','name','vehicle','owner','status','where','capacity','route','meetings','touch','read','ladder'];
export const numeric = new Set<SortKey>(['score','priority','capacity','route','meetings','touch','ladder']);
export const lead = (r: PipelineRow) => r.orgFirst && r.org ? r.org : r.name;
export function compareRows(a: PipelineRow, b: PipelineRow, key: SortKey, dir: 1 | -1): number {
  const value = (r: PipelineRow): string | number | null => {
    switch (key) {
      case 'name': return lead(r);
      case 'where': return [r.money?.state, r.money?.amount, r.ended, r.next, r.said].filter(Boolean).join(' ') || null;
      case 'capacity': return r.capacitySort;
      case 'touch': return r.lastTouch ? Date.parse(r.lastTouch) : null;
      case 'ladder': return r.rung;
      case 'read': return r.readSuperseded ? null : r.read;
      default: return r[key];
    }
  };
  const av = value(a), bv = value(b);
  // Missing evidence stays at the bottom in either direction.
  if (av === null || bv === null) return av === bv ? a.id.localeCompare(b.id) : av === null ? 1 : -1;
  const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
  return order * dir || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
/** Identity, not a matching display name, determines an organisation group. Never merge vehicles. */
export function groupRows(rows: PipelineRow[], key: SortKey, dir: 1 | -1) {
  const groups = new Map<string, PipelineRow[]>();
  for (const r of rows) {
    const id = r.orgFirst && r.orgId ? `${r.vehicleId}:${r.orgId}` : r.id;
    const group = groups.get(id) ?? []; group.push(r); groups.set(id, group);
  }
  const compare = (a: PipelineRow, b: PipelineRow) => compareRows(a, b, key, dir);
  return [...groups.entries()].map(([id, people]) => ({ id, people: people.sort(compare) }))
    .sort((a, b) => compare(a.people[0]!, b.people[0]!));
}

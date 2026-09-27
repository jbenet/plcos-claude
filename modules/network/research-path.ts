import type { Path } from '@/lib/enrich/connect';

export interface RoutePerson { id: string; name: string; handle?: string }
const nameKey = (s: string) => s.replace(/\s*\([^()]*\)\s*$/, '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Old W3 files classified named people as `ours`/`backer`. Resolve uniquely, never fuzzily.
 * An explicit but missing ID is not permission to substitute a namesake.
 */
export function researchEndpoint(other: Path['other'], people: RoutePerson[]): string | null {
  if (other.key) return people.some((p) => p.id === other.key) ? other.key : null;
  if (other.handle) return people.find((p) => p.handle === other.handle)?.id ?? null;
  const key = nameKey(other.name);
  if (!key.includes(' ')) return null;
  const matches = people.filter((p) => nameKey(p.name) === key);
  return matches.length === 1 ? matches[0]!.id : null;
}

/** Build once per import: preserve exact-ID precedence and ambiguous-name refusal. */
export function researchEndpointResolver(people: RoutePerson[]): (other: Path['other']) => string | null {
  const ids = new Set(people.map(p => p.id));
  const handles = new Map<string, string>();
  const names = new Map<string, string | null>();
  for (const person of people) {
    if (person.handle && !handles.has(person.handle)) handles.set(person.handle, person.id);
    const key = nameKey(person.name);
    names.set(key, names.has(key) ? null : person.id);
  }
  return other => {
    if (other.key) return ids.has(other.key) ? other.key : null;
    if (other.handle) return handles.get(other.handle) ?? null;
    const key = nameKey(other.name);
    return key.includes(' ') ? names.get(key) ?? null : null;
  };
}

/** Retain the recorded tier; warmth metadata may describe an explicitly documented co-founding. */
export function researchTie(p: Path) {
  return p.tie ?? ((p.tier === 'C' || p.tier === 'D' || p.kind === 'same_firm')
    ? { kind: 'proximity' as const }
    : /\bco[ -]?founded\b|\bco[ -]?founders\b|\bfounded\b.+\bwith\b/i.test(p.basis)
      ? { kind: 'cofounder' as const } : undefined);
}

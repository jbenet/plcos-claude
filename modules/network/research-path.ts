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

/** Retain the recorded tier; warmth metadata may describe an explicitly documented co-founding. */
export function researchTie(p: Path) {
  return p.tie ?? ((p.tier === 'C' || p.tier === 'D' || p.kind === 'same_firm')
    ? { kind: 'proximity' as const }
    : /\bco[ -]?founded\b|\bco[ -]?founders\b|\bfounded\b.+\bwith\b/i.test(p.basis)
      ? { kind: 'cofounder' as const } : undefined);
}

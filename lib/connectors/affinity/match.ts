import type { RealInit } from '@/lib/real/init';
import type { AffinityList, AffinityUser } from './discover';

/**
 * Matching the init file's words against Affinity's names (N41). Pure functions: no
 * database, no network, so the property harness can hold them to their promises.
 *
 * A list name matches when it is the same name once case, spacing and the kind of dash are
 * set aside — people type a hyphen where Affinity shows an em dash, and that is not a
 * different list. Anything looser is a *suggestion*, shown as one, never a match: an import
 * that quietly read the wrong list would be worse than one that refused to start.
 */
export function normName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string) => new Set(normName(s).split(/[^a-z0-9]+/).filter(Boolean));

/** Share of words in common, 0–1. For suggestions only. */
export function likeness(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export interface ListMatch {
  vehicleSlug: string;
  vehicleName: string;
  /** As written in the init file. */
  wanted: string;
  list: AffinityList | null;
  /** When nothing matched: the most alike list, if any is close. Not a match. */
  closest: { list: AffinityList; likeness: number } | null;
}

export function matchLists(init: RealInit, lists: AffinityList[]): ListMatch[] {
  const byName = new Map(lists.map((l) => [normName(l.name), l]));
  const out: ListMatch[] = [];
  for (const v of init.vehicles) {
    for (const wanted of v.affinityLists) {
      const list = byName.get(normName(wanted)) ?? null;
      let closest: ListMatch['closest'] = null;
      if (!list) {
        for (const l of lists) {
          const score = likeness(wanted, l.name);
          if (score >= 0.5 && (!closest || score > closest.likeness)) closest = { list: l, likeness: score };
        }
      }
      out.push({ vehicleSlug: v.slug, vehicleName: v.name, wanted, list, closest });
    }
  }
  return out;
}

/** Lists that say SPV and that no vehicle claims yet: candidates for the init file. */
export function spvCandidates(lists: AffinityList[], matches: ListMatch[]): AffinityList[] {
  const claimed = new Set(matches.filter((m) => m.list).map((m) => m.list!.id));
  return lists.filter((l) => /\bspv\b/i.test(l.name) && !claimed.has(l.id));
}

export interface UserMatch {
  handle: string;
  name: string;
  /** How the match was made, so an address guessed from `email` reads as a guess. */
  via: 'affinityEmail' | 'email' | null;
  user: AffinityUser | null;
}

export function matchTeam(init: RealInit, users: AffinityUser[]): UserMatch[] {
  const find = (email: string | null) => {
    if (!email) return null;
    const e = email.toLowerCase();
    return users.find((u) => u.primaryEmailAddress?.toLowerCase() === e || u.emailAddresses?.some((x) => x.toLowerCase() === e)) ?? null;
  };
  return init.team.map((t) => {
    const byAffinity = find(t.affinityEmail);
    if (byAffinity) return { handle: t.handle, name: t.name, via: 'affinityEmail' as const, user: byAffinity };
    const byEmail = t.affinityEmail ? null : find(t.email);
    return { handle: t.handle, name: t.name, via: byEmail ? ('email' as const) : null, user: byEmail };
  });
}

import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import type { WarmthKind } from '@/modules/network/warmth';

export interface WarehousePerson {
  key: string; name: string; org: string | null; emailDomain: string | null;
  roles: string[]; warehouseIds: Record<string, string>; teamKey?: string; oneHop?: boolean;
  source: string; as_of: string; confidence: string; last_verified_by: string;
}
export interface WarehouseTie {
  key: string; from: string; to: string; kind: WarmthKind; tier: 'A'|'B'|'C'|'D';
  firstSeen: string|null; lastSeen: string|null; source: string; rowIds: string[]; count: number;
}
export interface WarehouseMatch {
  lpKey: string; personKey: string; score: number; status: 'confident'|'ambiguous'; basis: string[];
}
export interface WarehouseGraph { people: WarehousePerson[]; ties: WarehouseTie[]; matches: WarehouseMatch[] }
export const graphKey = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
export const normalizedName = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const redactWarehouseText = (s: string) => s.replace(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi, '[address removed]');
const orgKey = (s: string) => normalizedName(s.replace(/\b(inc|llc|ltd|limited|corporation)\.?$/i, ''));
const freeDomain = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|aol|protonmail|proton|live|msn|fastmail|hey)\./i;
export type GraphIdentity = { key: string; name: string; org: string|null; domains: string[] };
/** Scores are deterministic match rules, not calibrated probabilities. Never resolve a collision. */
export function matchWarehousePeople(lps: GraphIdentity[], people: WarehousePerson[]): WarehouseMatch[] {
  const index = new Map<string, WarehousePerson[]>();
  for (const p of people) {
    const n = normalizedName(p.name); if (!n) continue;
    index.set(n, [...(index.get(n) ?? []), p]);
  }
  const matches = lps.flatMap(lp => {
    const hits = (index.get(normalizedName(lp.name)) ?? []).map(p => {
      const org = !!lp.org && !!p.org && !!orgKey(lp.org) && orgKey(lp.org) === orgKey(p.org);
      const domain = !!p.emailDomain && !freeDomain.test(p.emailDomain) && lp.domains.some(d => d.toLowerCase() === p.emailDomain!.toLowerCase());
      return { lpKey: lp.key, personKey: p.key, score: org && domain ? 1 : org || domain ? .95 : .6,
        status: 'ambiguous' as WarehouseMatch['status'], basis: ['exact normalized name', ...(org ? ['organization'] : []), ...(domain ? ['work domain'] : [])] };
    });
    const supported = hits.filter(h => h.score >= .95);
    // An equally named record remains separate. A single corroborated match can disambiguate name-only alternatives.
    if (supported.length === 1) supported[0]!.status = 'confident';
    return hits;
  });
  const owners = new Map<string, Set<string>>();
  for (const m of matches) if (m.status === 'confident') {
    const ids = owners.get(m.personKey) ?? new Set<string>(); ids.add(m.lpKey); owners.set(m.personKey, ids);
  }
  for (const m of matches) if ((owners.get(m.personKey)?.size ?? 0) > 1) {
    m.status = 'ambiguous'; m.basis.push('warehouse identity matches multiple LP records');
  }
  return matches;
}
export type TieEvidence = 'direct_contact'|'named_coinvestment'|'shared_company'|'cofounders'|'event'|'portfolio'|'demo_interest';
export function classifyWarehouseTie(evidence: TieEvidence, count: number): Pick<WarehouseTie, 'tier'|'kind'> {
  switch (evidence) {
    case 'direct_contact': return { tier: 'B', kind: count >= config.routeWarmth.repeatedContacts ? 'repeated_contact' : 'acquaintance' };
    case 'named_coinvestment': return { tier: 'B', kind: 'joint_investment' };
    // A founder flag plus company membership lacks dated collaboration evidence.
    case 'cofounders': return { tier: 'C', kind: 'cofounder' };
    case 'shared_company': return { tier: 'C', kind: 'proximity' };
    case 'portfolio': return { tier: 'C', kind: 'proximity' };
    case 'event': case 'demo_interest': return { tier: 'D', kind: 'proximity' };
  }
}

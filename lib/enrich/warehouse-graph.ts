import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import type { WarmthKind } from '@/modules/network/warmth';

export interface WarehousePerson {
  key: string; name: string; org: string | null; emailDomain: string | null;
  roles: string[]; warehouseIds: Record<string, string>; teamKey?: string; oneHop?: boolean; nodeType?: 'person'|'organization';
  source: string; as_of: string; confidence: string; last_verified_by: string;
}
export interface WarehouseTie {
  key: string; from: string; to: string; kind: WarmthKind; tier: 'A'|'B'|'C'|'D';
  basis?: 'pl_affiliation'|'pl_network'|'firm_attribution';
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
export type TieEvidence = 'direct_contact'|'named_coinvestment'|'shared_company'|'cofounders'|'event'|'portfolio'|'demo_interest'|'demo_action';
export function classifyWarehouseTie(evidence: TieEvidence, count: number): Pick<WarehouseTie, 'tier'|'kind'> {
  switch (evidence) {
    case 'direct_contact': return { tier: 'B', kind: count >= config.routeWarmth.repeatedContacts ? 'repeated_contact' : 'acquaintance' };
    case 'named_coinvestment': return { tier: 'B', kind: count >= config.routeWarmth.frequentDeals ? 'frequent_coinvestment' : 'joint_investment' };
    // A founder flag plus company membership lacks dated collaboration evidence.
    case 'cofounders': return { tier: 'C', kind: 'cofounder' };
    case 'shared_company': return { tier: 'C', kind: 'proximity' };
    case 'portfolio': return { tier: 'C', kind: count >= config.routeWarmth.frequentDeals ? 'frequent_coinvestment' : 'joint_investment' };
    // A company action names its actor, but does not establish which employee received it.
    case 'demo_action': return { tier: 'C', kind: count >= config.routeWarmth.repeatedContacts ? 'repeated_contact' : 'acquaintance' };
    case 'event': case 'demo_interest': return { tier: 'D', kind: 'proximity' };
    default: throw new Error('Unknown warehouse tie evidence');
  }
}


/** Explicit policy edges are not claimed meetings. A CRM record alone never qualifies. */
export function addWarehouseNetworkTies(people: WarehousePerson[], asOf: string): WarehouseTie[] {
  const plKey = 'organization:protocol-labs';
  if (!people.some(p => p.key === plKey)) people.push({ key: plKey, name: 'PL', org: null, emailDomain: null,
    nodeType: 'organization', roles: ['PL network'], warehouseIds: {}, oneHop: true,
    source: 'AGENTS.md rule 6 (2026-09-26)', as_of: asOf, confidence: 'PL network affiliation policy',
    last_verified_by: 'warehouse-graph deterministic policy' });
  const sources = people.filter(p => p.teamKey || p.roles.includes('PL team') || p.key === plKey);
  const out = new Map<string, WarehouseTie>();
  for (const person of people.filter(p => p.oneHop || p.teamKey)) for (const source of sources) {
    if (source.key === person.key) continue;
    const [from,to] = [source.key,person.key].sort() as [string,string];
    const key = graphKey(`${from}|${to}|pl_network`);
    const colleagues = (person.roles.includes('PL team') || !!person.teamKey)
      && (source.roles.includes('PL team') || !!source.teamKey);
    out.set(key,{key,from,to,tier:'B',kind:colleagues?'worked_together':'acquaintance',
      basis:colleagues?'pl_affiliation':'pl_network',firstSeen:null,lastSeen:null,
      source:'AGENTS.md rule 6 (2026-09-26); '+person.source,rowIds:[person.key],count:1});
  }
  return [...out.values()];
}

/** Affiliation only: do not assign a firm's investment decision to an employee at tier B. */
export function addWarehouseFirmTies(lps: GraphIdentity[], matches: WarehouseMatch[], people: WarehousePerson[], ties: WarehouseTie[]): WarehouseTie[] {
  const organizations = people.filter(p => p.key.startsWith('coinvestor:'));
  const byOrg = new Map<string, WarehousePerson[]>();
  for (const p of organizations) { const k=orgKey(p.name); if(k) byOrg.set(k,[...(byOrg.get(k)??[]),p]); }
  const candidates = new Map(lps.map(p=>[p.key,p]));
  const personByKey = new Map(people.map(p=>[p.key,p]));
  const firmEdges = new Map<string, WarehouseTie[]>();
  for (const t of ties) for (const key of [t.from,t.to]) if (key.startsWith('coinvestor:')) firmEdges.set(key,[...(firmEdges.get(key)??[]),t]);
  const out = new Map<string,WarehouseTie>();
  for (const match of matches.filter(m=>m.status==='confident')) {
    const lp=candidates.get(match.lpKey), person=personByKey.get(match.personKey);
    const orgs=new Set([lp?.org,person?.org].filter((s):s is string=>!!s).map(orgKey));
    for(const org of orgs) for(const firm of byOrg.get(org)??[]) for(const tie of firmEdges.get(firm.key)??[]) {
      const founder=tie.from===firm.key?tie.to:tie.from;
      if(founder===match.personKey) continue;
      const [from,to]=[match.personKey,founder].sort() as [string,string];
      const key=graphKey(`${from}|${to}|${firm.key}|firm_attribution`);
      out.set(key,{...tie,key,from,to,tier:'C',basis:'firm_attribution',source:tie.source+'; exact organization affiliation'});
    }
  }
  return [...out.values()];
}

/** Topological coverage includes weak evidence, not an authorization or a supported-intro claim. */
export function warehouseCoverage(people: WarehousePerson[], ties: WarehouseTie[], matches: WarehouseMatch[]) {
  const adjacent=new Map<string,Set<string>>();
  for(const t of ties) for(const [a,b] of [[t.from,t.to],[t.to,t.from]]) {
    const set=adjacent.get(a!)??new Set<string>();set.add(b!);adjacent.set(a!,set);
  }
  const warm=new Set(people.filter(p=>p.oneHop||p.teamKey).map(p=>p.key));
  const sources=people.filter(p=>p.teamKey||p.roles.includes('PL team')||p.key==='organization:protocol-labs').map(p=>p.key);
  const distance=new Map(sources.map(k=>[k,0])); let frontier=sources;
  for(let hop=1;hop<=2;hop++) { const next:string[]=[];
    for(const k of frontier) for(const n of adjacent.get(k)??[]) if(!distance.has(n)) {distance.set(n,hop);next.push(n);} frontier=next;
  }
  const confident=matches.filter(m=>m.status==='confident');
  return { matched:new Set(confident.map(m=>m.lpKey)).size,
    anyTie:new Set(confident.filter(m=>(adjacent.get(m.personKey)?.size??0)>0).map(m=>m.lpKey)).size,
    tieToOneHopOrPL:new Set(confident.filter(m=>[...(adjacent.get(m.personKey)??[])].some(k=>warm.has(k))).map(m=>m.lpKey)).size,
    withinTwoHops:new Set(confident.filter(m=>distance.has(m.personKey)).map(m=>m.lpKey)).size };
}

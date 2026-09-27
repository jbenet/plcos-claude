import type { NetworkNodeInput } from '@/modules/network/nodes';
import { connectionPersonKey } from '@/lib/enrich/connect';
import { normalizeIdentityName, type IdentityEvidence } from './resolution';
import { parseProspectFile, prospectPersonKey, type ProspectFile } from '@/lib/enrich/prospects';

/** Restrict free-text identity references to explicit source IDs (never merely mentioning a source). */
export function identityEvidence(input: NetworkNodeInput | null, prospects: ProspectFile[] = []): IdentityEvidence[] {
  const out:IdentityEvidence[]=[];
  if(input){
    const rosterProfiles = new Map<string, string[]>();
    for (const t of input.team) for (const url of [...(t.sources ?? []), ...t.roles.map(r => r.source), ...t.prior.map(r => r.source)]) {
      if (!url || !/^https:\/\/[^/]+\/person\//i.test(url)) continue;
      rosterProfiles.set(url, [...new Set([...(rosterProfiles.get(url) ?? []), t.handle])]);
    }
    const warehouseByName = new Map<string, typeof input.warehouse.people>();
    const warehouseIds = new Set<string>();
    for (const p of input.warehouse.people) {
      const name = normalizeIdentityName(p.name);
      warehouseByName.set(name, [...(warehouseByName.get(name) ?? []), p]);
      for (const id of [p.key, ...Object.values(p.warehouseIds)]) warehouseIds.add(id);
    }
    for(const m of input.warehouse.matches)if(m.status==='confident')out.push({entityId:m.lpKey,warehouseIds:[m.personKey]});
    for(const c of input.candidates)out.push({entityId:c.key,organizations:c.org?[c.org]:[],domains:c.domains});
    for(const p of input.warehouse.people) {
      const profile = p.key.startsWith('coinvestor:') ? p.key.slice('coinvestor:'.length) : '';
      const handles = rosterProfiles.get(profile) ?? [];
      const profileHandle = handles.length === 1 && input.team.some(t => t.handle === handles[0]
        && normalizeIdentityName(t.name) === normalizeIdentityName(p.name)) ? handles[0] : null;
      out.push({source:'warehouse',sourceId:p.key,organizations:p.org?[p.org]:[],domains:p.emailDomain?[p.emailDomain]:[],warehouseIds:[p.key,...Object.values(p.warehouseIds)],
        teamReferences: p.teamKey && input.team.some(t => t.handle === p.teamKey) ? [`app_user:${p.teamKey}`]
          : profileHandle ? [`app_user:${profileHandle}`] : []});
    }
    for(const r of input.graph)for(const e of [r.from,r.to])if(e.type==='person'){
      const source=r.sources?.find(s=>s.url)?.url??r.provenance.source;
      const ids=(e.identity?.sourceIds??[]).map(id=>id.replace(/^warehouse:/,''));
      out.push({source:'w3_person',sourceId:connectionPersonKey(e.name,source),organizations:e.contextOrganization?[e.contextOrganization]:[],
        warehouseIds:ids.filter(id=>warehouseIds.has(id)),references:ids});
    }
    for(const f of input.findings)if(['confirmed','probable'].includes(f.identity.match)){
      const owner:IdentityEvidence=/^[0-9a-f]{8}-/i.test(f.key)?{entityId:f.key}:{source:'warehouse',sourceId:f.key};
      const references:string[]=[];
      for(const p of warehouseByName.get(normalizeIdentityName(f.name)) ?? [])if( [p.key,...Object.values(p.warehouseIds)].some(id=>id.length>3&&f.identity.basis.includes(id)))references.push(`warehouse:${p.key}`);
      // Explicit source identifiers in a finding are evidence; vague name agreement is not.
      for(const m of f.identity.basis.matchAll(/\b(affinity|w3_person|warehouse|prospect):([^\s,;)]+)/gi))references.push(`${m[1]!.toLowerCase()}:${m[2]}`);
      out.push({...owner,organizations:f.identity.canonical?.org?[f.identity.canonical.org]:[],references});
    }
  }
  for(const file of prospects)for(const record of parseProspectFile(file).records){
    const p = record.p as unknown as Record<string,unknown>;
    const personKey = prospectPersonKey(record.p);
    const ids=typeof p.warehouseId==='string'?[p.warehouseId]:Array.isArray(p.warehouseIds)?p.warehouseIds.filter((x):x is string=>typeof x==='string'):p.warehouseIds&&typeof p.warehouseIds==='object'?Object.values(p.warehouseIds).filter((x):x is string=>typeof x==='string'):[];
    // personKey often is the warehouse key itself.
    if(typeof p.personKey === 'string' && input?.warehouse.people.some(w=>w.key===p.personKey))ids.push(p.personKey);
    out.push({source:'prospect',sourceId:personKey,organizations:typeof p.org==='string'?[p.org]:[],warehouseIds:ids,
      domains:typeof p.emailDomain==='string'?[p.emailDomain]:[]});
  }
  return out;
}

/** All discovered people and organizations, independent of the current LP route shortlist.
 * Files are read locally; the caller owns the existing server transaction. No database is opened here.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import type { Queryable } from '@/lib/db';
import { readWarehouseGraph, connectionPersonKey, type TeamMember, type Network, type WarehouseGraph } from '@/lib/enrich/connect';
import { check as checkFinding, type Finding } from '@/lib/enrich/schema';
import type { EdgeKind, EvidenceTier } from './types';
import { tieWarmth, type TieDetails } from './warmth';

interface ResearchEndpoint {
  name: string; type: 'person'|'organization'|'org'; contextOrganization?: string; contextIsEmploymentClaim?: boolean;
  identity?: { match?: string; sourceIds?: string[] }; localNameMatches?: Array<{key:string;name?:string}>;
}
export interface ResearchGraphRow {
  id: string; from: ResearchEndpoint; to: ResearchEndpoint; kind: string; claim: string; scope?: string;
  startHandle?: string; hop?: number;
  provenance: {source:string;as_of:string;confidence:string;last_verified_by:string|null};
  sources?: Array<{id:string;url?:string}>; evidenceTier: {proposed:EvidenceTier};
  recency?: {documentedAt?:string|null;lastPersonalContact?:string|null};
}
export interface DirectTieRow {
  lp:string; recordId:string; on:string; channel:string; direction:string|null; participantObserved?:string;
  team:{handle?:string|null;name?:string|null}|null; identity:{lp:string;team:string}; tier:EvidenceTier|null;
  eligible:boolean; holds?:string[]; source:{url:string;as_of:string;last_verified_by?:string|null};
}
export interface NetworkNodeInput {
  warehouse: WarehouseGraph;
  candidates: Array<{key:string;name:string;type?:string;org:string|null;domains?:string[]}>;
  team: TeamMember[]; graph: ResearchGraphRow[]; direct: DirectTieRow[]; findings: Finding[]; network?: Network;
}
export interface NodeSpec {
  key:string; source:string; sourceId:string; name:string; type:'person'|'org';
  entityId?:string; teamHandle?:string;
}
export interface NodeEdge {
  from:string; to:string; kind:EdgeKind; tier:EvidenceTier; tie:TieDetails;
  source:string; rowIds:string[]; note:string; asOf:string; lastVerifiedBy:string|null;
}
export interface NodePlan { nodes:NodeSpec[]; edges:NodeEdge[]; warehouseLoaded:boolean }
export interface NodeImportCounts {
  nodesCreated:number; sourceRecords:number; edgesWritten:number; warehouseLoaded:boolean;
  edgePairs:Set<string>;
}
const normalized = (s:string) => s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const hash = (s:string) => createHash('sha256').update(s).digest('hex');
const uuid = (s:string) => { const h=hash(s); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const isUuid = (s:string) => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(s);
const isPL = (s:string) => ['pl','protocollabs'].includes(normalized(s));
const sourceKey = (source:string,id:string) => `${source}:${id}`;
export const nodePairKey = (a:string,b:string,kind:string) => `${[a,b].sort().join('|')}|${kind}`;
const day = (s:string|null|undefined, fallback:string) => /^\d{4}-\d{2}-\d{2}/.test(s??'') ? s!.slice(0,10) : fallback;
const edgeKind = (kind:string): EdgeKind => ({worked_together:'colleague',cofounder:'colleague',
  joint_investment:'coinvestor',frequent_coinvestment:'coinvestor',repeated_contact:'corresponded',acquaintance:'met',proximity:'other'} as Record<string,EdgeKind>)[kind] ?? 'other';

/** Pure preparation: source identities survive name collisions; every endpoint is materialized. */
export function planNetworkNodes(input:NetworkNodeInput, at=new Date()):NodePlan {
  const today=at.toISOString().slice(0,10), nodes=new Map<string,NodeSpec>(), edges:NodeEdge[]=[];
  const staff=new Set<string>(), members=new Set<string>(), candidateKeys=new Map<string,string>(), teamKeys=new Map<string,string>();
  const addNode=(source:string,id:string,name:string,type:'person'|'org',extra:Partial<NodeSpec>={}) => {
    const key=sourceKey(source,id);
    if (!nodes.has(key)) nodes.set(key,{key,source,sourceId:id,name,type,...extra});
    return key;
  };
  const org=(name:string) => addNode('network_org',isPL(name)?'pl':normalized(name),isPL(name)?'PL':name,'org');
  const pl=org('PL');
  const addEdge=(from:string,to:string,kind:EdgeKind,tier:EvidenceTier,tie:TieDetails,source:string,note:string,
    rowIds:string[],asOf=today,lastVerifiedBy:string|null=null) => {
    if (from!==to) edges.push({from,to,kind,tier,tie,source,note,rowIds,asOf,lastVerifiedBy});
  };
  const affiliation=(person:string,name:string,source:string,rowIds:string[],asOf=today,employment=true) => {
    if (!name.trim()) return;
    const company=org(name);
    if (employment && isPL(name) && nodes.get(person)?.type==='person') staff.add(person);
    addEdge(person,company,'other',employment?'C':'D',{kind:'proximity'},source,
      employment?'Recorded organizational affiliation; not a personal introduction.':'Organization named in the source; employment is not claimed.',rowIds,asOf);
  };
  for (const t of input.team) {
    const key=addNode('app_user',t.handle,t.name,'person',{teamHandle:t.handle}); teamKeys.set(t.handle,key); staff.add(key);
    for (const r of [...t.roles,...t.prior]) affiliation(key,r.org,r.source??'enrich/us/team.json',[t.handle]);
  }
  for (const c of input.candidates) {
    const key=addNode('network_candidate',c.key,c.name,c.type==='org'?'org':'person',isUuid(c.key)?{entityId:c.key}:{});
    candidateKeys.set(c.key,key);
    if(c.org && c.type!=='org') affiliation(key,c.org,'enrich/candidates.jsonl',[c.key]);
  }
  // Only a unique corroborated LP mapping in both directions is an identity alias.
  const byLP=new Map<string,string[]>(), byPerson=new Map<string,string[]>();
  for(const m of input.warehouse.matches) if(m.status==='confident') {
    byLP.set(m.lpKey,[...(byLP.get(m.lpKey)??[]),m.personKey]);
    byPerson.set(m.personKey,[...(byPerson.get(m.personKey)??[]),m.lpKey]);
  }
  const warehouseKeys=new Map<string,string>();
  for(const p of input.warehouse.people) {
    const lp=byPerson.get(p.key);
    const matched=lp?.length===1 && byLP.get(lp[0]!)?.length===1 ? input.candidates.find(c=>c.key===lp[0]) : undefined;
    const key=addNode('warehouse',p.key,p.name,'person',{
      ...(matched && isUuid(matched.key)?{entityId:matched.key}:{}),...(p.teamKey?{teamHandle:p.teamKey}:{})});
    warehouseKeys.set(p.key,key); members.add(key);
    if(p.roles.includes('PL team') || (p.org && isPL(p.org))) staff.add(key);
    if(p.org) affiliation(key,p.org,p.source,[p.key],p.as_of.slice(0,10));
  }
  for(const t of input.warehouse.ties) {
    const a=warehouseKeys.get(t.from),b=warehouseKeys.get(t.to);
    if(!a||!b) throw new Error('Warehouse tie references an absent person');
    addEdge(a,b,edgeKind(t.kind),t.tier,{kind:t.kind,lastInteraction:t.lastSeen},t.source,
      `${t.kind.replaceAll('_',' ')}; ${t.count} source records`,t.rowIds,today);
  }
  for(const list of [input.network?.orgs,input.network?.backers,input.network?.portfolio]) for(const x of list??[]) org(x.name);
  const sourcedPerson=(name:string,source:string) => addNode('w3_person',connectionPersonKey(name,source),name,'person');
  for(const p of input.network?.backer_people??[]) sourcedPerson(p.name,p.source);
  const exactTeam=(name:string) => {
    const matches=input.team.filter(t=>normalized(t.name)===normalized(name));
    return matches.length===1 ? teamKeys.get(matches[0]!.handle) : undefined;
  };
  const researchPerson=(endpoint:ResearchEndpoint,source:string) => {
    if(endpoint.type!=='person') return org(endpoint.name);
    const local=endpoint.localNameMatches;
    if(endpoint.identity?.match==='confirmed' && local?.length===1 && candidateKeys.has(local[0]!.key)) return candidateKeys.get(local[0]!.key)!;
    const key=exactTeam(endpoint.name)??sourcedPerson(endpoint.name,source);
    if(endpoint.contextOrganization) affiliation(key,endpoint.contextOrganization,source,[],today,endpoint.contextIsEmploymentClaim===true);
    return key;
  };
  for(const r of input.graph) {
    const source=r.sources?.find(s=>s.url)?.url??r.provenance.source;
    const a=researchPerson(r.from,source),b=researchPerson(r.to,source);
    const worked=/collaboration|coauthorship|colead/.test(r.kind),board=/board/.test(r.kind);
    const kind:EdgeKind=worked||r.kind==='cofounder'?'colleague':board?'board':r.kind==='academic_advising'?'advisor':r.kind==='public_conversation'?'met':/portfolio|investor/.test(r.kind)?'portfolio':'other';
    const warmth:TieDetails['kind']=r.kind==='cofounder'?'cofounder':worked?'worked_together':kind==='met'?'acquaintance':'proximity';
    addEdge(a,b,kind,r.evidenceTier.proposed,{kind:warmth,lastInteraction:r.recency?.lastPersonalContact},
      r.provenance.source,r.claim,[r.id,...(r.sources??[]).map(s=>s.id)],day(r.provenance.as_of,today),r.provenance.last_verified_by);
  }
  for(const r of input.direct) {
    const team=r.team?.handle ? teamKeys.get(r.team.handle) : undefined;
    const observed=r.team?.name || r.participantObserved;
    const person=team ?? (observed && !observed.includes('@') ? sourcedPerson(observed,r.source.url) : undefined);
    const lp=candidateKeys.get(r.lp);
    // Automatic mail, an unresolved participant, and an organization-linked person do not establish a personal interaction.
    // This is an evidence/identity check, not a human-review gate.
    if(r.eligible && person && lp && r.tier) addEdge(person,lp,r.channel==='email'?'corresponded':'met',r.tier,
      {kind:'acquaintance',lastInteraction:day(r.on,today)},r.source.url,'Named direct interaction in our records.',[r.recordId],day(r.source.as_of,today),r.source.last_verified_by??null);
  }
  const knownOrgs=new Set([...nodes.values()].filter(n=>n.type==='org').map(n=>normalized(n.name)));
  for(const f of input.findings) {
    const resolved=f.identity.match==='confirmed'||f.identity.match==='probable';
    const owner=(resolved?(candidateKeys.get(f.key)??warehouseKeys.get(f.key)):undefined)??
      addNode('network_finding',f.key,f.identity.canonical?.name??f.name,'person',resolved&&isUuid(f.key)?{entityId:f.key}:{});
    if(f.identity.canonical?.org) affiliation(owner,f.identity.canonical.org,`enrich/raw/${f.key}.json`,[f.key],day(f.researched.at,today));
    for(const fact of f.facts) {
      const organizations=new Set(['company','companies','organization','org','firm','fund','school','university','institution'].flatMap(k=>typeof fact.detail?.[k]==='string'?String(fact.detail[k]).split(/\s*;\s*/):[]));
      for(const name of organizations) {
        if(!name.trim()) continue;
        org(name); knownOrgs.add(normalized(name));
        if(['role','prior_role','affiliation','board'].includes(fact.field) && fact.scope!=='firm') affiliation(owner,name,fact.source.url,[f.key],day(fact.source.published??f.researched.at,today));
        else if(['investment','fund_lp','fund_gp','exit','education'].includes(fact.field)) {
          const from=fact.scope==='firm' && f.identity.canonical?.org ? org(f.identity.canonical.org) : owner;
          addEdge(from,org(name),fact.field==='education'?'alumni':'portfolio',fact.field==='education'?'D':'C',
            {kind:'proximity'},fact.source.url,`${fact.scope==='firm'?'Firm':'Person'} record: ${fact.value}`,[f.key],day(fact.source.published??f.researched.at,today));
        }
      }
    }
    for(const c of f.connections??[]) {
      const source=c.source??`enrich/raw/${f.key}.json`;
      const to=(c.toHandle?teamKeys.get(c.toHandle):undefined)??exactTeam(c.to)??
        (isPL(c.to)||knownOrgs.has(normalized(c.to))||/\b(capital|ventures|partners|foundation|university|labs|inc|llc|fund)\b/i.test(c.to)?org(c.to):sourcedPerson(c.to,source));
      const from=c.scope==='firm' && f.identity.canonical?.org ? org(f.identity.canonical.org) : owner;
      const tier=c.scope==='firm' && c.tier<'C'?'C':c.tier;
      addEdge(from,to,c.kind,tier,c.tie??{kind: tier==='C'||tier==='D'?'proximity':c.kind==='colleague'?'worked_together':'acquaintance'},
        source,c.basis,[f.key,...(c.feedbackId?[c.feedbackId]:[])],day(f.researched.at,today),c.reviewedBy??null);
    }
  }
  // Own network access is explicit policy, not fabricated contact evidence. Unknown dates stay unknown.
  for(const key of members) if(!staff.has(key)) addEdge(pl,key,'other','C',{kind:'proximity'},'AGENTS.md rule 6; warehouse membership',
    'PL network participant; no specific team member or personal interaction identified.',[nodes.get(key)!.sourceId]);
  for(const key of staff) addEdge(pl,key,'colleague','B',{kind:'worked_together'},'AGENTS.md rule 6; recorded PL affiliation',
    'Current or former PL colleague; own-network working tie. Contact date unknown.',[nodes.get(key)!.sourceId]);
  const colleagues=[...staff];
  for(let i=0;i<colleagues.length;i++) for(let j=i+1;j<colleagues.length;j++) addEdge(colleagues[i]!,colleagues[j]!,'colleague','B',
    {kind:'worked_together'},'AGENTS.md rule 6; recorded PL affiliations','Current or former PL colleagues; contact date unknown.',
    [nodes.get(colleagues[i]!)!.sourceId,nodes.get(colleagues[j]!)!.sourceId]);
  return {nodes:[...nodes.values()],edges,warehouseLoaded:input.warehouse.people.length>0};
}

/** Missing files are optional; malformed files fail with a data-free diagnostic. */
export async function readNetworkNodeInput(dir:string):Promise<NetworkNodeInput|null> {
  const read=async(name:string)=>readFile(join(dir,name),'utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return '';throw e;});
  const parse=<T>(s:string):T=>{try{return JSON.parse(s) as T;}catch{throw new Error('Invalid network input JSON');}};
  const lines=<T>(s:string)=>s.split('\n').filter(Boolean).map(l=>parse<T>(l));
  const [warehouse,candidates,team,graph,direct,network]=await Promise.all([readWarehouseGraph(dir),read('candidates.jsonl'),read('us/team.json'),
    read('us/graph-2026-09-26.jsonl'),read('us/own-records-direct-ties-2026-09-26.jsonl'),read('us/network.json')]);
  const files=(await readdir(join(dir,'raw')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;})).filter(f=>f.endsWith('.json')).sort();
  const findings:Finding[]=[];
  for(const file of files) {
    const f=parse<Finding>(await read(`raw/${file}`));
    if(checkFinding(f,file.slice(0,-5)).length) continue; // Same accepted schema as the findings importer.
    findings.push(f);
  }
  if(!warehouse.people.length&&!candidates&&!team&&!graph&&!direct&&!findings.length&&!network)return null;
  return {warehouse,candidates:lines(candidates),team:team?parse<{team:TeamMember[]}>(team).team:[],graph:lines(graph),direct:lines(direct),findings,
    network:network?parse<Network>(network):undefined};
}

/** Bounded JSON recordsets, never one query per person or tie. Caller must hold a transaction. */
export async function importNetworkNodes(tx:Queryable,plan:NodePlan,at=new Date()):Promise<NodeImportCounts> {
  const today=at.toISOString().slice(0,10), counts:NodeImportCounts={nodesCreated:0,sourceRecords:0,edgesWritten:0,edgePairs:new Set(),warehouseLoaded:plan.warehouseLoaded};
  const existing=await tx.query<{source:string;source_id:string;entity_id:string}>(
    `select source,source_id,identity.canonical_entity_id(entity_id)::text entity_id from identity.source_record where source=any($1::text[])`,[[...new Set(plan.nodes.map(n=>n.source))]]);
  const mapped=new Map(existing.map(r=>[sourceKey(r.source,r.source_id),r.entity_id]));
  const entities=await tx.query<{id:string;type:string;name:string}>(`select entity_id::text id,entity_type::text type,display_name name from identity.entity where merged_into is null`);
  const byId=new Map(entities.map(e=>[e.id,e]));
  const redirects=new Map((await tx.query<{entity_id:string;canonical_id:string}>(`select entity_id::text,canonical_id::text from identity.entity_resolution`)).map(r=>[r.entity_id,r.canonical_id]));
  const ids=new Map<string,string>(), newEntities=new Map<string,{id:string;type:string;name:string}>(), aliases:Array<{source:string;source_id:string;id:string}>=[];
  for(const n of plan.nodes) {
    const team=n.teamHandle?(ids.get(sourceKey('app_user',n.teamHandle))??mapped.get(sourceKey('app_user',n.teamHandle))):undefined;
    const explicitId=n.entityId ? redirects.get(n.entityId)??n.entityId : undefined;
    const explicit=explicitId && (!byId.has(explicitId)||byId.get(explicitId)!.type===n.type) ? explicitId : undefined;
    const id=mapped.get(n.key)??team??explicit??randomUUID(); ids.set(n.key,id);
    if(!byId.has(id)&&!newEntities.has(id))newEntities.set(id,{id,type:n.type,name:n.name});
    if(!mapped.has(n.key))aliases.push({source:n.source,source_id:n.sourceId,id});
  }
  const chunks=async<T>(rows:T[],size:number,run:(chunk:T[])=>Promise<unknown>)=>{for(let i=0;i<rows.length;i+=size)await run(rows.slice(i,i+size));};
  await chunks([...newEntities.values()],1000,async chunk=>tx.query(`insert into identity.entity(entity_id,entity_type,display_name)
    select id::uuid,type::identity.entity_type,name from jsonb_to_recordset($1::jsonb) x(id text,type text,name text) on conflict(entity_id) do nothing`,[JSON.stringify(chunk)]));
  await chunks(aliases,1000,async chunk=>tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
    select source,source_id,id::uuid,'rule:network-source-key' from jsonb_to_recordset($1::jsonb) x(source text,source_id text,id text)
    on conflict(source,source_id) do nothing`,[JSON.stringify(chunk)]));
  counts.nodesCreated=newEntities.size;counts.sourceRecords=aliases.length;
  // Protect explicit decisions and reuse pre-existing edges, including earlier W3 imports.
  type ExistingEdge={id:string;a:string;b:string;kind:EdgeKind;tier:EvidenceTier;reviewed:boolean;evidence:Record<string,unknown>[]};
  const current=await tx.query<ExistingEdge>(
    `select edge_id::text id,from_entity::text a,to_entity::text b,kind::text,tier::text,reviewed_at is not null reviewed,evidence from network.edge`);
  const byPair=new Map<string,ExistingEdge>(), external=new Map<string,Record<string,unknown>[]>(), externalTier=new Map<string,EvidenceTier>();
  const redundant:string[]=[];
  for(const e of current) {
    const k=nodePairKey(e.a,e.b,e.kind),old=byPair.get(k);
    const evidence=e.evidence.filter(v=>v.derived!=='network_nodes');
    if(evidence.length){external.set(k,[...(external.get(k)??[]),...evidence]);externalTier.set(k,e.tier<(externalTier.get(k)??'D')?e.tier:(externalTier.get(k)??'D'));}
    if(!old)byPair.set(k,e);
    else if(e.reviewed&&!old.reviewed){byPair.set(k,e);redundant.push(old.id);}
    else if(!e.reviewed)redundant.push(e.id);
  }
  type Stored={id:string;a:string;b:string;kind:EdgeKind;tier:EvidenceTier;band:string;on:string;evidence:Record<string,unknown>[]};
  const rows=new Map<string,Stored>();
  for(const e of plan.edges) {
    const a=ids.get(e.from),b=ids.get(e.to);if(!a||!b)throw new Error('Network edge has an absent endpoint');if(a===b)continue;
    const pair=nodePairKey(a,b,e.kind);counts.edgePairs.add(pair);
    const prior=byPair.get(pair);if(prior?.reviewed)continue;
    const evidence={derived:'network_nodes',note:e.note,source:e.source,as_of:e.asOf,confidence:e.tier,last_verified_by:e.lastVerifiedBy,
      tie:e.tie,rowIds:e.rowIds,fromSource:e.from,toSource:e.to};
    const row=rows.get(pair);
    if(row){row.evidence.push(evidence);if(e.tier<row.tier)row.tier=e.tier;continue;}
    const warmth=tieWarmth(e.kind,e.tie,at);
    rows.set(pair,{id:prior?.id??uuid(`network-node-edge:${pair}`),a,b,kind:e.kind,tier:(externalTier.get(pair)??'D')<e.tier?externalTier.get(pair)!:e.tier,
      band:warmth.score>=config.routeWarmth.strongFirstHop?'strong':warmth.score>=config.routeWarmth.priors.repeated_contact?'moderate':'weak',
      on:day(e.tie.lastInteraction,e.asOf||today),evidence:[...(external.get(pair)??[]),evidence]});
  }
  for(const row of rows.values())row.evidence=[...new Map(row.evidence.map(e=>[JSON.stringify(e),e])).values()];
  await chunks([...rows.values()],2000,async chunk=>tx.query(`insert into network.edge(edge_id,from_entity,to_entity,kind,tier,tie_band,evidence,valid_from)
    select id::uuid,a::uuid,b::uuid,kind::network.edge_kind,tier::network.evidence_tier,band,evidence,on_date::date
    from jsonb_to_recordset($1::jsonb) x(id text,a text,b text,kind text,tier text,band text,evidence jsonb,on_date text)
    on conflict(edge_id) do update set tier=excluded.tier,tie_band=excluded.tie_band,evidence=excluded.evidence,valid_from=excluded.valid_from
    where network.edge.reviewed_at is null`,[JSON.stringify(chunk.map(({on,...r})=>({...r,on_date:on})))]));
  // Only reconcile duplicates for pairs this import actually covers. Reviewed decisions always survive.
  const touchedIds=new Set(current.filter(e=>counts.edgePairs.has(nodePairKey(e.a,e.b,e.kind))).map(e=>e.id));
  const duplicateIds=redundant.filter(id=>touchedIds.has(id));
  if(duplicateIds.length)await tx.query(`delete from network.edge where edge_id=any($1::uuid[]) and reviewed_at is null`,[duplicateIds]);
  await tx.query(`delete from network.edge where reviewed_at is null
    and evidence @> '[{"derived":"network_nodes"}]'::jsonb and not(edge_id=any($1::uuid[]))
    and not exists(select 1 from jsonb_array_elements(evidence) v where v->>'derived' is distinct from 'network_nodes')
    and exists(select 1 from jsonb_array_elements(evidence) v where v->>'fromSource'=any($2::text[]) and v->>'toSource'=any($2::text[]))`,
    [[...rows.values()].map(r=>r.id),plan.nodes.map(n=>n.key)]);
  counts.edgesWritten=rows.size;
  return counts;
}

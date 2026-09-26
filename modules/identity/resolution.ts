import type { Db, Queryable } from '@/lib/db';
import { prioritizeDb, withBackgroundDb } from '@/lib/db/scheduling';
import { config } from '@/config/deployment';

export const normalizeIdentityName = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/gu, ' ');
/** Former affiliations still corroborate identity; no inference about a current role. */
export function organizationNames(s: string): string[] {
  return s.split(/\s*\((?:formerly known as|formerly|previously)\s+|\s+(?:formerly known as|formerly|previously)\s+/i)
    .map(x => normalizeIdentityName(x).replace(/[()]/g, '').replace(/[^\p{L}\p{N}]/gu, '')) .filter(Boolean);
}
export interface IdentityEvidence {
  entityId?: string; source?: string; sourceId?: string;
  organizations?: string[]; domains?: string[]; warehouseIds?: string[];
  /** Explicit source references in an identity finding, never arbitrary prose about a relationship. */
  references?: string[];
}
interface Person { id: string; name: string; source: string; sourceId: string; root: string; orgs: Set<string>; domains: Set<string>; warehouse: Set<string>; references: Set<string> }
export interface ResolutionCounts { peopleWithMultipleEntitiesBefore: number; merges: number; mergesByRule: Record<string, number>; possibleMatchesLeft: number }
const priority: Record<string, number> = { affinity: 0, warehouse: 1, w3_person: 2, prospect: 3 };
const batchSize = config.identityResolution.batchSize;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, config.identityResolution.pauseMs));
const intersect = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x));
const domain = (s: string) => s.trim().toLowerCase().replace(/^.*@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const pair = (a: string, b: string) => [a,b].sort().join('|');

/** Uses the server's existing handle. Reads and mutations yield in bounded batches; no long transaction. */
const mutations = new WeakMap<Db, Promise<unknown>>();
function serialized<T>(db: Db, work: () => Promise<T>): Promise<T> {
  const next = (mutations.get(db) ?? Promise.resolve()).catch(() => {}).then(work);
  mutations.set(db, next);
  return next.finally(() => { if (mutations.get(db) === next) mutations.delete(db); });
}
export async function resolveIdentities(db: Db, evidence: IdentityEvidence[] = [], progress?: (stage: string, count: number) => void): Promise<ResolutionCounts> {
  db = prioritizeDb(db);
  // Passes serialize so a rebuild queued during an earlier pass reads its own evidence.
  return serialized(db, () => withBackgroundDb(() => resolvePass(db, evidence, progress)));
}
async function resolvePass(db: Db, evidence: IdentityEvidence[], progress?: (stage: string, count: number) => void): Promise<ResolutionCounts> {
  const people: Person[] = [];
  let sourceCursor = ['00000000-0000-0000-0000-000000000000', '', ''];
  for (;;) {
    const rows = await db.query<{ id:string; name:string; source:string; source_id:string; root:string }>(
      `select e.entity_id::text id,e.display_name name,s.source,s.source_id,identity.canonical_entity_id(e.entity_id)::text root
       from identity.entity e join identity.source_record s using(entity_id)
       where e.entity_type='person' and e.retired_at is null and s.source=any($1::text[])
       and (e.entity_id,s.source,s.source_id)>($2::uuid,$3::text,$4::text)
       order by e.entity_id,s.source,s.source_id limit $5`, [Object.keys(priority),...sourceCursor,batchSize]);
    people.push(...rows.map(r=>({id:r.id,name:r.name,source:r.source,sourceId:r.source_id,root:r.root,orgs:new Set<string>(),domains:new Set<string>(),warehouse:new Set(r.source==='warehouse'?[r.source_id]:[]),references:new Set<string>()})));
    await pause(); if(rows.length<batchSize)break;
    const last=rows.at(-1)!;sourceCursor=[last.id,last.source,last.source_id];
  }
  progress?.('sources', people.length);
  const byId = new Map<string,Person[]>(), bySource = new Map<string,Person[]>();
  for(const p of people){byId.set(p.id,[...(byId.get(p.id)??[]),p]);bySource.set(`${p.source}:${p.sourceId}`,[...(bySource.get(`${p.source}:${p.sourceId}`)??[]),p]);}
  const apply=(ev:IdentityEvidence)=>{
    const targets=ev.entityId?byId.get(ev.entityId):bySource.get(`${ev.source}:${ev.sourceId}`);
    for(const p of targets??[]){for(const s of ev.organizations??[])for(const n of organizationNames(s))p.orgs.add(n);
      for(const s of ev.domains??[])if(domain(s))p.domains.add(domain(s));
      for(const s of ev.warehouseIds??[])p.warehouse.add(s);
      for(const s of ev.references??[])p.references.add(s);}
  };
  for(const [i,e] of evidence.entries()){apply(e);if((i+1)%batchSize===0)await pause();}
  // Source-owned affiliations and person/org graph edges preserve evidence for aliases.
  // Keyset pages avoid repeatedly sorting/scanning the complete evidence corpus.
  let cursor = '';
  for (;;) {
    const rows = await db.query<{key:string;id:string;name:string}>(`select a.affiliation_id::text key,a.person_entity::text id,o.display_name name
      from identity.affiliation a join identity.entity o on o.entity_id=a.org_entity
      where a.affiliation_id > coalesce(nullif($1,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      order by a.affiliation_id limit $2`,[cursor,batchSize]);
    for(const r of rows)apply({entityId:r.id,organizations:[r.name]});
    await pause();if(rows.length<batchSize)break;cursor=rows.at(-1)!.key;
  }
  progress?.('affiliations', people.length);
  cursor = '';
  for (;;) {
    const rows = await db.query<{key:string;a:string;b:string;aname:string;bname:string;atype:string;btype:string;affiliation:boolean}>(`select e.edge_id::text key,e.from_entity::text a,e.to_entity::text b,
      f.display_name aname,t.display_name bname,f.entity_type::text atype,t.entity_type::text btype,
      e.valid_to is null and exists(select 1 from jsonb_array_elements(e.evidence) v where v->>'note' ilike '%affiliation%') affiliation
      from network.edge e join identity.entity f on f.entity_id=e.from_entity join identity.entity t on t.entity_id=e.to_entity
      where e.edge_id > coalesce(nullif($1,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      order by e.edge_id limit $2`,[cursor,batchSize]);
    for(const r of rows)if(r.affiliation){
      if(r.atype==='person'&&r.btype==='org')apply({entityId:r.a,organizations:[r.bname]});
      if(r.btype==='person'&&r.atype==='org')apply({entityId:r.b,organizations:[r.aname]});
    }
    await pause();if(rows.length<batchSize)break;cursor=rows.at(-1)!.key;
  }
  progress?.('edges', people.length);
  const forbidden=new Set<string>();
  cursor = '0';
  for (;;) {
    const assertions=await db.query<{key:string;kind:string;left_source:string;left_source_id:string;right_source:string;right_source_id:string;merged_entity:string|null;canonical_entity:string|null;undone_at:string|null}>(`select assertion_id::text key,kind::text,left_source,left_source_id,right_source,right_source_id,merged_entity::text,canonical_entity::text,undone_at::text
      from identity.match_assertion where assertion_id > $1::bigint order by assertion_id limit $2`,[cursor,batchSize]);
    for(const a of assertions)if(a.kind==='not_same_as'||a.undone_at){
      const ls=bySource.get(`${a.left_source}:${a.left_source_id}`)??[],rs=bySource.get(`${a.right_source}:${a.right_source_id}`)??[];
      for(const l of ls)for(const r of rs)forbidden.add(pair(l.id,r.id));
      if(a.merged_entity&&a.canonical_entity)forbidden.add(pair(a.merged_entity,a.canonical_entity));
    }
    await pause();if(assertions.length<batchSize)break;cursor=assertions.at(-1)!.key;
  }
  const groups=new Map<string,Person[]>();
  for(const p of people){const key=normalizeIdentityName(p.name);if(key)groups.set(key,[...(groups.get(key)??[]),p]);}
  const counts:ResolutionCounts={peopleWithMultipleEntitiesBefore:0,merges:0,mergesByRule:{},possibleMatchesLeft:0};
  const roots=new Map(people.map(p=>[p.id,p.root]));
  const root=(id:string):string=>{const seen=new Set<string>();while(roots.has(id)&&roots.get(id)!==id){if(seen.has(id))throw new Error('Identity redirect cycle');seen.add(id);id=roots.get(id)!;}return id;};
  const ranks=new Map<string,number>();
  for(const p of people)ranks.set(root(p.id),Math.min(ranks.get(root(p.id))??Infinity,priority[p.source]!));
  const rank=(id:string)=>ranks.get(id)??Infinity;
  const proposals:Array<{a:Person;b:Person;signals:Record<string,string[]>}>=[];
  const possible=new Set<string>();
  let comparisons=0;
  let groupsSeen=0;
  for(const group of groups.values()){
    if(++groupsSeen%batchSize===0)await pause();
    if(group.length<2||new Set(group.map(p=>p.source)).size<2)continue;
    if(new Set(group.map(p=>root(p.id))).size>1&&new Set(group.map(p=>p.source)).size>1)counts.peopleWithMultipleEntitiesBefore++;
    for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
      if(++comparisons%batchSize===0)await pause();
      const a=group[i]!,b=group[j]!;if(a.id===b.id||a.source===b.source||root(a.id)===root(b.id))continue;
      const signals:Record<string,string[]>={};
      const org=intersect(a.orgs,b.orgs),email=intersect(a.domains,b.domains),warehouse=intersect(a.warehouse,b.warehouse);
      if(org.length)signals.affiliation=org;if(email.length)signals.email_domain=email;if(warehouse.length)signals.warehouse_id=warehouse;
      if(a.references.has(`${b.source}:${b.sourceId}`)||b.references.has(`${a.source}:${a.sourceId}`))signals.finding_identity=[`${a.source}:${a.sourceId}`,`${b.source}:${b.sourceId}`];
      if(Object.keys(signals).length)proposals.push({a,b,signals});else possible.add(pair(a.id,b.id));
    }
  }
  progress?.('proposals', proposals.length);
  proposals.sort((x,y)=>pair(x.a.id,x.b.id).localeCompare(pair(y.a.id,y.b.id)));
  for(const {a,b,signals} of proposals){
    const ar=root(a.id),br=root(b.id);if(ar===br)continue;
    // A correction constrains the whole prospective component, including transitive merges.
    if([...forbidden].some(k=>{const [l,r]=k.split('|');return pair(root(l!),root(r!))===pair(ar,br);})){continue;}
    const ordered=[ar,br].sort((x,y)=>rank(x)-rank(y)||x.localeCompare(y)),canonical=ordered[0]!,merged=ordered[1]!;
    const rule=Object.keys(signals).sort().join('+');
    const changed=await db.transaction(async tx=>{
      await tx.exec('lock table identity.entity in share row exclusive mode');
      const row=await tx.one<{id:string}>(`update identity.entity set merged_into=$2 where entity_id=$1 and merged_into is null returning entity_id::text id`,[merged,canonical]);
      if(!row)return false;
      await tx.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
        values('same_as',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,'Deterministic cross-source identity; source records retained for undo.')`,
        [a.source,a.sourceId,b.source,b.sourceId,merged,canonical,`identity:v1:${rule}`,JSON.stringify(signals)]);return true;
    });
    if(changed){roots.set(merged,canonical);ranks.set(canonical,Math.min(rank(merged),rank(canonical)));counts.merges++;counts.mergesByRule[rule]=(counts.mergesByRule[rule]??0)+1;}await pause();
  }
  progress?.('merges', counts.merges);
  const active=new Set<string>();
  const projectedForbidden=new Set([...forbidden].map(k=>{const [l,r]=k.split('|');return pair(root(l!),root(r!));}));
  for(const k of possible){const [a,b]=k.split('|'),l=root(a!),r=root(b!);if(l!==r&&!projectedForbidden.has(pair(l,r)))active.add(pair(l,r));}
  // GUESS: name-only identity confidence is 0.25, always D-tier; it is never merge evidence.
  for(const k of active){const [a,b]=k.split('|');await db.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals) values($1,$2,0.25,'{"rule":"name_only","label":"Possible identity: matching full name only; uncorroborated"}')
    on conflict(left_entity,right_entity) do update set active=true where not possible_match.active`,[a,b]);await pause();}
  cursor = '';
  for (;;) {
    const old=await db.query<{edge_id:string;left_entity:string;right_entity:string;active:boolean}>(`select edge_id::text,left_entity::text,right_entity::text,active from identity.possible_match
      where edge_id > coalesce(nullif($1,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      order by edge_id limit $2`,[cursor,batchSize]);
    for(const p of old)if(p.active&&!active.has(pair(p.left_entity,p.right_entity))){await db.query('update identity.possible_match set active=false where edge_id=$1',[p.edge_id]);await pause();}
    await pause();if(old.length<batchSize)break;cursor=old.at(-1)!.edge_id;
  }
  counts.possibleMatchesLeft=active.size;return counts;
}

/** Undo just this recorded redirect. Source facts never moved; a subsequent pass respects the correction. */
export async function undoIdentityMerge(db: Db, assertionId: string, reason: string): Promise<boolean> {
  if(!reason.trim())throw new Error('An undo reason is required');
  db = prioritizeDb(db);
  return serialized(db, () => db.transaction(async(tx:Queryable)=>{
    const a=await tx.one<{merged_entity:string;canonical_entity:string}>(`select merged_entity::text,canonical_entity::text from identity.match_assertion where assertion_id=$1 and rule like 'identity:v1:%' and undone_at is null for update`,[assertionId]);
    if(!a)return false;
    const row=await tx.one(`update identity.entity set merged_into=null where entity_id=$1 and merged_into=$2 returning entity_id`,[a.merged_entity,a.canonical_entity]);
    if(!row)throw new Error('Redirect changed since assertion; undo the newer merge first');
    await tx.query(`update identity.match_assertion set undone_at=now(),undo_reason=$2 where assertion_id=$1`,[assertionId,reason]);return true;
  }));
}

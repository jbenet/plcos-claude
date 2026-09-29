/** The only production entrance for entity creation. Callers may pass a transaction or Db.
 * Source records attach to a canonical entity; name-only collisions remain separate and
 * enter possible_match in the same transaction. No source facts or human decisions move.
 */
import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import type { EntityType } from './types';
import { normalizeIdentityName, organizationNames } from './resolution';

export interface EntityCreation {
  type: EntityType; name: string; source?: string; sourceId?: string; id?: string;
  organizations?: string[]; domains?: string[]; personalUrls?: string[]; resolvedBy?: string;
}
export interface EntityResolution { id: string; created: boolean; rule: string; possible: string[] }
const freeMail = new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','mail.com','gmx.com','gmx.de','fastmail.com','hey.com','qq.com','163.com','126.com','yandex.com','yandex.ru']);
export function identityEmailDomain(value: string): string | null {
  const d = value.trim().toLowerCase().replace(/^.*@/, '').replace(/\.$/, '');
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(d) && !freeMail.has(d)
    && !/^(yahoo|hotmail|outlook|live|aol|gmx|yandex)\./.test(d) ? d : null;
}
export function identityPersonalUrl(value: string): string | null {
  try {
    const u = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return null;
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    const social=['linkedin.com','facebook.com','x.com','twitter.com','github.com'].includes(host);
    const path=social?u.pathname.replace(/\/+$/,'').toLowerCase():u.pathname.replace(/\/+$/,'');
    // Company LinkedIn pages and social homepages are never personal identities.
    if (host==='linkedin.com' && !/^\/in\/[^/]+$/.test(path)) return null;
    if (['facebook.com','x.com','twitter.com','github.com'].includes(host) && !/^\/[^/]+$/.test(path)) return null;
    for(const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();
    return host.includes('.') ? `${host}${path}${u.search}` : null;
  } catch { return null; }
}
type Signals = { organizations: Set<string>; domains: Set<string>; personalUrls: Set<string> };
const signals = (): Signals => ({ organizations:new Set(), domains:new Set(), personalUrls:new Set() });
function add(into: Signals, input: Pick<EntityCreation,'organizations'|'domains'|'personalUrls'>) {
  for(const s of input.organizations??[]) for(const n of organizationNames(s)) into.organizations.add(n);
  for(const s of input.domains??[]) { const n=identityEmailDomain(s); if(n)into.domains.add(n); }
  for(const s of input.personalUrls??[]) { const n=identityPersonalUrl(s); if(n)into.personalUrls.add(n); }
}
const intersects=(a:Set<string>,b:Set<string>)=>[...a].some(x=>b.has(x));
type EntityRow={id:string;name:string};
const contexts=new WeakMap<Queryable,Promise<{byName:Map<string,EntityRow[]>}>>();
async function context(tx:Queryable) {
  let pending=contexts.get(tx);
  if(!pending) {
    pending=(async()=>{
      const rows=await tx.query<EntityRow>(`select entity_id::text id,display_name name from identity.entity`);
      const byName=new Map<string,EntityRow[]>();
      for(const row of rows) {const name=normalizeIdentityName(row.name);byName.set(name,[...(byName.get(name)??[]),row]);}
      return {byName};
    })(); contexts.set(tx,pending);
  }
  return pending;
}
async function evidence(tx:Queryable, ids:string[]):Promise<Signals> {
  const out=signals();
  for(const r of await tx.query<{name:string}>(`select o.display_name name from identity.affiliation a
    join identity.entity o on o.entity_id=identity.canonical_entity_id(a.org_entity) where a.person_entity=any($1::uuid[])`,[ids])) add(out,{organizations:[r.name]});
  for(const r of await tx.query<{name:string}>(`select o.display_name name from network.edge e
    join identity.entity o on o.entity_id=case when e.from_entity=any($1::uuid[]) then e.to_entity else e.from_entity end
    where (e.from_entity=any($1::uuid[]) or e.to_entity=any($1::uuid[])) and o.entity_type='org' and e.valid_to is null
      and exists(select 1 from jsonb_array_elements(e.evidence) v where v->>'note' ilike 'Recorded organizational affiliation%')`,[ids])) add(out,{organizations:[r.name]});
  for(const r of await tx.query<{kind:string;data:Record<string,unknown>}>(`select kind,data from research.note where entity_id=any($1::uuid[]) and kind in ('identity_creation','public_profile')`,[ids])) {
    if(r.kind==='identity_creation') add(out,r.data as Pick<EntityCreation,'organizations'|'domains'|'personalUrls'>);
    else {
      const identity=r.data.identity as {match?:string;canonical?:{org?:string};links?:Array<{kind?:string;url:string}>}|undefined;
      const researched=r.data.researched as {at?:string;by?:string}|undefined;
      if(!identity || !['confirmed','probable'].includes(identity.match??'') || !researched?.at || !researched.by)continue;
      add(out,{organizations:identity?.canonical?.org?[identity.canonical.org]:[],personalUrls:identity?.links?.filter(l=>/^(bio|x|linkedin|personal|personal_website|profile)$/i.test(l.kind??'')).map(l=>l.url)??[]});
    }
  }
  for(const r of await tx.query<{field:string;value:string}>(`select regexp_replace(field,'^public[.]','') field,value from research.claim where entity_id=any($1::uuid[]) and superseded_by is null
    and regexp_replace(field,'^public[.]','') in ('email','email_domain','linkedin','personal_url','profile_url','bio_url','organization','org','company')`,[ids])) {
    if(['email','email_domain'].includes(r.field)) add(out,{domains:[r.value]});
    else if(['organization','org','company'].includes(r.field)) add(out,{organizations:[r.value]});
    else add(out,{personalUrls:[r.value]});
  }
  for(const r of await tx.query<{value:string}>(`select value from identity.external_identifier where entity_id=any($1::uuid[]) and kind='linkedin'`,[ids])) add(out,{personalUrls:[r.value]});
  // Older Affinity imports predate the creation evidence notes. Inspect only mapped candidates.
  for(const r of await tx.query<{payload:Record<string,unknown>}>(`select distinct on (r.kind,r.source_id) r.payload from sources.raw_record r
    join identity.source_record s on s.source=r.source and s.source_id=case when r.kind='list_entry'
      then (r.payload->>'type')||':'||(r.payload->'entity'->>'id') else r.kind||':'||r.source_id end
    where s.entity_id=any($1::uuid[]) and r.source='affinity' and r.kind in ('person','organization','list_entry')
    order by r.kind,r.source_id,r.fetched_at desc,r.id desc`,[ids])) {
    const p=(r.payload.entity??r.payload) as Record<string,unknown>;
    const emails=[p.primaryEmailAddress,p.primaryEmail,...(Array.isArray(p.emailAddresses)?p.emailAddresses:[]),...(Array.isArray(p.emails)?p.emails:[])].filter((x):x is string=>typeof x==='string');
    add(out,{domains:emails,personalUrls:[p.linkedinUrl,p.linkedin_url].filter((x):x is string=>typeof x==='string')});
    for(const f of (Array.isArray(p.fields)?p.fields:[]) as Array<{name?:string;value?:{data?:unknown}}>) {
      const value=f.value?.data;
      if(/linkedin/i.test(f.name??'') && typeof value==='string') add(out,{personalUrls:[value]});
      if(/^(current organization|organizations)$/i.test(f.name??'')) {
        const values=Array.isArray(value)?value:[value];
        add(out,{organizations:values.map(v=>typeof v==='string'?v:(v as {name?:string}|null)?.name??'').filter(Boolean)});
      }
    }
  }
  return out;
}
async function remember(tx:Queryable,id:string,input:EntityCreation,rule:string) {
  const source=input.source??'local', sourceId=input.sourceId??id;
  await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,$4) on conflict(source,source_id) do nothing`,
    [source,sourceId,id,input.resolvedBy??`rule:create:${rule}`]);
  if(!input.organizations?.length&&!input.domains?.length&&!input.personalUrls?.length)return;
  const data={source,sourceId,organizations:input.organizations??[],domains:input.domains??[],personalUrls:input.personalUrls??[]};
  // Notes retain the input for later matching; they are not verified research claims.
  const old=await tx.one<{id:string}>(`select note_id::text id from research.note where entity_id=$1 and kind='identity_creation' and data->>'source'=$2 and data->>'sourceId'=$3 limit 1`,[id,source,sourceId]);
  if(old) await tx.query('update research.note set data=$2::jsonb where note_id=$1 and data is distinct from $2::jsonb',[old.id,JSON.stringify(data)]);
  else await tx.query(`insert into research.note(entity_id,kind,body,data) values($1,'identity_creation','Identity evidence supplied at creation; not independently verified.',$2::jsonb)`,[id,JSON.stringify(data)]);
}
export async function resolveEntity(tx:Queryable,input:EntityCreation):Promise<EntityResolution> {
  if('transaction' in tx) return (tx as Db).transaction(t=>resolveEntity(t,input));
  if(!input.name.trim())throw new Error('Entity name is required');
  if(!!input.source!==!!input.sourceId)throw new Error('Identity source and sourceId must be supplied together');
  await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
  if(input.source) {
    const prior=await tx.one<{id:string}>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record where source=$1 and source_id=$2`,[input.source,input.sourceId]);
    if(prior) {await remember(tx,prior.id,input,'source_id');return {id:prior.id,created:false,rule:'source_id',possible:[]};}
  }
  const ctx=await context(tx), name=normalizeIdentityName(input.name), incoming=signals(); add(incoming,input);
  // Recheck current roots/types: a caller can merge, correct or roll back a savepoint
  // between resolutions within this transaction. The name index is only a candidate seed.
  const names=(ctx.byName.get(name)??[]).map(e=>e.id);
  const candidates=await tx.query<{id:string;type:EntityType}>(`select distinct e.entity_id::text id,e.entity_type::text type from identity.entity original
    join identity.entity e on e.entity_id=identity.canonical_entity_id(original.entity_id)
    where original.entity_id=any($1::uuid[]) and original.retired_at is null and e.retired_at is null order by id`,[names]);
  const allowed:string[]=[], strong:string[]=[], affiliations:string[]=[];
  for(const {id,type} of candidates) {
    const members=(await tx.query<{id:string}>(`with recursive members as (
      select entity_id from identity.entity where entity_id=$1 union all
      select e.entity_id from identity.entity e join members m on e.merged_into=m.entity_id
    ) select entity_id::text id from members`,[id])).map(e=>e.id);
    const forbidden=await tx.one(`select 1 from identity.match_assertion a where ((a.kind='not_same_as' and a.undone_at is null) or (a.kind='same_as' and a.undone_at is not null))
      and ((a.left_source=$1 and a.left_source_id=$2 and exists(select 1 from identity.source_record s where s.source=a.right_source and s.source_id=a.right_source_id and s.entity_id=any($3::uuid[])))
        or (a.right_source=$1 and a.right_source_id=$2 and exists(select 1 from identity.source_record s where s.source=a.left_source and s.source_id=a.left_source_id and s.entity_id=any($3::uuid[])))) limit 1`,[input.source??'local',input.sourceId??input.id??'',members]);
    if(forbidden)continue;
    allowed.push(id);
    if(type!==input.type || !(incoming.domains.size || incoming.personalUrls.size || incoming.organizations.size))continue;
    const ev=await evidence(tx,members);
    if(intersects(incoming.domains,ev.domains)||intersects(incoming.personalUrls,ev.personalUrls))strong.push(id);
    if(intersects(incoming.organizations,ev.organizations))affiliations.push(id);
  }
  const winners=strong.length?strong:affiliations;
  if(winners.length===1) {
    const id=winners[0]!,rule=strong.length?'name_contact':'name_affiliation';
    await remember(tx,id,input,rule);return {id,created:false,rule,possible:[]};
  }
  const id=input.id??randomUUID();
  // GUESS: unresolved name matches carry 0.25 confidence, never attachment evidence.
  await tx.query(`insert into identity.entity(entity_id,entity_type,display_name) values($1,$2::identity.entity_type,$3)`,[id,input.type,input.name]);
  const row={id,name:input.name};ctx.byName.set(name,[...(ctx.byName.get(name)??[]),row]);
  const rule=allowed.length?'name_only':'new'; await remember(tx,id,input,rule);
  for(const other of allowed) await tx.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
    values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),0.25,$3::jsonb)
    on conflict(left_entity,right_entity) do update set active=true`,[id,other,JSON.stringify({rule:'creation-name-only',source:input.source??'local',label:'Matching name; identity unresolved'})]);
  return {id,created:true,rule,possible:allowed};
}

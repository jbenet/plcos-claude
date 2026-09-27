import type { Queryable } from '@/lib/db';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { normalizeIdentityName } from './resolution';
import { config } from '@/config/deployment';

export type IdentifierKind = 'domain' | 'linkedin' | 'crd' | 'cik';
export type Identifiers = Partial<Record<IdentifierKind, string>>;
/** Normalize identifiers, never prose or an email's shared employer domain. */
export function normalizeIdentifier(kind: IdentifierKind, value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (kind === 'crd' || kind === 'cik') return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : null;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (kind === 'domain') return host.includes('.') ? host : null;
    return host === 'linkedin.com' && /^\/(in|company)\/[^/]+\/?$/.test(u.pathname)
      ? `linkedin.com${u.pathname.replace(/\/$/, '').toLowerCase()}` : null;
  } catch { return null; }
}

type Candidate = { id: string; name: string; type: string; identifiers: Set<string>; identifierSources: Map<string,Set<string>> };
/** Existing source-owned identifiers plus explicit identifiers in existing research/Affinity records.
 * Each source uses a keyset page so the background caller releases the connection and
 * event loop between pages. Callers validate their input revision before using the index. */
export async function externalIdentityIndex(tx: Queryable) {
  const pageSize=200;
  async function pages<T>(read:(last:T|undefined)=>Promise<T[]>,consume:(row:T)=>void|Promise<void>) {
    let last:T|undefined;
    for(;;) {
      const rows=await read(last);
      for(const row of rows)await consume(row);
      if(rows.length<pageSize)break;
      last=rows.at(-1);
      await yieldTurn();
    }
    await yieldTurn();
  }
  const index=new Map<string,Candidate>();
  await pages<{id:string;name:string;type:string}>(last=>tx.query<{id:string;name:string;type:string}>(`select entity_id::text id,display_name name,entity_type::text type
    from identity.entity where retired_at is null and ($1::uuid is null or entity_id>$1)
    order by entity_id limit $2`,[last?.id??null,pageSize]),r=>{index.set(r.id,{...r,identifiers:new Set(),identifierSources:new Map()});});
  const add = (id: string, kind: IdentifierKind, value: unknown, source:string) => {
    const v=normalizeIdentifier(kind,value),candidate=index.get(id);
    if(!v||!candidate)return;
    const key=`${kind}:${v}`;
    candidate.identifiers.add(key);
    candidate.identifierSources.set(source,(candidate.identifierSources.get(source)??new Set()).add(key));
  };
  await pages<{entity_id:string;kind:IdentifierKind;value:string;source:string}>(last=>tx.query<{entity_id:string;kind:IdentifierKind;value:string;source:string}>(`select entity_id::text,kind,value,source
    from identity.external_identifier where $1::uuid is null or (entity_id,kind,value,source)>($1::uuid,$2::text,$3::text,$4::text)
    order by entity_id,kind,value,source limit $5`,[last?.entity_id??null,last?.kind??null,last?.value??null,last?.source??null,pageSize]),
    r=>add(r.entity_id,r.kind,r.value,`external:${r.source}`));
  await pages<{id:string;entity_id:string;field:string;value:string}>(last=>tx.query<{id:string;entity_id:string;field:string;value:string}>(`select claim_id::text id,entity_id::text,field,value
    from research.claim where superseded_by is null and field ~* '(linkedin|(^|[._])(crd|(sec_)?cik|website|domain)$)'
      and ($1::uuid is null or claim_id>$1) order by claim_id limit $2`,[last?.id??null,pageSize]),r=>{
    const kind = /linkedin/i.test(r.field) ? 'linkedin' : /(^|[._])crd$/i.test(r.field) ? 'crd' : /(^|[._])(sec_)?cik$/i.test(r.field) ? 'cik' : /(^|[._])(website|domain)$/i.test(r.field) ? 'domain' : null;
    if(kind)add(r.entity_id,kind,r.value,'research-claim');
  });
  await pages<{id:string;entity_id:string;links:{kind:string;url:string}[]|null}>(last=>tx.query<{id:string;entity_id:string;links:{kind:string;url:string}[]|null}>(`select note_id::text id,entity_id::text,data->'identity'->'links' links
    from research.note where kind='public_profile' and ($1::uuid is null or note_id>$1)
    order by note_id limit $2`,[last?.id??null,pageSize]),async r=>{
    let processed=0;
    for(const l of r.links??[]) {
      if (/linkedin/i.test(l.kind)) add(r.entity_id,'linkedin',l.url,'research-note');
      else if (/website|domain|web/i.test(l.kind) && index.get(r.entity_id)?.type !== 'person') add(r.entity_id,'domain',l.url,'research-note');
      if(++processed%pageSize===0)await yieldTurn();
    }
  });
  // Page the source keys before joining: unmapped source records must advance the
  // cursor too, and list-entry identities retain their original entity mapping.
  await pages<{kind:string;source_id:string;entity_id:string|null;payload:Record<string,unknown>|null}>(last=>tx.query<{kind:string;source_id:string;entity_id:string|null;payload:Record<string,unknown>|null}>(`with latest as materialized (
    select distinct on (kind,source_id) kind,source_id,payload from sources.raw_record
    where source='affinity' and kind in ('person','organization','list_entry')
      and ($1::text is null or (kind,source_id)>($1::text,$2::text))
    order by kind,source_id,fetched_at desc,id desc limit $3
    ) select r.kind,r.source_id,s.entity_id::text,case when r.kind='list_entry' then r.payload->'entity' else r.payload end payload
    from latest r left join identity.source_record s on s.source='affinity' and s.source_id=
      case when r.kind='list_entry' then (r.payload->>'type')||':'||(r.payload->'entity'->>'id') else r.kind||':'||r.source_id end
    order by r.kind,r.source_id`,[last?.kind??null,last?.source_id??null,pageSize]),async r=>{
    const p=r.payload;
    if(!r.entity_id||!p)return;
    if(index.get(r.entity_id)?.type!=='person') {
      let processed=0;
      for(const d of [p.domain,p.website,...(Array.isArray(p.domains)?p.domains:[])]) {
        add(r.entity_id,'domain',d,'affinity-raw');
        if(++processed%pageSize===0)await yieldTurn();
      }
    }
    for(const l of [p.linkedinUrl,p.linkedin_url,p.linkedin])add(r.entity_id,'linkedin',l,'affinity-raw');
    if(Array.isArray(p.fields)) {
      let processed=0;
      for(const field of p.fields as Array<{name?:string;value?:{data?:unknown}}>) {
        const kind=/linkedin/i.test(field.name??'')?'linkedin':/^(website|domain)$/i.test(field.name??'')&&index.get(r.entity_id)?.type!=='person'?'domain':/^(sec )?cik$/i.test(field.name??'')?'cik':/^crd$/i.test(field.name??'')?'crd':null;
        if(kind)add(r.entity_id,kind,field.value?.data,'affinity-raw');
        if(++processed%pageSize===0)await yieldTurn();
      }
    }
  });
  // The resolver walks parent pointers. Reading those directly avoids rebuilding
  // the complete recursive resolution view for each page.
  const roots=new Map<string,string>();
  await pages<{id:string;root:string}>(last=>tx.query<{id:string;root:string}>(`select entity_id::text id,merged_into::text root from identity.entity
    where merged_into is not null and ($1::uuid is null or entity_id>$1) order by entity_id limit $2`,[last?.id??null,pageSize]),
    r=>{roots.set(r.id,r.root);});
  const forbidden:Array<{a:string;b:string}>=[],seenForbidden=new Set<string>();
  const forbid=(a:string|null,b:string|null)=>{
    if(!a||!b||seenForbidden.has(`${a}:${b}`))return;
    seenForbidden.add(`${a}:${b}`);forbidden.push({a,b});
  };
  await pages<{id:string;a:string|null;b:string|null;merged:string|null;canonical:string|null}>(last=>tx.query<{id:string;a:string|null;b:string|null;merged:string|null;canonical:string|null}>(`with assertions as materialized (
    select * from identity.match_assertion where (kind='not_same_as' or undone_at is not null)
      and ($1::bigint is null or assertion_id>$1) order by assertion_id limit $2
    ) select m.assertion_id::text id,l.entity_id::text a,r.entity_id::text b,m.merged_entity::text merged,m.canonical_entity::text canonical
    from assertions m left join identity.source_record l on l.source=m.left_source and l.source_id=m.left_source_id
    left join identity.source_record r on r.source=m.right_source and r.source_id=m.right_source_id order by m.assertion_id`,[last?.id??null,pageSize]),
    r=>{forbid(r.a,r.b);forbid(r.merged,r.canonical);});
  const byName = new Map<string,Set<string>>(), byIdentifier = new Map<string,Set<string>>();
  const register = (candidate: Candidate) => {
    const name=normalizeIdentityName(candidate.name);
    byName.set(name,(byName.get(name)??new Set()).add(candidate.id));
    for(const key of candidate.identifiers)byIdentifier.set(key,(byIdentifier.get(key)??new Set()).add(candidate.id));
  };
  let registered=0;
  for(const candidate of index.values()) {register(candidate);if(++registered%pageSize===0)await yieldTurn();}
  return {index,roots,forbidden,byName,byIdentifier,register};
}

/** Caller holds the identity lock. Redirects preserve source facts; corrections constrain entire components. */
export async function resolveExternalIdentity(tx: Queryable, context: Awaited<ReturnType<typeof externalIdentityIndex>>, input: {
  source: string; sourceId: string; type: 'person' | 'org'; name: string; identifiers: Identifiers;
  asOf: string; verifiedBy: string;
}): Promise<{ id: string; merged: number; possible: number }> {
  const { index,roots,forbidden,byName,byIdentifier,register } = context;
  const prior = await tx.one<{ id: string }>('select entity_id::text id from identity.source_record where source=$1 and source_id=$2',[input.source,input.sourceId]);
  let id = prior?.id;
  if (!id) {
    id = (await tx.one<{ id: string }>('insert into identity.entity(entity_type,display_name) values($1::identity.entity_type,$2) returning entity_id::text id',[input.type,input.name]))!.id;
    await tx.query(`insert into identity.source_record(source,source_id,entity_id,confidence,resolved_by) values($1,$2,$3,$4,'rule:source-owned')`,[input.source,input.sourceId,id,config.dakota.identityConfidence]);
  } else await tx.query('update identity.entity set display_name=$2 where entity_id=$1 and display_name is distinct from $2',[id,input.name]);
  const identifiers = new Set<string>();
  const normalized: Array<[IdentifierKind,string]> = [];
  for (const [kind,value] of Object.entries(input.identifiers)) {
    const v = normalizeIdentifier(kind as IdentifierKind,value);
    if (v) { normalized.push([kind as IdentifierKind,v]); identifiers.add(`${kind}:${v}`); }
  }
  await tx.query('delete from identity.external_identifier where entity_id=$1 and source=$2',[id,input.source]);
  for (const [kind,value] of normalized) await tx.query(`insert into identity.external_identifier(entity_id,kind,value,source,as_of,confidence,last_verified_by)
    values($1,$2,$3,$4,$5,'medium',$6)`,[id,kind,value,input.source,input.asOf,input.verifiedBy]);
  const old=index.get(id);
  if(old) {
    byName.get(normalizeIdentityName(old.name))?.delete(id);
    for(const key of old.identifiers)byIdentifier.get(key)?.delete(id);
  }
  // Replace only this source's identifiers. Retaining research/other-source
  // identifiers makes a warm cache identical to one rebuilt after a restart.
  const identifierSources=old?.identifierSources??new Map<string,Set<string>>();
  identifierSources.set(`external:${input.source}`,identifiers);
  index.set(id,{id,name:input.name,type:input.type,identifiers:new Set([...identifierSources.values()].flatMap(keys=>[...keys])),identifierSources});
  register(index.get(id)!);
  const root = (x: string): string => { const seen=new Set<string>(); while(roots.has(x)&&roots.get(x)!==x) {if(seen.has(x))throw new Error('Identity cycle.');seen.add(x);x=roots.get(x)!;}return x; };
  const blocked = (other: string) => forbidden.some(f => (root(f.a)===root(id!) && root(f.b)===other) || (root(f.b)===root(id!) && root(f.a)===other));
  const candidateIds=new Set([...(byName.get(normalizeIdentityName(input.name))??[]),...[...identifiers].flatMap(k=>[...(byIdentifier.get(k)??[])])]);
  const matches: Candidate[]=[];
  let searched=0;
  for(const k of candidateIds) {
    const c=index.get(k)!;
    if((c.type===input.type || input.type==='org'&&['foundation','family'].includes(c.type)) && index.has(root(c.id)) && root(c.id)!==root(id!) && !blocked(root(c.id)))matches.push(c);
    if(++searched%200===0)await yieldTurn();
  }
  const strong = matches.filter(c=>[...c.identifiers].some(k=>identifiers.has(k)));
  const strongRoots = [...new Set(strong.map(c=>root(c.id)))];
  let merged=0,possible=0;
  // Ambiguous identifiers never pick an arbitrary winner. A source already redirected stays put.
  if (strongRoots.length===1 && root(id)===id) {
    const target=strongRoots[0]!;
    const other=await tx.one<{source:string;source_id:string}>(`select source,source_id from identity.source_record where identity.canonical_entity_id(entity_id)=$1 order by source,source_id limit 1`,[target]);
    // Standalone manually-created nodes still get a stable identity reference for reversible constraints.
    if (!other) await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('local',$1::text,$1::uuid,'rule:existing-entity') on conflict do nothing`,[target]);
    await tx.query('update identity.entity set merged_into=$2 where entity_id=$1',[id,target]);
    await tx.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
      values('same_as',$1,$2,$3,$4,$5,$6,'identity:v1:external-identifier',$7::jsonb,'Corroborated source identity; source records retained for undo.')`,
      [input.source,input.sourceId,other?.source??'local',other?.source_id??target,id,target,JSON.stringify({source:input.source,identifiers:[...identifiers].filter(k=>strong.some(c=>c.identifiers.has(k))),as_of:input.asOf,confidence:config.dakota.identityConfidence,last_verified_by:input.verifiedBy})]);
    const affected=[id,...[...roots.keys()].filter(k=>root(k)===id)];
    roots.set(id,target);
    await tx.query(`update identity.possible_match set active=false where active
      and (left_entity=any($1::uuid[]) or right_entity=any($1::uuid[]))
      and identity.canonical_entity_id(left_entity)=identity.canonical_entity_id(right_entity)`,[affected]);
    merged++;
  } else {
    const others=new Set<string>();
    for(const c of matches)if(normalizeIdentityName(c.name)===normalizeIdentityName(input.name))others.add(root(c.id));
    const ids=[...others],self=root(id);
    const signals=JSON.stringify({rule:'name_only',source:input.source,as_of:input.asOf,confidence:config.dakota.possibleConfidence,last_verified_by:input.verifiedBy});
    // Indexed candidate lookup above; insert sets rather than one SQL round trip per pair.
    for(let offset=0;offset<ids.length;offset+=200) {
      const rows=await tx.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
        select least($1::uuid,other),greatest($1::uuid,other),$3,$4::jsonb from unnest($2::uuid[]) other
        where other<>$1::uuid on conflict(left_entity,right_entity) do nothing returning edge_id`,[self,ids.slice(offset,offset+200),config.dakota.possibleConfidence,signals]);
      possible+=rows.length;await yieldTurn();
    }
  }
  return {id,merged,possible};
}

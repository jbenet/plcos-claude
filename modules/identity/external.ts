import type { Queryable } from '@/lib/db';
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

type Candidate = { id: string; name: string; type: string; identifiers: Set<string> };
/** Existing source-owned identifiers plus explicit identifiers in existing research/Affinity records. */
export async function externalIdentityIndex(tx: Queryable) {
  const rows = await tx.query<{ id: string; name: string; type: string }>(`select entity_id::text id,display_name name,entity_type::text type
    from identity.entity where retired_at is null`);
  const index = new Map<string, Candidate>(rows.map(r => [r.id, { ...r, identifiers: new Set() }]));
  const add = (id: string, kind: IdentifierKind, value: unknown) => {
    const v = normalizeIdentifier(kind, value); if (v) index.get(id)?.identifiers.add(`${kind}:${v}`);
  };
  for (const r of await tx.query<{ entity_id: string; kind: IdentifierKind; value: string }>('select entity_id::text,kind,value from identity.external_identifier')) add(r.entity_id,r.kind,r.value);
  for (const r of await tx.query<{ entity_id: string; field: string; value: string }>(`select entity_id::text,field,value from research.claim where superseded_by is null`)) {
    const kind = /linkedin/i.test(r.field) ? 'linkedin' : /(^|[._])crd$/i.test(r.field) ? 'crd' : /(^|[._])(sec_)?cik$/i.test(r.field) ? 'cik' : /(^|[._])(website|domain)$/i.test(r.field) ? 'domain' : null;
    if (kind) add(r.entity_id,kind,r.value);
  }
  for (const r of await tx.query<{ entity_id: string; data: { identity?: { links?: { kind: string; url: string }[] } } }>(`select entity_id::text,data from research.note where kind='public_profile'`)) {
    for (const l of r.data.identity?.links ?? []) {
      if (/linkedin/i.test(l.kind)) add(r.entity_id,'linkedin',l.url);
      else if (/website|domain|web/i.test(l.kind) && index.get(r.entity_id)?.type !== 'person') add(r.entity_id,'domain',l.url);
    }
  }
  for (const r of await tx.query<{ entity_id: string; payload: Record<string, unknown> }>(`with latest as (
    select distinct on (source,kind,source_id) * from sources.raw_record where source='affinity'
      and kind in ('person','organization','list_entry') order by source,kind,source_id,fetched_at desc,id desc
    ) select s.entity_id::text,case when r.kind='list_entry' then r.payload->'entity' else r.payload end payload
    from latest r join identity.source_record s on s.source=r.source and s.source_id=
      case when r.kind='list_entry' then (r.payload->>'type')||':'||(r.payload->'entity'->>'id') else r.kind||':'||r.source_id end`)) {
    const p = r.payload;
    if (!p)continue;
    if (index.get(r.entity_id)?.type !== 'person') {
      for (const d of [p.domain,p.website,...(Array.isArray(p.domains)?p.domains:[])]) add(r.entity_id,'domain',d);
    }
    for (const l of [p.linkedinUrl,p.linkedin_url,p.linkedin]) add(r.entity_id,'linkedin',l);
    if(Array.isArray(p.fields))for(const field of p.fields as Array<{name?:string;value?:{data?:unknown}}>) {
      const kind=/linkedin/i.test(field.name??'')?'linkedin':/^(website|domain)$/i.test(field.name??'')&&index.get(r.entity_id)?.type!=='person'?'domain':/^(sec )?cik$/i.test(field.name??'')?'cik':/^crd$/i.test(field.name??'')?'crd':null;
      if(kind)add(r.entity_id,kind,field.value?.data);
    }
  }
  const roots = new Map((await tx.query<{ id: string; root: string }>('select entity_id::text id,canonical_id::text root from identity.entity_resolution')).map(r=>[r.id,r.root]));
  const forbidden = await tx.query<{ a: string; b: string }>(`select l.entity_id::text a,r.entity_id::text b
    from identity.match_assertion m join identity.source_record l on l.source=m.left_source and l.source_id=m.left_source_id
    join identity.source_record r on r.source=m.right_source and r.source_id=m.right_source_id where m.kind='not_same_as' or m.undone_at is not null
    union select merged_entity::text,canonical_entity::text from identity.match_assertion
    where (kind='not_same_as' or undone_at is not null) and merged_entity is not null and canonical_entity is not null`);
  const byName = new Map<string,Set<string>>(), byIdentifier = new Map<string,Set<string>>();
  const register = (candidate: Candidate) => {
    const name=normalizeIdentityName(candidate.name);
    byName.set(name,(byName.get(name)??new Set()).add(candidate.id));
    for(const key of candidate.identifiers)byIdentifier.set(key,(byIdentifier.get(key)??new Set()).add(candidate.id));
  };
  for(const candidate of index.values())register(candidate);
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
  index.set(id,{id,name:input.name,type:input.type,identifiers});
  register(index.get(id)!);
  const root = (x: string): string => { const seen=new Set<string>(); while(roots.has(x)&&roots.get(x)!==x) {if(seen.has(x))throw new Error('Identity cycle.');seen.add(x);x=roots.get(x)!;}return x; };
  const blocked = (other: string) => forbidden.some(f => (root(f.a)===root(id!) && root(f.b)===other) || (root(f.b)===root(id!) && root(f.a)===other));
  const candidateIds=new Set([...(byName.get(normalizeIdentityName(input.name))??[]),...[...identifiers].flatMap(k=>[...(byIdentifier.get(k)??[])])]);
  const matches=[...candidateIds].map(k=>index.get(k)!).filter(c=>(c.type===input.type || input.type==='org'&&['foundation','family'].includes(c.type)) && index.has(root(c.id)) && root(c.id)!==root(id!) && !blocked(root(c.id)));
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
    roots.set(id,target);
    await tx.query(`update identity.possible_match set active=false where active
      and identity.canonical_entity_id(left_entity)=identity.canonical_entity_id(right_entity)`);
    merged++;
  } else for (const c of matches.filter(c=>normalizeIdentityName(c.name)===normalizeIdentityName(input.name))) {
    const [a,b]=[root(id),root(c.id)].sort();
    const r=await tx.one(`insert into identity.possible_match(left_entity,right_entity,confidence,signals) values($1,$2,$3,$4::jsonb)
      on conflict(left_entity,right_entity) do nothing returning edge_id`,[a,b,config.dakota.possibleConfidence,JSON.stringify({rule:'name_only',source:input.source,as_of:input.asOf,confidence:config.dakota.possibleConfidence,last_verified_by:input.verifiedBy})]);
    if(r)possible++;
  }
  return {id,merged,possible};
}

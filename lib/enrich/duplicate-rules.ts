import { config } from '@/config/deployment';
import { createHash } from 'node:crypto';
import { readSeparationGroups } from '@/modules/identity/separation-groups';
import type { Queryable } from '@/lib/db';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import type { ImportDuplicateReport } from './import-dupes';

export const normalizeOrg = (s: string) => normalizeIdentityName(s).replace(/[^\p{L}\p{N}]/gu, '');
const freeMail = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|me|mac|proton|protonmail|pm|aol|aim|gmx|mail|email|yandex|zoho|fastmail|tutanota|tuta|hey)\./i;
export function businessEmailDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const d = value.trim().toLowerCase().replace(/^[^@\s]+@/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) return null;
  return d.split('.').some((_, i, parts) => freeMail.test(parts.slice(i).join('.'))) ? null : d;
}
export function countDuplicateRule(report: ImportDuplicateReport, rule: string) {
  report.rules ??= {};
  report.rules[rule] = (report.rules[rule] ?? 0) + 1;
}
const ownNamedSuffix = /\s+(?:family office|foundation|holdings?)(?:[,.]?\s+(?:llc|ltd|inc)\.?)?$/i;
const pair = (a: string, b: string) => [a, b].sort().join(':');

/** Run under the caller's identity lock. An empty report handles own-named organizations
 * before redirects; the second call handles only the remaining ambiguous candidates.
 * Equal (source, source_id) is already one identity by source_record's primary key.
 * Different IDs constrain complete canonical components, including aliases.
 */
export async function recordDuplicateSeparations(tx: Queryable, by: string, report: ImportDuplicateReport) {
  const entities = await tx.query<{ id: string; name: string; type: string }>(`select entity_id::text id,display_name name,entity_type::text type
    from identity.entity where merged_into is null and retired_at is null order by entity_id`);
  const sources = await tx.query<{ id: string; source: string; key: string }>(`select identity.canonical_entity_id(entity_id)::text id,source,source_id key from identity.source_record order by source,source_id`);
  const owned = new Map<string, typeof sources>();
  for (const s of sources) owned.set(s.id, [...(owned.get(s.id) ?? []), s]);
  const existing = await tx.query<{ a: string; b: string }>(`select identity.canonical_entity_id(coalesce(m.merged_entity,l.entity_id))::text a,
    identity.canonical_entity_id(coalesce(m.canonical_entity,r.entity_id))::text b from identity.match_assertion m
    left join identity.source_record l on l.source=m.left_source and l.source_id=m.left_source_id
    left join identity.source_record r on r.source=m.right_source and r.source_id=m.right_source_id
    where m.kind='not_same_as' or m.undone_at is not null`);
  const recordedGroups = new Set((await tx.query<{key:string}>(`select distinct signals->>'separationGroup' key from identity.match_assertion where kind='not_same_as' and undone_at is null and signals ? 'separationGroup'`)).map(r => r.key));
  const existingGroups = (await readSeparationGroups(tx)).map(ids => new Set(ids));
  const separated = new Set(existing.filter(r => r.a && r.b).map(r => pair(r.a, r.b)));
  const settled = new Set<string>();
  const byName = new Map<string, typeof entities>();
  for (const e of entities) {
    const key = normalizeIdentityName(e.name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), e]);
  }
  const pairs = new Map<string, [typeof entities[number], typeof entities[number], boolean, string?]>();
  const groupSources = new Map<string, string>();
  const entityById = new Map(entities.map(e => [e.id, e]));
  // Only ambiguous review members are external-ID candidates. Own-named organizations
  // must still be separated before the automatic type/merge pass.
  for (const candidate of report.ambiguous) {
    const group = [...new Set(candidate.entityIds)].map(id => entityById.get(id)).filter(e => !!e);
    if (existingGroups.some(ids => group.every(e => ids.has(e.id)))) continue;
    const covered = new Map<string, Set<string>>();
    if (group.length > config.identity.compactSeparationThreshold) {
      for (const source of ['affinity','warehouse','dakota','network_finding']) {
        const bucket = group.filter(e => (owned.get(e.id) ?? []).some(s => s.source === source));
        const keys = bucket.flatMap(e => (owned.get(e.id) ?? []).filter(s => s.source === source).map(s => s.key));
        if (bucket.length < 2 || new Set(keys).size !== keys.length) continue;
        const ids = bucket.map(e => e.id).sort();
        const key = createHash('sha256').update(JSON.stringify([source, ids])).digest('hex');
        groupSources.set(key, source);
        const members = new Set(ids); covered.set(key, members);
        const anchor = entityById.get(ids[0]!)!;
        for (const id of ids.slice(1)) pairs.set(`${key}:${id}`, [anchor, entityById.get(id)!, false, key]);
      }
    }
    if ([...covered.values()].some(ids => group.every(e => ids.has(e.id)))) continue;
    for (let i=0;i<group.length;i++) for (let j=i+1;j<group.length;j++) {
      const a=group[i]!, b=group[j]!;
      if ([...covered.values()].some(ids => ids.has(a.id) && ids.has(b.id))) continue;
      pairs.set(pair(a.id,b.id), [a,b,false]);
    }
  }
  for (const group of byName.values()) {
    const people = group.filter(e => e.type === 'person');
    if (people.length !== 1) continue;
    for (const org of group) if (['org','foundation','family'].includes(org.type) && ownNamedSuffix.test(normalizeIdentityName(org.name)))
      pairs.set(pair(people[0]!.id,org.id), [people[0]!,org,true]);
  }
  // Require the entire person's name, followed only by an explicit organization suffix.
  // A surname-only foundation is ambiguous. This does not infer ownership or authority.
  for (const org of entities.filter(e => ['org','foundation','family'].includes(e.type))) {
    const n=normalizeIdentityName(org.name);
    const base=n.replace(ownNamedSuffix,'');
    if (base===n) continue;
    const people=(byName.get(base)??[]).filter(e=>e.type==='person');
    if (people.length===1 && base.split(' ').length>=2) {
      const person=people[0]!;
      pairs.set(pair(person.id,org.id),[person,org,true]);
    }
  }
  const pending: Array<{ls:string;lk:string;rs:string;rk:string;a:string;b:string;rule:string;signals:string}> = [];
  const local = new Set<string>();
  for (const [, [a,b,ownNamed,separationGroup]] of pairs) {
    const key = pair(a.id,b.id);
    const left=owned.get(a.id)??[],right=owned.get(b.id)??[];
    const conflict=left.find(l => ['affinity','warehouse','dakota','network_finding'].includes(l.source)
      && right.some(r => r.source===l.source && r.key!==l.key));
    const rule=ownNamed?'own_named_organization':conflict?'different_external_id':null;
    if (!rule) continue;
    settled.add(key);
    if (separationGroup ? !recordedGroups.has(separationGroup) : !separated.has(key) && !existingGroups.some(ids => ids.has(a.id) && ids.has(b.id))) {
      const l=conflict??left[0]??{source:'local',key:a.id};
      const r=(conflict?right.find(s=>s.source===conflict.source&&s.key!==conflict.key):right[0])??{source:'local',key:b.id};
      for (const [e, records] of [[a,left],[b,right]] as const) if (!records.length) local.add(e.id);
      pending.push({ls:l.source,lk:l.key,rs:r.source,rk:r.key,a:a.id,b:b.id,rule,
        signals:JSON.stringify({by,source:conflict?.source,rule,separationGroup,separationSource:separationGroup ? groupSources.get(separationGroup) : undefined})});
      separated.add(key); countDuplicateRule(report,rule);
    }
    if (ownNamed) {
      await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty,note)
        select $1,$2,'contact','',$3,current_date,'inferred','Own-named organization; capacity not established.'
        where not exists(select 1 from identity.affiliation where identity.canonical_entity_id(person_entity)=$1
          and identity.canonical_entity_id(org_entity)=$2 and ended_on is null)`,[a.id,b.id,'identity:v1:own_named_organization']);
    }
  }
  if (local.size) await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
    select 'local',id::text,id,'rule:existing-entity' from unnest($1::uuid[]) id on conflict do nothing`, [[...local]]);
  // The caller holds the identity/source lock. Existing canonical pairs and group keys
  // were excluded above; ON CONFLICT alone is insufficient (assertion IDs are unique).
  if (pending.length) await tx.query(`insert into identity.match_assertion
    (kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
    select 'not_same_as',ls,lk,rs,rk,a,b,'identity:v1:'||rule,signals::jsonb,
      'Deterministic distinct identities; source records retained.'
    from unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::uuid[],$6::uuid[],$7::text[],$8::text[])
      as batch(ls,lk,rs,rk,a,b,rule,signals) on conflict do nothing`,
    ['ls','lk','rs','rk','a','b','rule','signals'].map(k => pending.map(row => row[k as keyof typeof row])));
  return settled;
}

/** Project remaining groups after subset merges; retired aliases are never review members. */
export async function suppressDeterministicSeparations(tx: Queryable, report: ImportDuplicateReport, separated: Set<string>) {
  const ids=[...new Set([...report.ambiguous.flatMap(g=>g.entityIds), ...[...separated].flatMap(k=>k.split(':'))])];
  if (!ids.length) return;
  const rows=await tx.query<{id:string;root:string}>(`select id::text,identity.canonical_entity_id(id)::text root from unnest($1::uuid[]) id`,[ids]);
  const roots=new Map(rows.map(r=>[r.id,r.root]));
  const settled=new Set([...separated].map(k=>{const [a,b]=k.split(':');return pair(roots.get(a!)??a!,roots.get(b!)??b!);}));
  const compactGroups = (await readSeparationGroups(tx)).map(ids => new Set(ids));
  const seen=new Set<string>();
  report.ambiguous=report.ambiguous.flatMap(g=>{
    const entityIds=[...new Set(g.entityIds.map(id=>roots.get(id)??id))].sort();
    const key=entityIds.join(':');
    if (entityIds.length<2 || seen.has(key) || compactGroups.some(ids => entityIds.every(id => ids.has(id))) || entityIds.every((a,i)=>entityIds.slice(i+1).every(b=>settled.has(pair(a,b)) || compactGroups.some(ids => ids.has(a) && ids.has(b))))) return [];
    seen.add(key);return [{...g,entityIds}];
  });
}

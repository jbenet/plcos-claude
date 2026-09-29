/** Frozen pre-fix separation hotspot, invented-fixture benchmark only. */
import type { Queryable } from '@/lib/db';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import type { ImportDuplicateReport } from '../../lib/enrich/import-dupes';

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

/** Run under the caller's identity lock, before any redirects. IDs stay source-owned.
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
  const separated = new Set(existing.filter(r => r.a && r.b).map(r => pair(r.a, r.b)));
  const settled = new Set<string>();
  const byName = new Map<string, typeof entities>();
  for (const e of entities) {
    const key = normalizeIdentityName(e.name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), e]);
  }
  const pairs = new Map<string, [typeof entities[number], typeof entities[number], boolean]>();
  for (const group of byName.values()) for (let i=0;i<group.length;i++) for (const b of group.slice(i+1)) {
    const a=group[i]!;
    const person=a.type==='person'?a:b.type==='person'?b:null;
    const org=person===a?b:a;
    const ownNamed=!!person && group.filter(e=>e.type==='person').length===1 && ['org','foundation','family'].includes(org.type) && ownNamedSuffix.test(normalizeIdentityName(org.name));
    pairs.set(pair(a.id,b.id),ownNamed?[person!,org,true]:[a,b,false]);
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
  for (const [key,[a,b,ownNamed]] of pairs) {
    const left=owned.get(a.id)??[],right=owned.get(b.id)??[];
    const conflict=left.find(l => ['affinity','warehouse','dakota','network_finding'].includes(l.source)
      && right.some(r => r.source===l.source && r.key!==l.key));
    const rule=ownNamed?'own_named_organization':conflict?'different_external_id':null;
    if (!rule) continue;
    settled.add(key);
    if (!separated.has(key)) {
      const l=conflict??left[0]??{source:'local',key:a.id};
      const r=(conflict?right.find(s=>s.source===conflict.source&&s.key!==conflict.key):right[0])??{source:'local',key:b.id};
      // Source-less manual nodes get a stable reference only when necessary.
      for (const [e,owned] of [[a,left],[b,right]] as const) if (!owned.length) await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values('local',$1::text,$1::uuid,'rule:existing-entity') on conflict do nothing`,[e.id]);
      await tx.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
        values('not_same_as',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,'Deterministic distinct identities; source records retained.')`,
      [l.source,l.key,r.source,r.key,a.id,b.id,`identity:v1:${rule}`,JSON.stringify({by,source:conflict?.source,rule})]);
      separated.add(key); countDuplicateRule(report,rule);
    }
    if (ownNamed) {
      await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty,note)
        select $1,$2,'contact','',$3,current_date,'inferred','Own-named organization; capacity not established.'
        where not exists(select 1 from identity.affiliation where identity.canonical_entity_id(person_entity)=$1
          and identity.canonical_entity_id(org_entity)=$2 and ended_on is null)`,[a.id,b.id,'identity:v1:own_named_organization']);
    }
  }
  return settled;
}


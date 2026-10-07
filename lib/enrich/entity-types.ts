import type { Queryable } from '@/lib/db';
import { identityRawContext } from './identity-context';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import { recordEntityTypeCorrection } from '@/modules/identity/entity-type';
import type { Finding } from './schema';
import type { Path } from './connect';

export interface EntityTypeReport {
  corrected: Array<{ entityId: string; name: string; correctionId: string }>;
  ambiguous: Array<{ entityId: string; name: string; reason: string }>;
}
const RULE = 'rule:org-name-match';
const meaningful = (v: unknown): boolean => {
  if (typeof v === 'string') return !!v.trim() && !/^(unknown|none|null|n\/a|not recorded)$/i.test(v.trim());
  if (Array.isArray(v)) return v.some(meaningful);
  if (v && typeof v === 'object') {
    if ('data' in v) return meaningful(v.data);
    return Object.values(v).some(meaningful);
  }
  return false;
};
/** Conservative presence test, not an inference from the spelling of a name. */
export function personEvidence(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, metadata = false) => {
    if (typeof v === 'string') {
      if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(v)) found.add('email');
      if (/https?:\/\/[^\s]+\/(?:people|person|team|bio|bios|biography|biographies|profile|profiles|staff|leadership|author|authors)\/[^\s/]+/i.test(v)) found.add('personal page');
      if (/(?:www\.)?linkedin\.com\/(?:in|pub)\//i.test(v)) found.add('personal LinkedIn');
    } else if (Array.isArray(v)) v.forEach(item => walk(item, metadata));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (/^(bio|personal(?:[ _-]*(?:page|website|site))?)$/i.test(String(o.kind ?? '')) && meaningful(o.url)) found.add('personal page');
      const sourceMetadata = metadata || ('url' in o && ('kind' in o || 'published' in o));
      // Affinity enriched fields and stored claim rows name their field separately.
      const label = String(o.name ?? o.field ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]/g, ' ');
      if (!sourceMetadata && /\b(job[ _-]*)?titles?\b|\brole$/i.test(label) && meaningful(o.value)) found.add('title');
      if (/personal (page|website|site|url)|bio url/i.test(label) && meaningful(o.value)) found.add('personal page');
      if (/email/i.test(label) && !/domain/i.test(label) && meaningful(o.value)) found.add('email');
      for (const [k, item] of Object.entries(o)) {
        if (!sourceMetadata && /^(?:current[ _-]*)?(?:job[ _-]*)?titles?$|^role$/i.test(k.replace(/([a-z])([A-Z])/g, '$1 $2')) && meaningful(item)) found.add('title');
        if (/personal[ _-]*(page|website|site|url)|^bio[ _-]*url$/i.test(k) && meaningful(item)) found.add('personal page');
        if (/email/i.test(k) && !/domain/i.test(k) && meaningful(item)) found.add('email');
        walk(item, sourceMetadata || k === 'source' || k === 'sources');
      }
    }
  };
  walk(value);
  return [...found].sort();
}

/** The identity part of Import the findings. Runs before W3 preflight in its transaction.
 * Corrects type only: name equality does not authorize an identity merge.
 */
export async function correctPipelineEntityTypes(tx: Queryable, findings: Finding[], paths: Path[], by: string): Promise<EntityTypeReport> {
  await tx.exec('lock table identity.entity in share row exclusive mode');
  const report: EntityTypeReport = { corrected: [], ambiguous: [] };
  const people = await tx.query<{ id: string; name: string }>(`select distinct e.entity_id::text id,e.display_name name
    from strategy.active_pursuit p join identity.entity e on e.entity_id=identity.canonical_entity_id(p.entity_id)
    where e.entity_type='person' and e.retired_at is null`);
  if (!people.length) return report;
  const organizations = new Map<string, Set<string>>();
  const addOrg = (name: unknown, key?: string) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const n = normalizeIdentityName(name);
    const keys = organizations.get(n) ?? new Set<string>();
    if (key) keys.add(key);
    organizations.set(n, keys);
  };
  const known = await tx.query<{ id: string; name: string }>(`select distinct e.entity_id::text id,e.display_name name
    from identity.entity e where e.entity_type='org' and e.retired_at is null and e.merged_into is null`);
  for (const o of known) addOrg(o.name, o.id);
  for (const f of findings) {
    if (!['confirmed', 'probable'].includes(f.identity.match)) continue;
    addOrg(f.identity.canonical?.org);
    for (const fact of f.facts) {
      const d = fact.detail as Record<string, unknown> | undefined;
      if (d) for (const n of [d.company, d.org, d.organization, d.firm, d.fund, ...(Array.isArray(d.companies) ? d.companies : [])]) addOrg(n);
    }
    for (const c of f.connections ?? []) if (c.toType === 'org') addOrg(c.to);
  }
  // Source descriptors can identify conflicting organizations. A descriptor already mapped
  // to a canonical organization is the same vote as that organization, not a second vote.
  const descriptors = paths.flatMap(p => [p.lpPerson, p.other.person]).filter(d => d?.entityType === 'org');
  const typedEndpoints = paths.filter(p => p.other.entityType === 'org' && p.other.key).map(p => ({ name: p.other.name, key: p.other.key! }));
  const references = [...descriptors.filter((d): d is NonNullable<typeof d> => !!d), ...typedEndpoints];
  const sourceIds = references.map(d => d.key);
  const mapped = new Map((await tx.query<{ key: string; id: string }>(`select source_id key,identity.canonical_entity_id(entity_id)::text id
    from identity.source_record where source='w3_person' and source_id=any($1::text[])`, [sourceIds])).map(r => [r.key, r.id]));
  const canonicalKeys = new Map((await tx.query<{ key: string; id: string }>(`select entity_id::text key,identity.canonical_entity_id(entity_id)::text id
    from identity.entity where entity_id=any($1::uuid[])`, [sourceIds])).map(r => [r.key, r.id]));
  const mentioned = new Map<string, Set<string>>();
  for (const d of references) {
    if (!d) continue;
    const n = normalizeIdentityName(d.name);
    mentioned.set(n, (mentioned.get(n) ?? new Set()).add(mapped.get(d.key) ?? canonicalKeys.get(d.key) ?? d.key));
    addOrg(d.name);
  }
  for (const p of paths) if (p.other.entityType === 'org') addOrg(p.other.name);
  const candidates = people.filter(p => organizations.has(normalizeIdentityName(p.name)));
  if (!candidates.length) return report;
  const ids = candidates.map(p => p.id);
  const evidence = await storedPersonEvidence(tx, ids, findings, paths);
  const decisions = new Set((await tx.query<{ id: string }>(`select entity_id::text id from identity.entity_type_correction
    where entity_id=any($1::uuid[])`, [ids])).map(r => r.id));
  for (const p of candidates) {
    const n = normalizeIdentityName(p.name);
    const reasons = [...(evidence.get(p.id) ?? [])];
    if (organizations.get(n)!.size > 1 || (mentioned.get(n)?.size ?? 0) > 1) reasons.push('multiple organization identities share this name');
    if (decisions.has(p.id)) reasons.push('prior local type decision; automatic correction withheld');
    if (reasons.length) { report.ambiguous.push({ entityId: p.id, name: p.name, reason: reasons.join('; ') }); continue; }
    const correctionId = await recordEntityTypeCorrection(tx, { entityId: p.id, type: 'org', by,
      reason: 'Exact normalized organization name match; no person evidence found in available identity sources.',
      rule: RULE, requestKey: `${RULE}:${p.id}`, evidence: { normalizedName: n, organizations: [...organizations.get(n)!], descriptors: [...(mentioned.get(n) ?? [])] } });
    if (correctionId) report.corrected.push({ entityId: p.id, name: p.name, correctionId });
  }
  return report;
}

/** Historical source evidence follows every alias; sparse refreshes cannot erase it. */
export async function storedPersonEvidence(tx: Queryable, ids: string[], findings: Finding[] = [], paths: Path[] = []): Promise<Map<string, Set<string>>> {
  const evidence = new Map<string, Set<string>>();
  if (!ids.length) return evidence;
  const addEvidence = (id: string, value: unknown) => {
    const reasons = evidence.get(id) ?? new Set<string>();
    personEvidence(value).forEach(r => reasons.add(r));
    evidence.set(id, reasons);
  };
  const members = await tx.query<{ id: string; root: string }>(`with recursive members as (
      select entity_id id,entity_id root from identity.entity
        where entity_id=any($1::uuid[]) and merged_into is null
      union all
      select e.entity_id,m.root from members m join identity.entity e on e.merged_into=m.id
    ) select id::text,root::text from members`, [ids]);
  const roots = new Map(members.map(m => [m.id, m.root]));
  for (const f of findings) if (roots.has(f.key)) addEvidence(roots.get(f.key)!, f);
  // Source-owned raw snapshots are read locally, including historical person evidence.
  // A later sparse snapshot must not erase it. List entries contain identity inside entity.
  const raw = await identityRawContext(tx, members.map(m => m.id));
  for (const r of raw) addEvidence(roots.get(r.id)!, r.payload);
  const notes = await tx.query<{ id: string; data: unknown }>(`select entity_id::text id,data from research.note
    where entity_id=any($1::uuid[]) and (kind='public_profile' or (kind='context' and data->>'source'='prospects'))`, [members.map(m => m.id)]);
  for (const r of notes) addEvidence(roots.get(r.id)!, r.data);
  const claims = await tx.query<{ id: string; field: string; value: string }>(`select c.entity_id::text id,c.field,c.value,d.origin from research.claim c left join research.source_doc d on d.doc_id=c.source
    where c.entity_id=any($1::uuid[])`, [members.map(m => m.id)]);
  for (const r of claims) addEvidence(roots.get(r.id)!, r);
  const pathNotes = await tx.query<{ data: { paths?: Path[] } }>(`select data from research.note where kind='connection_candidates'`);
  const w3Sources = new Map((await tx.query<{ key: string; id: string }>(`select source_id key,entity_id::text id
    from identity.source_record where source='w3_person' and entity_id=any($1::uuid[])`, [members.map(m => m.id)]))
    .map(r => [r.key, roots.get(r.id)!]));
  for (const p of [...paths, ...pathNotes.flatMap(n => n.data.paths ?? [])]) {
    for (const d of [p.lpPerson, p.other.person]) if (d) {
      const root = roots.get(d.key) ?? w3Sources.get(d.key);
      if (root) addEvidence(root, d.source);
    }
  }
  const roles = await tx.query<{ id: string; role: string }>(`select person_entity::text id,role from identity.affiliation
    where person_entity=any($1::uuid[])`, [members.map(m => m.id)]);
  for (const r of roles) {
    addEvidence(roots.get(r.id)!, r);
    evidence.get(roots.get(r.id)!)!.add('person affiliation');
  }
  const affiliations = await tx.query<{ id: string }>(`select distinct m.id::text id
    from unnest($1::uuid[]) m(id) join network.edge e on e.from_entity=m.id or e.to_entity=m.id
    join identity.entity o on o.entity_id=identity.canonical_entity_id(case when e.from_entity=m.id then e.to_entity else e.from_entity end)
    where o.entity_type='org' and o.entity_id<>identity.canonical_entity_id(m.id)
      and (e.kind::text='same_firm' or exists(select 1 from jsonb_array_elements(e.evidence) v
        where v->>'note' ~* 'affiliation|employment|employed by|works at'))`, [members.map(m => m.id)]);
  for (const r of affiliations) {
    const root = roots.get(r.id)!;
    evidence.set(root, (evidence.get(root) ?? new Set()).add('person affiliation'));
  }
  const accounts = await tx.query<{ id: string }>(`select entity_id::text id from identity.source_record where source='app_user' and entity_id=any($1::uuid[])`, [members.map(m => m.id)]);
  for (const r of accounts) {
    const root = roots.get(r.id)!;
    evidence.set(root, (evidence.get(root) ?? new Set()).add('person user account'));
  }
  const links = await tx.query<{ id: string; value: string }>(`select entity_id::text id,value from identity.external_identifier
    where entity_id=any($1::uuid[]) `, [members.map(m => m.id)]);
  for (const r of links) addEvidence(roots.get(r.id)!, r.value);
  // Dakota's replica keeps contact evidence in typed local columns, not raw_record.
  const contacts = await tx.query<{ id: string; email: string | null; title: string | null; linkedin: string | null }>(
    `select entity_id::text id,email,title,linkedin_url__c linkedin from dakota.contact where entity_id=any($1::uuid[])`, [members.map(m => m.id)]);
  for (const r of contacts) addEvidence(roots.get(r.id)!, r);
  return evidence;
}

export interface TypeCandidate {
  entityId: string; name: string;
  /** Organisations recorded under the same normalised name. */
  organizations: string[];
  /** Person evidence found in our records (a title, an email, an affiliation…); empty means none was found. */
  evidence: string[];
  /** Pipelines the record is in. */
  pursuits: number;
}

/**
 * Pipeline people whose normalised name is the name of an organisation we hold (issue 0063): the list a person
 * reviews before marking a record an organisation. Read-only. Unlike the import's automatic pass, this lists
 * every match, with the person evidence that would hold the automatic correction back.
 */
export async function pipelinePeopleNamedLikeOrgs(tx: Queryable): Promise<TypeCandidate[]> {
  const people = await tx.query<{ id: string; name: string; pursuits: number }>(`select e.entity_id::text id,e.display_name name,count(*)::int pursuits
    from strategy.active_pursuit p join identity.entity e on e.entity_id=identity.canonical_entity_id(p.entity_id)
    where e.entity_type='person' and e.retired_at is null group by e.entity_id,e.display_name`);
  if (!people.length) return [];
  const organizations = new Map<string, string[]>();
  for (const o of await tx.query<{ id: string; name: string }>(`select entity_id::text id,display_name name from identity.entity
    where entity_type='org' and retired_at is null and merged_into is null`)) {
    const n = normalizeIdentityName(o.name);
    if (n) organizations.set(n, [...(organizations.get(n) ?? []), o.id]);
  }
  const matches = people.filter(p => organizations.has(normalizeIdentityName(p.name)));
  if (!matches.length) return [];
  const evidence = await storedPersonEvidence(tx, matches.map(p => p.id));
  return matches.map(p => ({ entityId: p.id, name: p.name, organizations: organizations.get(normalizeIdentityName(p.name))!,
    evidence: [...(evidence.get(p.id) ?? [])].sort(), pursuits: p.pursuits }))
    .sort((a, b) => a.evidence.length - b.evidence.length || a.name.localeCompare(b.name));
}

import type { Queryable } from '@/lib/db';
import { identityGraphContext, identityRawContext } from './identity-context';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import { identityReviewGroupId } from './identity-decisions';

export interface IdentityReviewMember {
  entityId: string; displayName: string; entityType: string;
  sources: Array<{ source: string; externalId: string }>;
  affiliations: Array<{ org: string; role: string }>;
  titles: string[]; personalUrls: string[];
  pursuits: Array<{ vehicle: string; status: string }>;
  counts: { claims: number; paths: number; notes: number };
  createdBy: string[];
}
export interface IdentityReviewGroup {
  group: string; name: string; type: 'person' | 'org' | 'mixed';
  members: IdentityReviewMember[]; reasons: string[];
}

// Identity fields can themselves contain contact details. Project only allowed fields,
// then scrub their strings too; never serialize a source payload or a note body.
const email = /([\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+)/giu;
const phone = /(?<![\p{L}\p{N}_])(?:\+?\(?\d[\d\s().-]{5,}\d)(?![\p{L}\p{N}_])/gu;
const redact = (value: string, identifier: boolean): string => value.split(email).map((part, index) => {
  // Handle addresses separately so numeric domains survive phone detection too.
  if (index % 2) return `…${part.slice(part.lastIndexOf('@'))}`;
  return identifier ? part : part.replace(phone, match =>
    (match.match(/\d/g)?.length ?? 0) >= 7 ? '[contact omitted]' : match);
}).join('');
const clean = (value: unknown, identifier = false): string => {
  if (typeof value !== 'string') return '';
  let decoded = value;
  try {
    for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
  } catch { /* Malformed escapes are still checked as ordinary text. */ }
  const redacted = redact(decoded, identifier);
  return (redacted !== decoded ? redacted : value).trim();
};
function personalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /\s/.test(value.trim())) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) return null;
    // Queries and fragments can carry private contact tokens, even on public pages.
    url.search = ''; url.hash = '';
    let decoded = url.href;
    for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
    if (clean(decoded) !== decoded || /(?:mailto:|tel:|sms:)/i.test(decoded)) return null;
    return url.href;
  } catch { return null; }
}
const unique = <T>(values: T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];

/** Caller owns a transaction. Preview rolls back even successful rule repairs. */
export async function exportIdentityReview(tx: Queryable): Promise<IdentityReviewGroup[]> {
  const { mergeImportDuplicatesInTransaction } = await import('./import-dupes');
  let ambiguous: Awaited<ReturnType<typeof mergeImportDuplicatesInTransaction>>['ambiguous'];
  await tx.exec('savepoint identity_review_export');
  try {
    ambiguous = (await mergeImportDuplicatesInTransaction(tx, 'identity-review-export', [], [], { reviewOnly: true })).ambiguous;
  } finally {
    await tx.exec('rollback to savepoint identity_review_export');
    await tx.exec('release savepoint identity_review_export');
  }
  const ids = [...new Set(ambiguous.flatMap(group => group.entityIds))];
  if (!ids.length) return [];
  const entities = await tx.query<{ id: string; root: string; name: string; type: string }>(`select e.entity_id::text id,
    r.canonical_id::text root,e.display_name name,e.entity_type::text type
    from identity.entity e join identity.entity_resolution r using(entity_id) where r.canonical_id=any($1::uuid[])`, [ids]);
  const roots = new Map(entities.map(e => [e.id, e.root]));
  const aliases = entities.map(e => e.id);
  const members = new Map(entities.filter(e => e.id === e.root).map(e => [e.id, {
    entityId: e.id, displayName: clean(e.name), entityType: e.type, sources: [], affiliations: [], titles: [],
    personalUrls: [], pursuits: [], counts: { claims: 0, paths: 0, notes: 0 }, createdBy: [],
  } as IdentityReviewMember]));
  const member = (id: string) => members.get(roots.get(id) ?? id);
  const sources = await tx.query<{ id: string; source: string; key: string; rule: string }>(`select entity_id::text id,
    source,source_id key,resolved_by rule from identity.source_record where entity_id=any($1::uuid[]) order by source,source_id`, [aliases]);
  for (const s of sources) {
    const m = member(s.id)!;
    // source_id is an opaque key by schema, regardless of connector or digit count.
    // Email-shaped keys retain only their domain; explicit phone schemes stay private.
    m.sources.push({ source: clean(s.source), externalId: /^(mailto|tel|sms):/i.test(s.key)
      ? (/^mailto:/i.test(s.key) ? clean(s.key.slice(7), true) : '[contact omitted]')
      : clean(s.key, true) });
    if (clean(s.rule)) m.createdBy.push(clean(s.rule));
  }
  const affiliations = await tx.query<{ id: string; org: string; role: string }>(`select a.person_entity::text id,
    o.display_name org,a.role from identity.affiliation a join identity.entity o on o.entity_id=identity.canonical_entity_id(a.org_entity)
    where a.person_entity=any($1::uuid[])`, [aliases]);
  for (const a of affiliations) {
    const m = member(a.id)!; m.affiliations.push({ org: clean(a.org), role: clean(a.role) });
    if (clean(a.role)) m.titles.push(clean(a.role));
  }
  const graphAffiliations = await identityGraphContext(tx, aliases);
  for (const a of graphAffiliations) member(a.id)!.affiliations.push({ org: clean(a.org), role: '' });
  function readIdentity(id: string, data: unknown, depth = 0) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || depth > 5) return;
    const d = data as Record<string, unknown>, m = member(id);
    if (!m) return;
    for (const key of ['title', 'job_title', 'jobTitle', 'role', 'position']) if (clean(d[key])) m.titles.push(clean(d[key]));
    const org = ['org', 'organization', 'company', 'firm', 'contextOrganization'].map(key => clean(d[key])).find(Boolean);
    if (org) m.affiliations.push({ org, role: clean(d.role ?? d.title) });
    for (const key of ['linkedin', 'linkedin_url', 'linkedinUrl', 'linkedin_url__c', 'personal_url', 'personalUrl', 'personal_website', 'bio_url']) {
      const url = personalUrl(d[key]); if (url) m.personalUrls.push(url);
    }
    for (const link of Array.isArray(d.links) ? d.links : []) {
      if (!link || typeof link !== 'object') continue;
      const l = link as Record<string, unknown>;
      if (['bio', 'personal', 'personal_website', 'linkedin'].includes(String(l.kind))) {
        const url = personalUrl(l.url); if (url) m.personalUrls.push(url);
      }
    }
    for (const key of ['identity', 'canonical', 'entity']) readIdentity(id, d[key], depth + 1);
    for (const fact of Array.isArray(d.facts) ? d.facts : []) {
      if (fact && typeof fact === 'object' && ['role', 'prior_role', 'affiliation'].includes(String(fact.field))) readIdentity(id, fact.detail, depth + 1);
    }
  }
  const raw = await identityRawContext(tx, aliases);
  for (const row of raw) readIdentity(row.id, row.payload);
  const profiles = await tx.query<{ id: string; data: unknown }>(`select entity_id::text id,data from research.note
    where entity_id=any($1::uuid[]) and (kind in ('public_profile','identity_creation') or (kind='context' and data->>'source'='prospects'))`, [aliases]);
  for (const row of profiles) {
    readIdentity(row.id, row.data);
    const data=row.data as {organizations?:unknown;personalUrls?:unknown};
    for(const org of Array.isArray(data.organizations)?data.organizations:[]) if(clean(org))member(row.id)!.affiliations.push({org:clean(org),role:''});
    for(const value of Array.isArray(data.personalUrls)?data.personalUrls:[]) {const url=personalUrl(value);if(url)member(row.id)!.personalUrls.push(url);}
  }
  const contacts = await tx.query<{ id: string; title: string | null; linkedin: string | null }>(`select entity_id::text id,
    title,linkedin_url__c linkedin from dakota.contact where entity_id=any($1::uuid[])`, [aliases]);
  for (const row of contacts) readIdentity(row.id, row);
  const links = await tx.query<{ id: string; value: string }>(`select entity_id::text id,value from identity.external_identifier
    where entity_id=any($1::uuid[]) and kind='linkedin'`, [aliases]);
  for (const row of links) { const url = personalUrl(row.value); if (url) member(row.id)!.personalUrls.push(url); }
  const claims = await tx.query<{ id: string; field: string; value: string }>(`select entity_id::text id,field,value
    from research.claim where entity_id=any($1::uuid[])`, [aliases]);
  for (const row of claims) {
    const m = member(row.id)!; m.counts.claims++;
    const field = row.field.replace(/^public\./, '');
    if (['title', 'role', 'job_title'].includes(field) && clean(row.value)) m.titles.push(clean(row.value));
    if (['linkedin', 'personal_url', 'bio_url'].includes(field)) { const url = personalUrl(row.value); if (url) m.personalUrls.push(url); }
  }
  const notes = await tx.query<{ id: string; n: number }>(`select entity_id::text id,count(*)::int n from research.note
    where entity_id=any($1::uuid[]) group by entity_id`, [aliases]);
  for (const row of notes) member(row.id)!.counts.notes += row.n;
  // Expand each stored path once, then resolve its keys through the already-loaded
  // aliases and sources. The old OR/EXISTS join compared every path with every
  // member and repeatedly scanned source_record. A key may identify several roots;
  // retain them all, counting each (note, path ordinal, root) exactly once.
  const keyRoots = new Map<string, Set<string>>();
  const addKey = (key: string, root: string) => {
    const owners = keyRoots.get(key) ?? new Set<string>();
    owners.add(root); keyRoots.set(key, owners);
  };
  for (const e of entities) addKey(e.id, e.root);
  for (const s of sources) addKey(s.key, roots.get(s.id)!);
  const paths = await tx.query<{ owner: string | null; keys: Array<string | null> }>(`select n.entity_id::text owner,
    array[p.data->>'lp',p.data->'other'->>'key',p.data->'lpPerson'->>'key',
      p.data->'other'->'person'->>'key'] keys
    from research.note n cross join lateral jsonb_array_elements(case when jsonb_typeof(n.data->'paths')='array'
      then n.data->'paths' else '[]'::jsonb end) p(data)
    where n.kind='connection_candidates'`);
  for (const path of paths) {
    const referenced = new Set<string>();
    // Note ownership is an entity reference, never an external source key.
    const owner = path.owner && roots.get(path.owner);
    if (owner) referenced.add(owner);
    for (const key of path.keys) if (key !== null) {
      for (const root of keyRoots.get(key) ?? []) referenced.add(root);
    }
    for (const root of referenced) members.get(root)!.counts.paths++;
  }
  const pursuits = await tx.query<{ id: string; vehicle: string; status: string }>(`select p.entity_id::text id,v.name vehicle,p.status::text status
    from strategy.active_pursuit p join platform.vehicle v on v.id=p.vehicle_id where p.entity_id=any($1::uuid[])
    order by v.name,p.status`, [aliases]);
  for (const p of pursuits) member(p.id)!.pursuits.push({ vehicle: clean(p.vehicle), status: clean(p.status) });
  for (const m of members.values()) {
    m.sources = unique(m.sources); m.affiliations = unique(m.affiliations); m.pursuits = unique(m.pursuits);
    m.titles = unique(m.titles).sort(); m.personalUrls = unique(m.personalUrls).sort(); m.createdBy = unique(m.createdBy).sort();
  }
  const groups = new Map<string, IdentityReviewGroup>();
  for (const group of ambiguous) {
    const rows = [...group.entityIds].sort().map(id => members.get(id)!).filter(Boolean);
    const types = new Set(rows.map(m => m.entityType));
    const id = identityReviewGroupId(group.entityIds);
    groups.set(id, { group: id, name: clean(normalizeIdentityName(group.name)),
      type: types.size === 1 && types.has('person') ? 'person' as const : types.size === 1 && types.has('org') ? 'org' as const : 'mixed' as const,
      members: rows, reasons: unique([...(groups.get(id)?.reasons ?? []), ...group.reason.split('; ').map(reason => clean(reason))]).sort() });
  }
  return [...groups.values()].sort((a, b) => a.group.localeCompare(b.group));
}

import type { Queryable } from '@/lib/db';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import type { Finding } from './schema';
import type { Path } from './connect';
import type { ImportDuplicateReport } from './import-dupes';

type Person = { id: string; root: string; name: string; created: string; retired: boolean };
type Source = { id: string; source: string; key: string; resolver: string };
const internal = (s: string) => ['prospect', 'prospect_key', 'w3_person', 'network_person', 'network_candidate'].includes(s) || s.startsWith('rule:');
const imported = (s: Source) => internal(s.source) || s.resolver.startsWith('rule:sourced-');
type Signals = { orgs: Set<string>; urls: Set<string> };
const meaningful = (s: string) => !!s.trim() && !/^(unknown|none|null|n\/a|not recorded)$/i.test(s.trim());

// A shared article, firm homepage or email domain is not a personal identity locator.
function personalUrl(value: unknown, explicit = false): string | null {
  if (typeof value !== 'string' || !meaningful(value) || /\s/.test(value.trim())) return null;
  const text = value.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return null;
    const path = u.pathname.replace(/\/+$/, '');
    if (host === 'linkedin.com') return /^\/(in|pub)\/[^/]+/i.test(path) ? `${host}${path.toLowerCase()}` : null;
    if (!explicit && !/^\/(people|person|team|bio|bios|profile|profiles|staff|leadership|authors?)\/[^/]+/i.test(path)) return null;
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return `${host}${u.port ? `:${u.port}` : ''}${path}${u.search}`;
  } catch { return null; }
}

/** Only structured identity/affiliation fields, never free-text mentions of another person or firm. */
function readSignals(value: unknown, into: Signals) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const org = (x: unknown) => { if (typeof x === 'string' && meaningful(x) && /[\p{L}\p{N}]/u.test(x)) into.orgs.add(normalizeIdentityName(x)); };
  const url = (x: unknown, explicit = false) => { const key = personalUrl(x, explicit); if (key) into.urls.add(key); };
  for (const key of ['org', 'organization', 'company', 'firm', 'contextOrganization']) org(v[key]);
  for (const key of ['linkedin', 'linkedin_url', 'linkedinUrl', 'linkedin_url__c', 'personal_url', 'personalUrl', 'personal_website', 'bio_url']) url(v[key], !key.startsWith('linkedin'));
  if (typeof v.source === 'string') url(v.source);
  if (v.identity && typeof v.identity === 'object') {
    const identity = v.identity as Record<string, unknown>;
    if (identity.match === undefined || ['confirmed', 'probable'].includes(String(identity.match))) readSignals(identity, into);
  }
  if (v.canonical) readSignals(v.canonical, into);
  if (v.entity) readSignals(v.entity, into); // Affinity list entry's subject
  for (const link of Array.isArray(v.links) ? v.links : []) {
    if (link && typeof link === 'object') {
      const l = link as Record<string, unknown>;
      url(l.url, ['bio', 'personal', 'personal_website'].includes(String(l.kind)));
    }
  }
  for (const fact of Array.isArray(v.facts) ? v.facts : []) {
    const f = fact as Record<string, unknown>;
    if (f && ['role', 'prior_role', 'affiliation'].includes(String(f.field))) readSignals(f.detail, into);
  }
  for (const source of Array.isArray(v.sources) ? v.sources : []) {
    if (typeof source === 'string') url(source);
    else if (source && typeof source === 'object') {
      const s = source as Record<string, unknown>;
      url(s.url, ['bio', 'personal', 'personal_website'].includes(String(s.kind)));
    }
  }
}

/** Caller holds the identity lock. Original records stay put; only audited redirects change. */
export async function mergeImportPeople(tx: Queryable, by: string, report: ImportDuplicateReport, findings: Finding[], paths: Path[]) {
  const people = await tx.query<Person>(`select e.entity_id::text id,r.canonical_id::text root,
    e.display_name name,e.created_at::text created,e.retired_at is not null retired
    from identity.entity e join identity.entity_resolution r using(entity_id)
    join identity.entity canonical on canonical.entity_id=r.canonical_id where canonical.entity_type='person'`);
  const roots = new Map(people.map(p => [p.id, p.root]));
  const groups = new Map<string, Person[]>();
  for (const p of people) if (p.id === p.root && !p.retired) {
    const key = normalizeIdentityName(p.name);
    if (key) groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const duplicateRoots = new Set([...groups.values()].filter(g => g.length > 1).flatMap(g => g.map(p => p.id)));
  const ids = people.filter(p => duplicateRoots.has(p.root)).map(p => p.id);
  if (!ids.length) return;
  const sources = await tx.query<Source>(`select entity_id::text id,source,source_id key,resolved_by resolver
    from identity.source_record where entity_id=any($1::uuid[]) order by source,source_id`, [ids]);
  const rootSources = (id: string) => sources.filter(s => roots.get(s.id) === id);
  const isImport = (id: string) => rootSources(id).some(imported);
  const established = (id: string) => rootSources(id).some(s => !internal(s.source));
  const signals = new Map([...duplicateRoots].map(id => [id, { orgs: new Set<string>(), urls: new Set<string>() }]));
  const apply = (id: string, data: unknown) => { const s = signals.get(roots.get(id) ?? id); if (s) readSignals(data, s); };
  const affiliations = await tx.query<{ id: string; name: string }>(`select a.person_entity::text id,o.display_name name
    from identity.affiliation a join identity.entity o on o.entity_id=identity.canonical_entity_id(a.org_entity)
    where a.person_entity=any($1::uuid[])
    union select p.id::text,o.display_name from unnest($1::uuid[]) p(id)
    join network.edge e on e.from_entity=p.id or e.to_entity=p.id
    join identity.entity o on o.entity_id=identity.canonical_entity_id(case when e.from_entity=p.id then e.to_entity else e.from_entity end)
    where o.entity_type='org' and (e.kind::text in ('same_firm','employment') or exists(
      select 1 from jsonb_array_elements(e.evidence) v where v->>'note' ~* 'affiliation|employment|employed by|works at'))`, [ids]);
  for (const a of affiliations) apply(a.id, { org: a.name });
  const notes = await tx.query<{ id: string; data: unknown }>(`select entity_id::text id,data from research.note
    where entity_id=any($1::uuid[]) and (kind='public_profile' or (kind='context' and data->>'source'='prospects'))`, [ids]);
  for (const n of notes) apply(n.id, n.data);
  const raw = await tx.query<{ id: string; payload: unknown }>(`select s.entity_id::text id,r.payload
    from identity.source_record s join sources.raw_record r on r.source=s.source and
      (r.source_id=s.source_id or (s.source='affinity' and (r.kind||':'||r.source_id=s.source_id or
        (r.kind='list_entry' and (r.payload->>'type')||':'||(r.payload->'entity'->>'id')=s.source_id))))
    where s.entity_id=any($1::uuid[])`, [ids]);
  for (const r of raw) apply(r.id, r.payload);
  const links = await tx.query<{ id: string; value: string }>(`select entity_id::text id,value from identity.external_identifier
    where kind='linkedin' and entity_id=any($1::uuid[])`, [ids]);
  for (const l of links) apply(l.id, { linkedin: l.value });
  const contacts = await tx.query<{ id: string; linkedin: string | null }>(`select entity_id::text id,linkedin_url__c linkedin
    from dakota.contact where entity_id=any($1::uuid[])`, [ids]);
  for (const c of contacts) apply(c.id, c);
  const keyOwner = (key: string) => roots.has(key) ? key : (() => {
    const matches = [...new Set(sources.filter(s => s.key === key).map(s => roots.get(s.id)!))];
    return matches.length === 1 ? matches[0]! : '';
  })();
  for (const f of findings) if (['confirmed', 'probable'].includes(f.identity.match)) apply(keyOwner(f.key), f);
  const pathNotes = await tx.query<{ data: { paths?: Path[] } }>(`select data from research.note where kind='connection_candidates'`);
  for (const p of [...paths, ...pathNotes.flatMap(n => n.data.paths ?? [])]) {
    for (const d of [p.lpPerson, p.other.person]) if (d) apply(keyOwner(d.key), d);
  }
  const constraints = await tx.query<{ a: string | null; b: string | null; ls: string; lk: string; rs: string; rk: string }>(
    `select merged_entity::text a,canonical_entity::text b,left_source ls,left_source_id lk,right_source rs,right_source_id rk
     from identity.match_assertion where kind='not_same_as' or undone_at is not null`);
  const bySource = new Map(sources.map(s => [`${s.source}\0${s.key}`, roots.get(s.id)!]));
  const corrected = new Set((await tx.query<{ id: string }>(`select entity_id::text id from identity.entity_type_correction
    where entity_id=any($1::uuid[])`, [ids])).map(c => roots.get(c.id)!));
  const shared = (a: string, b: string) => {
    const x = signals.get(a)!, y = signals.get(b)!;
    return { organizations: [...x.orgs].filter(v => y.orgs.has(v)).sort(), personalUrls: [...x.urls].filter(v => y.urls.has(v)).sort() };
  };
  const corroborates = (a: string, b: string) => { const s = shared(a, b); return s.organizations.length + s.personalUrls.length > 0; };
  for (const [name, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2 || !group.some(p => isImport(p.id))) continue;
    // Build proposals before writing, so an ambiguous fork cannot become an arbitrary first match.
    const remaining = new Set(group.map(p => p.id));
    while (remaining.size) {
      const component = new Set([remaining.values().next().value!]);
      for (const a of component) for (const b of group) if (!component.has(b.id)
        && (isImport(a) || isImport(b.id)) && corroborates(a, b.id)) component.add(b.id);
      for (const id of component) remaining.delete(id);
      if (component.size === 1 && !isImport([...component][0]!)) continue;
      const members = people.filter(p => component.has(p.root));
      const ownedSources = sources.filter(s => component.has(roots.get(s.id)!));
      const reasons = new Set<string>();
      if (component.size === 1) reasons.add('matching name without corroborating organization or personal URL');
      if ([...component].filter(established).length > 1) reasons.add('multiple established identities match the imported person');
      if (members.some(p => p.retired)) reasons.add('retired identity in component');
      if ([...component].some(id => corrected.has(id))) reasons.add('prior local type decision');
      if (ownedSources.some(s => s.source === 'app_user')) reasons.add('user account requires explicit roster resolution');
      if (members.some(p => !sources.some(s => s.id === p.id))) reasons.add('identity has unknown provenance');
      for (const a of component) for (const b of component) if (a !== b && !corroborates(a, b)) reasons.add('corroboration does not identify every candidate in component');
      const external = new Map<string, Set<string>>();
      for (const s of ownedSources) if (!internal(s.source)) external.set(s.source, (external.get(s.source) ?? new Set()).add(s.key));
      for (const [source, keys] of external) if (keys.size > 1) reasons.add(`different external IDs from ${source}`);
      for (const c of constraints) {
        const a = (c.a && roots.get(c.a)) || bySource.get(`${c.ls}\0${c.lk}`);
        const b = (c.b && roots.get(c.b)) || bySource.get(`${c.rs}\0${c.rk}`);
        if (a && b && component.has(a) && component.has(b)) reasons.add('prior identity separation or reversed merge');
      }
      if (reasons.size) {
        const entityIds = (component.size === 1 ? group.map(p => p.id) : [...component]).sort();
        const previous = report.ambiguous.find(a => a.entityIds.join(':') === entityIds.join(':'));
        const reason = [...reasons].sort().join('; ');
        if (!previous) report.ambiguous.push({ name: group[0]!.name, entityIds, reason });
        else if (!previous.reason.includes(reason)) previous.reason += `; ${reason}`;
        continue;
      }
      const ordered = group.filter(p => component.has(p.id)).sort((a, b) => Number(established(b.id)) - Number(established(a.id))
        || Date.parse(a.created) - Date.parse(b.created) || a.id.localeCompare(b.id));
      const survivor = ordered[0]!, canonical = rootSources(survivor.id)[0]!;
      for (const loser of ordered.slice(1)) {
        const source = rootSources(loser.id)[0]!;
        await tx.query('update identity.entity set merged_into=$2 where entity_id=$1', [loser.id, survivor.id]);
        const assertion = await tx.one<{ id: string }>(`insert into identity.match_assertion
          (kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
          values('same_as',$1,$2,$3,$4,$5,$6,'identity:v1:import-duplicates',$7::jsonb,
            'Corroborated imported person duplicate; original source references retained for undo.') returning assertion_id::text id`,
        [source.source, source.key, canonical.source, canonical.key, loser.id, survivor.id,
          JSON.stringify({ entityType: 'person', normalizedName: name, by, ...shared(loser.id, survivor.id) })]);
        report.merged++;
        report.merges.push({ assertionId: assertion!.id, survivorId: survivor.id, loserId: loser.id, name: survivor.name });
      }
    }
  }
}

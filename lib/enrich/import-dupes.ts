import { readSeparationGroups, violatesSeparationGroup } from '@/modules/identity/separation-groups';
import type { Db, Queryable } from '@/lib/db';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import { recordEntityTypeCorrection } from '@/modules/identity/entity-type';
import { consolidatePursuitsInTransaction, type PursuitMergeReport } from '@/modules/strategy';
import { storedPersonEvidence } from './entity-types';
import type { Finding } from './schema';
import type { Path } from './connect';
import { mergeImportPeople } from './import-person-dupes';
import { applyIdentityDecisions, readIdentityDecisions, suppressSeparatedIdentityGroups,
  type IdentityDecisionInput, type IdentityDecisionReport } from './identity-decisions';
import { config } from '@/config/deployment';
import { foldIdentityReviewComponents } from './identity-review-components';
import { resolvedIdentities } from './identity-roots';
import { join } from 'node:path';

import { recordDuplicateSeparations, suppressDeterministicSeparations } from './duplicate-rules';

const RULE = 'identity:v1:import-duplicates';
const TYPE_RULE = 'rule:import-duplicate-org';
// These keys identify our rows/descriptors, not distinct upstream organizations.
const internalSource = (source: string) => ['prospect', 'prospect_key', 'prospect_org', 'w3_person',
  'network_candidate', 'network_org', 'network_person', 'investing-organization:v1'].includes(source) || source.startsWith('rule:');
type Entity = { id: string; root: string; name: string; type: string; created: string; retired: boolean };
type Source = { id: string; source: string; key: string; resolver: string };
export interface ImportDuplicateReport {
  merged: number;
  rules?: Record<string, number>;
  merges: Array<{ assertionId: string; survivorId: string; loserId: string; name: string }>;
  corrected: Array<{ entityId: string; correctionId: string }>;
  ambiguous: Array<{ name: string; entityIds: string[]; reason: string }>;
  pursuitMerges?: PursuitMergeReport;
  decisions?: IdentityDecisionReport;
}

/** Local imported organizations and corroborated imported people. Whole components are checked before any mutation.
 * Like the existing identity resolver, retain original FKs and record a reversible redirect.
 * Caller owns the transaction; there is deliberately no DB-opening command line script.
 */
export async function mergeImportDuplicatesInTransaction(tx: Queryable, by: string,
  findings: Finding[] = [], paths: Path[] = [],
  options: { decisions?: IdentityDecisionInput[]; reviewOnly?: boolean } = {}): Promise<ImportDuplicateReport> {
  if (!by.trim()) throw new Error('An actor is required');
  await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
  const report: ImportDuplicateReport = { merged: 0, merges: [], corrected: [], ambiguous: [] };
  const separated = await recordDuplicateSeparations(tx, by, report);
  const entities: Entity[] = await resolvedIdentities(tx);
  const roots = new Map(entities.map(e => [e.id, e.root]));
  const creationPairs = (await tx.query<{a:string;b:string}>(`select left_entity::text a,right_entity::text b
    from identity.possible_match where active and signals->>'rule'='creation-name-only'`))
    .map(p => ({ a: roots.get(p.a), b: roots.get(p.b) }));
  const groups = new Map<string, Entity[]>();
  for (const e of entities) if (e.id === e.root && !e.retired && ['org', 'person'].includes(e.type)) {
    const name = normalizeIdentityName(e.name);
    if (name) groups.set(name, [...(groups.get(name) ?? []), e]);
  }
  const duplicates = [...groups.entries()].filter(([, g]) => g.length > 1 && g.some(e => e.type === 'org'))
    .sort(([a], [b]) => a.localeCompare(b));

  const candidateRoots = new Set(duplicates.flatMap(([, g]) => g.map(e => e.id)));
  const members = entities.filter(e => candidateRoots.has(e.root));
  const ids = members.map(e => e.id);
  const sources = await tx.query<Source>(`select entity_id::text id,source,source_id key,resolved_by resolver
    from identity.source_record where entity_id=any($1::uuid[]) order by source,source_id`, [ids]);
  const bySource = new Map(sources.map(s => [`${s.source}\0${s.key}`, roots.get(s.id)!]));
  const separationGroups = await readSeparationGroups(tx);
  const constraints = await tx.query<{ a: string | null; b: string | null; ls: string; lk: string; rs: string; rk: string }>(
    `select merged_entity::text a,canonical_entity::text b,left_source ls,left_source_id lk,right_source rs,right_source_id rk
     from identity.match_assertion where kind='not_same_as' or undone_at is not null`);
  const corrections = await tx.query<{ id: string; rule: string; original: string; reversed: boolean }>(
    `select entity_id::text id,rule,original_type::text original,reversed_at is not null reversed
     from identity.entity_type_correction where entity_id=any($1::uuid[])`, [ids]);
  // Recheck corrected former people too: the preceding 0063 pass must not conceal evidence.
  const people = members.filter(e => e.type === 'person' || corrections.some(c => c.id === e.id && c.original === 'person'));
  const evidence = await storedPersonEvidence(tx, [...new Set(people.map(e => e.root))], findings, paths);
  const references = await tx.query<{ id: string; n: number }>(`select id::text,count(*)::int n from (
    select entity_id id from strategy.active_pursuit where entity_id=any($1::uuid[])
    union all select entity_id from research.claim where entity_id=any($1::uuid[])
    union all select e.entity_id from research.note n cross join lateral
      jsonb_array_elements(case when jsonb_typeof(n.data->'paths')='array' then n.data->'paths' else '[]'::jsonb end) p
      cross join lateral (select distinct key from unnest(array[n.entity_id::text,p->>'lp',p->'other'->>'key']) key) k
      join identity.entity e on e.entity_id=any($1::uuid[]) and e.entity_id::text=k.key
      where n.kind='connection_candidates'
  ) refs group by id`, [ids]);
  const counts = new Map<string, number>();
  for (const r of references) counts.set(roots.get(r.id)!, (counts.get(roots.get(r.id)!) ?? 0) + r.n);
  for (const [name, group] of duplicates) {
    const groupIds = new Set(group.map(e => e.id));
    const component = members.filter(e => groupIds.has(e.root));
    const groupSources = sources.filter(s => groupIds.has(roots.get(s.id)!));
    const reasons = new Set<string>();
    if (violatesSeparationGroup(groupIds, separationGroups)) reasons.add('prior identity group separation');
    if(creationPairs.some(p=>p.a!==p.b && p.a && p.b && groupIds.has(p.a) && groupIds.has(p.b))) {
      reasons.add('creation name-only match requires identity review');
    }
    for (const e of component) {
      const own = groupSources.filter(s => s.id === e.id);
      if (!own.length || own.some(s => !internalSource(s.source) && !s.resolver.startsWith('rule:'))) {
        reasons.add('identity has unknown or non-import provenance');
      }
      if (e.retired) reasons.add('retired identity in component');
      for (const reason of evidence.get(e.root) ?? []) reasons.add(reason);
    }
    const external = new Map<string, Set<string>>();
    for (const s of groupSources) if (!internalSource(s.source)) {
      external.set(s.source, (external.get(s.source) ?? new Set()).add(s.key));
    }
    for (const [source, keys] of external) if (keys.size > 1) reasons.add(`different external IDs from ${source}`);
    for (const c of constraints) {
      const a = (c.a && roots.get(c.a)) || bySource.get(`${c.ls}\0${c.lk}`);
      const b = (c.b && roots.get(c.b)) || bySource.get(`${c.rs}\0${c.rk}`);
      if (a && b && groupIds.has(a) && groupIds.has(b)) reasons.add('prior identity separation or reversed merge');
    }
    for (const c of corrections) if (groupIds.has(roots.get(c.id)!)) {
      if (c.reversed || !['rule:org-name-match', TYPE_RULE].includes(c.rule)) reasons.add('prior local type decision');
    }
    if (reasons.size) {
      report.ambiguous.push({ name: group[0]!.name, entityIds: [...groupIds].sort(), reason: [...reasons].sort().join('; ') });
      continue;
    }
    group.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)
      || Date.parse(a.created) - Date.parse(b.created) || a.id.localeCompare(b.id));
    for (const e of group) if (e.type === 'person') {
      const correctionId = await recordEntityTypeCorrection(tx, { entityId: e.id, type: 'org', by,
        rule: TYPE_RULE, requestKey: `${TYPE_RULE}:${e.id}`,
        reason: 'Imported organization namesakes with no person evidence in available sources.',
        evidence: { normalizedName: name, entityIds: [...groupIds] } });
      if (correctionId) report.corrected.push({ entityId: e.id, correctionId });
    }
    const survivor = group[0]!;
    const canonicalSource = groupSources.find(s => roots.get(s.id) === survivor.id)!;
    for (const loser of group.slice(1)) {
      const source = groupSources.find(s => roots.get(s.id) === loser.id)!;
      await tx.query('update identity.entity set merged_into=$2 where entity_id=$1', [loser.id, survivor.id]);
      const assertion = await tx.one<{ id: string }>(`insert into identity.match_assertion
        (kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
        values('same_as',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,'Imported organization duplicate; original source references retained for undo.')
        returning assertion_id::text id`, [source.source, source.key, canonicalSource.source, canonicalSource.key,
        loser.id, survivor.id, RULE, JSON.stringify({ normalizedName: name, by, references: Object.fromEntries(group.map(e => [e.id, counts.get(e.id) ?? 0])) })]);
      report.merged++;
      report.merges.push({ assertionId: assertion!.id, survivorId: survivor.id, loserId: loser.id, name: survivor.name });
    }
  }
  await mergeImportPeople(tx, by, report, findings, paths);
  // W13 also reviews manual/connector namesakes that the imported-person pass does
  // not own. Fold current queued components into the same stable decision groups.
  const queued = await tx.query<{a:string;b:string;name:string}>(`with pairs as materialized (
    select left_entity,right_entity from identity.possible_match
    where active and signals->>'rule'='creation-name-only'
  ), endpoints as (select left_entity id from pairs union select right_entity from pairs),
  roots as materialized (
    select e.entity_id id,case when e.merged_into is null then e.entity_id
      else identity.canonical_entity_id(e.entity_id) end root
    from endpoints p join identity.entity e on e.entity_id=p.id
  ) select a.entity_id::text a,b.entity_id::text b,a.display_name name
    from pairs p join roots l on l.id=p.left_entity join roots r on r.id=p.right_entity
    join identity.entity a on a.entity_id=l.root join identity.entity b on b.entity_id=r.root
    where a.entity_id<>b.entity_id and a.retired_at is null and b.retired_at is null`);
  report.ambiguous = foldIdentityReviewComponents(report.ambiguous, queued);
  for (const key of await recordDuplicateSeparations(tx, by, report)) separated.add(key);
  await suppressDeterministicSeparations(tx, report, separated);
  await suppressSeparatedIdentityGroups(tx, report);
  if (!options.reviewOnly) await applyIdentityDecisions(tx, by, report, options.decisions ?? []);
  if (report.decisions?.applied) {
    // A partial merge or retype changes the remaining group. Report current roots and
    // reasons, without silently applying a second round of automatic repairs.
    await tx.exec('savepoint identity_review_remaining');
    try {
      report.ambiguous = (await mergeImportDuplicatesInTransaction(tx, by, findings, paths, { reviewOnly: true })).ambiguous;
    } finally {
      await tx.exec('rollback to savepoint identity_review_remaining');
      await tx.exec('release savepoint identity_review_remaining');
    }
  }
  // Review callers roll back repairs; queue retirement cannot change this report.
  if (options.reviewOnly) return report;
  // Materialize canonical endpoints once per distinct entity, then compare sets.
  // A correlated EXISTS used to resolve every assertion again for each queued pair.
  await tx.query(`with active_pairs as materialized (
    select edge_id,left_entity,right_entity,signals->>'rule' rule from identity.possible_match where active
  ), assertions as materialized (
    select m.merged_entity,m.canonical_entity,m.signals->>'separationGroup' group_key,
      l.entity_id left_source_entity,r.entity_id right_source_entity
    from identity.match_assertion m
    left join identity.source_record l on l.source=m.left_source and l.source_id=m.left_source_id
    left join identity.source_record r on r.source=m.right_source and r.source_id=m.right_source_id
    where m.kind='not_same_as' and m.undone_at is null
  ), endpoint_ids as (
    select left_entity id from active_pairs union select right_entity from active_pairs
    union select merged_entity from assertions union select canonical_entity from assertions
    union select left_source_entity from assertions union select right_source_entity from assertions
  ), roots as materialized (
    select e.entity_id id,case when e.merged_into is null then e.entity_id
      else identity.canonical_entity_id(e.entity_id) end canonical_id
    from endpoint_ids i join identity.entity e on e.entity_id=i.id
  ), pairs as materialized (
    select p.edge_id,p.rule,a.canonical_id l,b.canonical_id r
    from active_pairs p join roots a on a.id=p.left_entity join roots b on b.id=p.right_entity
  ), separated as materialized (
    select distinct least(l.canonical_id,r.canonical_id) l,greatest(l.canonical_id,r.canonical_id) r
    from assertions a join roots l on l.id=a.left_source_entity join roots r on r.id=a.right_source_entity
  ), memberships as materialized (
    select r.canonical_id,array_agg(distinct a.group_key) groups from (
      select group_key,merged_entity id from assertions where group_key is not null
      union select group_key,canonical_entity from assertions where group_key is not null
    ) a join roots r on r.id=a.id group by r.canonical_id
  ), retired as (
    select edge_id from pairs where l=r
    union select p.edge_id from pairs p join separated s on s.l=least(p.l,p.r) and s.r=greatest(p.l,p.r)
      where p.rule='creation-name-only'
    union select p.edge_id from pairs p join memberships a on a.canonical_id=p.l
      join memberships b on b.canonical_id=p.r where a.groups && b.groups
  ) update identity.possible_match p set active=false from retired r where p.edge_id=r.edge_id`);
  return report;
}

export async function mergeImportDuplicates(db: Db, by: string, decisionDir = join(config.data.root, 'enrich')) {
  const decisions = await readIdentityDecisions(decisionDir);
  return db.transaction(async tx => {
    const report = await mergeImportDuplicatesInTransaction(tx, by, [], [], { decisions });
    report.pursuitMerges = await consolidatePursuitsInTransaction(tx, by);
    return report;
  });
}

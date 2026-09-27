// Test-only frozen pre-optimization implementation for semantic parity and profiling.
import type { Db, Queryable } from '@/lib/db';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import { recordEntityTypeCorrection } from '@/modules/identity/entity-type';
import { consolidatePursuitsInTransaction, type PursuitMergeReport } from '@/modules/strategy';
import { storedPersonEvidence } from './baseline-entity-types';
import type { Finding } from '@/lib/enrich/schema';
import type { Path } from '@/lib/enrich/connect';
import { mergeImportPeople } from './baseline-people';
import { applyIdentityDecisions, readIdentityDecisions, suppressSeparatedIdentityGroups,
  type IdentityDecisionInput, type IdentityDecisionReport } from '@/lib/enrich/identity-decisions';
import { config } from '@/config/deployment';
import { join } from 'node:path';

const RULE = 'identity:v1:import-duplicates';
const TYPE_RULE = 'rule:import-duplicate-org';
// These keys identify our rows/descriptors, not distinct upstream organizations.
const internalSource = (source: string) => ['prospect', 'prospect_key', 'prospect_org', 'w3_person',
  'network_candidate', 'network_org', 'network_person', 'investing-organization:v1'].includes(source) || source.startsWith('rule:');
type Entity = { id: string; root: string; name: string; type: string; created: string; retired: boolean };
type Source = { id: string; source: string; key: string; resolver: string };
export interface ImportDuplicateReport {
  merged: number;
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
  const entities = await tx.query<Entity>(`select e.entity_id::text id,r.canonical_id::text root,
    e.display_name name,e.entity_type::text type,e.created_at::text created,e.retired_at is not null retired
    from identity.entity e join identity.entity_resolution r using(entity_id) order by e.entity_id`);
  const roots = new Map(entities.map(e => [e.id, e.root]));
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
      join identity.entity e on e.entity_id=any($1::uuid[]) and
        (e.entity_id=n.entity_id or e.entity_id::text=p->>'lp' or e.entity_id::text=p->'other'->>'key')
      where n.kind='connection_candidates'
  ) refs group by id`, [ids]);
  const counts = new Map<string, number>();
  for (const r of references) counts.set(roots.get(r.id)!, (counts.get(roots.get(r.id)!) ?? 0) + r.n);
  for (const [name, group] of duplicates) {
    const groupIds = new Set(group.map(e => e.id));
    const component = members.filter(e => groupIds.has(e.root));
    const groupSources = sources.filter(s => groupIds.has(roots.get(s.id)!));
    const reasons = new Set<string>();
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
  await tx.query(`update identity.possible_match set active=false where active
    and identity.canonical_entity_id(left_entity)=identity.canonical_entity_id(right_entity)`);
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

import { readSeparationGroups, violatesSeparationGroup } from '@/modules/identity/separation-groups';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db, Queryable } from '@/lib/db';
import { recordEntityTypeCorrection } from '@/modules/identity/entity-type';
import type { ImportDuplicateReport } from './import-dupes';

export const identityReviewGroupId = (ids: string[]) => createHash('sha256').update(JSON.stringify([...new Set(ids)].sort())).digest('hex');
export interface IdentityDecisionInput { line: number; value?: unknown; error?: string }
export interface IdentityDecision {
  group: string; decision: 'merge' | 'separate' | 'retype'; survivor?: string; members?: string[];
  newType?: 'person' | 'org'; evidence: Array<{ source: string; as_of: string; quote: string }>; decided_by: string;
}
export interface IdentityDecisionReport {
  applied: number; skipped: number;
  refused: Array<{ line: number; group?: string; reason: string }>;
  superseded: Array<{ line: number; group: string; byLine: number }>;
  separations: Array<{ assertionId: string; group: string }>;
}
const internalSource = (s: string) => ['prospect', 'prospect_key', 'prospect_org', 'w3_person',
  'network_candidate', 'network_org', 'network_person', 'investing-organization:v1'].includes(s) || s.startsWith('rule:');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const fail = (message: string): never => { throw new Error(message); };

/** A missing file means no proposals. Malformed lines remain visible alongside valid ones. */
export async function readIdentityDecisions(dir: string): Promise<IdentityDecisionInput[]> {
  let text: string;
  try { text = await readFile(join(dir, 'identity-decisions.jsonl'), 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  return text.split(/\r?\n/).flatMap<IdentityDecisionInput>((line, i) => {
    if (!line.trim()) return [];
    try { return [{ line: i + 1, value: JSON.parse(line) }]; }
    catch { return [{ line: i + 1, error: 'Invalid JSON' }]; }
  });
}

/** What is wrong with one proposed decision, judged by its own fields (a push checks this before the server keeps it); empty when valid. */
export function identityDecisionProblems(value: unknown): string[] {
  try { validate(value); return []; } catch (e) { return [(e as Error).message]; }
}

function validate(value: unknown): IdentityDecision {
  if (!object(value)) fail('Decision must be an object');
  const v = value as Record<string, unknown>;
  if (typeof v.group !== 'string' || !/^[0-9a-f]{64}$/.test(v.group)) fail('group must be the exported SHA-256 group ID');
  if (typeof v.decision !== 'string' || !['merge', 'separate', 'retype'].includes(v.decision)) fail('decision must be merge, separate or retype');
  if (!nonempty(v.decided_by)) fail('decided_by is required');
  if (!Array.isArray(v.evidence) || !v.evidence.length || !v.evidence.every(e => object(e)
    && nonempty(e.source) && nonempty(e.quote) && typeof e.as_of === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(e.as_of) && !isNaN(Date.parse(e.as_of))
    && new Date(e.as_of).toISOString().slice(0, 10) === e.as_of)) fail('At least one evidence item with source, valid as_of (YYYY-MM-DD) and quote is required');
  if (v.members !== undefined && (!Array.isArray(v.members) || !v.members.length
    || !v.members.every(uuid) || new Set(v.members).size !== v.members.length)) fail('members must be unique entity UUIDs');
  if (v.survivor !== undefined && !uuid(v.survivor)) fail('survivor must be an entity UUID');
  if (v.decision === 'retype') {
    if (typeof v.newType !== 'string' || !['person', 'org'].includes(v.newType)) fail('retype requires newType person or org');
    if (!Array.isArray(v.members)) fail('retype requires explicit members');
    if (v.survivor !== undefined) fail('retype does not take a survivor');
  } else if (v.newType !== undefined || (v.decision === 'separate' && v.survivor !== undefined)) fail('Fields do not match the decision kind');
  return { group: v.group as string, decision: v.decision as IdentityDecision['decision'],
    ...(v.survivor ? { survivor: v.survivor as string } : {}),
    ...(v.members ? { members: [...v.members as string[]].sort() } : {}),
    ...(v.newType ? { newType: v.newType as 'person' | 'org' } : {}),
    evidence: (v.evidence as IdentityDecision['evidence']).map(e => ({ source: e.source.trim(), as_of: e.as_of, quote: e.quote.trim() })),
    decided_by: (v.decided_by as string).trim() };
}

/** Separation is a full-group assertion: changing the member set requires a fresh review. */
export async function suppressSeparatedIdentityGroups(tx: Queryable, report: ImportDuplicateReport) {
  const rows = await tx.query<{ group: string }>(`select distinct signals->>'group' "group" from identity.match_assertion
    where kind='not_same_as' and rule='identity:v1:decision:separate' and undone_at is null`);
  const separated = new Set(rows.map(r => r.group));
  report.ambiguous = report.ambiguous.filter(g => !separated.has(identityReviewGroupId(g.entityIds)));
}

type Member = { id: string; root: string; type: string; retired: boolean; name: string };
type Source = { id: string; source: string; key: string };

/** Decisions use existing reversible redirects/type corrections. The caller owns the identity lock.
 * Each line has a savepoint: one refused line cannot partially apply or abort its valid neighbours.
 */
export async function applyIdentityDecisions(tx: Queryable, by: string, report: ImportDuplicateReport, inputs: IdentityDecisionInput[]) {
  const result: IdentityDecisionReport = { applied: 0, skipped: 0, refused: [], superseded: [], separations: [] };
  report.decisions = result;
  const parsed = inputs.map(input => {
    try { if (input.error) fail(input.error); return { input, decision: validate(input.value) }; }
    catch (e) { result.refused.push({ line: input.line, reason: (e as Error).message }); return { input }; }
  });
  const fingerprint = (d: IdentityDecision) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
  const receipts = await tx.query<{ key: string }>(`select data->>'key' key from research.note
    where kind='identity_review_decision' and data->>'key'=any($1::text[])`,
  [parsed.flatMap(p => p.decision ? [fingerprint(p.decision)] : [])]);
  const applied = new Set(receipts.map(r => r.key));
  // A hash alone cannot recover an old export's members. Only use a current group or
  // explicit members that reproduce its full-group hash; never guess from a name.
  const groupMembers = (d: IdentityDecision) => report.ambiguous.find(g => identityReviewGroupId(g.entityIds) === d.group)?.entityIds
    ?? (d.members && identityReviewGroupId(d.members) === d.group ? d.members : undefined);
  const superseded = new Map<IdentityDecisionInput, number>();
  for (const { input, decision: d } of parsed) {
    if (!d || applied.has(fingerprint(d))) continue;
    const members = groupMembers(d);
    if (!members) continue;
    const later = parsed.find(p => {
      // Only a later proposal of the same kind supersedes (issue 0138: a merge swallowed the retype before it).
      if (!p.decision || p.input.line <= input.line || p.decision.decision !== d.decision) return false;
      const next = groupMembers(p.decision);
      return next && next.length > members.length && members.every(id => next.includes(id))
        && (d.members ?? members).every(id => (p.decision!.members ?? next).includes(id));
    });
    if (later) superseded.set(input, later.input.line);
  }
  // The same decision pushed twice, with other evidence or reviewer (issue 0138: two Mac sessions each
  // pushed the retype and the merge). They do not conflict; each is tried in file order until one applies,
  // and the rest are then superseded by it.
  // Read once, before any decision changes the groups.
  const outcomes = new Map(parsed.flatMap(({ decision: d }) => d ? [[d, JSON.stringify([d.group, d.decision, [...(d.members ?? groupMembers(d) ?? [])].sort(),
    d.decision === 'merge' ? d.survivor ?? null : null, d.decision === 'retype' ? d.newType ?? null : null])] as const] : []));
  const outcome = (d: IdentityDecision) => outcomes.get(d)!;
  const appliedOutcome = new Map<string, number>();
  for (const { input, decision: d } of parsed) if (d && applied.has(fingerprint(d)) && !appliedOutcome.has(outcome(d))) appliedOutcome.set(outcome(d), input.line);
  // A retype and a merge for one group do not conflict: the retype comes first in the file and makes the
  // members one type, then the merge applies (issue 0138). A merge and a separation do, as do two retypes.
  const lane = (d: IdentityDecision) => `${d.group}:${d.decision === 'retype' ? 'retype' : 'outcome'}`;
  const variants = new Map<string, Set<string>>();
  for (const { input, decision: d } of parsed) if (d && !applied.has(fingerprint(d)) && !superseded.has(input))
    variants.set(lane(d), (variants.get(lane(d)) ?? new Set()).add(outcome(d)));
  for (const { input, decision: d } of parsed) {
    if (!d) continue;
    const key = fingerprint(d);
    if (applied.has(key)) { result.skipped++; continue; }
    const byLine = superseded.get(input);
    const sameAs = byLine ?? appliedOutcome.get(outcome(d));
    if (sameAs !== undefined) { result.superseded.push({ line: input.line, group: d.group, byLine: sameAs }); continue; }
    const delta: Pick<ImportDuplicateReport, 'merged' | 'merges' | 'corrected'> = { merged: 0, merges: [], corrected: [] };
    const separations: IdentityDecisionReport['separations'] = [];
    await tx.exec('savepoint identity_decision');
    try {
      if (variants.get(lane(d))!.size > 1) fail('Conflicting decisions for this group; keep one proposal per group');
      const group = report.ambiguous.find(g => identityReviewGroupId(g.entityIds) === d.group);
      if (!group) fail('Group is stale, already settled, or absent from the current ambiguous pass; export again');
      const groupIds = group!.entityIds;
      const ids = d.members ?? groupIds;
      if (ids.some(id => !groupIds.includes(id))) fail('members must belong to the exported group');
      if (d.decision === 'separate' && identityReviewGroupId(ids) !== d.group) fail('separate must cover every member of the group');
      if (d.decision === 'merge' && ids.length < 2) fail('merge requires at least two members');
      const survivor = d.survivor ?? [...ids].sort()[0]!;
      if (d.decision === 'merge' && !ids.includes(survivor)) fail('survivor must be a selected member');
      const members = await tx.query<Member>(`select e.entity_id::text id,r.canonical_id::text root,e.entity_type::text type,
        e.retired_at is not null retired,e.display_name name from identity.entity e join identity.entity_resolution r using(entity_id)
        where r.canonical_id=any($1::uuid[]) or e.entity_id=any($1::uuid[])`, [ids]);
      if (ids.some(id => !members.some(m => m.id === id && m.root === id && !m.retired))) fail('Members must still be active canonical identities; export again');
      if (members.some(m => m.retired)) fail('Retired identity in component');
      const sources = await tx.query<Source>(`select entity_id::text id,source,source_id key from identity.source_record
        where entity_id=any($1::uuid[]) order by source,source_id`, [members.map(m => m.id)]);
      if (sources.some(s => s.source === 'app_user')) fail('User account requires explicit roster resolution');
      const signals = JSON.stringify({ group: d.group, key, decision: d, by });
      if (d.decision === 'retype') {
        if (ids.every(id => members.find(m => m.id === id)!.type === d.newType)) fail('Selected members already have this type');
        for (const id of ids) {
          const correctionId = await recordEntityTypeCorrection(tx, { entityId: id, type: d.newType!, by,
            rule: 'decision:identity-review', requestKey: `identity-review:${key}:${id}`,
            reason: `Identity review by ${d.decided_by}`, evidence: { ...d, applied_by: by } });
          if (correctionId) delta.corrected.push({ entityId: id, correctionId });
        }
      } else {
        const sourceFor = (id: string) => sources.find(s => members.find(m => m.id === s.id)?.root === id)
          ?? { id, source: 'identity', key: id };
        let rule = 'identity:v1:decision:merge';
        if (d.decision === 'merge') {
          if (new Set(ids.map(id => members.find(m => m.id === id)!.type)).size > 1) fail('Retype mixed identities before merging');
          if (violatesSeparationGroup(ids, await readSeparationGroups(tx)))
            fail('Prior group separation requires a fresh manual identity resolution');
          const constraints = await tx.query<{ id: string; kind: string; rule: string; a: string | null; b: string | null; ls: string; lk: string; rs: string; rk: string }>(`select
            assertion_id::text id,kind::text kind,rule,merged_entity::text a,canonical_entity::text b,left_source ls,left_source_id lk,right_source rs,right_source_id rk
            from identity.match_assertion where (kind='not_same_as' and undone_at is null) or (kind='same_as' and undone_at is not null)`);
          const rootOf = (id: string | null, source: string, key: string) => members.find(m => m.id === id)?.root
            ?? members.find(m => m.id === sources.find(s => s.source === source && s.key === key)?.id)?.root;
          const between = constraints.filter(c => { const a = rootOf(c.a,c.ls,c.lk), b = rootOf(c.b,c.rs,c.rk); return a && b && a !== b && ids.includes(a) && ids.includes(b); });
          // Issue 0138: the import's own "different external IDs" separation is no person's decision, only the
          // rule that two upstream records were not assumed to be one. The attestation below, every pair
          // stated as the same real organization or person with a supporting excerpt, clears it. A separation
          // a person or a review recorded, or a reversed merge, still refuses.
          const deterministic = between.filter(c => c.kind === 'not_same_as' && c.rule === 'identity:v1:different_external_id');
          if (between.length > deterministic.length) fail('Prior separation or reversed merge requires a fresh manual identity resolution');
          const external = new Map<string, Set<string>>();
          for (const s of sources) if (!internalSource(s.source)) external.set(s.source, (external.get(s.source) ?? new Set()).add(s.key));
          for (const [source, keys] of external) if (keys.size > 1) {
            // Explicit, inspectable attestation for EVERY pair; a generic bio cannot waive this guard.
            if (!d.evidence.some(e => e.quote.split(/\r?\n/).some(line => line.trim() && !/^Same real (person|organization):/.test(line.trim()))))
              fail(`Different external IDs from ${source}: an attestation also needs a supporting identity excerpt, not only the duplicate declaration`);
            const refs = [...keys].sort().map(k => `${source}:${k}`);
            const kind = members.find(m => m.id === survivor)!.type === 'person' ? 'person' : 'organization';
            for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
              const markers = [`Same real ${kind}: ${refs[i]} = ${refs[j]}`, `Same real ${kind}: ${refs[j]} = ${refs[i]}`];
              if (!d.evidence.some(e => e.quote.split(/\r?\n/).some(line => markers.includes(line.trim()))))
                fail(`Different external IDs from ${source}: evidence must explicitly attest each pair as the same real ${kind}`);
            }
            rule = source === 'affinity' || rule === 'decision:affinity-duplicate' ? 'decision:affinity-duplicate' : 'identity:v1:decision:source-duplicate';
          }
          if (deterministic.length) {
            // Each one's own pair must be among those just attested: both IDs from one source, both in the group.
            const attested = (c: { ls: string; lk: string; rs: string; rk: string }) => c.ls === c.rs && c.lk !== c.rk
              && (external.get(c.ls)?.size ?? 0) > 1 && external.get(c.ls)!.has(c.lk) && external.get(c.ls)!.has(c.rk);
            if (!deterministic.every(attested)) fail('Prior separation or reversed merge requires a fresh manual identity resolution');
            await tx.query(`update identity.match_assertion set undone_at=now(),undo_reason=$2 where assertion_id=any($1::bigint[]) and undone_at is null`,
              [deterministic.map(c => c.id), `${by}: identity review ${key}; each pair attested as the same real entity (issue 0138)`]);
          }
        }
        const pairs = d.decision === 'merge' ? ids.filter(id => id !== survivor).map(id => [id, survivor] as const)
          : ids.flatMap((id, i) => ids.slice(i + 1).map(other => [id, other] as const));
        for (const [left, right] of pairs) {
          const a = sourceFor(left), b = sourceFor(right);
          if (d.decision === 'merge') await tx.query('update identity.entity set merged_into=$2 where entity_id=$1', [left, right]);
          const row = await tx.one<{ id: string }>(`insert into identity.match_assertion
            (kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
            values($1::identity.assertion_kind,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) returning assertion_id::text id`,
          [d.decision === 'merge' ? 'same_as' : 'not_same_as', a.source, a.key, b.source, b.key, left, right,
            d.decision === 'merge' ? rule : 'identity:v1:decision:separate', signals, `Identity review by ${d.decided_by}; original records retained.`]);
          if (d.decision === 'merge') {
            delta.merged++; delta.merges.push({ assertionId: row!.id, loserId: left, survivorId: right, name: members.find(m => m.id === right)!.name });
          } else separations.push({ assertionId: row!.id, group: d.group });
        }
      }
      await tx.query(`insert into research.note(kind,body,data) values('identity_review_decision','Applied identity review decision',$1::jsonb)`,
        [JSON.stringify({ key, decision: d, applied_by: by, merges: delta.merges, corrected: delta.corrected, separations })]);
      await tx.exec('release savepoint identity_decision');
      applied.add(key);
      if (!appliedOutcome.has(outcome(d))) appliedOutcome.set(outcome(d), input.line);
      report.merged += delta.merged; report.merges.push(...delta.merges); report.corrected.push(...delta.corrected);
      result.separations.push(...separations); result.applied++;
      if (d.decision === 'separate' || (d.decision === 'merge' && ids.length === groupIds.length))
        report.ambiguous = report.ambiguous.filter(g => identityReviewGroupId(g.entityIds) !== d.group);
    } catch (e) {
      await tx.exec('rollback to savepoint identity_decision');
      await tx.exec('release savepoint identity_decision');
      result.refused.push({ line: input.line, group: d.group, reason: e instanceof Error ? e.message : 'Decision refused' });
    }
  }
}

/** Reopen the entire group, retaining the assertion history. A file retry cannot reapply it. */
export async function reverseIdentitySeparation(db: Db, assertionId: string, by: string, reason: string): Promise<boolean> {
  if (!by.trim() || !reason.trim()) throw new Error('Actor and reversal reason are required');
  return db.transaction(async tx => {
    await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
    const row = await tx.one<{ key: string; undone: boolean }>(`select signals->>'key' key,undone_at is not null undone from identity.match_assertion
      where assertion_id=$1 and kind='not_same_as' and rule='identity:v1:decision:separate'`, [assertionId]);
    if (!row || row.undone) return false;
    await tx.query(`update identity.match_assertion set undone_at=now(),undo_reason=$2 where rule='identity:v1:decision:separate'
      and signals->>'key'=$1 and undone_at is null`, [row.key, `${by}: ${reason}`]);
    await tx.query(`update identity.possible_match p set active=true from identity.match_assertion a
      where p.signals->>'rule'='creation-name-only' and a.rule='identity:v1:decision:separate' and a.signals->>'key'=$1
        and identity.canonical_entity_id(p.left_entity)<>identity.canonical_entity_id(p.right_entity)
        and least(identity.canonical_entity_id(p.left_entity),identity.canonical_entity_id(p.right_entity))=
          least(identity.canonical_entity_id(a.merged_entity),identity.canonical_entity_id(a.canonical_entity))
        and greatest(identity.canonical_entity_id(p.left_entity),identity.canonical_entity_id(p.right_entity))=
          greatest(identity.canonical_entity_id(a.merged_entity),identity.canonical_entity_id(a.canonical_entity))`,[row.key]);
    return true;
  });
}

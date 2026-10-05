import { resolveEntity } from '@/modules/identity/create';
import { createHash } from 'node:crypto';
import { recordActivity } from '@/lib/activity/log';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db, Queryable } from '@/lib/db';
import { enrichDir } from './candidates';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import { STATUS_LABEL, type PursuitStatus } from '@/modules/strategy';
import { parseProspectFile, type Prospect, type ProspectFile, type ProspectProblem } from './prospect-rows';

export { parseProspectFile, prospectFileProblems, prospectProblems, type Prospect, type ProspectFile, type ProspectProblem } from './prospect-rows';

export interface ProspectLoser extends ProspectProblem {
  status: Prospect['status'];
  winner: { file: string; line: number; status: Prospect['status'] };
}
export interface ProspectResult {
  files: number; added: number; existing: number; ambiguous: number;
  moved: number; toSourcing: number; toPassed: number; kept: number;
  invalid: ProspectProblem[]; skipped: ProspectProblem[]; inProgress: string[];
  perFile: Array<{ file: string; won: number; lost: number }>;
  losers: ProspectLoser[];
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const normalized = normalizeIdentityName;
const RULE = 'juan-prospects-2026-09-26';

/** Deterministic source identity: never tied to a vehicle, file, line or planning fields. */
export function prospectPersonKey(p: Prospect): string {
  if (p.personKey != null) return p.personKey;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  // Prefer source locators to mutable titles/annotations; opaque sources retain their full value.
  const sources = [...new Set(p.sources.map(source => JSON.stringify(canonical(
    typeof source === 'string' ? source.trim() : source.url ?? source.source ?? source
  ))))].sort();
  return `unkeyed:v1:${createHash('sha256').update(JSON.stringify([normalized(p.name), normalized(p.org ?? ''), sources])).digest('hex')}`;
}

/**
 * Read only settled inputs. Recheck after reading so a concurrent append cannot import a prefix.
 *
 * A file is settled when it has not changed for two minutes — a person or an agent may still be writing a
 * hand-placed one. `settled` names files known complete although new: a cloud push (lib/sync/push.ts)
 * writes its file whole, by a temporary name and a link, before it queues the import, and passes the name.
 * Only those skip the wait; every other file still waits, and every file is still re-checked after reading.
 */
export async function readProspectFiles(dir = join(enrichDir(), 'prospects'), settled: ReadonlySet<string> = new Set()): Promise<ProspectFile[]> {
  const names = await readdir(dir).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  return Promise.all(names.filter(n => n.endsWith('.jsonl')).sort().map(async file => {
    const path = join(dir, file), before = await stat(path);
    const young = (mtimeMs: number) => !settled.has(file) && Date.now() - mtimeMs < 120_000;
    if (young(before.mtimeMs)) return { file, text: '', inProgress: true };
    const text = await readFile(path, 'utf8'), after = await stat(path);
    if (after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== before.size
      || after.ino !== before.ino || young(after.mtimeMs)) return { file, text: '', inProgress: true };
    return { file, text, mtimeMs: after.mtimeMs };
  }));
}

type Identity = { id: string; name: string; type: string; merged: string | null; retired: string | null };
const current = (e: Identity) => !e.merged && !e.retired;

/** Record the supplied organization as a claimed affiliation, never a decision-making role. */
async function affiliateProspect(tx: Queryable, personId: string, p: Prospect) {
  if (!p.org) return;
  const key = normalized(p.org);
  const orgId = (await resolveEntity(tx,{type:'org',name:p.org,source:'prospect_org',sourceId:key})).id;
  await tx.query(`insert into identity.affiliation
    (person_entity, org_entity, kind, role, is_primary, source, as_of, certainty, note)
    values ($1, $2, 'contact', 'not recorded', true, $3, current_date, 'claimed',
      'From the sourced prospect row; role and decision-making capacity not established.')`,
    [personId, orgId, `prospect:${prospectPersonKey(p)}`]);
}

/** Stable keys follow canonical identity. Unknown keys get their own reversible source node; names alone never identify a person. */
async function resolvePerson(tx: Queryable, p: Prospect, identities: Identity[], conflictingNames = false): Promise<{ id?: string; candidates: Identity[]; reason?: string }> {
  const expectedType = p.entityType ?? 'person';
  if (p.entityId != null) {
    // Text comparison safely rejects malformed UUIDs without aborting the whole import.
    const pinned = await tx.one<Identity>(`select e.entity_id::text id, e.display_name name,
      e.entity_type::text type, e.merged_into::text merged, e.retired_at::text retired
      from identity.entity original join identity.entity e on e.entity_id = identity.canonical_entity_id(original.entity_id)
      where original.entity_id::text = $1`, [p.entityId.trim()]);
    if (!pinned) return { candidates: [], reason: `entityId ${p.entityId} does not exist` };
    if (pinned.type !== expectedType || !current(pinned)) return { candidates: [pinned],
      reason: `entityId must resolve to an active ${expectedType}; found ${pinned.type}${pinned.retired ? ' (retired)' : ''}` };
    // A reviewed explicit pin intentionally resolves stale names and conflicting source mappings.
    return { id: pinned.id, candidates: [pinned] };
  }
  const source = await tx.one<{id:string}>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record where source='prospect' and source_id=$1`,[prospectPersonKey(p)]);
  if(source) {
    const resolved=await resolveEntity(tx,{type:expectedType,name:p.name,source:'prospect',sourceId:prospectPersonKey(p),
      organizations:p.org?[p.org]:[],domains:p.emailDomain?[p.emailDomain]:[],personalUrls:p.personalUrls??[]});
    return {id:resolved.id,candidates:[]};
  }
  const rows = await tx.query<Identity>(
    `select distinct e.entity_id::text id, e.display_name name, e.entity_type::text type, e.merged_into::text merged, e.retired_at::text retired
       from identity.entity original join identity.entity e on e.entity_id=identity.canonical_entity_id(original.entity_id)
       left join identity.source_record s on s.entity_id = original.entity_id
      where original.entity_id::text = $1 or (s.source in ('warehouse', 'w3_person', 'prospect', 'prospect_key') and s.source_id = $1)`, [prospectPersonKey(p)]);
  const candidates = [...new Map([...rows, ...identities.filter(e => current(e)
    && e.type === expectedType && normalized(e.name) === normalized(p.name))].map(e => [e.id, e])).values()];
  if (conflictingNames) return { candidates };
  if (rows.length) {
    if (rows.length !== 1) return { candidates };
    const row = rows[0]!;
    return { id: row.type === expectedType && current(row) && normalized(row.name) === normalized(p.name) ? row.id : undefined, candidates };
  }
  const { id } = await resolveEntity(tx,{type:expectedType,name:p.name,source:'prospect',sourceId:prospectPersonKey(p),
    organizations:p.org?[p.org]:[],domains:p.emailDomain?[p.emailDomain]:[],personalUrls:p.personalUrls??[]});
  identities.push({ id, name: p.name, type: expectedType, merged: null, retired: null });
  if (expectedType === 'person') await affiliateProspect(tx, id, p);
  return { id, candidates: [] };
}

type ProspectSource = { p: Prospect; file: string; line: number; mtimeMs: number };
/** Research beats intake. Explicit decision times outrank absent ones, then file mtime/name/line. */
function compareSource(a: ProspectSource, b: ProspectSource): number {
  const researched = (p: Prospect) => Number((p.status === 'sourcing' || p.status === 'passed') && !!p.reason.trim());
  const decisionTime = (p: Prospect) => p.decidedAt === undefined ? -Infinity : Date.parse(p.decidedAt);
  return researched(a.p) - researched(b.p)
    || decisionTime(a.p) - decisionTime(b.p)
    || a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file) || a.line - b.line;
}

/** Caller supplies the live server's existing handle; there is deliberately no DB-opening CLI. */
export async function addProspects(db: Db, actorId: string, files: ProspectFile[]): Promise<ProspectResult> {
  const activityAt = new Date().toISOString();
  const result: ProspectResult = { files: files.length, added: 0, existing: 0, ambiguous: 0,
    moved: 0, toSourcing: 0, toPassed: 0, kept: 0, invalid: [], skipped: [], inProgress: [],
    perFile: [...new Set(files.map(f => f.file))].sort().map(file => ({ file, won: 0, lost: 0 })), losers: [] };
  const counts = new Map(result.perFile.map(f => [f.file, f]));
  const records: Array<ProspectSource & { hash: string }> = [];
  for (const file of files) {
    if (file.inProgress) { result.inProgress.push(file.file); continue; }
    const hash = createHash('sha256').update(file.text).digest('hex');
    const parsed = parseProspectFile(file);
    result.invalid.push(...parsed.invalid);
    // In-memory fixtures without filesystem metadata tie at zero; disk reads always supply mtime.
    records.push(...parsed.records.map(r => ({ ...r, file: file.file, mtimeMs: file.mtimeMs ?? 0, hash })));
  }
  if (!records.length) return result;
  await db.transaction(async tx => {
    const vehicles = new Map((await tx.query<{ id: string; slug: string }>('select id::text, slug from platform.vehicle')).map(v => [v.slug, v.id]));
    for (const r of records) if (!vehicles.has(r.p.vehicle)) result.invalid.push({ file: r.file, line: r.line, reason: 'Unknown vehicle slug' });
    const valid = records.filter(r => vehicles.has(r.p.vehicle));
    if (!valid.length) return result;
    // Serialize identity lookup/create, including callers that both initially see zero names.
    // This also prevents orphan nodes from a competing source-record insert.
    await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
    const identities = await tx.query<Identity>(`select entity_id::text id, display_name name, entity_type::text type,
      merged_into::text merged, retired_at::text retired from identity.entity`);
    // Conflicting descriptions of one key are skipped together, regardless of file order.
    const names = new Map<string, Set<string>>();
    for (const { p } of valid) {
      const key = prospectPersonKey(p);
      names.set(key, (names.get(key) ?? new Set()).add(normalized(p.name)));
    }
    const resolved = [];
    for (const r of valid) {
      const p = r.p;
      const conflictingNames = p.entityId == null && names.get(prospectPersonKey(p))!.size > 1;
      const resolution = await resolvePerson(tx, p, identities, conflictingNames);
      const entityId = resolution.id;
      if (!entityId) {
        result.ambiguous++;
        const candidates = resolution.candidates.map(e => `${e.id} (${e.name}; ${e.type})`).join('; ');
        result.skipped.push({ file: r.file, line: r.line, name: p.name, vehicle: p.vehicle,
          reason: `${resolution.reason ?? 'Conflicting identity'}: supply entityId for the correct existing ${p.entityType ?? 'person'} or resolve the conflicting source mapping. Candidates: ${candidates || 'none in the database'}.` });
        continue;
      }
      // Include matched and previously imported prospects, even when their pursuit is kept.
      // resolvePerson checks every existing mapping against the canonical person while the
      // identity tables are locked. Existing aliases (including pre-merge IDs) stay untouched.
      if (p.personKey != null) await tx.query(
        `insert into identity.source_record (source, source_id, entity_id, resolved_by)
         values ('prospect_key', $1, $2, 'rule:sourced-prospect-key')
         on conflict (source, source_id) do nothing`, [p.personKey, entityId]);
      resolved.push({ ...r, entityId });
    }
    // Select once across canonical identities so file iteration order cannot cause oscillation.
    const dispositions = new Map<string, Set<string>>();
    for (const { p, entityId } of resolved) {
      const key = `${entityId}:${p.vehicle}`;
      dispositions.set(key, (dispositions.get(key) ?? new Set()).add(p.status));
    }
    const winners = new Map<string, (typeof resolved)[number]>();
    for (const r of resolved) {
      const key = `${r.entityId}:${r.p.vehicle}`, prior = winners.get(key);
      if (!prior || compareSource(r, prior) > 0 || (compareSource(r, prior) === 0 && r.hash > prior.hash)) winners.set(key, r);
    }
    for (const r of resolved) {
      const winner = winners.get(`${r.entityId}:${r.p.vehicle}`)!;
      if (r === winner) { counts.get(r.file)!.won++; continue; }
      counts.get(r.file)!.lost++;
      result.losers.push({ file: r.file, line: r.line, name: r.p.name, vehicle: r.p.vehicle, status: r.p.status,
        winner: { file: winner.file, line: winner.line, status: winner.p.status },
        reason: r.p.status === 'new' && winner.p.status !== 'new'
          ? 'Researched decision takes precedence over intake.' : 'Superseded by decision timestamp, file modification time, filename, then line.' });
    }
    for (const r of winners.values()) {
      const { p, entityId } = r;
      const key = `${entityId}:${p.vehicle}`;
      const body = `Added by rule on Juan's instruction (26 Sep): ${p.reason}; capacity ${p.capacity.band} (${p.capacity.guess ? 'guess' : 'not marked as a guess'})`;
      const reason = `${RULE}: ${p.reason.trim()}`;
      const existing = await tx.query<{ id: string; status: PursuitStatus; source: string; status_source: string; entity: string; vehicle: string; historical: boolean }>(
        `select p.pursuit_id::text id, p.status::text, p.source, p.status_source,
           e.display_name entity, v.name vehicle, v.phase = 'historical' historical
         from strategy.pursuit p join identity.entity e on e.entity_id = p.entity_id
         join platform.vehicle v on v.id = p.vehicle_id
         where identity.canonical_entity_id(p.entity_id)=$1 and p.vehicle_id=$2 and p.merged_into is null
         order by p.pursuit_id for update of p`, [entityId, vehicles.get(p.vehicle)]);
      if (existing.length > 1) {
        result.ambiguous++;
        result.skipped.push({ file: r.file, line: r.line, name: p.name, vehicle: p.vehicle,
          reason: 'Multiple pursuits for this canonical person and vehicle; resolve them before retrying.' });
        continue;
      }
      const prior = existing[0];
      if (prior) {
        // Legacy UI audits have no statusSource. Treat every unmarked change as human.
        // Read after locking the pursuit so a concurrent UI change cannot slip past this guard.
        const human = await tx.one<{ protected: boolean }>(
          'select strategy.pursuit_has_human_status($1::uuid) as protected', [prior.id]);
        if (prior.status_source !== 'rule' || human?.protected) { result.kept++; continue; }
        if (prior.status === p.status) {
          if (dispositions.get(key)!.size > 1) {
            // Status need not change to record which conflicting file won. Reruns are silent.
            await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
              select $1, 'pursuit.prospect_disposition_selected', 'pursuit', $2, $3::jsonb
              where not exists (select 1 from platform.audit_log where subject_id=$2
                and action in ('pursuit.prospect_disposition_selected', 'pursuit.status_set') and detail->>'file'=$4
                and detail->>'line'=$5 and detail->>'toId'=$6)
              and not exists (select 1 from research.note where data->>'pursuitId'=$2
                and data->>'source'='prospects' and data->>'file'=$4 and data->>'line'=$5 and data->>'status'=$6)`,
              [actorId, prior.id, JSON.stringify({ rule: RULE, statusSource: 'rule', file: r.file, line: r.line,
                inputHash: r.hash, toId: p.status }), r.file, String(r.line), p.status]);
          }
          result.existing++; continue;
        }
        await tx.query(`update strategy.pursuit set status = $2::strategy.pursuit_status,
          status_source = 'rule', status_reason = $3, status_set_at = now(), status_set_by = $4,
          passed_by = case when $2 = 'passed' then 'us' else null end,
          closed_at = case when $2 = 'passed' then coalesce(closed_at, now()) when $5 then closed_at else null end,
          close_reason = case when $2 = 'passed' then $3 when $5 then close_reason else null end
          where pursuit_id = $1`, [prior.id, p.status, reason, actorId, prior.historical]);
        await tx.query(`insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
          values ($1, 'pursuit.status_set', 'pursuit', $2, $3::jsonb)`, [actorId, prior.id, JSON.stringify({
          entity: prior.entity, vehicle: prior.vehicle, from: STATUS_LABEL[prior.status], to: STATUS_LABEL[p.status],
          fromId: prior.status, toId: p.status, ...(p.status === 'passed' ? { passedBy: 'us' } : {}),
          reason, statusSource: 'rule', rule: RULE, file: r.file, line: r.line, inputHash: r.hash,
        })]);
        result.moved++;
        if (p.status === 'sourcing') result.toSourcing++;
        if (p.status === 'passed') result.toPassed++;
        continue;
      }
      const pursuit = await tx.one<{ id: string }>(
        `insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status, status_source, status_reason, status_set_at, status_set_by, source,
           passed_by, closed_at, close_reason)
         values ($1, $2, $3, $4::strategy.pursuit_status, 'rule', $5, now(), $3, 'prospects',
           case when $4 = 'passed' then 'us' else null end, case when $4 = 'passed' then now() else null end,
           case when $4 = 'passed' then $5 else null end)
         on conflict (entity_id, vehicle_id) do nothing returning pursuit_id::text id`,
        [entityId, vehicles.get(p.vehicle), actorId, p.status, reason]);
      if (!pursuit) { result.existing++; continue; }
      await tx.query(`insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'context', $3, $4::jsonb)`,
        [entityId, actorId, body, JSON.stringify({ ...p, pursuitId: pursuit.id, vehicleId: vehicles.get(p.vehicle), source: 'prospects', file: r.file, line: r.line, inputHash: r.hash, rule: RULE })]);
      result.added++;
    }
    return result;
  });
  await recordActivity({ source: 'intake', at: activityAt, segment: 'prospects', requests: 0,
    bytesIn: files.filter(file => !file.inProgress).reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0),
    bytesOut: 0, records: result.added + result.moved });
  return result;
}

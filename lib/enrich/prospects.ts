import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db, Queryable } from '@/lib/db';
import { enrichDir } from './candidates';
import { normalizeIdentityName } from '@/modules/identity/resolution';

export interface Prospect {
  personKey?: string | null; name: string; org: string | null; vehicle: string;
  status: 'new' | 'sourcing';
  capacity: { band: string; basis: string; guess: boolean };
  reason: string; strategic: boolean;
  route: { best: string; score: number } | null;
  sources: Array<string | Record<string, unknown>>;
}
export interface ProspectFile { file: string; text: string; inProgress?: boolean }
export interface ProspectProblem { file: string; line: number; name?: string; vehicle?: string; reason: string }
export interface ProspectResult {
  files: number; added: number; existing: number; ambiguous: number;
  invalid: ProspectProblem[]; skipped: ProspectProblem[]; inProgress: string[];
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const words = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
const normalized = normalizeIdentityName;

/** Notes retain supplied evidence; this import does not turn estimates into verified claims. */
export function prospectProblems(x: unknown): string[] {
  if (!object(x)) return ['Expected a prospect object'];
  const errors: string[] = [];
  if (x.personKey != null && !words(x.personKey)) errors.push('personKey must be nonempty text, null or absent');
  for (const k of ['name', 'vehicle', 'reason']) if (!words(x[k])) errors.push(`${k} must be nonempty text`);
  if (x.org !== null && !words(x.org)) errors.push('org must be nonempty text or null');
  if (x.status !== 'new' && x.status !== 'sourcing') errors.push('status must be new or sourcing');
  if (!object(x.capacity) || !words(x.capacity.band) || !words(x.capacity.basis) || typeof x.capacity.guess !== 'boolean') errors.push('capacity needs band, basis and a boolean guess');
  if (typeof x.strategic !== 'boolean') errors.push('strategic must be boolean');
  if (x.route !== null && (!object(x.route) || !words(x.route.best) || typeof x.route.score !== 'number' || !Number.isFinite(x.route.score))) errors.push('route must be null or have best text and a finite score');
  if (!Array.isArray(x.sources) || !x.sources.length || x.sources.some(s => !words(s) && !(object(s) && Object.keys(s).length))) errors.push('sources must contain source strings or objects');
  return errors;
}

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

/** Read only settled inputs. Recheck after reading so a concurrent append cannot import a prefix. */
export async function readProspectFiles(dir = join(enrichDir(), 'prospects')): Promise<ProspectFile[]> {
  const names = await readdir(dir).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  return Promise.all(names.filter(n => n.endsWith('.jsonl')).sort().map(async file => {
    const path = join(dir, file), before = await stat(path);
    if (Date.now() - before.mtimeMs < 120_000) return { file, text: '', inProgress: true };
    const text = await readFile(path, 'utf8'), after = await stat(path);
    if (after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== before.size
      || after.ino !== before.ino || Date.now() - after.mtimeMs < 120_000) return { file, text: '', inProgress: true };
    return { file, text };
  }));
}

/** Row errors are isolated; a whole JSON document/array is not a JSON-lines file. */
export function parseProspectFile(file: ProspectFile): { records: Array<{ p: Prospect; line: number }>; invalid: ProspectProblem[] } {
  const records: Array<{ p: Prospect; line: number }> = [], invalid: ProspectProblem[] = [];
  if (file.inProgress) return { records, invalid };
  const lines = file.text.split('\n');
  try {
    const whole: unknown = JSON.parse(file.text);
    if (Array.isArray(whole) || (object(whole) && lines.filter(l => l.trim()).length > 1)) {
      return { records, invalid: [{ file: file.file, line: 1, reason: 'File skipped: expected JSON lines, not a JSON document or array' }] };
    }
  } catch { /* Multiple JSON values are normal for JSON lines. */ }
  let parsed = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); parsed++; }
    catch { invalid.push({ file: file.file, line: index + 1, reason: 'Invalid JSON; row skipped' }); continue; }
    const errors = prospectProblems(value);
    if (errors.length) invalid.push({ file: file.file, line: index + 1, reason: errors.join('; ') });
    else records.push({ p: value as Prospect, line: index + 1 });
  }
  if (!parsed && invalid.length) return { records: [], invalid: [{ file: file.file, line: 1, reason: 'File skipped: no JSON lines could be read' }] };
  return { records, invalid };
}

type Identity = { id: string; name: string; type: string; merged: string | null; retired: string | null };
const current = (e: Identity) => !e.merged && !e.retired;

/** Record the supplied organization as a claimed affiliation, never a decision-making role. */
async function affiliateProspect(tx: Queryable, personId: string, p: Prospect, identities: Identity[]) {
  if (!p.org) return;
  const key = normalized(p.org);
  const mapped = await tx.one<{ id: string }>(`select entity_id::text id from identity.source_record where source = 'prospect_org' and source_id = $1`, [key]);
  let orgId = mapped?.id;
  if (!orgId) {
    const matches = identities.filter(e => e.type === 'org' && current(e) && normalized(e.name) === key);
    // Never arbitrarily choose among organization namesakes. Retain a separate sourced node.
    orgId = matches.length === 1 ? matches[0]!.id : (await tx.one<{ id: string }>(
      `insert into identity.entity (entity_type, display_name) values ('org', $1) returning entity_id::text id`, [p.org]))!.id;
    if (matches.length !== 1) identities.push({ id: orgId, name: p.org, type: 'org', merged: null, retired: null });
    await tx.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by)
      values ('prospect_org', $1, $2, 'rule:sourced-prospect-organization')`, [key, orgId]);
  }
  await tx.query(`insert into identity.affiliation
    (person_entity, org_entity, kind, role, is_primary, source, as_of, certainty, note)
    values ($1, $2, 'contact', 'not recorded', true, $3, current_date, 'claimed',
      'From the sourced prospect row; role and decision-making capacity not established.')`,
    [personId, orgId, `prospect:${prospectPersonKey(p)}`]);
}

/** Stable keys follow canonical identity. Unknown keys get their own reversible source node; names alone never identify a person. */
async function resolvePerson(tx: Queryable, p: Prospect, identities: Identity[]): Promise<string | null> {
  const rows = await tx.query<Identity>(
    `select distinct e.entity_id::text id, e.display_name name, e.entity_type::text type, e.merged_into::text merged, e.retired_at::text retired
       from identity.entity original join identity.entity e on e.entity_id=identity.canonical_entity_id(original.entity_id)
       left join identity.source_record s on s.entity_id = original.entity_id
      where original.entity_id::text = $1 or (s.source in ('warehouse', 'w3_person', 'prospect') and s.source_id = $1)`, [prospectPersonKey(p)]);
  if (rows.length) {
    if (rows.length !== 1) return null;
    const row = rows[0]!;
    return row.type === 'person' && current(row) && normalized(row.name) === normalized(p.name) ? row.id : null;
  }
  const id = (await tx.one<{ id: string }>(
    `insert into identity.entity (entity_type, display_name) values ('person', $1) returning entity_id::text id`, [p.name]))!.id;
  await tx.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by)
    values ('prospect', $1, $2, 'rule:sourced-prospect')`, [prospectPersonKey(p), id]);
  identities.push({ id, name: p.name, type: 'person', merged: null, retired: null });
  await affiliateProspect(tx, id, p, identities);
  return id;
}

/** Caller supplies the live server's existing handle; there is deliberately no DB-opening CLI. */
export async function addProspects(db: Db, actorId: string, files: ProspectFile[]): Promise<ProspectResult> {
  const result: ProspectResult = { files: files.length, added: 0, existing: 0, ambiguous: 0, invalid: [], skipped: [], inProgress: [] };
  const records: Array<{ p: Prospect; file: string; line: number; hash: string }> = [];
  for (const file of files) {
    if (file.inProgress) { result.inProgress.push(file.file); continue; }
    const hash = createHash('sha256').update(file.text).digest('hex');
    const parsed = parseProspectFile(file);
    result.invalid.push(...parsed.invalid);
    records.push(...parsed.records.map(r => ({ ...r, file: file.file, hash })));
  }
  if (!records.length) return result;
  return db.transaction(async tx => {
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
    for (const r of valid) {
      const p = r.p;
      const entityId = names.get(prospectPersonKey(p))!.size === 1 ? await resolvePerson(tx, p, identities) : null;
      if (!entityId) {
        result.ambiguous++;
        result.skipped.push({ file: r.file, line: r.line, name: p.name, vehicle: p.vehicle, reason: 'Conflicting identity: supply the correct existing person ID or resolve the conflicting source mapping.' });
        continue;
      }
      const body = `Added by rule on Juan's instruction (26 Sep): ${p.reason}; capacity ${p.capacity.band} (${p.capacity.guess ? 'guess' : 'not marked as a guess'})`;
      if (await tx.one('select pursuit_id from strategy.pursuit where identity.canonical_entity_id(entity_id)=$1 and vehicle_id=$2 limit 1', [entityId, vehicles.get(p.vehicle)])) { result.existing++; continue; }
      const pursuit = await tx.one<{ id: string }>(
        `insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status, status_source, status_reason, status_set_at, status_set_by, source)
         values ($1, $2, $3, $4::strategy.pursuit_status, 'rule', $5, now(), $3, 'prospects')
         on conflict (entity_id, vehicle_id) do nothing returning pursuit_id::text id`,
        [entityId, vehicles.get(p.vehicle), actorId, p.status, body]);
      if (!pursuit) { result.existing++; continue; }
      await tx.query(`insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'context', $3, $4::jsonb)`,
        [entityId, actorId, body, JSON.stringify({ ...p, pursuitId: pursuit.id, vehicleId: vehicles.get(p.vehicle), source: 'prospects', file: r.file, line: r.line, inputHash: r.hash, rule: 'juan-prospects-2026-09-26' })]);
      result.added++;
    }
    return result;
  });
}

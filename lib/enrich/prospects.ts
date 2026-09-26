import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db, Queryable } from '@/lib/db';
import { enrichDir } from './candidates';

export interface Prospect {
  personKey: string; name: string; org: string | null; vehicle: string;
  status: 'new' | 'sourcing';
  capacity: { band: string; basis: string; guess: boolean };
  reason: string; strategic: boolean;
  route: { best: string; score: number } | null;
  sources: Array<string | Record<string, unknown>>;
}
export interface ProspectFile { file: string; text: string }
export interface ProspectProblem { file: string; line: number; name?: string; vehicle?: string; reason: string }
export interface ProspectResult {
  files: number; added: number; existing: number; ambiguous: number;
  invalid: ProspectProblem[]; skipped: ProspectProblem[];
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const words = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
const normalized = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Notes retain supplied evidence; this import does not turn estimates into verified claims. */
export function prospectProblems(x: unknown): string[] {
  if (!object(x)) return ['Expected a prospect object'];
  const errors: string[] = [];
  for (const k of ['personKey', 'name', 'vehicle', 'reason']) if (!words(x[k])) errors.push(`${k} must be nonempty text`);
  if (x.org !== null && !words(x.org)) errors.push('org must be nonempty text or null');
  if (x.status !== 'new' && x.status !== 'sourcing') errors.push('status must be new or sourcing');
  if (!object(x.capacity) || !words(x.capacity.band) || !words(x.capacity.basis) || typeof x.capacity.guess !== 'boolean') errors.push('capacity needs band, basis and a boolean guess');
  if (typeof x.strategic !== 'boolean') errors.push('strategic must be boolean');
  if (x.route !== null && (!object(x.route) || !words(x.route.best) || typeof x.route.score !== 'number' || !Number.isFinite(x.route.score))) errors.push('route must be null or have best text and a finite score');
  if (!Array.isArray(x.sources) || !x.sources.length || x.sources.some(s => !words(s) && !(object(s) && Object.keys(s).length))) errors.push('sources must contain source strings or objects');
  return errors;
}

/** Read only the local profile's inputs. The live checkout links data/real to plcos-data/real. */
export async function readProspectFiles(dir = join(enrichDir(), 'prospects')): Promise<ProspectFile[]> {
  const names = await readdir(dir).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  return Promise.all(names.filter(n => n.endsWith('.jsonl')).sort().map(async file => ({ file, text: await readFile(join(dir, file), 'utf8') })));
}

/** No name lookup, node creation or implicit merge. Conflicting aliases are refused. */
async function resolvePerson(tx: Queryable, p: Prospect): Promise<string | null> {
  const rows = await tx.query<{ id: string; name: string; type: string; merged: string | null; retired: string | null }>(
    `select distinct e.entity_id::text id, e.display_name name, e.entity_type::text type, e.merged_into::text merged, e.retired_at::text retired
       from identity.entity e left join identity.source_record s on s.entity_id = e.entity_id
      where e.entity_id::text = $1 or (s.source in ('warehouse', 'w3_person') and s.source_id = $1)`, [p.personKey]);
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  return row.type === 'person' && !row.merged && !row.retired && normalized(row.name) === normalized(p.name) ? row.id : null;
}

/** Caller supplies the live server's existing handle; there is deliberately no DB-opening CLI. */
export async function addProspects(db: Db, actorId: string, files: ProspectFile[]): Promise<ProspectResult> {
  const result: ProspectResult = { files: files.length, added: 0, existing: 0, ambiguous: 0, invalid: [], skipped: [] };
  const records: Array<{ p: Prospect; file: string; line: number; hash: string }> = [];
  for (const file of files) {
    const hash = createHash('sha256').update(file.text).digest('hex');
    for (const [index, line] of file.text.split('\n').entries()) {
      if (!line.trim()) continue;
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { result.invalid.push({ file: file.file, line: index + 1, reason: 'Invalid JSON' }); continue; }
      const errors = prospectProblems(value);
      if (errors.length) result.invalid.push({ file: file.file, line: index + 1, reason: errors.join('; ') });
      else records.push({ p: value as Prospect, file: file.file, line: index + 1, hash });
    }
  }
  // A malformed file never partially imports. Validate vehicle slugs before any mutation too.
  if (result.invalid.length) return result;
  return db.transaction(async tx => {
    const vehicles = new Map((await tx.query<{ id: string; slug: string }>('select id::text, slug from platform.vehicle')).map(v => [v.slug, v.id]));
    for (const r of records) if (!vehicles.has(r.p.vehicle)) result.invalid.push({ file: r.file, line: r.line, reason: 'Unknown vehicle slug' });
    if (result.invalid.length) return result;
    // Conflicting descriptions of one key are skipped together, regardless of file order.
    const names = new Map<string, Set<string>>();
    for (const { p } of records) names.set(p.personKey, (names.get(p.personKey) ?? new Set()).add(normalized(p.name)));
    for (const r of records) {
      const p = r.p;
      const entityId = names.get(p.personKey)!.size === 1 ? await resolvePerson(tx, p) : null;
      if (!entityId) {
        result.ambiguous++;
        result.skipped.push({ file: r.file, line: r.line, name: p.name, vehicle: p.vehicle, reason: 'Identity unresolved or ambiguous: supply an existing person ID or an unambiguous warehouse/W3 mapping with the same name.' });
        continue;
      }
      const body = `Added by rule on Juan's instruction (26 Sep): ${p.reason}; capacity ${p.capacity.band} (${p.capacity.guess ? 'guess' : 'not marked as a guess'})`;
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

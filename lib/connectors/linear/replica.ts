import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { ENTITIES, type Entity } from './queries';

/**
 * The raw replica and its translation into rows (docs/24-linear.md). Pages land as Linear sent them,
 * one JSON object a line, under <real root>/linear/raw/<entity>/<stamp>.jsonl, with a manifest per
 * pull. Translation reads them from there, so a mapping fix is a re-run, not a re-fetch.
 *
 * A field Linear sent as null clears the column; a field that is absent leaves it alone. This file
 * has no network, no database and no writes.
 */

type Kind = 'text' | 'num' | 'int' | 'bool' | 'ts' | 'date' | 'ref' | 'refs' | 'ids' | 'statusName' | 'statusType';
/** [column, the key in Linear's answer, how to read it] */
type Col = readonly [string, string, Kind];

export const TABLE: Record<Entity, string> = {
  teams: 'team', users: 'member', states: 'state', labels: 'label', projects: 'project',
  milestones: 'milestone', cycles: 'cycle', issues: 'issue', comments: 'comment',
};

const COMMON: Col[] = [['updated_at', 'updatedAt', 'ts'], ['archived_at', 'archivedAt', 'ts']];
export const COLUMNS: Record<Entity, readonly Col[]> = {
  teams: [['key', 'key', 'text'], ['name', 'name', 'text'], ['created_at', 'createdAt', 'ts'], ...COMMON],
  users: [['name', 'name', 'text'], ['display_name', 'displayName', 'text'], ['email', 'email', 'text'], ['active', 'active', 'bool'], ['created_at', 'createdAt', 'ts'], ...COMMON],
  states: [['name', 'name', 'text'], ['type', 'type', 'text'], ['position', 'position', 'num'], ['team_id', 'team', 'ref'], ...COMMON],
  labels: [['name', 'name', 'text'], ['is_group', 'isGroup', 'bool'], ['parent_id', 'parent', 'ref'], ['team_id', 'team', 'ref'], ...COMMON],
  projects: [['name', 'name', 'text'], ['description', 'description', 'text'], ['slug_id', 'slugId', 'text'], ['url', 'url', 'text'],
    ['status_name', 'status', 'statusName'], ['status_type', 'status', 'statusType'], ['lead_id', 'lead', 'ref'],
    ['start_date', 'startDate', 'date'], ['target_date', 'targetDate', 'date'], ['started_at', 'startedAt', 'ts'],
    ['completed_at', 'completedAt', 'ts'], ['canceled_at', 'canceledAt', 'ts'], ['created_at', 'createdAt', 'ts'],
    ['team_ids', 'teams', 'refs'], ['label_ids', 'labelIds', 'ids'], ['health', 'health', 'text'], ['priority', 'priority', 'int'], ...COMMON],
  milestones: [['name', 'name', 'text'], ['target_date', 'targetDate', 'date'], ['project_id', 'project', 'ref'], ['sort_order', 'sortOrder', 'num'], ...COMMON],
  cycles: [['number', 'number', 'int'], ['name', 'name', 'text'], ['starts_at', 'startsAt', 'ts'], ['ends_at', 'endsAt', 'ts'],
    ['completed_at', 'completedAt', 'ts'], ['team_id', 'team', 'ref'], ...COMMON],
  issues: [['identifier', 'identifier', 'text'], ['title', 'title', 'text'], ['description', 'description', 'text'], ['url', 'url', 'text'],
    ['priority', 'priority', 'int'], ['estimate', 'estimate', 'num'], ['due_date', 'dueDate', 'date'], ['created_at', 'createdAt', 'ts'],
    ['started_at', 'startedAt', 'ts'], ['completed_at', 'completedAt', 'ts'], ['canceled_at', 'canceledAt', 'ts'],
    ['state_id', 'state', 'ref'], ['assignee_id', 'assignee', 'ref'], ['creator_id', 'creator', 'ref'], ['team_id', 'team', 'ref'],
    ['project_id', 'project', 'ref'], ['milestone_id', 'projectMilestone', 'ref'], ['cycle_id', 'cycle', 'ref'], ['parent_id', 'parent', 'ref'],
    ['label_ids', 'labelIds', 'ids'], ...COMMON],
  comments: [['body', 'body', 'text'], ['issue_id', 'issue', 'ref'], ['user_id', 'user', 'ref'], ['parent_id', 'parent', 'ref'], ['created_at', 'createdAt', 'ts'], ...COMMON],
};

export type Value = string | number | boolean | string[] | null;
/** A translated record: `id`, `updated_at`, and only the columns Linear's answer carried. */
export type Row = Record<string, Value> & { id: string; updated_at: string };

const bad = (entity: Entity) => new Error(`Invalid Linear ${entity} record.`);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function read(entity: Entity, kind: Kind, v: unknown): Value {
  if (v === null) return null;
  switch (kind) {
    case 'text': if (typeof v === 'string') return v; break;
    case 'num': if (typeof v === 'number' && Number.isFinite(v)) return v; break;
    case 'int': if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v); break;
    case 'bool': if (typeof v === 'boolean') return v; break;
    case 'ts': if (typeof v === 'string' && Number.isFinite(Date.parse(v))) return new Date(v).toISOString(); break;
    case 'date': if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v; break;
    case 'ref': if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' && ID.test((v as { id: string }).id)) return (v as { id: string }).id; break;
    case 'refs': {
      const nodes = (v as { nodes?: unknown })?.nodes;
      if (Array.isArray(nodes) && nodes.every((n) => n && typeof n.id === 'string' && ID.test(n.id))) return nodes.map((n) => n.id as string);
      break;
    }
    case 'ids': if (Array.isArray(v) && v.every((x) => typeof x === 'string' && ID.test(x))) return v as string[]; break;
    case 'statusName': case 'statusType': {
      const x = (v as Record<string, unknown>)[kind === 'statusName' ? 'name' : 'type'];
      if (x === null || x === undefined) return null;
      if (typeof x === 'string') return x;
      break;
    }
  }
  throw bad(entity);
}

/** One record of Linear's answer → a row. Absent keys stay absent (they preserve a stored value). */
export function normalize(entity: Entity, raw: unknown): Row {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad(entity);
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID.test(r.id)) throw bad(entity);
  const row: Record<string, Value> = { id: r.id };
  for (const [col, key, kind] of COLUMNS[entity]) if (key in r) row[col] = read(entity, kind, r[key]);
  if (typeof row.updated_at !== 'string') throw bad(entity);
  return row as Row;
}

export interface EntityResult { written: number; error?: string }
export interface Manifest {
  /** Pins the requested scope; missing on legacy workspace-wide pulls. */
  teams?: string[];
  at: string; finishedAt: string; since: string | null; full: boolean;
  requests: number; bytesIn: number; bytesOut: number; records: number;
  budget: { requestsLeft: number | null; requestsLimit: number | null; complexityLeft: number | null; complexityLimit: number | null };
  entities: Partial<Record<Entity, EntityResult>>;
  complete: boolean;
}
export interface Replica { entity: Entity; file: string; hash: string; at: string; records: Row[] }

export const MANIFEST = /^[-\dTZ]+\.manifest\.json$/;

/** Every readable manifest, oldest first. An unreadable one is not a pull. */
export async function readManifests(rawDir: string): Promise<Array<Manifest & { name: string }>> {
  let names: string[];
  try { names = (await readdir(rawDir)).filter((f) => MANIFEST.test(f)).sort(); }
  catch { return []; }
  const out: Array<Manifest & { name: string }> = [];
  for (const name of names) {
    try {
      const m = JSON.parse(await readFile(join(rawDir, name), 'utf8')) as Manifest;
      if (Number.isFinite(Date.parse(m.at)) && m.entities && typeof m.entities === 'object') out.push({ ...m, name });
    } catch { /* skipped */ }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.name.localeCompare(b.name));
}

/** When the newest complete pull started; null means nothing complete yet, so pull everything. */
export async function lastCompletePull(rawDir: string, teams?: readonly string[]): Promise<string | null> {
  const latest = (await readManifests(rawDir)).filter((m) => m.complete).at(-1);
  if (!latest) return null;
  const scope = (keys: readonly string[]) => JSON.stringify([...new Set(keys)].sort());
  // Changing the allowlist needs a full read, including newly allowed unchanged records.
  if (teams && (!latest.teams || scope(latest.teams) !== scope(teams))) return null;
  return latest.at;
}

/**
 * Each entity file a manifest says finished, parsed and hashed, oldest pull first. A file whose line
 * count disagrees with its manifest, or holds a record that does not read, stops the whole read.
 */
export async function readReplicas(rawDir: string): Promise<Replica[]> {
  const out: Replica[] = [];
  for (const m of await readManifests(rawDir)) {
    const stamp = m.name.replace('.manifest.json', '');
    for (const entity of ENTITIES) {
      const e = m.entities[entity];
      if (!e || e.error || !Number.isSafeInteger(e.written) || e.written < 0) continue;
      const file = `${entity}/${stamp}.jsonl`;
      const hash = createHash('sha256'), records: Row[] = [];
      let pending = '', lines = 0;
      const accept = (line: string) => {
        if (!line.trim()) return;
        lines++;
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { throw new Error('Invalid Linear replica records.'); }
        records.push(normalize(entity, parsed));
      };
      try {
        for await (const chunk of createReadStream(join(rawDir, file), { encoding: 'utf8' })) {
          hash.update(chunk as string);
          pending += chunk;
          let start = 0, end: number;
          while ((end = pending.indexOf('\n', start)) !== -1) {
            accept(pending.slice(start, end)); start = end + 1;
            if (lines % 200 === 0) await yieldTurn();
          }
          pending = pending.slice(start);
        }
        if (pending) accept(pending);
      } catch (err) {
        if (!(e.written === 0 && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
          if (err instanceof Error && /^Invalid Linear/.test(err.message)) throw err;
          throw new Error('Linear replica unavailable.');
        }
      }
      if (lines !== e.written) throw new Error('Linear replica count does not match its manifest.');
      out.push({ entity, file, hash: hash.digest('hex'), at: m.at, records });
    }
  }
  return out;
}

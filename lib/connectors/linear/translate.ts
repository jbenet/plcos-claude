import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { Db, Queryable } from '@/lib/db';
import { COLUMNS, TABLE, type Replica, type Row, type Value } from './replica';
import type { Entity } from './queries';

/**
 * Raw replica → the `linear` schema (docs/24-linear.md). Replayable and idempotent:
 *
 *   - files are applied oldest pull first; each file's hash is pinned when it finishes, and a
 *     finished file that has since changed is refused;
 *   - a record older than the stored row never replaces it (Linear's updatedAt is the clock);
 *   - a field Linear sent as null clears the column; a field it did not send is left alone;
 *   - each batch commits its rows and, at a file's end, the file's pin, together.
 *
 * Only our database is written. Nothing here reads the network.
 */

export interface LinearCounts { files: number; inserted: number; updated: number; unchanged: number }
export const emptyCounts = (): LinearCounts => ({ files: 0, inserted: 0, updated: 0, unchanged: 0 });

const ARRAY_KINDS = new Set(['refs', 'ids']);
const TYPE: Record<string, string> = { text: 'text', num: 'double precision', int: 'integer', bool: 'boolean', ts: 'timestamptz', date: 'date', ref: 'text', statusName: 'text', statusType: 'text' };

function param(v: Value): unknown {
  if (Array.isArray(v)) return JSON.stringify(v);
  return v;
}

/** One record, upserted. Returns what happened to it. */
async function upsert(tx: Queryable, entity: Entity, row: Row, file: string, actor: string | null): Promise<'inserted' | 'updated' | 'unchanged'> {
  const table = `linear.${TABLE[entity]}`;
  const cols = COLUMNS[entity].filter(([c]) => c in row);
  const values: unknown[] = [row.id];
  const exprs: string[] = ['$1'];
  for (const [c, , kind] of cols) {
    values.push(param(row[c]!));
    const n = values.length;
    exprs.push(ARRAY_KINDS.has(kind)
      ? `case when $${n}::jsonb is null then null else array(select jsonb_array_elements_text($${n}::jsonb)) end`
      : `$${n}::${TYPE[kind]}`);
  }
  values.push(file, actor);
  const names = ['id', ...cols.map(([c]) => c), 'replica_file', 'last_verified_by'];
  exprs.push(`$${values.length - 1}`, `$${values.length}::uuid`);
  const data = cols.map(([c]) => c);
  // Newer wins; an equal timestamp only rewrites when a value differs, so a replay counts as unchanged.
  const changed = data.length
    ? `(${data.map((c) => `${table}.${c}`).join(',')}) is distinct from (${data.map((c) => `excluded.${c}`).join(',')})`
    : 'false';
  const r = await tx.one<{ inserted: boolean }>(
    `insert into ${table} (${names.join(',')}) values (${exprs.join(',')})
     on conflict (id) do update set ${[...data, 'replica_file', 'last_verified_by'].map((c) => `${c}=excluded.${c}`).join(',')}, synced_at=now()
     where ${table}.updated_at < excluded.updated_at or (${table}.updated_at = excluded.updated_at and ${changed})
     returning (xmax = 0) as inserted`, values);
  return !r ? 'unchanged' : r.inserted ? 'inserted' : 'updated';
}

export interface TranslateOptions { batch: number; onBatch?: (done: number, total: number) => Promise<void> }

export async function translateLinear(db: Db, actor: string | null, replicas: Replica[], opts: TranslateOptions): Promise<LinearCounts> {
  const counts = emptyCounts();
  const pinned = new Map((await db.query<{ entity: string; file: string; hash: string }>('select entity, file, hash from linear.replica'))
    .map((r) => [`${r.entity}:${r.file}`, r.hash]));
  for (const r of replicas) {
    const was = pinned.get(`${r.entity}:${r.file}`);
    if (was && was !== r.hash) throw new Error('A translated Linear replica file changed; translation refused.');
  }
  const pending = replicas.filter((r) => !pinned.has(`${r.entity}:${r.file}`));
  const total = pending.reduce((n, r) => n + r.records.length, 0);
  let done = 0;
  for (const r of pending) {
    let offset = 0;
    do {
      const slice = r.records.slice(offset, offset + opts.batch);
      const last = offset + slice.length >= r.records.length;
      await db.transaction(async (tx) => {
        for (const [i, row] of slice.entries()) {
          counts[await upsert(tx, r.entity, row, r.file, actor)]++;
          if (i % 50 === 49) await yieldTurn();
        }
        if (last) await tx.query('insert into linear.replica (entity, file, hash, records) values ($1,$2,$3,$4)', [r.entity, r.file, r.hash, r.records.length]);
      });
      offset += slice.length;
      done += slice.length;
      await opts.onBatch?.(done, total);
    } while (offset < r.records.length);
    counts.files++;
  }
  return counts;
}

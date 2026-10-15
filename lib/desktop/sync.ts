import { getDb, type Queryable } from '@/lib/db';

/**
 * Syncing the desktop app's copy down from this server (docs/31 §3). Read-only, for an Admin's session; nothing
 * here is added to the write path (no trigger, no change table):
 *
 *   state  every table, its primary key and Postgres's own change counters (pg_stat_user_tables). The app reads
 *          only the tables whose counters moved since its last look.
 *   rows   a table's rows changed since a transaction horizon (their xmin is at or after it), a page at a time in
 *          primary-key order, with the horizon to ask from next time. The last page carries the exact row count,
 *          so the app can tell a deletion happened.
 *   keys   a table's primary keys, a page at a time, for finding what was deleted.
 *
 * The horizon is the oldest transaction still running when a page is read (pg_snapshot_xmin), so a transaction
 * that commits later is read next time, never skipped. Rows are re-read now and then; applying one twice is
 * harmless.
 */

export interface TableInfo { t: string; pk: string[] | null; counter: string; rows: number }

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
/**
 * Tables the app never copies: its own schema bookkeeping, which the build's migrations write locally, and
 * people's own secrets (their mailguard keys, calendar addresses), which not even an Admin may read
 * (lib/settings/person-secrets.ts).
 */
const SKIP = new Set(['platform.migration', 'platform.person_secret']);
/**
 * Columns sent as a stand-in rather than as stored. A secret setting's ciphertext stays here (the copy runs no
 * connector and has none of this server's keys, so it shows the setting as set but unreadable); a token's hash
 * becomes one of its own id, so the copy can never check a real token against it.
 */
const STAND_IN: Record<string, string> = {
  'platform.setting': `case when t.secret then jsonb_build_object('value', 'withheld') else '{}'::jsonb end`,
  'platform.mcp_token': `jsonb_build_object('token_hash', encode(sha256(convert_to('withheld:' || t.token_id::text, 'UTF8')), 'hex'))`,
};
/** A row as the copy gets it. */
const rowJson = (table: string) => (STAND_IN[table] ? `(to_jsonb(t) || ${STAND_IN[table]})` : 'to_jsonb(t)');

export async function syncState(q?: Queryable): Promise<{ horizon: string; tables: TableInfo[] }> {
  const db = q ?? await getDb();
  const rows = await db.query<{ t: string; pk: string[] | null; counter: string; rows: number }>(`
    select n.nspname || '.' || c.relname as t,
           (select array_agg(a.attname::text order by k.ord)
              from pg_index i
              cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
             where i.indrelid = c.oid and i.indisprimary) as pk,
           (coalesce(s.n_tup_ins, 0) + coalesce(s.n_tup_upd, 0) + coalesce(s.n_tup_del, 0))::text as counter,
           coalesce(s.n_live_tup, 0)::int as rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
     where c.relkind = 'r' and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
     order by 1`);
  const h = await db.one<{ horizon: string }>('select pg_snapshot_xmin(pg_current_snapshot())::text as horizon');
  return { horizon: h!.horizon, tables: rows.filter((r) => !SKIP.has(r.t)) };
}

interface Shape { schema: string; name: string; pk: { name: string; type: string }[] }

async function shape(db: Queryable, table: string): Promise<Shape | null> {
  const m = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(table);
  if (!m || SKIP.has(table)) return null;
  const [, schema, name] = m as unknown as [string, string, string];
  const found = await db.one<{ ok: boolean }>(`select true as ok from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and c.relkind = 'r'`, [schema, name]);
  if (!found) return null;
  const pk = await db.query<{ name: string; type: string }>(`
    select a.attname::text as name, format_type(a.atttypid, a.atttypmod) as type
      from pg_index i
      cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
     where i.indrelid = format('%I.%I', $1::text, $2::text)::regclass and i.indisprimary
     order by k.ord`, [schema, name]);
  return { schema, name, pk };
}

const xid8 = (s: string | null): string | null => (s && /^\d{1,20}$/.test(s) ? s : null);

/**
 * One page of a table's rows changed since `since` (an xid8 horizon from an earlier page or state; null for all),
 * after the primary key `after` (the last page's `next`). Rows come back as one JSON array text, untouched.
 */
export async function syncRows(table: string, since: string | null, after: string[] | null, limit: number): Promise<
  { ok: false; error: string } | { ok: true; horizon: string; rowsJson: string; n: number; next: string[] | null; count: number | null }
> {
  const db = await getDb();
  const s = await shape(db, table);
  if (!s) return { ok: false, error: 'No such table.' };
  const lim = Math.max(1, Math.min(20_000, Math.trunc(limit) || 2000));
  const from = `${ident(s.schema)}.${ident(s.name)}`;
  return db.transaction(async (tx) => {
    // One snapshot for the page, its horizon and its count.
    await tx.exec('set transaction isolation level repeatable read');
    const h = (await tx.one<{ horizon: string }>('select pg_snapshot_xmin(pg_current_snapshot())::text as horizon'))!.horizon;
    const params: unknown[] = [];
    const where: string[] = [];
    const sinceX = xid8(since);
    if (sinceX) {
      // xmin is a 32-bit xid; age() compares both against the same current transaction, wrap-safe.
      params.push(String(BigInt(sinceX) % 4294967296n));
      where.push(`age(t.xmin) <= age($${params.length}::text::xid)`);
    }
    if (s.pk.length && after) {
      if (after.length !== s.pk.length) return { ok: false as const, error: 'The cursor does not fit the key.' };
      const casts = s.pk.map((c, i) => { params.push(after[i]); return `$${params.length}::text::${c.type}`; });
      where.push(`(${s.pk.map((c) => `t.${ident(c.name)}`).join(', ')}) > (${casts.join(', ')})`);
    }
    const order = s.pk.length ? `order by ${s.pk.map((c) => `t.${ident(c.name)}`).join(', ')}` : '';
    // A table with no primary key is read whole, in one page: the app replaces it.
    const pageLimit = s.pk.length ? `limit ${lim + 1}` : '';
    const rows = await tx.query<{ j: string; k: string[] | null }>(
      `select ${rowJson(table)}::text as j, ${s.pk.length ? `array[${s.pk.map((c) => `t.${ident(c.name)}::text`).join(', ')}]` : 'null'} as k
         from ${from} t ${where.length ? `where ${where.join(' and ')}` : ''} ${order} ${pageLimit}`, params);
    const more = s.pk.length > 0 && rows.length > lim;
    const page = more ? rows.slice(0, lim) : rows;
    const count = more ? null : Number((await tx.one<{ n: string }>(`select count(*)::text as n from ${from}`))!.n);
    return { ok: true as const, horizon: h, rowsJson: `[${page.map((r) => r.j).join(',')}]`, n: page.length, next: more ? page[page.length - 1]!.k : null, count };
  });
}

/** One page of a table's primary keys, in order, after `after`. */
export async function syncKeys(table: string, after: string[] | null, limit: number): Promise<{ ok: false; error: string } | { ok: true; keys: string[][]; next: string[] | null }> {
  const db = await getDb();
  const s = await shape(db, table);
  if (!s || !s.pk.length) return { ok: false, error: 'No such table with a primary key.' };
  const lim = Math.max(1, Math.min(50_000, Math.trunc(limit) || 20_000));
  const params: unknown[] = [];
  let where = '';
  if (after) {
    if (after.length !== s.pk.length) return { ok: false, error: 'The cursor does not fit the key.' };
    const casts = s.pk.map((c, i) => { params.push(after[i]); return `$${params.length}::text::${c.type}`; });
    where = `where (${s.pk.map((c) => `t.${ident(c.name)}`).join(', ')}) > (${casts.join(', ')})`;
  }
  const rows = await db.query<{ k: string[] }>(
    `select array[${s.pk.map((c) => `t.${ident(c.name)}::text`).join(', ')}] as k from ${ident(s.schema)}.${ident(s.name)} t ${where}
      order by ${s.pk.map((c) => `t.${ident(c.name)}`).join(', ')} limit ${lim + 1}`, params);
  const more = rows.length > lim;
  const keys = (more ? rows.slice(0, lim) : rows).map((r) => r.k);
  return { ok: true, keys, next: more ? keys[keys.length - 1]! : null };
}

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
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
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
/** A row as the copy gets it, as jsonb: what the digest hashes, on both ends. */
const rowJson = (table: string) => (STAND_IN[table] ? `(to_jsonb(t) || ${STAND_IN[table]})` : 'to_jsonb(t)');
/**
 * A row as `rows` sends it, as text. row_to_json writes the text directly, about twice as fast as building a jsonb and
 * printing it (route_cache: 300 → 150 ms) and 5% shorter; the copy reads it into jsonb either way, so it gets the same
 * values (17 Oct 2026).
 */
const rowText = (table: string) => (STAND_IN[table] ? `${rowJson(table)}::text` : 'row_to_json(t)::text');
/**
 * The key a thinned row carries (syncRows' `thin`): {column: md5 of its value as text} for each wide value left out.
 * GUESS: a value over 1 KB stored is worth a hash; route_cache's searches are 4-60 KB each.
 */
export const THIN_KEY = '__plcos_thin';
const THIN_BYTES = 1024;

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

interface Shape { schema: string; name: string; pk: { name: string; type: string }[]; cols: string[]; wide: string[] }

async function shape(db: Queryable, table: string): Promise<Shape | null> {
  const m = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(table);
  if (!m || SKIP.has(table)) return null;
  const [, schema, name] = m as unknown as [string, string, string];
  const found = await db.one<{ ok: boolean }>(`select true as ok from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and c.relkind = 'r'`, [schema, name]);
  if (!found) return null;
  // Its columns: the primary key's in order, and the ones that can hold a wide value (jsonb, json, text).
  const cols = await db.query<{ name: string; type: string; ord: number | null; wide: boolean }>(`
    select a.attname::text as name, format_type(a.atttypid, a.atttypmod) as type, k.ord::int as ord,
           a.atttypid in ('jsonb'::regtype, 'json'::regtype, 'text'::regtype) and a.attgenerated = '' as wide
      from pg_attribute a
      left join (select k.attnum, k.ord from pg_index i cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
                  where i.indrelid = format('%I.%I', $1::text, $2::text)::regclass and i.indisprimary) k on k.attnum = a.attnum
     where a.attrelid = format('%I.%I', $1::text, $2::text)::regclass and a.attnum > 0 and not a.attisdropped
     order by k.ord nulls last, a.attnum`, [schema, name]);
  const pk = cols.filter((c) => c.ord !== null).map((c) => ({ name: c.name, type: c.type }));
  const wide = cols.some((c) => c.name === THIN_KEY) ? [] : cols.filter((c) => c.ord === null && c.wide).map((c) => c.name);
  return { schema, name, pk, cols: cols.map((c) => c.name), wide };
}

const PAGE_BYTES = 16 * 1024 * 1024;
const xid8 = (s: string | null): string | null => (s && /^\d{1,20}$/.test(s) ? s : null);

/**
 * One page of a table's rows changed since `since` (an xid8 horizon from an earlier page or state; null for all),
 * after the primary key `after` (the last page's `next`). Rows come back as one JSON array text, untouched.
 *
 * `thin` (a copy that already holds the table, reading what changed): a wide value (over THIN_BYTES stored) is left out
 * and its hash sent under THIN_KEY instead. The copy keeps its own value when its hash matches, and asks for the rows
 * whole when one does not. A stored route whose input revision moved sent its whole 4-60 KB search again for one
 * number (17 Oct 2026). A copy that does not ask gets whole rows, as before.
 */
export async function syncRows(table: string, since: string | null, after: string[] | null, limit: number, upTo: string[] | null = null, thin = false): Promise<
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
    // A page of a big or wide table can take longer than a page view's 20 s limit; this is an Admin's background read.
    await tx.exec("set local statement_timeout = '5min'");
    const h = (await tx.one<{ horizon: string }>('select pg_snapshot_xmin(pg_current_snapshot())::text as horizon'))!.horizon;
    const params: unknown[] = [];
    const where: string[] = [];
    const sinceX = xid8(since);
    if (sinceX) {
      // xmin is a 32-bit xid; age() compares both against the same current transaction, wrap-safe.
      params.push(String(BigInt(sinceX) % 4294967296n));
      where.push(`age(t.xmin) <= age($${params.length}::text::xid)`);
    }
    for (const [bound, op] of [[after, '>'], [upTo, '<=']] as const) {
      if (!s.pk.length || !bound) continue;
      if (bound.length !== s.pk.length) return { ok: false as const, error: 'The cursor does not fit the key.' };
      const casts = s.pk.map((c, i) => { params.push(bound[i]); return `$${params.length}::text::${c.type}`; });
      where.push(`(${s.pk.map((c) => `t.${ident(c.name)}`).join(', ')}) ${op} (${casts.join(', ')})`);
    }
    const order = s.pk.length ? `order by ${s.pk.map((c) => `t.${ident(c.name)}`).join(', ')}` : '';
    // A table with no primary key is read whole, in one page: the app replaces it.
    const pageLimit = s.pk.length ? `limit ${lim + 1}` : '';
    // Thinned only for a read since a horizon, by key, of a table with wide columns and no stand-ins.
    const wide = thin && sinceX && s.pk.length && !STAND_IN[table] ? s.wide : [];
    const hashes = wide.length ? chunks(wide, 50).map((part) => `jsonb_build_object(${part.map((c) => `${lit(c)}, case when pg_column_size(t.${ident(c)}) > ${THIN_BYTES} then md5(t.${ident(c)}::text) end`).join(', ')})`).join(' || ') : '';
    // A thinned row is written as text too, its wide values null, with the hashes added at the end. (Rebuilding it as
    // jsonb copied every 60 KB value it was leaving out.) `offset 0` works the hashes out once a row, not at every use.
    const thinned = `(select left(row_to_json(r)::text, -1) from (select ${s.cols.map((c) => (wide.includes(c) ? `case when th.h ? ${lit(c)} then null else t.${ident(c)} end` : `t.${ident(c)}`) + ` as ${ident(c)}`).join(', ')}) r)`;
    const json = wide.length
      ? `case when th.h = '{}'::jsonb then ${rowText(table)} else ${thinned} || ',${JSON.stringify(THIN_KEY)}:' || th.h::text || '}' end`
      : rowText(table);
    const rows = await tx.query<{ j: string; k: string[] | null }>(
      `select ${json} as j, ${s.pk.length ? `array[${s.pk.map((c) => `t.${ident(c.name)}::text`).join(', ')}]` : 'null'} as k
         from ${from} t ${wide.length ? `cross join lateral (select jsonb_strip_nulls(${hashes}) as h offset 0) th` : ''}
         ${where.length ? `where ${where.join(' and ')}` : ''} ${order} ${pageLimit}`, params);
    // A page stops at about 16 MB of rows, so wide rows (long notes, big JSON) never make one huge response.
    let kept = 0, bytes = 0;
    while (kept < Math.min(rows.length, lim) && (kept === 0 || bytes + rows[kept]!.j.length <= PAGE_BYTES)) bytes += rows[kept++]!.j.length;
    const more = s.pk.length > 0 && rows.length > kept;
    const page = rows.slice(0, kept);
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

/**
 * A table's digest, for a copy that already holds most of its rows (seeded from the Mac's own database, or a copy
 * cut short): the table in key order, cut into runs of `chunk` rows, each with its last key, its row count and an md5
 * of its rows' JSON (as `rows` sends them, in UTC). The runs split the whole key space: run i holds the keys after
 * run i-1's last key, up to and including its own; the last run has no upper end. The app hashes its own rows the
 * same way and asks only for the runs that differ.
 */
export async function syncDigest(table: string, chunk: number): Promise<
  { ok: false; error: string } | { ok: true; horizon: string; runs: { hi: string[] | null; n: number; md5: string }[] }
> {
  const db = await getDb();
  const s = await shape(db, table);
  if (!s || !s.pk.length) return { ok: false, error: 'No such table with a primary key.' };
  const size = Math.max(100, Math.min(50_000, Math.trunc(chunk) || 5000));
  const pkList = s.pk.map((c) => `t.${ident(c.name)}`).join(', ');
  return db.transaction(async (tx) => {
    await tx.exec('set transaction isolation level repeatable read');
    await tx.exec("set local statement_timeout = '5min'");
    await tx.exec("set local timezone = 'UTC'");
    const h = (await tx.one<{ horizon: string }>('select pg_snapshot_xmin(pg_current_snapshot())::text as horizon'))!.horizon;
    const rows = await tx.query<{ hi: string[]; n: number; md5: string }>(`
      with r as (
        select to_jsonb(array[${s.pk.map((c) => `t.${ident(c.name)}::text`).join(', ')}]) as k, md5(${rowJson(table)}::text) as h,
               (row_number() over (order by ${pkList}) - 1) / ${size} as c, row_number() over (order by ${pkList}) as i
          from ${ident(s.schema)}.${ident(s.name)} t)
      select (array_agg(k order by i desc))[1] as hi, count(*)::int as n, md5(string_agg(h, '' order by i)) as md5
        from r group by c order by c`);
    const runs = rows.map((r, i) => ({ hi: i === rows.length - 1 ? null : r.hi, n: r.n, md5: r.md5 }));
    return { ok: true as const, horizon: h, runs };
  });
}

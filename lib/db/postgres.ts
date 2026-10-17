import { Pool, types, type QueryResult } from 'pg';
import { TooManyRows, type Db, type Queryable } from './index';
import { timeQuery } from './timing';
import { memoRead } from './read-memo';

export interface PostgresOptions {
  /** GUESS — 20 s foreground budget, matching the PGlite queue deadline. Workers use 0. */
  statementTimeoutMs?: number;
  /** GUESS — eight foreground connections; workers use a smaller independent pool. */
  max?: number;
  /** Writes on this pool are background (network 017), as an import worker's are; its statement limits stay the foreground's. */
  background?: boolean;
}

/** The application uses numbers for bigint counts, as PGlite does. Refuse precision loss. */
const parseInt8 = (text: string) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError('Database integer exceeds JavaScript safe precision');
  return value;
};
/**
 * A timestamptz as the server prints it in UTC ("2026-10-17 12:00:00.123456+00", a four-digit year), read without
 * postgres-date's regular expressions: the same Date.UTC of the same numbers, so the same instant. Anything else (another
 * zone, BC, infinity, a short year) goes to the library's parser. Rebuilding the pipeline list parses thousands of
 * these, and the library's parse was about a microsecond and a half each (performance pass, 17 Oct 2026).
 */
const parseTimestamptz = types.getTypeParser(1184, 'text') as (text: string) => unknown;
const digit = (text: string, at: number) => { const c = text.charCodeAt(at) - 48; return c >= 0 && c <= 9 ? c : -1; };
const twoDigits = (text: string, at: number) => { const a = digit(text, at), b = digit(text, at + 1); return a < 0 || b < 0 ? -1 : a * 10 + b; };
export function fastTimestamptz(text: string): unknown {
  const end = text.length - 3;
  if (end < 19 || text.charCodeAt(end) !== 43 /* + */ || text.charCodeAt(end + 1) !== 48 || text.charCodeAt(end + 2) !== 48
    || text.charCodeAt(4) !== 45 || text.charCodeAt(7) !== 45 || text.charCodeAt(10) !== 32 || text.charCodeAt(13) !== 58 || text.charCodeAt(16) !== 58) {
    return parseTimestamptz(text);
  }
  const hi = twoDigits(text, 0), lo = twoDigits(text, 2), month = twoDigits(text, 5), day = twoDigits(text, 8);
  const hour = twoDigits(text, 11), minute = twoDigits(text, 14), second = twoDigits(text, 17);
  if (hi < 1 || lo < 0 || month < 0 || day < 0 || hour < 0 || minute < 0 || second < 0) return parseTimestamptz(text);
  let ms = 0;
  if (end > 19) {
    if (text.charCodeAt(19) !== 46 /* . */ || end === 20) return parseTimestamptz(text);
    for (let i = 20; i < end; i++) if (digit(text, i) < 0) return parseTimestamptz(text);
    ms = 1000 * parseFloat(text.slice(19, end));
  }
  return new Date(Date.UTC(hi * 100 + lo, month - 1, day, hour, minute, second, ms));
}
/** A date ("2026-10-17", a four-digit year) the same way: the library's local midnight of the same numbers. */
const parseDateText = types.getTypeParser(1082, 'text') as (text: string) => unknown;
export function fastDate(text: string): unknown {
  if (text.length !== 10 || text.charCodeAt(4) !== 45 || text.charCodeAt(7) !== 45) return parseDateText(text);
  const hi = twoDigits(text, 0), lo = twoDigits(text, 2), month = twoDigits(text, 5), day = twoDigits(text, 8);
  if (hi < 1 || lo < 0 || month < 0 || day < 0) return parseDateText(text);
  return new Date(hi * 100 + lo, month - 1, day);
}
const parsers = { getTypeParser(oid: number, format?: 'text' | 'binary') {
  if (oid === 20 && format !== 'binary') return parseInt8;
  if (oid === 1184 && format !== 'binary') return fastTimestamptz;
  if (oid === 1082 && format !== 'binary') return fastDate;
  return types.getTypeParser(oid, format);
} };

/** Real PostgreSQL connections; query/one/exec have the same shape as the local adapter. */
export async function openPostgres(url: string, options: PostgresOptions = {}): Promise<Db> {
  const worker = process.env.PLCOS_IMPORT_WORKER === '1';
  // A database off this machine (the deployed app's RDS) is always TLS with a verified certificate;
  // the image adds the RDS CA bundle through NODE_EXTRA_CA_CERTS.
  // Railway's private network (*.railway.internal) is WireGuard-encrypted and its Postgres has no public
  // certificate to verify (docs/deploy/railway.md §2), so it connects like loopback.
  const host = new URL(url).hostname;
  const remote = !['127.0.0.1', 'localhost', '[::1]', ''].includes(host) && !host.endsWith('.railway.internal');
  const pool = new Pool({
    connectionString: url,
    ...(remote ? { ssl: { rejectUnauthorized: true } } : {}),
    max: options.max ?? 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Import jobs run in their own process (PLCOS_IMPORT_WORKER=1, scripts/import-worker.ts) and compute
    // between statements inside long transactions: no statement limit and 30 min idle there (GUESS).
    // The foreground keeps 20 s and 60 s. Before 27 Sep the worker inherited the foreground limits,
    // and "Merge duplicate identities" was killed at 60 s idle every time.
    statement_timeout: options.statementTimeoutMs ?? (worker ? 0 : 20_000),
    idle_in_transaction_session_timeout: worker ? 1_800_000 : 60_000,
    application_name: 'plcos',
    // An import worker's writes are background (network 017): pages may answer from their last build
    // while it writes, and rebuild behind. Everyone else's writes rebuild before the next page answers.
    ...(worker || options.background ? { options: '-c plcos.background=on' } : {}),
    types: parsers,
  });
  // Idle connection failures must not become unhandled EventEmitter errors. pg removes
  // the failed client; the next query reconnects. No SQL, parameters or URL in this log.
  pool.on('error', () => console.error('[db] idle Postgres connection lost'));
  const on = (run: (sql: string, params: unknown[]) => Promise<QueryResult | QueryResult[]>, inTransaction = false): Queryable => {
    const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      const read = () => timeQuery(sql, () => run(sql, params));
      const result = await (inTransaction ? read() : memoRead(sql, params, read));
      // PGlite's no-parameter multi-statement query returns the last statement.
      return (Array.isArray(result) ? result.at(-1)?.rows ?? [] : result.rows) as T[];
    };
    return {
      query,
      async one<T>(sql: string, params: unknown[] = []) {
        const rows = await query<T>(sql, params);
        if (rows.length > 1) throw new TooManyRows(rows.length);
        return rows[0] ?? null;
      },
      async exec(sql: string) { await run(sql, []); },
    };
  };
  // A write's table counters (pg_stat_user_tables) reach other sessions only when its backend next flushes them, which
  // is up to 10 s later if it flushed in the last second: the desktop app's copy reads those counters to know what to
  // fetch, so it could take a person's own change for absent (measured 10.0 s, 15 Oct 2026). After each write the
  // backend is asked to flush when it goes idle, i.e. at once. A server that refuses the call stops asking.
  let flushStats = true;
  const flush = async (client: { query: (sql: string) => Promise<unknown> }) => {
    if (!flushStats) return;
    try { await client.query('select pg_stat_force_next_flush()'); } catch { flushStats = false; }
  };
  const writes = (sql: string) => /^\s*(insert|update|delete|merge)\b/i.test(sql) || (/^\s*with\b/i.test(sql) && /\b(insert\s+into|update\s+\S+\s+set|delete\s+from)\b/i.test(sql));
  let closing: Promise<void> | undefined;
  return {
    kind: 'postgres',
    ...on(async (sql, params) => {
      if (!flushStats || !writes(sql)) return pool.query(sql, params);
      const client = await pool.connect();
      try { const result = await client.query(sql, params); await flush(client); return result; }
      finally { client.release(); }
    }),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('begin');
        const result = await fn(on((sql, params) => client.query(sql, params), true));
        await client.query('commit');
        await flush(client);
        return result;
      } catch (error) {
        try { await client.query('rollback'); } catch { discard = true; }
        throw error;
      } finally { client.release(discard); }
    },
    async close() { await (closing ??= pool.end()); },
    poolState: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
  };
}

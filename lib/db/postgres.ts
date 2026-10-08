import { Pool, types, type QueryResult } from 'pg';
import { TooManyRows, type Db, type Queryable } from './index';
import { timeQuery } from './timing';
import { memoRead } from './read-memo';

export interface PostgresOptions {
  /** GUESS — 20 s foreground budget, matching the PGlite queue deadline. Workers use 0. */
  statementTimeoutMs?: number;
  /** GUESS — eight foreground connections; workers use a smaller independent pool. */
  max?: number;
}

/** The application uses numbers for bigint counts, as PGlite does. Refuse precision loss. */
const parseInt8 = (text: string) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError('Database integer exceeds JavaScript safe precision');
  return value;
};
const parsers = { getTypeParser(oid: number, format?: 'text' | 'binary') {
  if (oid === 20 && format !== 'binary') return parseInt8;
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
    ...(worker ? { options: '-c plcos.background=on' } : {}),
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
  let closing: Promise<void> | undefined;
  return {
    kind: 'postgres',
    ...on((sql, params) => pool.query(sql, params)),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('begin');
        const result = await fn(on((sql, params) => client.query(sql, params), true));
        await client.query('commit');
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

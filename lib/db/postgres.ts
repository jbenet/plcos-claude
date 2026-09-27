import { Pool, types, type QueryResult } from 'pg';
import { TooManyRows, type Db, type Queryable } from './index';
import { timeQuery } from './timing';

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
  const pool = new Pool({
    connectionString: url,
    max: options.max ?? 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: options.statementTimeoutMs ?? 20_000,
    idle_in_transaction_session_timeout: 60_000,
    application_name: 'plcos',
    types: parsers,
  });
  // Idle connection failures must not become unhandled EventEmitter errors. pg removes
  // the failed client; the next query reconnects. No SQL, parameters or URL in this log.
  pool.on('error', () => console.error('[db] idle Postgres connection lost'));
  const on = (run: (sql: string, params: unknown[]) => Promise<QueryResult | QueryResult[]>): Queryable => {
    const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      const result = await timeQuery(sql, () => run(sql, params));
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
        const result = await fn(on((sql, params) => client.query(sql, params)));
        await client.query('commit');
        return result;
      } catch (error) {
        try { await client.query('rollback'); } catch { discard = true; }
        throw error;
      } finally { client.release(discard); }
    },
    async close() { await (closing ??= pool.end()); },
  };
}

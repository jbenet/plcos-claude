import { TooManyRows, type Db, type Queryable } from './index';

/**
 * The live-version half of the Db seam. Deliberately unexercised until D0: `pg` is not a
 * dependency yet, so the specifier is computed at runtime — the bundler leaves it alone and
 * a missing driver produces a sentence rather than a build error. The swap at D0 is
 * `npm i pg` plus a DATABASE_URL, and nothing above this file changes.
 */

interface PgResult {
  rows: unknown[];
}
interface PgClient {
  query(sql: string, params?: unknown[]): Promise<PgResult>;
  release(): void;
}
interface PgPool {
  query(sql: string, params?: unknown[]): Promise<PgResult>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}
interface PgModule {
  Pool: new (cfg: { connectionString: string }) => PgPool;
}

export async function openPostgres(url: string): Promise<Db> {
  // Opaque on purpose. `pg` is not a dependency until D0, and a literal here makes the
  // bundler warn about a module it is never supposed to find.
  const specifier = ['p', 'g'].join('');
  let mod: PgModule;
  try {
    const loaded = (await import(/* @vite-ignore */ specifier)) as { default?: PgModule; Pool?: PgModule['Pool'] };
    mod = (loaded.Pool ? (loaded as PgModule) : loaded.default) as PgModule;
    if (!mod?.Pool) throw new Error('no Pool export');
  } catch {
    throw new Error(
      'DATABASE_URL is set but the `pg` driver is not installed. This is the D0 path: run `npm i pg`. ' +
        'Unset DATABASE_URL to keep using PGlite locally.',
    );
  }
  const pool = new mod.Pool({ connectionString: url });

  const on = (exec: (sql: string, params: unknown[]) => Promise<PgResult>): Queryable => {
    const query = async <T>(sql: string, params: unknown[] = []) => (await exec(sql, params)).rows as T[];
    return {
      query,
      async one<T>(sql: string, params: unknown[] = []) {
        const rows = await query<T>(sql, params);
        if (rows.length > 1) throw new TooManyRows(rows.length);
        return rows[0] ?? null;
      },
      async exec(sql: string) {
        await exec(sql, []);
      },
    };
  };

  const top = on((sql, params) => pool.query(sql, params));
  return {
    kind: 'postgres',
    ...top,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(on((sql, params) => client.query(sql, params)));
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

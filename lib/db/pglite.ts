import { PGlite } from '@electric-sql/pglite';
import { TooManyRows, type Db, type Queryable } from './index';
import { lock } from './lock';

function wrap(run: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Queryable {
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const res = await run(sql, params);
    return res.rows as T[];
  };
  return {
    query,
    async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = await query<T>(sql, params);
      if (rows.length > 1) throw new TooManyRows(rows.length);
      return rows[0] ?? null;
    },
    async exec(sql: string) {
      await run(sql, []);
    },
  };
}

export async function openPglite(dir: string): Promise<Db> {
  const release = await lock(dir);
  const pg = await PGlite.create(dir);
  const base = wrap((sql, params) =>
    params && params.length ? pg.query(sql, params as never[]) : pg.exec(sql).then((r) => r[r.length - 1] ?? { rows: [] }),
  );
  return {
    kind: 'pglite',
    query: base.query,
    one: base.one,
    exec: async (sql: string) => {
      await pg.exec(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const out = await pg.transaction(async (tx) => {
        const q = wrap((sql, params) =>
          params && params.length ? tx.query(sql, params as never[]) : tx.exec(sql).then((r) => r[r.length - 1] ?? { rows: [] }),
        );
        return fn(q);
      });
      return out as T;
    },
    async close() {
      await pg.close();
      await release();
    },
  };
}

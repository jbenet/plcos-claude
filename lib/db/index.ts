/**
 * Seam 1 of 5 — Db.
 *
 * PGlite locally, Postgres in the live version. The only rule that makes the swap a
 * connection string rather than a rewrite: nothing outside `lib/db/` may import
 * `@electric-sql/pglite` or `pg`. Callers see `Queryable` and nothing else.
 */

export interface Queryable {
  /** Parameterized query. `$1`-style placeholders, Postgres semantics, both implementations. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** First row or null. Throws if the query returns more than one row. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Multi-statement DDL. No parameters, no result. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly kind: 'pglite' | 'postgres';
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class TooManyRows extends Error {
  constructor(count: number) {
    super(`one() expected at most 1 row, got ${count}`);
    this.name = 'TooManyRows';
  }
}

import { config } from '@/config/deployment';

type Global = typeof globalThis & { __capitalOsDb?: Promise<Db> };
const g = globalThis as Global;

/**
 * Resolve the Db for this process, apply migrations, and seed if the database is empty.
 * Cached on globalThis so Next's dev-mode module reloading does not open a second handle —
 * PGlite is single-process, and a second handle on the same directory deadlocks.
 */
export function getDb(): Promise<Db> {
  if (!g.__capitalOsDb) g.__capitalOsDb = boot();
  return g.__capitalOsDb;
}

async function boot(dir?: string): Promise<Db> {
  const db = config.db.url
    ? await (await import('./postgres')).openPostgres(config.db.url)
    : await (await import('./pglite')).openPglite(dir ?? config.db.localDir);
  const { migrate } = await import('./migrate');
  await migrate(db);

  // Publish the handle before seeding. The seed calls module services, those services call
  // getDb(), and without this line that call would await the promise it is running inside.
  g.__capitalOsDb = Promise.resolve(db);

  const { seedIfEmpty } = await import('../seed');
  await seedIfEmpty(db);
  return db;
}

/** Script entry point. Same handle, same lifecycle, explicit about the directory. */
export async function openFresh(dir?: string): Promise<Db> {
  if (!g.__capitalOsDb) g.__capitalOsDb = boot(dir);
  return g.__capitalOsDb;
}

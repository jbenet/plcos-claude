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

/**
 * Coerce a Postgres array column into a JS array.
 *
 * PGlite resolves type OIDs when it prepares a statement, and it only knows how to parse
 * arrays whose element type it has seen. An array of a *custom* type — an enum created by
 * one of our own migrations — is unparsed when the same connection that created the type
 * later reads it, and comes back as the raw literal `{a,b,c}` instead of `['a','b','c']`.
 *
 * That happens exactly once per database: on a cold start, where the server process runs
 * the migrations itself and then serves from the same handle. Start the server against an
 * already-migrated database and the type is in the cache, so the bug hides.
 *
 * The real fix is to cast custom arrays to `text[]` in the query, which has a built-in OID
 * the driver always knows. This exists so that forgetting the cast produces a wrong-looking
 * value rather than a `.map is not a function` five layers up.
 */
export function pgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (value === null || value === undefined) return [];
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];
  const inner = trimmed.slice(1, -1);
  if (inner === '') return [];
  // Enum and identifier members are never quoted or escaped, which is the only case this
  // needs to survive; anything richer should be jsonb rather than an array.
  return inner.split(',').map((part) => {
    const t = part.trim();
    return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
  });
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
 * Resolve the Db for this process, apply migrations, then give it its first rows: the
 * fictional seed for the demo profile, the init file for the real one — never the other way
 * round. Cached on globalThis so Next's dev-mode module reloading does not open a second
 * handle — PGlite is single-process, and a second handle on the same directory corrupts it.
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

  if (config.data.profile === 'real') {
    const { loadInit } = await import('../real/init');
    await loadInit(db);
  } else {
    const { seedIfEmpty } = await import('../seed');
    await seedIfEmpty(db);
  }
  return db;
}

/** Script entry point. Same handle, same lifecycle, explicit about the directory. */
export async function openFresh(dir?: string): Promise<Db> {
  if (!g.__capitalOsDb) g.__capitalOsDb = boot(dir);
  return g.__capitalOsDb;
}

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

import { readdirSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { config } from '@/config/deployment';

type Global = typeof globalThis & { __capitalOsDb?: Promise<Db>; __capitalOsMigrationCheck?: { at: number; files: string; running: Promise<void> | null } };
const g = globalThis as Global;

/**
 * Resolve the Db for this process, apply migrations, then give it its first rows: the
 * fictional seed for the demo profile, the init file for the real one — never the other way
 * round. Cached on globalThis so Next's dev-mode module reloading does not open a second
 * handle — PGlite is single-process, and a second handle on the same directory corrupts it.
 */
export function getDb(): Promise<Db> {
  if (!g.__capitalOsDb) g.__capitalOsDb = boot();
  if (process.env.NODE_ENV === 'production') return g.__capitalOsDb;
  return g.__capitalOsDb.then(catchUp);
}

/**
 * A dev server applies a migration added while it runs (N81). Its code reloads as it is edited,
 * but migrations ran once, at boot, so new code could query a column its database doesn't have —
 * and the real server restarts only when the Keychain hands over the Affinity key, which asks Juan.
 * So every few seconds the list of migration files is compared with the one last applied, and when
 * it differs the same idempotent runner applies what is new, once, before the query goes ahead. A
 * migration that fails is logged and left for a restart: the pages keep what they had.
 */
async function catchUp(db: Db): Promise<Db> {
  // Empty at first, so a server that booted before this code was loaded checks once, at once.
  const state = (g.__capitalOsMigrationCheck ??= { at: 0, files: '', running: null });
  if (state.running) {
    await state.running;
    return db;
  }
  if (Date.now() - state.at < 3000) return db;
  state.at = Date.now();
  const files = migrationFiles();
  if (files === state.files) return db;
  state.running = (async () => {
    try {
      const { migrate } = await import('./migrate');
      const { applied } = await migrate(db);
      if (applied.length) console.log(`[db] applied while running: ${applied.join(', ')}`);
      state.files = files;
    } catch (err) {
      console.error('[db] a new migration could not be applied while running; restart to apply it:', err instanceof Error ? err.message : err);
      state.files = files;
    } finally {
      state.running = null;
    }
  })();
  await state.running;
  return db;
}

/** The migration files on disk, as one string: what changes when one is added. */
function migrationFiles(): string {
  const root = pathJoin(process.cwd(), 'modules');
  const out: string[] = [];
  try {
    for (const m of readdirSync(root)) {
      try {
        for (const f of readdirSync(pathJoin(root, m, 'migrations'))) if (f.endsWith('.sql')) out.push(`${m}/${f}`);
      } catch { /* a module with no migrations */ }
    }
  } catch { /* no modules directory: nothing to compare */ }
  return out.sort().join('|');
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

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

export type Check = (name: string, ok: boolean, detail: string) => void;
export const SCRATCH = join('data', 'demo', 'props');

/** The groups now running, outermost first: an unfinished run names where it stopped (5 Oct 2026). */
export const runningSteps = new Set<string>();
/** Runs one property group. PROPS_TRACE=1 also logs its start and end to stderr, with its time. */
export async function step<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const trace = process.env.PROPS_TRACE === '1', t0 = Date.now();
  if (trace) console.error(`[props] start ${name}`);
  runningSteps.add(name);
  try { return await run(); }
  finally {
    runningSteps.delete(name);
    if (trace) console.error(`[props] end   ${name} ${Date.now() - t0}ms`);
  }
}

export async function freshDb() {
  await rm(join(process.cwd(), SCRATCH), { recursive: true, force: true });
  const g = globalThis as typeof globalThis & { __capitalOsDb?: unknown };
  if (process.env.DATABASE_URL && g.__capitalOsDb) await (await (g.__capitalOsDb as Promise<import('../../lib/db').Db>)).close();
  delete g.__capitalOsDb;
  await (await import('./database')).resetTestPostgres();
  const { openFresh } = await import('../../lib/db');
  return openFresh();
}

export type Db = Awaited<ReturnType<typeof freshDb>>;
export type SeedContext = { check: Check; db: Db; id: (name: string) => string };

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

export type Check = (name: string, ok: boolean, detail: string) => void;
export const SCRATCH = join('data', 'demo', 'props');

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

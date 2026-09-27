import { randomUUID } from 'node:crypto';
import { openPostgres } from '../../lib/db/postgres';
import { openPglite } from '../../lib/db/pglite';
import type { Db } from '../../lib/db';

const scratch = new Map<string, string>();
const qi = (s: string) => '"' + s.replaceAll('"', '""') + '"';

/** Destructive test operations are restricted to explicitly named loopback test databases. */
export function testUrl(value = process.env.DATABASE_URL): URL | null {
  if (!value) return null;
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/plcos_test_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error('Properties require a loopback DATABASE_URL named plcos_test_*; refusing destructive setup.');
  }
  return url;
}
async function admin(work: (db: Db) => Promise<void>) {
  const url = testUrl()!;
  url.pathname = '/postgres';
  const db = await openPostgres(url.href);
  try { await work(db); } finally { await db.close(); }
}
export async function resetTestPostgres() {
  const url = testUrl();
  if (!url) return;
  await admin(async db => {
    const name = url.pathname.slice(1);
    await db.exec(`drop database if exists ${qi(name)}`);
    await db.exec(`create database ${qi(name)}`);
  });
}
/** An unseeded isolated handle, with restart persistence for explicit directory names. */
export async function openTestDb(dir = 'memory://'): Promise<Db> {
  const url = testUrl();
  if (!url) return openPglite(dir);
  const key = dir === 'memory://' ? randomUUID() : dir;
  let name = scratch.get(key);
  if (!name) {
    name = `plcos_test_scratch_${randomUUID().replaceAll('-', '')}`;
    await admin(db => db.exec(`create database ${qi(name!)}`));
    scratch.set(key, name);
  }
  url.pathname = '/' + name;
  return openPostgres(url.href);
}
export async function cleanTestPostgres() {
  if (!testUrl()) return;
  await admin(async db => {
    for (const name of scratch.values()) await db.exec(`drop database if exists ${qi(name)}`);
  });
  scratch.clear();
}

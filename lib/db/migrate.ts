import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './index';
import { MODULES } from '@/modules/manifest';

const BOOTSTRAP = `
create schema if not exists platform;
create table if not exists platform.migration (
  id          text primary key,
  module      text not null,
  name        text not null,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);
`;

type Row = { id: string; checksum: string };

/**
 * Apply every module migration that has not run yet, in manifest order then filename order.
 * Idempotent: safe to call on every boot, which is how the local loop works.
 */
export async function migrate(db: Db): Promise<{ applied: string[] }> {
  await db.exec(BOOTSTRAP);
  const done = new Map(
    (await db.query<Row>('select id, checksum from platform.migration')).map((r) => [r.id, r.checksum]),
  );
  const applied: string[] = [];

  for (const mod of MODULES) {
    const dir = join(process.cwd(), 'modules', mod.name, 'migrations');
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const id = `${mod.name}/${file}`;
      const sql = await readFile(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
      const prior = done.get(id);
      if (prior === checksum) continue;
      if (prior && prior !== checksum) {
        throw new Error(
          `Migration ${id} changed after it was applied (${prior} → ${checksum}). ` +
            'Locally: `npm run db:reset`. Once anything is deployed: write a new migration instead.',
        );
      }
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query(
          'insert into platform.migration (id, module, name, checksum) values ($1,$2,$3,$4)',
          [id, mod.name, file, checksum],
        );
      });
      applied.push(id);
    }
  }
  return { applied };
}

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
  if (db.kind === 'postgres') {
    // Concurrent server boots must see the ledger only after the prior migrator commits.
    return db.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(192837, 1)");
      return applyMigrations({ ...db, ...tx, transaction: work => work(tx) });
    });
  }
  return applyMigrations(db);
}

async function applyMigrations(db: Db): Promise<{ applied: string[] }> {
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
  // Network read dependencies include modules later in manifest order. Install their
  // invalidation triggers after the complete schema exists, including on a fresh demo.
  await db.exec(`do $$ begin
    if to_regprocedure('network.install_read_triggers()') is not null then
      perform network.install_read_triggers();
    end if;
  end $$;`);
  // Every schema readable by the read-only role (docs/21): backups pg_dump as plcos_ro, and a new schema
  // made without the grant (email, 2 Oct 2026) stopped every daily backup until someone looked. Postgres
  // only, and only where the role exists; a grant the migrator may not give is skipped, not fatal.
  if (db.kind === 'postgres') await db.exec(READ_ROLE_GRANTS);
  return { applied };
}

const READ_ROLE_GRANTS = `do $$
declare s text;
begin
  if not exists (select 1 from pg_roles where rolname = 'plcos_ro') then return; end if;
  for s in select nspname from pg_namespace
    where nspname !~ '^pg_' and nspname <> 'information_schema'
      and not has_schema_privilege('plcos_ro', oid, 'USAGE') loop
    begin
      execute format('grant usage on schema %I to plcos_ro', s);
      execute format('grant select on all tables in schema %I to plcos_ro', s);
      execute format('grant select on all sequences in schema %I to plcos_ro', s);
      raise notice 'granted plcos_ro read on schema %', s;
    exception when insufficient_privilege then
      raise warning 'cannot grant plcos_ro read on schema % (not its owner); backups will fail', s;
    end;
  end loop;
end $$;`;

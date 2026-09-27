import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPglite } from '../../lib/db/pglite';
import { openPostgres } from '../../lib/db/postgres';
import { copyPgliteToPostgres } from '../../lib/db/pg-copy';
import { lockFile } from '../../lib/db/lock';
import { migrate } from '../../lib/db/migrate';
import type { Check } from './harness';

async function treeHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(dir: string) {
    for (const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = join(dir,entry.name);
      hash.update(path.slice(root.length));
      if (entry.isDirectory()) await visit(path); else hash.update(await readFile(path));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

/** Integration uses only an explicitly supplied, disposable plcos_test_copy* database. */
export async function pgCopyProperties(check: Check, suppliedUrl = process.env.PG_COPY_TEST_URL): Promise<void> {
  const root = await mkdtemp(join(tmpdir(),'plcos-copy-props-'));
  const source = join(root,'snapshot');
  let pg: Awaited<ReturnType<typeof openPostgres>> | undefined;
  try {
    const db = await openPglite(source);
    try {
      await migrate(db);
      await db.exec(`create schema copy_fixture;
        create type copy_fixture.mood as enum ('fine','better');
        create table copy_fixture.parent(id bigserial primary key, at timestamptz, precise numeric, payload jsonb, moods copy_fixture.mood[], raw bytea);
        create table copy_fixture.child(id int primary key,parent bigint references copy_fixture.parent(id));
        create table copy_fixture.cycle_a(id int primary key,other int);
        create table copy_fixture.cycle_b(id int primary key,other int references copy_fixture.cycle_a(id));
        alter table copy_fixture.cycle_a add foreign key(other) references copy_fixture.cycle_b(id);
        insert into copy_fixture.parent(at,precise,payload,moods,raw) values ('2026-09-27T01:02:03.123456Z',12345678901234567890.123456789,'{"z": 1, "a": [null,"invented"]}',array['fine','better']::copy_fixture.mood[],'\\x000102ff');
        insert into copy_fixture.child values (1,1);
        insert into copy_fixture.cycle_a values(1,null);
        insert into copy_fixture.cycle_b values(2,1);
        update copy_fixture.cycle_a set other=2;
        create table copy_fixture.triggered(id int);
        create function copy_fixture.prevent_insert() returns trigger language plpgsql as $$ begin raise exception 'invented trigger fires'; end $$;
        insert into copy_fixture.triggered values(1);
        create trigger fixture_guard before insert on copy_fixture.triggered for each row execute function copy_fixture.prevent_insert();
        create view copy_fixture.parent_view as select id,at from copy_fixture.parent;`);
    } finally { await db.close(); }
    const before = await treeHash(source);
    await writeFile(lockFile(source),String(process.pid));
    let locked = false;
    try { await copyPgliteToPostgres({source,targetUrl:'postgres://invalid:1/never'}); }
    catch (e) { locked = String(e).includes('open in a running process'); }
    finally { await rm(lockFile(source),{force:true}); }
    check('pg-copy refuses a held source lock before opening either database',locked,'Includes a lock owned by this process.');
    let remoteRefused = false;
    try { await copyPgliteToPostgres({source,targetUrl:'postgres://outside.example/copy'}); }
    catch(e) { remoteRefused=String(e).includes('local loopback'); }
    check('pg-copy refuses remote targets before any connection',remoteRefused,'Only a local Postgres migration is authorized.');
    if (!suppliedUrl && process.env.DATABASE_URL) {
      const base = new URL(process.env.DATABASE_URL);
      if (!/^\/plcos_test_[a-z0-9_]+$/.test(base.pathname) || !['127.0.0.1','localhost','[::1]'].includes(base.hostname) || base.search || base.hash) throw new Error('pg-copy test derivation requires a local plcos_test_* DATABASE_URL');
      base.pathname='/plcos_test_copy_props';
      suppliedUrl=base.toString();
    }
    if (!suppliedUrl) return;
    const url = new URL(suppliedUrl);
    if (!/^\/plcos_test_copy[a-z0-9_]*$/.test(url.pathname) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.search || url.hash) throw new Error('pg-copy tests require a local plcos_test_copy* database');
    const adminUrl=new URL(url); adminUrl.pathname='/postgres';
    const admin=await openPostgres(adminUrl.toString());
    try {
      const name=url.pathname.slice(1);
      if (!(await admin.one('select 1 from pg_database where datname=$1',[name]))) {
        await admin.exec(`create database "${name}"`);
      }
    } finally { await admin.close(); }
    pg = await openPostgres(suppliedUrl,{statementTimeoutMs:0});
    const reports = await copyPgliteToPostgres({source,targetUrl:suppliedUrl,replace:true,batchSize:1});
    check('pg-copy preserves every table count and checksum',reports.length>100 && reports.every(r=>r.ok),'Full migrated schema plus invented precision, enum arrays, bytea, cycles and triggers; one-row batches.');
    check('pg-copy leaves every source file byte-for-byte unchanged',before===await treeHash(source),'PGlite opens a private clone; source snapshot remains untouched.');
    const ledger = await pg.one<{count:number}>('select count(*)::int count from platform.migration');
    const next = await pg.one<{id:number}>("insert into copy_fixture.parent(payload) values ('{}') returning id");
    const exact = await pg.one<{at:string; precise:string}>('select at::text at,precise::text precise from copy_fixture.parent where id=1');
    check('pg-copy preserves migration ledger, sequence next values and full precision',ledger?.count===reports.find(r=>r.table==='platform.migration')?.sourceRows && next?.id===2 && exact?.at.includes('.123456')===true && exact?.precise==='12345678901234567890.123456789','No JavaScript date or numeric decoding in the copy path.');
    let trigger = false;
    try { await pg.exec('insert into copy_fixture.triggered values(2)'); } catch { trigger=true; }
    check('pg-copy restores triggers after data load',trigger,'The copied trigger prevents later inserts without blocking historical data.');
    let refused = false;
    try { await copyPgliteToPostgres({source,targetUrl:suppliedUrl}); } catch(e) { refused=String(e).includes('Target is not empty'); }
    check('pg-copy refuses a nonempty target without --replace',refused && (await pg.one<{count:number}>('select count(*)::int count from copy_fixture.parent'))?.count===2,'Refusal preserves existing target data.');
    const replaced = await copyPgliteToPostgres({source,targetUrl:suppliedUrl,replace:true,batchSize:2});
    check('pg-copy --replace verifies an exact replacement',replaced.every(r=>r.ok) && (await pg.one<{count:number}>('select count(*)::int count from copy_fixture.parent'))?.count===1,'Replacement and verification commit in one target transaction.');
    const unsupported = await openPglite(source);
    try { await unsupported.exec('create table copy_fixture.unsupported(id bigint generated always as identity)'); }
    finally { await unsupported.close(); }
    let rolledBack = false;
    try { await copyPgliteToPostgres({source,targetUrl:suppliedUrl,replace:true}); }
    catch(e) { rolledBack=String(e).includes('Identity columns'); }
    check('pg-copy rolls back a failed replacement without losing the prior target',rolledBack && (await pg.one<{count:number}>('select count(*)::int count from copy_fixture.parent'))?.count===1,'Unsupported schema fails closed even after replacement DDL begins.');
  } finally {
    if(pg) await pg.close();
    await rm(root,{recursive:true,force:true});
  }
}

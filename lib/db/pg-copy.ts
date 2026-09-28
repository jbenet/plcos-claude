import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Client } from 'pg';
import { lockFile } from './lock';

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const qualified = (schema: string, name: string) => `${ident(schema)}.${ident(name)}`;
const userSchema = "n.nspname <> 'information_schema' and n.nspname !~ '^pg_'";
type Query = { query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
type Table = { oid: number; schema: string; name: string };
type Column = { name: string; type: string; nullable: boolean; expression: string | null; generated: string; identity: string; collation: string | null };
export type CopyReport = { table: string; sourceRows: number; targetRows: number; sourceChecksum: string; targetChecksum: string; ok: boolean };
export type CopyOptions = { source: string; targetUrl: string; replace?: boolean; batchSize?: number; onTable?: (report: CopyReport) => void };

/** Never expose SQL, bound values, or driver details in a copy failure: they can hold records. */
export class PgCopyError extends Error {
  constructor(message: string) { super(message); this.name = 'PgCopyError'; }
}

async function refuseHeldSource(source: string): Promise<void> {
  let text: string;
  try { text = await readFile(lockFile(source), 'utf8'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; throw new PgCopyError('Cannot inspect the source lock.'); }
  const pid = Number(text.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new PgCopyError('Source lock is malformed; inspect it before copying.');
  try { process.kill(pid, 0); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ESRCH') return; }
  throw new PgCopyError('Source is open in a running process. Stop it and take a closed snapshot before copying.');
}

async function digest(db: Query, table: string, batchSize: number): Promise<{ count: number; checksum: string }> {
  // Hash each row in SQL, preserving full timestamp/numeric precision and canonical jsonb keys.
  // Sorting fixed-width hashes retains duplicate rows, is independent of heap order and uses no JS values.
  const hash = createHash('sha256');
  let count = 0;
  await db.query(`declare copy_digest no scroll cursor for select md5(to_jsonb(t)::text) as digest from ${table} t order by md5(to_jsonb(t)::text) collate "C"`);
  try {
    for (;;) {
      const { rows } = await db.query<{ digest: string }>(`fetch ${batchSize} from copy_digest`);
      if (!rows.length) break;
      for (const row of rows) hash.update(row.digest + '\n');
      count += rows.length;
    }
  } finally { await db.query('close copy_digest'); }
  return { count, checksum: hash.digest('hex') };
}

function dependencyOrder(tables: Table[], dependencies: Array<{ child: number; parent: number }>): Table[] {
  const pending = new Map(tables.map(t => [t.oid, t]));
  const ordered: Table[] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter(t => !dependencies.some(d => d.child === t.oid && d.parent !== t.oid && pending.has(d.parent)));
    // Cyclic FKs are restored and validated after every row is loaded.
    const next = ready.length ? ready : [pending.values().next().value!];
    for (const table of next) { ordered.push(table); pending.delete(table.oid); }
  }
  return ordered;
}

/**
 * Copy a CLOSED PGlite snapshot. PGlite only opens a private clone, because opening it can
 * checkpoint/recover files even for SELECTs. All target DDL/data/verification is atomic.
 * Catalog support covers the application's schema; unhandled features fail before target writes.
 */
export async function copyPgliteToPostgres(options: CopyOptions): Promise<CopyReport[]> {
  const batchSize = options.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new PgCopyError('Batch size must be between 1 and 5000.');
  const source = await realpath(resolve(options.source));
  if (!(await stat(source)).isDirectory()) throw new PgCopyError('Source must be a PGlite snapshot directory.');
  await refuseHeldSource(source);
  let target: URL;
  try { target = new URL(options.targetUrl); } catch { throw new PgCopyError('Target must be a local Postgres URL.'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.search || target.hash || !target.pathname.slice(1) || ['postgres','template0','template1'].includes(decodeURIComponent(target.pathname.slice(1)))) {
    throw new PgCopyError('Target must name a local loopback Postgres application database, without query parameters or fragments.');
  }
  // Keep private data inside the snapshot's enclosing storage boundary, never OS temp.
  const scratch = await mkdtemp(join(dirname(source), '.pg-copy-'));
  await chmod(scratch, 0o700);
  let from: PGlite | undefined;
  let to: Client | undefined;
  let stage = 'opening the snapshot';
  try {
    const clone = join(scratch, 'snapshot');
    await cp(source, clone, { recursive: true, errorOnExist: true, force: false, dereference: false, filter: async path => {
      if ((await lstat(path)).isSymbolicLink()) throw new PgCopyError('Snapshot contains a symbolic link; copy refused to keep source files isolated.');
      return true;
    } });
    await refuseHeldSource(source);
    from = await PGlite.create(clone);
    await from.exec("begin read only; set local timezone = 'UTC'; set local datestyle = 'ISO, YMD'; set local intervalstyle = 'postgres'; set local bytea_output = 'hex'; set local extra_float_digits = 3;");
    const read = from as unknown as Query;
    stage = 'checking supported schema features';
    const unsupported = await read.query<{ count: string }>(`select count(*)::text count from (
      select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and (c.relkind in ('p','f','m','c') or c.relispartition or c.relrowsecurity or (c.relacl is not null and not (n.nspname='platform' and c.relname='audit_log')) or (c.relkind='v' and c.reloptions is not null))
      union all select t.oid from pg_type t join pg_namespace n on n.oid=t.typnamespace where ${userSchema} and t.typtype in ('d','r','m')
      union all select i.inhrelid from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema}
      union all select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${userSchema} and p.prokind not in ('f','p')
      union all select e.oid from pg_extension e where e.extname <> 'plpgsql'
      union all select n.oid from pg_namespace n where ${userSchema} and n.nspname <> 'public' and n.nspacl is not null
      union all select n.oid from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname='public' and a.grantee not in (0,n.nspowner)
      union all select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${userSchema} and p.proacl is not null
      union all select a.attrelid from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and a.attacl is not null
      union all select d.oid from pg_default_acl d
      union all select r.oid from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and r.rulename <> '_RETURN'
      union all select c.oid from pg_collation c join pg_namespace n on n.oid=c.collnamespace where ${userSchema}
    ) unsupported`);
    if (unsupported.rows[0].count !== '0') throw new PgCopyError('Unsupported schema feature (partition, foreign/materialized/composite table, RLS, custom grants, view options, rules/collations, domain/range, inheritance, aggregate or extension); copy refused.');
    const schemas = (await read.query<{ name: string }>(`select n.nspname name from pg_namespace n where ${userSchema} order by 1`)).rows;
    const tables = (await read.query<Table>(`select c.oid::int oid,n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and c.relkind='r' order by 2,3`)).rows;
    const dependencies = (await read.query<{ child: number; parent: number }>(`select conrelid::int child,confrelid::int parent from pg_constraint where contype='f'`)).rows;
    to = new Client({ connectionString: options.targetUrl, application_name: 'capital-os-pg-copy' });
    await to.connect();
    await to.query('begin');
    await to.query("set local timezone = 'UTC'; set local datestyle = 'ISO, YMD'; set local intervalstyle = 'postgres'; set local bytea_output = 'hex'; set local extra_float_digits = 3; set local statement_timeout = 0; set local lock_timeout = '10s';");
    await to.query("select pg_advisory_xact_lock(734210, 1)");
    stage = 'checking the target';
    const occupied = await to.query<{ count: string }>(`select count(*)::text count from (
      select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${userSchema}
      union all select t.oid from pg_type t join pg_namespace n on n.oid=t.typnamespace where ${userSchema}
      union all select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${userSchema}
      union all select n.oid from pg_namespace n where ${userSchema} and n.nspname <> 'public'
    ) objects`);
    if (occupied.rows[0].count !== '0' && !options.replace) throw new PgCopyError('Target is not empty. Use a fresh database, or explicitly pass --replace.');
    const targetSchemas = await to.query<{ name: string }>(`select n.nspname name from pg_namespace n where ${userSchema}`);
    for (const schema of targetSchemas.rows) await to.query(`drop schema ${ident(schema.name)} cascade`);
    for (const schema of schemas) await to.query(`create schema ${ident(schema.name)}`);
    // platform.audit_log's revoked update/delete (migration platform/010_audit_append_only) is the one
    // known custom grant: the target's own migration reapplies it, and its append-only trigger holds.
    // Preserve the built-in public schema's PUBLIC usage/create grants. Other custom
    // grants require an explicit role mapping and are refused in the preflight above.
    const publicGrants = await read.query<{ privilege: string }>(`select a.privilege_type privilege from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname='public' and a.grantee=0`);
    for (const grant of publicGrants.rows) {
      if (!['USAGE','CREATE'].includes(grant.privilege)) throw new PgCopyError('Unsupported public schema privilege; copy refused.');
      await to.query(`grant ${grant.privilege} on schema public to public`);
    }
    stage = 'creating enum types';
    const enums = await read.query<{ schema: string; name: string; labels: string[] }>(`select n.nspname schema,t.typname name,array_agg(e.enumlabel::text order by e.enumsortorder) labels from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where ${userSchema} group by n.nspname,t.typname order by 1,2`);
    for (const e of enums.rows) await to.query(`create type ${qualified(e.schema, e.name)} as enum (${e.labels.map(literal).join(',')})`);
    const sequences = (await read.query<{ schema: string; name: string; type: string; start: string; increment: string; min: string; max: string; cache: string; cycle: boolean }>(`select n.nspname schema,c.relname name,format_type(s.seqtypid,null) type,s.seqstart::text start,s.seqincrement::text increment,s.seqmin::text min,s.seqmax::text max,s.seqcache::text cache,s.seqcycle cycle from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema} order by 1,2`)).rows;
    for (const s of sequences) await to.query(`create sequence ${qualified(s.schema,s.name)} as ${s.type} increment ${s.increment} minvalue ${s.min} maxvalue ${s.max} start ${s.start} cache ${s.cache} ${s.cycle ? '' : 'no '}cycle`);
    const columns = new Map<number, Column[]>();
    // Functions may mention tables in their body. PostgreSQL restores them with body checking off.
    await to.query('set local check_function_bodies = off');
    const functions = await read.query<{ definition: string }>(`select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${userSchema} and p.prokind in ('f','p') order by p.oid`);
    for (const f of functions.rows) await to.query(f.definition);
    stage = 'creating tables';
    for (const t of tables) {
      const cols = (await read.query<Column>(`select a.attname name,format_type(a.atttypid,a.atttypmod) type,not a.attnotnull nullable,pg_get_expr(d.adbin,d.adrelid) expression,a.attgenerated generated,a.attidentity identity,case when a.attcollation <> ty.typcollation then quote_ident(cn.nspname)||'.'||quote_ident(co.collname) end collation from pg_attribute a join pg_type ty on ty.oid=a.atttypid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace where a.attrelid=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`, [t.oid])).rows;
      if (cols.some(c => c.identity)) throw new PgCopyError('Identity columns are not supported by this copy version; copy refused.');
      columns.set(t.oid, cols);
      const definitions = cols.map(c => `${ident(c.name)} ${c.type}${c.collation ? ` collate ${c.collation}` : ''}${c.generated ? ` generated always as (${c.expression}) stored` : c.expression ? ` default ${c.expression}` : ''}${c.nullable ? '' : ' not null'}`);
      await to.query(`create table ${qualified(t.schema,t.name)} (${definitions.join(',')})`);
    }
    stage = 'copying table batches';
    for (const t of dependencyOrder(tables, dependencies)) {
      const table = qualified(t.schema,t.name);
      const cols = columns.get(t.oid)!.filter(c => !c.generated);
      const effectiveBatch = Math.min(batchSize, Math.floor(60000 / Math.max(1, cols.length)));
      await read.query(`declare copy_rows no scroll cursor for select ${cols.map(c => `${ident(c.name)}::text`).join(',')} from ${table}`);
      try {
        for (;;) {
          const { rows } = await read.query<Record<string,string|null>>(`fetch ${effectiveBatch} from copy_rows`);
          if (!rows.length) break;
          if (!cols.length) { for (const _row of rows) await to.query(`insert into ${table} default values`); continue; }
          const values: unknown[] = [];
          const tuples = rows.map(row => `(${cols.map(c => { values.push(row[c.name]); return `$${values.length}::${c.type}`; }).join(',')})`);
          await to.query(`insert into ${table} (${cols.map(c => ident(c.name)).join(',')}) values ${tuples.join(',')}`, values);
        }
      } finally { await read.query('close copy_rows'); }
    }
    stage = 'restoring sequence positions and ownership';
    for (const s of sequences) {
      const name = qualified(s.schema,s.name);
      const state = (await read.query<{ value: string; called: boolean }>(`select last_value::text value,is_called called from ${name}`)).rows[0];
      await to.query('select setval($1::regclass,$2::bigint,$3)',[name,state.value,state.called]);
    }
    const owned = await read.query<{ ss: string; sn: string; ts: string; tn: string; column: string }>(`select n.nspname ss,s.relname sn,tn.nspname ts,t.relname tn,a.attname "column" from pg_class s join pg_namespace n on n.oid=s.relnamespace join pg_depend d on d.classid='pg_class'::regclass and d.objid=s.oid and d.deptype='a' join pg_class t on t.oid=d.refobjid join pg_namespace tn on tn.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid where s.relkind='S' and ${userSchema}`);
    for (const s of owned.rows) await to.query(`alter sequence ${qualified(s.ss,s.sn)} owned by ${qualified(s.ts,s.tn)}.${ident(s.column)}`);
    stage = 'restoring constraints and indexes';
    const constraints = await read.query<{ schema: string; table: string; name: string; definition: string }>(`select n.nspname schema,c.relname "table",con.conname name,pg_get_constraintdef(con.oid) definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and con.contype in ('p','u','c','x','f') order by case when con.contype='f' then 1 else 0 end,con.oid`);
    for (const c of constraints.rows) await to.query(`alter table ${qualified(c.schema,c.table)} add constraint ${ident(c.name)} ${c.definition}`);
    const indexes = await read.query<{ definition: string }>(`select pg_get_indexdef(i.indexrelid) definition from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and not exists(select 1 from pg_constraint con where con.conindid=i.indexrelid) order by i.indexrelid`);
    for (const i of indexes.rows) await to.query(i.definition);
    stage = 'restoring views and triggers';
    const views = await read.query<{ schema: string; name: string; definition: string }>(`select n.nspname schema,c.relname name,pg_get_viewdef(c.oid,true) definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and c.relkind='v' order by c.oid`);
    for (const v of views.rows) await to.query(`create view ${qualified(v.schema,v.name)} as ${v.definition}`);
    const triggers = await read.query<{ definition: string; enabled: string; schema: string; table: string; name: string }>(`select pg_get_triggerdef(t.oid) definition,t.tgenabled enabled,n.nspname schema,c.relname "table",t.tgname name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and not t.tgisinternal order by t.oid`);
    for (const t of triggers.rows) {
      await to.query(t.definition);
      if (t.enabled !== 'O') await to.query(`alter table ${qualified(t.schema,t.table)} ${t.enabled === 'D' ? 'disable' : t.enabled === 'A' ? 'enable always' : 'enable replica'} trigger ${ident(t.name)}`);
    }
    stage = 'verifying counts and checksums';
    const reports: CopyReport[] = [];
    for (const t of tables) {
      const table = qualified(t.schema,t.name);
      const a = await digest(read,table,batchSize);
      const b = await digest(to as unknown as Query,table,batchSize);
      const report = { table: `${t.schema}.${t.name}`,sourceRows:a.count,targetRows:b.count,sourceChecksum:a.checksum,targetChecksum:b.checksum,ok:a.count===b.count && a.checksum===b.checksum };
      reports.push(report);
      if (!report.ok) throw new PgCopyError(`Counts/checksums differ for ${report.table}; target transaction rolled back.`);
    }
    await to.query('commit');
    for (const report of reports) options.onTable?.(report);
    return reports;
  } catch (err) {
    if (to) await to.query('rollback').catch(() => undefined);
    if (err instanceof PgCopyError) throw err;
    const code = typeof err === 'object' && err && 'code' in err ? String(err.code).replace(/[^a-zA-Z0-9_]/g, '').slice(0,30) : 'unknown';
    throw new PgCopyError(`Copy failed while ${stage} (code ${code}); no row contents logged. Target changes rolled back.`);
  } finally {
    if (to) await to.end().catch(() => undefined);
    if (from) await from.close().catch(() => undefined);
    await rm(scratch,{ recursive:true,force:true });
  }
}

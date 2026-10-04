/**
 * The cutover checker (scripts/pg-verify.ts, scripts/cutover.sh; docs/deploy/rev2/image-and-cutover.md).
 * Per table: the row count and the ordered-row checksum of docs/21's pg-copy checker (`digest`), each
 * database read in one REPEATABLE READ READ ONLY snapshot. Also the set of tables, each sequence's last
 * value, and the counts of views, functions, triggers, indexes, constraints and schemas. The report
 * holds counts and table names, never rows.
 */
import { Client } from 'pg';
import { digest, type Query } from './pg-copy';

const userSchema = "n.nspname <> 'information_schema' and n.nspname !~ '^pg_'";
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;

export type TableReport = { table: string; sourceRows: number | null; targetRows: number | null; ok: boolean };
export type VerifyReport = {
  tables: number; rows: number; mismatchedTables: string[]; missingTables: string[]; extraTables: string[];
  sequences: number; mismatchedSequences: string[]; objects: Record<string, { source: number; target: number }>;
  ok: boolean; perTable: TableReport[];
};
export type Snapshot = { tables: Map<string, { count: number; checksum: string }>; sequences: Map<string, string>; objects: Record<string, number> };

const OBJECTS: Record<string, string> = {
  views: `select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and c.relkind in ('v','m')`,
  functions: `select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${userSchema} and p.prokind in ('f','p')`,
  triggers: `select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and not t.tgisinternal`,
  indexes: `select count(*)::int n from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where ${userSchema}`,
  constraints: `select count(*)::int n from pg_constraint con join pg_namespace n on n.oid=con.connamespace where ${userSchema}`,
  schemas: `select count(*)::int n from pg_namespace n where ${userSchema}`,
};

export async function snapshot(url: string, batchSize = 5000): Promise<Snapshot> {
  const client = new Client({ connectionString: url, application_name: 'plcos-verify' });
  await client.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    // Rows are hashed as text, so pin how values print, as pg-copy does: otherwise two servers in different
    // time zones (the Mac's cluster and a cloud one in UTC) print every timestamptz differently and never match.
    await client.query("set local timezone = 'UTC'; set local datestyle = 'ISO, YMD'; set local intervalstyle = 'postgres'; set local bytea_output = 'hex'; set local extra_float_digits = 3;");
    const q = client as unknown as Query;
    const tables = new Map<string, { count: number; checksum: string }>();
    const list = await client.query<{ schema: string; name: string }>(
      `select n.nspname schema, c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${userSchema} and c.relkind='r' order by 1,2`);
    for (const t of list.rows) tables.set(`${t.schema}.${t.name}`, await digest(q, `${ident(t.schema)}.${ident(t.name)}`, batchSize));
    const sequences = new Map<string, string>();
    const seqs = await client.query<{ name: string; last: string | null }>(
      `select schemaname||'.'||sequencename name, last_value::text last from pg_sequences where schemaname <> 'information_schema' and schemaname !~ '^pg_' order by 1`);
    for (const s of seqs.rows) sequences.set(s.name, s.last ?? 'unused');
    const objects: Record<string, number> = {};
    for (const [kind, sql] of Object.entries(OBJECTS)) objects[kind] = (await client.query<{ n: number }>(sql)).rows[0]!.n;
    await client.query('commit');
    return { tables, sequences, objects };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function compare(a: Snapshot, b: Snapshot): VerifyReport {
  const perTable: TableReport[] = [];
  const names = [...new Set([...a.tables.keys(), ...b.tables.keys()])].sort();
  for (const table of names) {
    const x = a.tables.get(table); const y = b.tables.get(table);
    perTable.push({ table, sourceRows: x?.count ?? null, targetRows: y?.count ?? null, ok: !!x && !!y && x.count === y.count && x.checksum === y.checksum });
  }
  const seqNames = [...new Set([...a.sequences.keys(), ...b.sequences.keys()])].sort();
  const mismatchedSequences = seqNames.filter(s => a.sequences.get(s) !== b.sequences.get(s));
  const objects: VerifyReport['objects'] = {};
  for (const kind of Object.keys(OBJECTS)) objects[kind] = { source: a.objects[kind] ?? 0, target: b.objects[kind] ?? 0 };
  const report: VerifyReport = {
    tables: a.tables.size,
    rows: [...a.tables.values()].reduce((sum, t) => sum + t.count, 0),
    mismatchedTables: perTable.filter(t => !t.ok && t.sourceRows !== null && t.targetRows !== null).map(t => t.table),
    missingTables: perTable.filter(t => t.targetRows === null).map(t => t.table),
    extraTables: perTable.filter(t => t.sourceRows === null).map(t => t.table),
    sequences: a.sequences.size,
    mismatchedSequences,
    objects,
    ok: false,
    perTable,
  };
  report.ok = !report.mismatchedTables.length && !report.missingTables.length && !report.extraTables.length
    && !mismatchedSequences.length && Object.values(objects).every(o => o.source === o.target) && report.tables > 0;
  return report;
}

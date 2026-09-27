import { openPostgres } from '../../lib/db/postgres';
import { TooManyRows } from '../../lib/db';
import { migrate } from '../../lib/db/migrate';
import { openTestDb } from './database';
import type { Check } from './harness';

export async function databaseProperties(check: Check) {
  const db = await openTestDb();
  try {
    check('DB selected adapter follows DATABASE_URL', db.kind === (process.env.DATABASE_URL ? 'postgres' : 'pglite'), db.kind);
    check('DB one accepts zero and one row', await db.one('select 1 where false') === null
      && (await db.one<{ n: number }>('select 1 n'))?.n === 1, 'Same Queryable result contract.');
    let tooMany = false;
    try { await db.one('select generate_series(1,2)'); } catch (e) { tooMany = e instanceof TooManyRows; }
    check('DB one refuses multiple rows', tooMany, 'No arbitrary first-row selection.');
    await db.exec('create table public.adapter_fixture (id int primary key, payload jsonb, at timestamptz)');
    await db.transaction(async tx => {
      await tx.query('insert into public.adapter_fixture values ($1,$2,$3)', [1, JSON.stringify({ b: 2, a: [1, null] }), '2026-09-01T12:00:00.123Z']);
    });
    let rolledBack = false;
    try {
      await db.transaction(async tx => {
        await tx.query('insert into public.adapter_fixture(id) values (2)');
        throw new Error('Invented rollback');
      });
    } catch { rolledBack = true; }
    const row = await db.one<{ n: number; payload: { a: unknown[] }; at: Date }>(
      'select (select count(*) from public.adapter_fixture) n,payload,at from public.adapter_fixture');
    check('DB transactions commit and roll back with JSON and timestamp parity', rolledBack && row?.n === 1
      && row.payload.a[0] === 1 && row.at.toISOString() === '2026-09-01T12:00:00.123Z', 'Count is numeric; JSON is decoded; timestamps retain milliseconds.');
    const last = await db.query<{ n: number }>('select 1 n; select 2 n');
    check('DB multi-statement reads return the last result', last[0]?.n === 2, 'Matches the PGlite adapter.');
    await migrate(db);
    check('DB migrations remain idempotent', (await migrate(db)).applied.length === 0, 'Same immutable SQL and ledger on either adapter.');
  } finally { await db.close(); }
  if (process.env.DATABASE_URL) {
    const bounded = await openPostgres(process.env.DATABASE_URL, { statementTimeoutMs: 50, max: 2 });
    try {
      let timeout = false;
      try { await bounded.query('select pg_sleep(1)'); } catch (e) { timeout = (e as { code?: string }).code === '57014'; }
      check('PG foreground statements time out and connection remains usable', timeout && Boolean(await bounded.one('select 1')), 'Postgres enforces a server-side statement deadline.');
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      const write = bounded.transaction(async tx => {
        await tx.query('select 1'); entered(); await gate;
      });
      await started;
      try {
        check('PG independent reader answers while another transaction is open', Boolean(await bounded.one('select 1')), 'Separate pool connections permit foreground reads during imports.');
      } finally { release(); await write; }
    } finally { await bounded.close(); }
  }
}

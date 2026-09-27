import { openPglite } from '../../lib/db/pglite';
import { TooManyRows, type Queryable } from '../../lib/db';
import type { Check } from './harness';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/** A process with no timers/sockets of its own must live exactly as long as its query. */
function workerChild(dir: string, pending: boolean): Promise<{code: number | null; output: string; timedOut: boolean}> {
  const source = `
    const module = await import(${JSON.stringify(join(process.cwd(), 'lib/db/pglite.ts'))});
    const {openPglite} = module.default ?? module;
    const db = await openPglite(${JSON.stringify(dir)});
    ${pending ? `
      const start = performance.now();
      void db.exec("do $$ declare deadline timestamptz:=clock_timestamp()+interval '0.3 seconds'; begin while clock_timestamp()<deadline loop null; end loop; end $$")
        .then(() => console.log(JSON.stringify({completed:true, milliseconds:performance.now()-start})))
        .catch(() => { process.exitCode=1; });
    ` : `
      const row = await db.one('select 1::int n');
      console.log(JSON.stringify({completed:row.n===1}));
    `}
    // Intentionally no close(): reproduce short scripts and the full property suite.
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: process.cwd(), env: { ...process.env, DATA_PROFILE: 'demo' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10_000);
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output, timedOut }); });
  });
}

/** Scheduling correctness and thread responsiveness; every row is invented. */
export async function pgliteWorkerProperties(check:Check) {
  const db=await openPglite('memory://');
  try {
    await db.exec('create table worker_fixture (id integer primary key, value text not null)');
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const tx=db.transaction(async q=>{
      await q.query('insert into worker_fixture values ($1,$2)',[1,'invented transaction']);
      entered();await gate;
      await q.query('insert into worker_fixture values ($1,$2)',[2,'invented transaction']);
    });
    await started;
    let outsiderFinished=false;
    const outside=db.query<{n:number}>('select count(*)::int n from worker_fixture').then(rows=>{outsiderFinished=true;return rows;});
    await new Promise(resolve=>setTimeout(resolve,25));
    const excluded=!outsiderFinished;
    release();await tx;
    const rows=await outside;
    check('PGLITE WORKER transaction excludes unrelated requests across callback awaits',excluded&&rows[0]?.n===2,'One transaction ID owns the connection until its callback commits.');
    try {await db.transaction(async q=>{await q.exec("insert into worker_fixture values(3,'rollback')");throw new Error('invented rollback');});} catch {/* expected */}
    const rollback=await db.one<{n:number}>('select count(*)::int n from worker_fixture');
    check('PGLITE WORKER callback failure rolls back and releases the queue',rollback?.n===2,'A subsequent outside query completes without the rolled-back row.');
    try {await db.transaction(q=>q.exec("insert into worker_fixture values(1,'duplicate')"));} catch {/* expected */}
    await db.exec("insert into worker_fixture values(4,'after SQL error')");
    check('PGLITE WORKER SQL failure releases transaction ownership',(await db.one<{n:number}>('select count(*)::int n from worker_fixture'))?.n===3,'A worker SQL exception does not strand later requests.');
    let code:string|undefined;
    try {await db.query("insert into worker_fixture values(1,'duplicate outside')");} catch(error) {code=(error as {code?:string}).code;}
    check('PGLITE WORKER database error codes survive message passing',code==='23505','Unique-constraint errors remain recognizable to callers.');
    let tooMany=false;
    try {await db.one('select generate_series(1,100000)');} catch(error) {tooMany=error instanceof TooManyRows&&error.message.endsWith('got 100000');}
    check('PGLITE WORKER bounded one retains TooManyRows identity',tooMany,'The typed refusal survives the worker message boundary without shipping all rows.');
    const shape=await db.one<{payload:{demo:boolean};keys:string[];at:Date}>('select $1::jsonb payload,$2::text[] keys,$3::timestamptz at',[JSON.stringify({demo:true}),['invented','array'],'2026-09-27T00:00:00Z']);
    check('PGLITE WORKER structured values survive message passing',shape?.payload.demo===true&&shape.keys.join(',')==='invented,array'&&shape.at instanceof Date,'JSON, arrays and Date values preserve adapter types.');
    let stale: Queryable | undefined, staleRefused = false;
    await db.transaction(async q => { stale = q; });
    await db.transaction(async q => {
      try { await stale!.exec("insert into worker_fixture values(99,'stale handle')"); }
      catch { staleRefused = true; }
      await q.exec("insert into worker_fixture values(5,'current handle')");
    });
    check('PGLITE WORKER stale transaction handle cannot enter a later transaction',
      staleRefused && (await db.one<{n:number}>('select count(*)::int n from worker_fixture where id=99'))?.n === 0,
      'A completed callback handle is refused even while a new native transaction is open.');
    let tickAt=Infinity;const start=performance.now();
    const tick=new Promise<void>(resolve=>setTimeout(()=>{tickAt=performance.now()-start;resolve();},25));
    await db.exec("do $$ declare deadline timestamptz:=clock_timestamp()+interval '0.25 seconds'; begin while clock_timestamp()<deadline loop null; end loop; end $$");await tick;
    check('PGLITE WORKER CPU-bound SQL leaves the main thread responsive',tickAt<150,`25 ms timer answered in ${tickAt.toFixed(1)} ms during 250 ms SQL; HTTP latency is guarded by scripts/responsiveness.ts.`);
  } finally {await db.close();}
  const root = await mkdtemp(join(tmpdir(), 'plcos-worker-durability-invented-'));
  let disk: Awaited<ReturnType<typeof openPglite>> | undefined;
  try {
    const dir = join(root, 'database');
    disk = await openPglite(dir);
    await disk.exec('create table durable_fixture(id integer primary key)');
    await disk.transaction(async q => {
      // Concurrent messages exercise the worker queue inside one native callback.
      await Promise.all(Array.from({ length: 100 }, (_, id) => q.query('insert into durable_fixture values ($1)', [id])));
    });
    try { await disk.transaction(async q => { await q.exec('insert into durable_fixture values (100)'); throw new Error('invented rollback'); }); }
    catch { /* expected */ }
    await disk.close();
    disk = await openPglite(dir);
    const persisted = await disk.one<{n:number;max:number}>('select count(*)::int n,max(id)::int max from durable_fixture');
    check('PGLITE WORKER commit receipt persists a complete batch and rollback across reopen',
      persisted?.n === 100 && persisted.max === 99,
      'One hundred queued inserts survive closing/reopening the invented disk fixture; the rolled-back row does not.');
    await disk.close(); disk = undefined;
    const idle = await workerChild(join(root, 'idle-child'), false);
    check('PGLITE WORKER idle handle permits natural CLI exit without close',
      idle.code === 0 && !idle.timedOut && idle.output.includes('"completed":true'),
      `Child completed its query and exited with code ${idle.code}; timeout ${idle.timedOut}.`);
    const pending = await workerChild(join(root, 'pending-child'), true);
    let pendingResult: {completed?:boolean;milliseconds?:number} = {};
    try { pendingResult = JSON.parse(pending.output.trim()); } catch { /* an early exit has no receipt */ }
    check('PGLITE WORKER in-flight query retains a CLI until its receipt',
      pending.code === 0 && !pending.timedOut && pendingResult.completed === true && (pendingResult.milliseconds ?? 0) >= 250,
      `Child's unawaited 300 ms SQL completed in ${pendingResult.milliseconds?.toFixed(1) ?? 'no receipt'} ms, then exited naturally.`);
  } finally { await disk?.close(); await rm(root, { recursive: true, force: true }); }
}

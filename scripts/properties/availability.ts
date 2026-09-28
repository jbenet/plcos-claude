import { mkdir, readFile, rm } from 'node:fs/promises';
import { fileIssueSink } from '../../lib/issues/file';
import { getDb, openFresh, withDb, type Db } from '../../lib/db';
import { bestEffortDb, cancellableDb, DbBusyError, isDbBusy, prioritizeDb, withBackgroundDb, type QueueClock } from '../../lib/db/scheduling';
import { singleFlight } from '../../lib/in-flight';
import { fileFeedback } from '../../modules/platform/service';
import type { Check } from './harness';

function fakeClock() {
  let now = 0;
  const jobs = new Set<{ at: number; run: () => void }>();
  const clock: QueueClock = {
    now: () => now,
    after: (ms, run) => { const job = { at: now + ms, run }; jobs.add(job); return () => { jobs.delete(job); }; },
  };
  return { clock, advance(ms: number, fire = true) {
    now += ms;
    if (fire) for (const job of [...jobs]) if (job.at <= now) { jobs.delete(job); job.run(); }
  } };
}

function heldDb(clock: QueueClock) {
  const calls: string[] = [];
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const raw: Db = {
    kind: 'pglite',
    async query<T>(sql: string) { calls.push(sql); if (sql === 'held') { entered(); await held; } return [] as T[]; },
    async one<T>(sql: string) { await raw.query(sql); return null as T | null; },
    async exec(sql) { await raw.query(sql); },
    transaction: fn => fn(raw),
    async close() {},
  };
  return { db: prioritizeDb(raw, clock), calls, release, started };
}

export async function availabilityProperties(check: Check) {
  {
    // A first caller owns its wait, never the process-wide boot promise.
    const global = globalThis as typeof globalThis & { __capitalOsDb?: Promise<Db>; __capitalOsMigrationCheck?: unknown };
    const prior = global.__capitalOsDb, priorCheck = global.__capitalOsMigrationCheck;
    const timer = fakeClock();
    let shared!: Promise<Db>, opened: Db | undefined;
    delete global.__capitalOsDb;
    delete global.__capitalOsMigrationCheck;
    try {
      const first = bestEffortDb(() => {
        shared = openFresh('memory://');
        return shared;
      }, 250, timer.clock);
      timer.advance(250);
      await first;
      let healthy = false;
      try {
        opened = await shared;
        await (await getDb()).query('select 1');
        healthy = true;
      } catch { /* A poisoned boot promise must fail this property, not the harness. */ }
      check('busy-stuck expired first caller cannot poison shared DB boot for later pages', healthy,
        'Expire feedback while boot is pending, then await the shared boot and query through ordinary getDb.');
      if (opened) {
        let attempts = 0;
        const db = opened;
        global.__capitalOsDb = Promise.resolve({
          ...db, kind: 'postgres',
          exec: async sql => { if (++attempts === 1) throw new DbBusyError(); await db.exec(sql); },
          // Postgres serializes the complete migration pass inside a transaction.
          transaction: fn => db.transaction(tx => fn({ ...tx,
            exec: async sql => { if (++attempts === 1) throw new DbBusyError(); await tx.exec(sql); },
          })),
        });
        delete global.__capitalOsMigrationCheck;
        await getDb();
        const afterBusy = global.__capitalOsMigrationCheck as unknown as { files: string; running: unknown };
        const notApplied = afterBusy.files === '' && afterBusy.running === null;
        await getDb();
        check('busy-stuck migration catch-up retries busy refusal without marking files applied',
          notApplied && attempts > 1 && afterBusy.files !== '',
          'The first migration bootstrap is refused as busy; ordinary getDb retries and completes the unchanged inventory.');
      }
    } finally {
      await opened?.close();
      global.__capitalOsDb = prior;
      global.__capitalOsMigrationCheck = priorCheck;
    }
  }
  {
    const timer = fakeClock(), held = heldDb(timer.clock), share = singleFlight();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const load = async () => { await gate; return held.db.query('shared-page'); };
    const first = bestEffortDb(() => share('page', load), 250, timer.clock);
    const joined = share('page', load).then(() => true, () => false);
    timer.advance(250); await first;
    release();
    check('busy-stuck a normal caller joining shared work survives its first caller expiring',
      await joined && held.calls.join('|') === 'shared-page',
      'Shared loaders never receive an implicit abort signal from their creator.');
  }
  {
    const timer = fakeClock(), held = heldDb(timer.clock);
    const errors: unknown[][] = [], originalError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      for (let i = 0; i < 2; i++) {
        const query = held.db.query(`idle-${i}`);
        timer.advance(20_001);
        await query;
      }
      check('busy-stuck idle busy guard runs queries and logs one diagnostic stack',
        held.calls.join('|') === 'idle-0|idle-1' && errors.length === 1
          && String(errors[0]?.[1]).includes('availability.ts'),
        'A timer firing before dispatch cannot refuse an idle database, and repeated recovery does not flood logs.');
    } finally { console.error = originalError; }
    const controller = new AbortController(); controller.abort();
    const cancelled = await cancellableDb(held.db, controller.signal).query('cancelled-write')
      .then(() => false, error => error.name === 'AbortError' && !isDbBusy(error));
    check('busy-stuck explicit cancellation remains cancelled even with an idle database',
      cancelled && !held.calls.includes('cancelled-write'),
      'Cancellation is distinct from capacity refusal; the idle guard must not resurrect expired writes.');
  }
  for (const fire of [true, false]) {
    const timer = fakeClock(), held = heldDb(timer.clock);
    const active = held.db.query('held'); await held.started;
    const abandoned = held.db.query('expired-page').then(() => false, error => error instanceof DbBusyError);
    const maintenance = withBackgroundDb(() => held.db.query('maintenance'));
    timer.advance(20_001, fire);
    if (fire) check('PERF3 queued foreground requests reject while the running query is still blocked',
      await abandoned && held.calls.join('|') === 'held', 'The injected clock reaches 20 seconds; no expired SQL starts.');
    held.release();
    await Promise.all([active, maintenance]);
    const rejected = await abandoned;
    await held.db.query('healthy-page');
    check(`PERF3 queue deadline (${fire ? 'refused while blocked' : 'idle recovery after delayed timer'})`,
      fire ? rejected && held.calls.join('|') === 'held|maintenance|healthy-page'
        : !rejected && held.calls.join('|') === 'held|expired-page|maintenance|healthy-page',
      'Busy work is refused; an idle queue recovers instead of manufacturing a busy response.');
  }

  {
    const timer = fakeClock(), held = heldDb(timer.clock);
    const work = bestEffortDb(async signal => {
      const q = cancellableDb(held.db, signal);
      await q.query('held');
      await q.query('late-followup');
    }, 250, timer.clock);
    await held.started;
    timer.advance(250);
    await work;
    held.release();
    await held.db.query('healthy-page');
    check('PERF3 best-effort expiry does not enqueue a follow-up after an uninterruptible active query',
      held.calls.join('|') === 'held|healthy-page',
      'Already-running SQL finishes; its explicit cancelled handle refuses later DB work.');
  }

  const scratch = 'data/demo/perf3-feedback-properties';
  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    const timer = fakeClock(), held = heldDb(timer.clock);
    const active = held.db.query('held'); await held.started;
    const issue = await withDb(held.db, () => fileFeedback({
      id: '70000000-0000-4000-8000-000000000001', handle: 'invented-reporter',
      name: 'Invented Reporter', initials: 'IR', role: 'team', email: 'invented@example.invalid',
      access: 'viewer', vehicles: [], approves: [],
    }, { title: ' Invented blocked database ', body: 'The page did not load.\n\n![First](attachment:1)\n\n![Second](attachment:2)', attachments: [
      { kind: 'screenshot', contentType: 'image/png', base64: Buffer.from('invented-screen').toString('base64') },
      { kind: 'image', contentType: 'image/png', base64: Buffer.from('invented-first').toString('base64') },
      { kind: 'image', contentType: 'image/png', base64: Buffer.from('invented-second').toString('base64') },
    ], imageOffset: 1, kind: 'bug', priority: 'P1', page: '/invented', context: {} }, { clock: timer.clock, sink: fileIssueSink(scratch) }));
    await new Promise<void>(resolve => setImmediate(resolve));
    const file = await readFile(issue.location, 'utf8');
    check('PERF3 feedback writes a resolved reporter while metadata is queued',
      file.includes('The page did not load.') && file.includes('reporter: invented-reporter')
        && file.includes('verified') && !file.includes('unverified') && held.calls.join('|') === 'held',
      'The actual fileFeedback service files to a scratch directory with its resolved actor without waiting for a database receipt.');
    const attached = await Promise.all(issue.attachments.map(path => readFile(`${scratch}/${path}`, 'utf8')));
    check('0064 all attachments and body references are durable before the blocked database responds',
      attached.join('|') === 'invented-screen|invented-first|invented-second'
        && file.includes('![First](attachments/0001-image-1.png)')
        && file.includes('![Second](attachments/0001-image-2.png)'),
      'The screenshot and both embedded files are written with the file-first receipt.');
    timer.advance(250);
    held.release(); await active;
    await held.db.query('healthy-page');
    check('PERF3 feedback metadata times out and its queued write never runs later',
      held.calls.join('|') === 'held|healthy-page' && (await readFile(issue.location, 'utf8')) === file,
      'The file remains the receipt; no ghost metadata write starts when the database becomes free.');
    check('0064 attachment bytes survive abandoned metadata work',
      (await Promise.all(issue.attachments.map(path => readFile(`${scratch}/${path}`, 'utf8')))).join('|') === attached.join('|'),
      'Database timeout leaves every attachment unchanged.');
    const failed = await withDb(held.db, () => fileFeedback(null, {
      title: 'Invented failed metadata', body: '![Retained](attachment:1)', kind: 'bug', priority: 'P2', page: '/invented', context: {},
      attachments: [{ kind: 'image', contentType: 'image/png', base64: Buffer.from('invented-retained').toString('base64') }],
    }, { sink: fileIssueSink(scratch) }));
    check('0064 unresolvable reporter still returns a complete file receipt with attachments',
      (await readFile(failed.location, 'utf8')).includes('![Retained](attachments/0002-image-1.png)')
        && await readFile(`${scratch}/${failed.attachments[0]}`, 'utf8') === 'invented-retained',
      'No active reporter still retains the issue and attachments without inventing an audit actor.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

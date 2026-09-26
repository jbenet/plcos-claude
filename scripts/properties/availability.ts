import { mkdir, readFile, rm } from 'node:fs/promises';
import { fileIssueSink } from '../../lib/issues/file';
import { withDb, type Db } from '../../lib/db';
import { bestEffortDb, DbBusyError, prioritizeDb, withBackgroundDb, type QueueClock } from '../../lib/db/scheduling';
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
    check(`PERF3 expired queries never run (${fire ? 'timer fired' : 'timer delayed by busy event loop'})`,
      rejected && held.calls.join('|') === 'held|maintenance|healthy-page',
      'Dispatch checks age before execution too; maintenance remains eligible and the queue recovers.');
  }

  {
    const timer = fakeClock(), held = heldDb(timer.clock);
    const work = bestEffortDb(async () => {
      await held.db.query('held');
      await held.db.query('late-followup');
    }, 250, timer.clock);
    await held.started;
    timer.advance(250);
    await work;
    held.release();
    await held.db.query('healthy-page');
    check('PERF3 best-effort expiry does not enqueue a follow-up after an uninterruptible active query',
      held.calls.join('|') === 'held|healthy-page',
      'Already-running SQL finishes; its cancelled async context refuses later DB work.');
  }

  const scratch = 'data/demo/perf3-feedback-properties';
  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    const timer = fakeClock(), held = heldDb(timer.clock);
    const active = held.db.query('held'); await held.started;
    let lookupStarted!: () => void;
    const lookup = new Promise<void>(resolve => { lookupStarted = resolve; });
    const issue = await withDb(held.db, () => fileFeedback({
      handle: 'invented-reporter',
      resolveUser: async () => {
        lookupStarted();
        await held.db.query('reporter-lookup');
        throw new Error('Invented missing reporter');
      },
    }, { title: ' Invented blocked database ', body: 'The page did not load.', kind: 'bug', priority: 'P1', page: '/invented', context: {} }, { clock: timer.clock, sink: fileIssueSink(scratch) }));
    await lookup;
    const file = await readFile(issue.location, 'utf8');
    check('PERF3 feedback writes its file and returns while reporter lookup is queued',
      file.includes('The page did not load.') && file.includes('invented-reporter (unverified)')
        && file.includes('unverified local cookie') && held.calls.join('|') === 'held',
      'The actual fileFeedback service files to a scratch directory without waiting for authentication or a database receipt.');
    timer.advance(250);
    held.release(); await active;
    await held.db.query('healthy-page');
    check('PERF3 feedback metadata times out and its queued lookup never runs later',
      held.calls.join('|') === 'held|healthy-page' && (await readFile(issue.location, 'utf8')) === file,
      'The file remains the receipt; no ghost lookup or metadata write starts when the database becomes free.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

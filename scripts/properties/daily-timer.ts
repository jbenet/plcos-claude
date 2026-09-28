import { runDailyJobs, startDailyTimer } from '../../lib/daily-timer';
import { createImportJob, executeImportJob } from '../../lib/import-jobs/store';
import type { queueImportJob } from '../../lib/import-jobs/server';
import type { ImportJob } from '../../lib/import-jobs/types';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import type { Check } from './harness';

export async function dailyTimerProperties(check: Check) {
  const db = await openTestDb();
  const backup = process.env.BACKUP_COMMAND, schedule = process.env.SCHEDULE_DAILY_AT;
  try {
    await migrate(db);
    const seen: string[] = [];
    let fail = false;
    const queue: typeof queueImportJob = async (db, kind, actor, input) => {
      seen.push(kind);
      if (kind === 'affinity' && (input?.operation !== 'slice' || !input.options)) throw new Error('Wrong slice input');
      const job = await createImportJob(db, kind, actor, input);
      await executeImportJob(db, job.id, async () => {
        if (fail) throw new Error('Invented failure');
        return {};
      });
      return (await db.one<ImportJob>('select * from platform.import_job where id=$1', [job.id]))!;
    };
    // A nonzero backup proves it was invoked after all three successful receipts.
    process.env.BACKUP_COMMAND = 'exit 23';
    const today = new Date(); today.setUTCHours(3, 0, 0, 0);
    let backupRan = false;
    try { await runDailyJobs(db, '03:00', today, queue); }
    catch (error) { backupRan = (error as { code?: number }).code === 23; }
    await runDailyJobs(db, '03:00', today, queue);
    check('DAILY ordered imports precede backup; persisted date prevents replay',
      backupRan && seen.join() === 'affinity,linear,spv-stance',
      'Invented receipts use the existing queue store; a second invocation skips even after backup failure.');

    await db.query("delete from platform.import_job where input->>'schedule'='daily'");
    seen.length = 0;
    delete process.env.SCHEDULE_DAILY_AT;
    startDailyTimer();
    const disabled = !(globalThis as typeof globalThis & { __dailyTimer?: unknown }).__dailyTimer;
    await runDailyJobs(db, '03:01', today, queue);
    const before = seen.length === 0;
    fail = true;
    let stopped = false;
    try { await runDailyJobs(db, '03:00', today, queue); } catch { stopped = true; }
    await runDailyJobs(db, '03:00', today, queue);
    check('DAILY unset is inert, UTC deadline gates work, failure stops the sequence',
      disabled && before && stopped && seen.join() === 'affinity',
      'No timer when unset, no early jobs, and no Linear, stance, backup or same-day retry after a failed receipt.');
  } finally {
    if (backup === undefined) delete process.env.BACKUP_COMMAND; else process.env.BACKUP_COMMAND = backup;
    if (schedule === undefined) delete process.env.SCHEDULE_DAILY_AT; else process.env.SCHEDULE_DAILY_AT = schedule;
    await db.close();
  }
}

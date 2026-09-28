import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '@/config/deployment';
import { getDb, type Db } from '@/lib/db';
import { withImportLock } from '@/lib/db/advisory';
import { queueImportJob, importJobStatus } from '@/lib/import-jobs/server';
import type { ImportJob } from '@/lib/import-jobs/types';

const g = globalThis as typeof globalThis & { __dailyTimer?: NodeJS.Timeout };

export async function runDailyJobs(db: Db, at: string, now = new Date(), queue = queueImportJob,
  lockLost = () => false): Promise<void> {
  if (now.toISOString().slice(11, 16) < at) return;
  const last = await db.one<{ created_at: Date }>(`select created_at from platform.import_job
    where input->>'schedule'='daily' order by created_at desc limit 1`);
  if (last && new Date(last.created_at).toISOString().slice(0, 10) >= now.toISOString().slice(0, 10)) return;
  const actor = await db.one<{ id: string }>("select id from platform.app_user where handle='reconciliation'");
  if (!actor) throw new Error('Missing system actor.');
  for (const kind of ['affinity', 'linear', 'spv-stance'] as const) {
    if (lockLost()) throw new Error('Daily lock lost.');
    let job = await queue(db, kind, actor.id, {
      schedule: 'daily', ...(kind === 'affinity' ? { operation: 'slice', options: {} } : {}),
    });
    while (job.status === 'queued' || job.status === 'running') {
      await delay(1000); // GUESS: one-second completion polling keeps this small queue responsive.
      if (lockLost()) throw new Error('Daily lock lost.');
      await importJobStatus(db);
      job = (await db.one<ImportJob>('select * from platform.import_job where id=$1', [job.id]))!;
    }
    if (job.status !== 'completed') throw new Error('Daily import failed.');
  }
  if (lockLost()) throw new Error('Daily lock lost.');
  if (process.env.BACKUP_COMMAND) await promisify(exec)(process.env.BACKUP_COMMAND);
}

export function startDailyTimer(): void {
  const at = process.env.SCHEDULE_DAILY_AT;
  if (!at || g.__dailyTimer) return;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error('SCHEDULE_DAILY_AT must be HH:MM UTC.');
  const tick = async () => {
    try {
      const db = await getDb();
      if (db.kind === 'postgres') {
        let lost = false;
        await withImportLock(config.db.url!, 'daily-timer',
          () => runDailyJobs(db, at, new Date(), queueImportJob, () => lost), () => { lost = true; });
      } else await runDailyJobs(db, at); // PGlite already has a single process owner.
    } catch { console.error('[daily] Run stopped; review import jobs and backup configuration.'); }
    finally { g.__dailyTimer = setTimeout(tick, 60_000); g.__dailyTimer.unref(); }
  };
  // Check on startup too: a restart after the UTC deadline catches up, at most once that day.
  g.__dailyTimer = setTimeout(tick, 0);
  g.__dailyTimer.unref();
}

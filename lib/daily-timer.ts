import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '@/config/deployment';
import { getDb, type Db } from '@/lib/db';
import { withImportLock } from '@/lib/db/advisory';
import { holdImports, queueImportJob, importJobStatus } from '@/lib/import-jobs/server';
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
  // The calendar after Affinity, so a meeting Affinity already has stays Affinity's (lib/calendar-sync.ts).
  // The slice only lands Affinity's records; translate maps them onto LPs (last email, statuses), so a read that is
  // never translated changes nothing anyone sees (13 Oct 2026: LP pages showed no Affinity email after 8 Oct).
  const steps = [['affinity', 'slice'], ['affinity', 'translate'], ['linear'], ['spv-stance'], ['calendar']] as const;
  // The whole chain counts as importing, so /api/health shows no gap between two steps (8 Oct 2026).
  const release = holdImports();
  try {
    for (const [kind, operation] of steps) {
      if (lockLost()) throw new Error('Daily lock lost.');
      let job = await queue(db, kind, actor.id, {
        schedule: 'daily', ...(operation ? { operation, options: {} } : {}),
      });
      while (job.status === 'queued' || job.status === 'running') {
        await delay(1000); // GUESS: one-second completion polling keeps this small queue responsive.
        if (lockLost()) throw new Error('Daily lock lost.');
        await importJobStatus(db);
        job = (await db.one<ImportJob>('select * from platform.import_job where id=$1', [job.id]))!;
      }
      if (job.status !== 'completed') throw new Error('Daily import failed.');
    }
  } finally { release(); }
  if (lockLost()) throw new Error('Daily lock lost.');
  if (process.env.BACKUP_COMMAND) await promisify(exec)(process.env.BACKUP_COMMAND);
}

/**
 * When the daily jobs run, HH:MM UTC, or null for never. SCHEDULE_DAILY_AT wins ("off" turns it off). A Railway server
 * runs at 03:00 without it: the variable was never set there, so from 9 to 13 Oct 2026 nothing read Affinity, Linear
 * or the calendars on a schedule, and nobody noticed. A Mac or demo server stays off unless it is set.
 */
export function dailyAt(env: Record<string, string | undefined> = process.env): string | null {
  const set = env.SCHEDULE_DAILY_AT?.trim();
  if (set) return set.toLowerCase() === 'off' ? null : set;
  return env.RAILWAY_ENVIRONMENT_ID?.trim() || env.RAILWAY_PROJECT_ID?.trim() ? '03:00' : null;
}

export function startDailyTimer(): void {
  const at = dailyAt();
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

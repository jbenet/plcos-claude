import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@/lib/db';

/**
 * The research export the Astra runner cuts its batches from (enrich-batch.ts reads these from the Mac's
 * plcos-data/real/enrich). 14 Oct 2026: Astra idled all night with every plan step at "Nobody is left", because the
 * Mac's copy dated from 8 Oct, so no LP added since (prospects, calendar) ever reached it, and no path brought the
 * server's export down (a files snapshot leaves the exports out). The runner now fetches these once a night.
 */
export const RESEARCH_FILES = ['research-set.jsonl', 'candidates.jsonl', 'entity-keys.json', 'vehicles.json', 'team.json'] as const;
/** An export older than this is redone before it is handed out (guessed: one per night window is enough). */
export const RESEARCH_FRESH_MS = 12 * 3600_000;

export type ResearchAnswer =
  | { pending: true; job: string; reason: string }
  | { pending: false; exportedAt: string; files: Record<string, { text: string; sha256: string }> };

/**
 * The server's research export, or a pending answer while a fresh one is built: an export older than
 * RESEARCH_FRESH_MS (or none) queues one as `actor`, and an export that is queued or running is waited for.
 */
export async function researchExport(db: Db, actor: string, o: { dir: string; now?: number; queue?: (db: Db, actor: string) => Promise<{ id: string }> }): Promise<ResearchAnswer> {
  const active = await db.one<{ id: string }>(`select id::text from platform.import_job where kind = 'export' and status in ('queued','running') limit 1`);
  if (active) return { pending: true, job: active.id, reason: 'An export is being built.' };
  const at = await stat(join(o.dir, 'candidates.jsonl')).then((s) => s.mtimeMs).catch(() => null);
  if (at === null || (o.now ?? Date.now()) - at > RESEARCH_FRESH_MS) {
    const queue = o.queue ?? (async (d: Db, a: string) => (await import('@/lib/import-jobs/server')).queueImportJob(d, 'export', a));
    const job = await queue(db, actor);
    return { pending: true, job: job.id, reason: at === null ? 'No export on file yet.' : 'The export was stale; a new one is being built.' };
  }
  const files: Record<string, { text: string; sha256: string }> = {};
  for (const name of RESEARCH_FILES) {
    const text = await readFile(join(o.dir, name), 'utf8').catch(() => null);
    if (text !== null) files[name] = { text, sha256: createHash('sha256').update(text).digest('hex') };
  }
  return { pending: false, exportedAt: new Date(at).toISOString(), files };
}

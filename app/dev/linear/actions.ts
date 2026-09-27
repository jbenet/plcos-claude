'use server';

import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { queueImportJob } from '@/lib/import-jobs/server';
import { linearSource } from '@/lib/connectors/linear/sync';

/**
 * Sync Linear (docs/24-linear.md): a person's click queues the `linear` import job. Read-only: the
 * job sends queries and writes only our own replica. On the real data only the live server, which
 * holds the key, may run it; the demo reads an invented workspace.
 */
export async function syncLinearAction(_prev: { error?: string; message?: string }, form: FormData): Promise<{ error?: string; message?: string }> {
  const src = linearSource();
  if ('refused' in src) return { error: src.refused };
  const full = form.get('full') === '1';
  try {
    const user = await (await auth()).currentUser();
    await queueImportJob(await getDb(), 'linear', user.id, full ? { full: true } : {});
    return { message: full ? 'Full sync queued: every record is read again. Progress appears above.' : 'Sync queued. Progress appears above; reload for the counts.' };
  } catch {
    return { error: 'The sync could not be queued. Retry after the active sync finishes.' };
  }
}

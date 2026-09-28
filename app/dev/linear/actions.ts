'use server';

import { requireServerActionMutation } from '@/lib/mutation-guard';

import { getDb } from '@/lib/db';
import { queueImportJob } from '@/lib/import-jobs/server';
import { config } from '@/config/deployment';
import { linearLiveServer, linearSource } from '@/lib/connectors/linear/sync';

/**
 * Sync Linear (docs/24-linear.md): a person's click queues the `linear` import job. Read-only: the
 * job sends queries and writes only our own replica. On the real data only the live server, which
 * holds the key, may run it; the demo reads an invented workspace.
 */
export async function syncLinearAction(_prev: { error?: string; message?: string }, form: FormData): Promise<{ error?: string; message?: string }> {
  const user = await requireServerActionMutation();
  const src = linearSource();
  if ('refused' in src) return { error: src.refused };
  const full = form.get('full') === '1';
  try {
    await queueImportJob(await getDb(), 'linear', user.id, full ? { full: true } : {});
    return { message: full ? 'Full sync queued: every allowed-team record is read again. Progress appears above.' : 'Sync queued. Progress appears above; reload for the counts.' };
  } catch {
    return { error: 'The sync could not be queued. Retry after the active sync finishes.' };
  }
}

/** Rebuild uses the existing local replica. It never needs a connector key or API request. */
export async function rebuildLinearAction(_prev: { error?: string; message?: string }, _form: FormData): Promise<{ error?: string; message?: string }> {
  if (config.data.profile !== 'demo' && !linearLiveServer()) return { error: 'Purge and re-map Linear from Developer → Linear on the live server.' };
  try {
    const user = await (await auth()).currentUser();
    await queueImportJob(await getDb(), 'linear-rebuild', user.id);
    return { message: 'Purge and re-map queued. Progress appears above; reload for the allowed-team counts.' };
  } catch {
    return { error: 'The rebuild could not be queued. Retry after the active Linear job finishes.' };
  }
}

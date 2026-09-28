'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { queueImportJob } from '@/lib/import-jobs/server';
import { config } from '@/config/deployment';
import { linearLiveServer, linearSource } from '@/lib/connectors/linear/sync';
import { decideLink } from '@/modules/linear';

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

/**
 * Link a vehicle to Linear projects, turn a suggestion down, or remove a link (docs/24-linear.md
 * §4). A person's click, stored once per pair (a double click changes nothing) and audited. Only
 * our database is written; Linear never is.
 */
export async function linkProjectsAction(_prev: { error?: string; message?: string }, form: FormData): Promise<{ error?: string; message?: string }> {
  const decision = String(form.get('decision') ?? '');
  if (decision !== 'accept' && decision !== 'reject' && decision !== 'remove') return { error: 'Unknown choice.' };
  const vehicleId = String(form.get('vehicle') ?? '');
  const projectIds = form.getAll('project').map(String).filter(Boolean);
  if (!vehicleId || projectIds.length === 0) return { error: 'Pick a project first.' };
  try {
    const user = await (await auth()).currentUser();
    const changed = await decideLink(user.id, {
      vehicleId, projectIds, decision,
      source: form.get('source') === 'name' ? 'name' : 'person',
      basis: form.get('basis') ? String(form.get('basis')) : null,
    });
    revalidatePath('/dev/linear');
    revalidatePath('/overview');
    const word = decision === 'accept' ? 'Linked' : decision === 'reject' ? 'Turned down' : 'Removed';
    return { message: changed ? `${word}: ${changed} project${changed === 1 ? '' : 's'}.` : 'Already recorded; nothing changed.' };
  } catch {
    return { error: 'The link was not saved. Reload and try again.' };
  }
}

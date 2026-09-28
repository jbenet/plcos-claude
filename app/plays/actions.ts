'use server';

import { requireServerActionMutation } from '@/lib/mutation-guard';

import { revalidatePath } from 'next/cache';
import { assignPlay, commit } from '@/modules/plays';

/**
 * Assigning and committing.
 *
 * Neither is gated by an approval ticket: putting work on somebody's plate is not one of
 * the five gated families. What the work *leads to* may well be, which is why every play
 * carries the ticket kind it will need and the board shows it on the row.
 */
export async function assign(playId: string, assigneeId: string, path: string): Promise<void> {
  const user = await requireServerActionMutation();
  await assignPlay(playId, assigneeId, user.id);
  revalidatePath(path);
}

export async function propose(
  vehicleId: string, entityId: string | null, body: string, path: string,
): Promise<void> {
  if (!body.trim()) return;
  const user = await requireServerActionMutation();
  await commit(vehicleId, entityId, body, user.id);
  revalidatePath(path);
}

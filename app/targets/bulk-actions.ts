'use server';
import { requireAction } from '@/lib/authz/server';

import { vehicleSelection } from '@/lib/session';
import { applyBulk, undoBulk, type BulkInput, type BulkPlace } from '@/lib/pipeline-bulk';
/**
 * No revalidatePath here (performance pass, 8 Oct 2026): in a server action it makes Next rebuild the
 * whole current page into the action's answer, so a move waited for the full list (seconds on the
 * live data) and then the page's own refresh rebuilt it again. The callers update the list at once
 * and refresh it themselves (components/strategy/MoveToSelected.tsx, BulkLpActions.tsx); the pages
 * are dynamic, so every other page reads the change when it is next opened.
 */
export async function bulkLpAction(input: BulkInput) {
  const authorizedUser = await requireAction('app/targets/bulk-actions.ts#bulkLpAction', input);
  try {
    const user = authorizedUser;
    const selection = await vehicleSelection();
    const result = await applyBulk(user.id, input, selection.current?.id ?? null);
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'The action could not be recorded.' };
  }
}

/** Put back the statuses one bulkLpAction request changed (issue 0104), through the same audited path. */
export async function undoBulkLpAction(input: { of: string; place?: BulkPlace }) {
  const authorizedUser = await requireAction('app/targets/bulk-actions.ts#undoBulkLpAction', input);
  try {
    const user = authorizedUser;
    const selection = await vehicleSelection();
    const result = await undoBulk(user.id, input, selection.current?.id ?? null);
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'The undo could not be recorded.' };
  }
}

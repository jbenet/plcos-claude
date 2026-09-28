'use server';

import { requireServerActionMutation } from '@/lib/mutation-guard';
import { revalidatePath } from 'next/cache';
import { vehicleSelection } from '@/lib/session';
import { applyBulk, undoBulk, type BulkInput, type BulkPlace } from '@/lib/pipeline-bulk';
export async function bulkLpAction(input: BulkInput) {
  try {
    const user = await requireServerActionMutation();
    const selection = await vehicleSelection();
    const result = await applyBulk(user.id, input, selection.current?.id ?? null);
    revalidatePath('/targets'); revalidatePath('/selection'); revalidatePath('/approvals');
    for (const row of input.rows) revalidatePath(`/targets/${row.id}`);
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'The action could not be recorded.' };
  }
}

/** Put back the statuses one bulkLpAction request changed (issue 0104), through the same audited path. */
export async function undoBulkLpAction(input: { of: string; place?: BulkPlace }) {
  try {
    const user = await requireServerActionMutation();
    const selection = await vehicleSelection();
    const result = await undoBulk(user.id, input, selection.current?.id ?? null);
    revalidatePath('/targets'); revalidatePath('/selection'); revalidatePath('/approvals');
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'The undo could not be recorded.' };
  }
}

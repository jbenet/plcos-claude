'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { setSpvStance, SpvRefused, withdrawSpvStance, type SpvStance } from '@/modules/strategy';

/**
 * A person's SPV stance for an LP (Juan, 27 Sep 2026): does SPVs (with an optional count), doesn't, or
 * unknown, with an optional note. It wins over research and derived signals, is audited, and is
 * reversible: withdrawing it returns the LP to what the evidence says. Waits for the server.
 */
export async function setSpvStanceAction(entityId: string, input: { stance: SpvStance; minDeals: number | null; note: string }): Promise<{ error?: string }> {
  if (typeof entityId !== 'string' || !input || !['does', 'does-not', 'unknown'].includes(input.stance)) return { error: 'That choice is not one this page offers.' };
  try {
    const user = await (await auth()).currentUser();
    await setSpvStance(await getDb(), entityId, user.id, { stance: input.stance, minDeals: input.minDeals, note: String(input.note ?? '') });
    refresh();
    return {};
  } catch (error) {
    return { error: error instanceof SpvRefused ? error.message : 'Not saved. Reload and try again.' };
  }
}

export async function withdrawSpvStanceAction(entityId: string): Promise<{ error?: string; none?: boolean }> {
  if (typeof entityId !== 'string') return { error: 'Not an LP on record.' };
  try {
    const user = await (await auth()).currentUser();
    const done = await withdrawSpvStance(await getDb(), entityId, user.id);
    refresh();
    return done ? {} : { none: true };
  } catch {
    return { error: 'Not withdrawn. Reload and try again.' };
  }
}

function refresh() {
  revalidatePath('/targets', 'layout');
  revalidatePath('/selection');
  revalidatePath('/[vehicle]/fit', 'page');
  revalidatePath('/[vehicle]/strategy', 'layout');
}

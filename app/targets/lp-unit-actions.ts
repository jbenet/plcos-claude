'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { decideLpUnitByPerson } from '@/modules/strategy';

/**
 * A person's answer to "who is the LP?" for one person's pursuit (issues 0111, 0112; docs/23): they
 * invest here personally, or the pursuit is their firm's and they are its contact. Waits for the
 * server; journalled, reversible from Developer → Enrich, and never overridden by the rule.
 */
export async function decideLpUnitAction(pursuitId: string, choice: { kind: 'personal' } | { kind: 'firm'; orgId: string }):
  Promise<{ error?: string; to?: string }> {
  if (typeof pursuitId !== 'string' || !choice || (choice.kind !== 'personal' && !(choice.kind === 'firm' && typeof choice.orgId === 'string'))) {
    return { error: 'That choice is not one this page offers.' };
  }
  try {
    const user = await (await auth()).currentUser();
    const row = await decideLpUnitByPerson(await getDb(), pursuitId, user.id, choice);
    revalidatePath('/targets', 'layout');
    revalidatePath('/selection');
    return { to: row.decision === 'moved' ? row.orgPursuitId ?? undefined : undefined };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Not saved. Reload and try again.' };
  }
}

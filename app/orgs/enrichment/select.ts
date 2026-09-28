'use server';

import { requireServerActionMutation } from '@/lib/mutation-guard';

import { revalidatePath } from 'next/cache';
import { selectMethod } from '@/modules/research';

/** Choosing a method is a decision, so it carries a name and survives a reload. */
export async function choose(methodId: string, on: boolean): Promise<void> {
  const user = await requireServerActionMutation();
  await selectMethod(methodId, on, user.id);
  revalidatePath('/orgs/enrichment');
}

'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { selectMethod } from '@/modules/research';

/** Choosing a method is a decision, so it carries a name and survives a reload. */
export async function choose(methodId: string, on: boolean): Promise<void> {
  const user = await (await auth()).currentUser();
  await selectMethod(methodId, on, user.id);
  revalidatePath('/orgs/enrichment');
}

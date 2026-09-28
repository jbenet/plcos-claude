'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';
import { selectMethod } from '@/modules/research';

/** Choosing a method is a decision, so it carries a name and survives a reload. */
export async function choose(methodId: string, on: boolean): Promise<void> {
  const authorizedUser = await requireAction('app/orgs/enrichment/select.ts#choose', methodId, on);
  const user = authorizedUser;
  await selectMethod(methodId, on, user.id);
  revalidatePath('/orgs/enrichment');
}

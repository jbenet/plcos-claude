'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { testConnection } from '@/lib/connectors/affinity';

/** Two GET requests. The page re-renders with what Affinity said, or why it could not ask. */
export async function runConnectionTest(): Promise<void> {
  const user = await (await auth()).currentUser();
  await testConnection(user.id);
  revalidatePath('/dev/affinity');
  revalidatePath('/dev/connectors');
}

/** One request per list, plus a few: lists, their fields, the account's users. No entries. */
export async function runDiscovery(): Promise<void> {
  const { discoverLists } = await import('@/lib/connectors/affinity/discover');
  const user = await (await auth()).currentUser();
  await discoverLists(user.id);
  revalidatePath('/dev/affinity');
  revalidatePath('/dev/affinity/lists');
}

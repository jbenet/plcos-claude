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

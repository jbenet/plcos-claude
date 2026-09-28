'use server';

import { requireServerActionMutation } from '@/lib/mutation-guard';

import { revalidatePath } from 'next/cache';
import { liveMetrics, pinDay } from '@/modules/standup';

/**
 * Freeze today's numbers into the day.
 *
 * Not a gated command: pinning records what the numbers were, it does not send, promise or
 * move anything. It is also one-way — `pinDay` only writes where `captured_at is null`, so
 * a second press cannot quietly rewrite what the team met on.
 */
export async function pinToday(day: string): Promise<void> {
  const user = await requireServerActionMutation();
  await pinDay(day, user.id, await liveMetrics());
  revalidatePath(`/standup/${day}`);
}

'use server';
import { requireAction } from '@/lib/authz/server';
import { revalidatePath } from 'next/cache';

/**
 * Preferences → Calendars (issue 0021): your own calendars' private addresses, for the Calendar page's Travel and
 * Events lanes. Read only: nothing is ever written to a calendar. An address is kept encrypted, and never shown
 * back except masked.
 */

export type FeedResult = { ok: boolean; message: string };

export async function addCalendarFeedAction(formData: FormData): Promise<FeedResult> {
  const user = await requireAction('app/settings/calendar-actions.ts#addCalendarFeedAction', formData);
  const { addFeed, FeedRefused } = await import('@/lib/calendar-feeds');
  try {
    await addFeed(user.id, String(formData.get('lane')) as 'travel', String(formData.get('address') ?? ''));
  } catch (e) {
    if (e instanceof FeedRefused) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath('/settings');
  return { ok: true, message: 'Added. The Calendar page reads it the next time it opens.' };
}

export async function removeCalendarFeedAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/settings/calendar-actions.ts#removeCalendarFeedAction', formData);
  const { removeFeed, FeedRefused } = await import('@/lib/calendar-feeds');
  try { await removeFeed(user.id, Number(formData.get('index'))); } catch (e) { if (!(e instanceof FeedRefused)) throw e; }
  revalidatePath('/settings');
}

'use server';
import { requireAction } from '@/lib/authz/server';
import { revalidatePath } from 'next/cache';

/**
 * The team's calendars on the Calendar page (issue 0021): your own pasted addresses and colour picks in Preferences,
 * and what an entry is, clicked on the Calendar page. Read only: nothing is ever written to a calendar. An address
 * is kept encrypted, and never shown back except masked.
 */

export type FeedResult = { ok: boolean; message: string };

export async function addCalendarFeedAction(formData: FormData): Promise<FeedResult> {
  const user = await requireAction('app/settings/calendar-actions.ts#addCalendarFeedAction', formData);
  const { addFeed, FeedRefused } = await import('@/lib/calendar-feeds');
  try {
    await addFeed(user.id, String(formData.get('address') ?? ''));
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

/** Your Google event colour for Travel and for Events, or none. */
export async function setCalendarColoursAction(formData: FormData): Promise<FeedResult> {
  const user = await requireAction('app/settings/calendar-actions.ts#setCalendarColoursAction', formData);
  const { setColours, FeedRefused } = await import('@/lib/calendar-feeds');
  try {
    await setColours(user.id, { travel: String(formData.get('travel') ?? 'none'), events: String(formData.get('events') ?? 'none') });
  } catch (e) {
    if (e instanceof FeedRefused) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath('/settings');
  return { ok: true, message: 'Saved. The Calendar page sorts by it the next time it opens.' };
}

/** Say what a calendar entry is. Remembered for every occurrence of it; clicking again changes it. */
export async function relabelCalendarEntryAction(formData: FormData): Promise<FeedResult> {
  const user = await requireAction('app/settings/calendar-actions.ts#relabelCalendarEntryAction', formData);
  const { relabelEntry, FeedRefused } = await import('@/lib/calendar-feeds');
  try {
    await relabelEntry(user.id, String(formData.get('key') ?? ''), String(formData.get('label') ?? '') as 'travel');
  } catch (e) {
    if (e instanceof FeedRefused) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath('/[vehicle]/calendar', 'page');
  return { ok: true, message: 'Relabelled.' };
}

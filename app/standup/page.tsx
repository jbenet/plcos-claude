import { redirect } from 'next/navigation';
import { latestDay } from '@/modules/standup';

/** Straight to the most recent day anybody has opened. */
export default async function StandupToday() {
  const day = await latestDay();
  redirect(day ? `/standup/${day}` : '/today');
}

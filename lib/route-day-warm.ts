/**
 * Warm the route cache when the day changes (7 Oct 2026, JuanMail: the Intros call took 15 s and inspected 62 of 2,860
 * LPs). A cached route search is keyed to the day, since warmth ages with time (modules/network/cache.ts revisionFor),
 * so every search goes cold at midnight and stays cold until someone asks for it, or until a network build warms them
 * all. Planning a target cold costs about three times a cached one (scripts/connectors-perf.ts: 15 LPs a second against
 * 45 on invented data), and top_connectors plans every open LP on a vehicle. Here the server notices the new day and
 * runs the same warm-up a build runs, in the background, before the desk's first call of the day.
 *
 * Not at start: a deploy does not change the day, and the cached searches in the database stay valid across it. Best
 * effort and in-process, like the warm-up itself; a miss still plans on demand. ROUTE_WARM=0 turns it off.
 */
import { getDb } from '@/lib/db';
import { startRouteWarmup } from '@/modules/network';

// GUESS — how often to look at the date: one tiny query; a cold quarter hour after midnight is acceptable.
export const ROUTE_DAY_POLL_MS = 10 * 60_000;
const g = globalThis as typeof globalThis & { __routeDayWarm?: NodeJS.Timeout };

/** Warm when the database's date differs from the one last seen; the first look only records it. */
export function dayDecision(lastSeen: string | null, today: string): 'warm' | 'record' | 'wait' {
  return lastSeen === null ? 'record' : lastSeen === today ? 'wait' : 'warm';
}

export function startRouteDayWarm(): void {
  if (process.env.ROUTE_WARM === '0' || g.__routeDayWarm) return;
  let seen: string | null = null;
  const look = async () => {
    const db = await getDb();
    const today = (await db.one<{ day: string }>('select current_date::text as day'))!.day;
    const decision = dayDecision(seen, today);
    seen = today;
    if (decision === 'warm') {
      console.log('[routes] A new day: warming the route cache.');
      startRouteWarmup(db);
    }
  };
  void look().catch(() => undefined);
  g.__routeDayWarm = setInterval(() => { void look().catch(() => console.error('[routes] Could not check the day for the route warm-up.')); }, ROUTE_DAY_POLL_MS);
  g.__routeDayWarm.unref();
}

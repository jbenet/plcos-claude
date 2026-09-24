import { cookies, headers } from 'next/headers';
import { currentUser } from '@/lib/auth';
import { listVehicles, type Vehicle } from '@/modules/platform';
import { config } from '@/config/deployment';

export const VEHICLE_COOKIE = `${config.data.cookiePrefix}vehicle`;

export interface VehicleSelection {
  /** null means "all vehicles" — a real choice, not an absence. */
  current: Vehicle | null;
  all: Vehicle[];
}

/**
 * The cookie holds a map of handle → slug, not a single slug (issue 0002).
 *
 * One cookie for everybody meant switching to Mara, changing vehicle, switching back to
 * Juan and finding Juan looking at Mara's choice. Harmless with one person on one laptop
 * and exactly the kind of thing that silently changes what a shared screen is showing.
 *
 * It is still a cookie, so it is still per browser — what it is not any more is per browser
 * *and* shared between the people using it. Real per-user state waits for real auth.
 */
export function parseSelections(raw: string | undefined, fallbackHandle: string): Record<string, string> {
  if (!raw) return {};
  if (raw.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  // A cookie written before this change: one bare slug. Treat it as the current user's.
  return { [fallbackHandle]: raw };
}

export async function vehicleSelection(): Promise<VehicleSelection> {
  const all = await listVehicles();
  // The vehicle in the address wins (N65, issue 0009): the proxy passes it for /<vehicle>/<module>,
  // so a link someone sends means the same thing on their screen as on yours.
  const fromPath = (await headers()).get('x-vehicle');
  if (fromPath) {
    if (fromPath === 'all') return { current: null, all };
    const v = all.find((x) => x.slug === fromPath);
    if (v) return { current: v, all };
  }
  const user = await currentUser();
  const map = parseSelections((await cookies()).get(VEHICLE_COOKIE)?.value, user.handle);
  const slug = map[user.handle];
  if (!slug || slug === 'all') return { current: null, all };
  return { current: all.find((v) => v.slug === slug) ?? null, all };
}

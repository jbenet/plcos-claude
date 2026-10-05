import type { Queryable } from '@/lib/db';
import { getUserByHandle, listUsers, type AppUser } from '@/modules/platform';

/** Resolve the local selector against active app_user rows, exactly as the app's user switcher does.
 * A cookie is only a selector, never a reporter identity. Lookup failures propagate so callers can retry.
 */
export async function resolveLocalUser(handle: string | null | undefined, q?: Queryable): Promise<AppUser | null> {
  // Behind Google sign-in the journal carries the signed session's user id and epoch (lib/auth/reporter.ts):
  // that person if still active and not signed out everywhere since, and nobody else — never the roster's
  // first user.
  if (handle?.startsWith('uid:')) {
    const [, id, epoch] = handle.split(':');
    const { sessionUser } = await import('@/modules/platform');
    const found = id && epoch && /^\d+$/.test(epoch) ? await sessionUser(id, q) : null;
    if (!found || found.sessionEpoch !== Number(epoch)) return null;
    const { sessionEpoch: _, ...user } = found;
    return user;
  }
  if (handle) {
    const found = await getUserByHandle(handle, q);
    if (found) return found;
  }
  return (await listUsers(q))[0] ?? null;
}

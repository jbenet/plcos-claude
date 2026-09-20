import { cookies } from 'next/headers';
import { getUserByHandle, listUsers } from '@/modules/platform';
import type { AppUser, AuthProvider } from './index';

export const USER_COOKIE = 'capitalos_user';

/**
 * The local provider. Identity is a cookie holding a handle; the dropdown in the rail
 * rewrites it. No password, no session, no token — none of which are simulated here,
 * because a simulated one is the thing that would quietly survive into D1.
 */
export function localAuth(): AuthProvider {
  return {
    kind: 'local',
    switchable: true,

    async currentUser(): Promise<AppUser> {
      const jar = await cookies();
      const handle = jar.get(USER_COOKIE)?.value;
      if (handle) {
        const found = await getUserByHandle(handle);
        if (found) return found;
      }
      const all = await listUsers();
      if (all.length === 0) {
        throw new Error('No users in platform.app_user. Run `npm run demo` to seed.');
      }
      return all[0]!;
    },

    listUsers,

    async switchUser(handle: string): Promise<AppUser> {
      const found = await getUserByHandle(handle);
      if (!found) throw new Error(`No such user: ${handle}`);
      const jar = await cookies();
      jar.set(USER_COOKIE, handle, { httpOnly: true, sameSite: 'lax', path: '/' });
      return found;
    },
  };
}

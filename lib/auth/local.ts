import type { Queryable } from '@/lib/db';
import { cookies } from 'next/headers';
import { getUserByHandle, listUsers } from '@/modules/platform';
import { config } from '@/config/deployment';
import type { AppUser, AuthProvider } from './index';

import { USER_COOKIE } from './cookie';
import { resolveLocalUser } from './local-user';

export { USER_COOKIE };

/**
 * The local provider. Identity is a cookie holding a handle; the dropdown in the rail
 * rewrites it. No password, no session, no token — none of which are simulated here,
 * because a simulated one is the thing that would quietly survive into D1.
 */
export function localAuth(): AuthProvider {
  return {
    kind: 'local',
    switchable: true,

    async currentUser(q?: Queryable): Promise<AppUser> {
      const jar = await cookies();
      const handle = jar.get(USER_COOKIE)?.value;
      const user = await resolveLocalUser(handle, q);
      if (!user) {
        throw new Error(
          config.data.profile === 'real'
            ? 'No users in platform.app_user. The real profile loads its team from data/real/init.jsonc.'
            : 'No users in platform.app_user. Run `npm run demo` to seed.',
        );
      }
      return user;
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

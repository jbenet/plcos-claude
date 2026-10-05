import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Queryable } from '@/lib/db';
import { listUsers } from '@/modules/platform';
import { MutationGuardError } from '@/lib/mutation-policy';
import type { AuthProvider } from './index';
import { publicUrl } from '@/lib/settings/setup';
import { sessionCookie, userFromSession } from './session';
import { WARM_COOKIE } from './warm';

/**
 * Google sign-in, on a deployed server (config/sign-in.ts; docs/deploy/railway.md §3). Who you are is a
 * signed session cookie made by /auth/google/callback after Google vouched for a verified Workspace
 * address on the roster. No cookie, a bad one, an expired one, a raised epoch or an inactive person: off
 * to /signin. Nobody can switch users, and there is no fallback to the local switcher.
 */
export function googleAuth(): AuthProvider {
  return {
    kind: 'google',
    switchable: false,
    async currentUser(q?: Queryable) {
      const [h, jar] = await Promise.all([headers(), cookies()]);
      const secure = publicUrl(h).startsWith('https://');
      const user = await userFromSession(jar.get(sessionCookie(secure))?.value, q);
      if (user) return user;
      // The page warm-up's pass (lib/auth/warm.ts): a loopback GET of a page it asked to warm, nothing else.
      const warm = jar.get(WARM_COOKIE)?.value;
      if (warm) {
        const { warmPassUser } = await import('./warm');
        const admin = await warmPassUser(warm, h, q);
        if (admin) return admin;
      }
      redirect('/signin');
    },
    listUsers: () => listUsers(),
    switchUser: async () => { throw new MutationGuardError('This deployment signs people in with Google; nobody can switch users.', 403); },
  };
}

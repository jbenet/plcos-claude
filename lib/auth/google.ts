import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Queryable } from '@/lib/db';
import { listUsers } from '@/modules/platform';
import { MutationGuardError } from '@/lib/mutation-policy';
import type { AuthProvider } from './index';
import { SESSION_COOKIE, userFromSession } from './session';

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
      const user = await userFromSession((await cookies()).get(SESSION_COOKIE)?.value, q);
      if (!user) redirect('/signin');
      return user;
    },
    listUsers: () => listUsers(),
    switchUser: async () => { throw new MutationGuardError('This deployment signs people in with Google; nobody can switch users.', 403); },
  };
}

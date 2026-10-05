import { cookies, headers } from 'next/headers';
import { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import type { Queryable } from '@/lib/db';
import { config } from '@/config/deployment';
import { auth, type AppUser } from '@/lib/auth';
import { USER_COOKIE } from '@/lib/auth/cookie';
import { WARM_COOKIE } from '@/lib/auth/warm';
import { getUserByHandle } from '@/modules/platform';

import { MutationGuardError, requireMutationOrigin, requireMutationProfile } from './mutation-policy';
export { MutationGuardError, requireMutationOrigin, requireMutationProfile, mutationProfileAllowed } from './mutation-policy';

/** No local provider fallback: an absent, unknown or inactive cookie is anonymous. */
export async function requireMutationUser(): Promise<AppUser> {
  requireMutationProfile();
  // The page warm-up's pass reads pages and nothing else: a request carrying one never writes (lib/auth/warm.ts).
  if ((await cookies()).get(WARM_COOKIE)?.value) throw new MutationGuardError('A page warm-up cannot make changes.', 403);
  if (config.auth.provider !== 'local') return (await auth()).currentUser();
  const handle = (await cookies()).get(USER_COOKIE)?.value;
  return resolveMutationUser(handle);
}

/** Active roster lookup shared by HTTP routes and actions. */
export async function resolveMutationUser(handle: string | undefined, q?: Queryable): Promise<AppUser> {
  const user = handle ? await getUserByHandle(handle, q) : null;
  if (!user) throw new MutationGuardError('Select an active app user before making changes.', 401);
  return user;
}

export async function mutationRouteGuard(request: Request): Promise<{ user: AppUser } | { response: Response }> {
  try {
    requireMutationOrigin(request);
    requireMutationProfile();
    if (new RequestCookies(request.headers).get(WARM_COOKIE)?.value) throw new MutationGuardError('A page warm-up cannot make changes.', 403);
    const user = config.auth.provider === 'local'
      ? await resolveMutationUser(new RequestCookies(request.headers).get(USER_COOKIE)?.value)
      : await (await auth()).currentUser();
    return { user };
  } catch (error) {
    if (error instanceof MutationGuardError) return { response: Response.json({ error: error.message }, { status: error.status }) };
    throw error;
  }
}

/** Next also checks action Origin/Host; require it explicitly, including Fetch Metadata. */
export async function requireServerActionMutation(): Promise<AppUser> {
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('host');
  const site = h.get('sec-fetch-site');
  let same = false;
  try { same = Boolean(origin && host && new URL(origin).host === host && ['http:', 'https:'].includes(new URL(origin).protocol)); } catch { /* fail closed */ }
  if (!same || (site !== null && site !== 'same-origin')) throw new MutationGuardError('Use this server’s own page to make changes.', 403);
  return requireMutationUser();
}

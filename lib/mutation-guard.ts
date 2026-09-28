import { cookies, headers } from 'next/headers';
import { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import type { Queryable } from '@/lib/db';
import { config } from '@/config/deployment';
import { readLayout } from '@/config/ports';
import { auth, type AppUser } from '@/lib/auth';
import { USER_COOKIE } from '@/lib/auth/cookie';
import { getUserByHandle } from '@/modules/platform';

export class MutationGuardError extends Error {
  constructor(message: string, readonly status: 401 | 403) { super(message); }
}

/** Explicit origin, including port and scheme; sibling origins are never trusted. */
export function requireMutationOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const url = new URL(request.url);
  // Next's route URL can name its bind address. Host is the address the browser requested;
  // forwarded-host is deliberately not trusted.
  const expected = `${url.protocol}//${request.headers.get('host') || url.host}`;
  if (!origin || origin !== expected || (site !== null && site !== 'same-origin')) {
    throw new MutationGuardError('Use this server’s own page to make changes.', 403);
  }
}

export function mutationProfileAllowed(profile: 'demo' | 'real', copyTakenAt: string | null, role: 'dev' | 'live'): boolean {
  return profile === 'demo' || (!copyTakenAt && role === 'live');
}

export function requireMutationProfile(): void {
  if (config.data.profile !== 'real') return;
  let live = false;
  try { live = mutationProfileAllowed(config.data.profile, config.data.copyTakenAt, readLayout().role); } catch { /* fail closed */ }
  if (!live) throw new MutationGuardError('Change real data on the live server.', 403);
}

/** No local provider fallback: an absent, unknown or inactive cookie is anonymous. */
export async function requireMutationUser(): Promise<AppUser> {
  requireMutationProfile();
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

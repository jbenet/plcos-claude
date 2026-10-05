/**
 * Seam 2 of 5 — AuthProvider.
 *
 * The local user switcher on the Mac, PL's LabOS kit (rev 3), or Google sign-in on a deployed server
 * (docs/deploy/railway.md §3; config/sign-in.ts decides). Callers ask for `currentUser()` and never
 * learn which provider answered. `switchUser` exists only on the local provider; the others refuse
 * it loudly rather than pretending.
 */
import type { Queryable } from '@/lib/db';
import type { AppUser } from '@/modules/platform';
import { config } from '@/config/deployment';

export type { AppUser };

export interface AuthProvider {
  readonly kind: 'local' | 'labos' | 'google';
  /** True when a person can pick who they are from a dropdown. False in any real deployment. */
  readonly switchable: boolean;
  currentUser(q?: Queryable): Promise<AppUser>;
  listUsers(): Promise<AppUser[]>;
  switchUser(handle: string): Promise<AppUser>;
}

export async function auth(): Promise<AuthProvider> {
  // An MCP request acts as its token's owner (lib/auth/acting.ts); nobody can switch from there.
  const { actingUser } = await import('./acting');
  const acting = actingUser();
  if (acting) {
    return {
      kind: config.auth.provider, switchable: false,
      currentUser: async () => acting,
      listUsers: async () => [acting],
      switchUser: async () => { throw new Error('An MCP request acts as its token’s owner and cannot switch user.'); },
    };
  }
  if (config.auth.provider === 'labos') {
    const { labosAuth } = await import('./labos');
    return labosAuth();
  }
  if (config.auth.provider === 'google') {
    const { googleAuth } = await import('./google');
    return googleAuth();
  }
  const { localAuth } = await import('./local');
  return localAuth();
}

/** Convenience for server components. */
export async function currentUser(): Promise<AppUser> {
  return (await auth()).currentUser();
}

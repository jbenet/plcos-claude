/**
 * Seam 2 of 5 — AuthProvider.
 *
 * Local user switcher now, PL LabOS kit later. Callers ask for `currentUser()` and never
 * learn which provider answered. `switchUser` exists only on the local provider and the
 * LabOS provider refuses it loudly rather than pretending.
 */
import type { AppUser } from '@/modules/platform';
import { config } from '@/config/deployment';

export type { AppUser };

export interface AuthProvider {
  readonly kind: 'local' | 'labos';
  /** True when a person can pick who they are from a dropdown. False in any real deployment. */
  readonly switchable: boolean;
  currentUser(): Promise<AppUser>;
  listUsers(): Promise<AppUser[]>;
  switchUser(handle: string): Promise<AppUser>;
}

export async function auth(): Promise<AuthProvider> {
  if (config.auth.provider === 'labos') {
    const { labosAuth } = await import('./labos');
    return labosAuth();
  }
  const { localAuth } = await import('./local');
  return localAuth();
}

/** Convenience for server components. */
export async function currentUser(): Promise<AppUser> {
  return (await auth()).currentUser();
}

import type { AuthProvider } from './index';

/**
 * The D1 path. Not built (CLAUDE.md: "No auth integration"). It exists so the seam has a
 * second implementation to type-check against, and so flipping config.auth.provider
 * produces a clear message rather than a subtle fallback to local identity.
 */
export function labosAuth(): AuthProvider {
  const refuse = (): never => {
    throw new Error(
      'config.auth.provider is "labos" but the PL LabOS kit is not wired up (D1). ' +
        'Set it back to "local" — there is no safe fallback for identity.',
    );
  };
  return {
    kind: 'labos',
    switchable: false,
    currentUser: refuse,
    listUsers: refuse,
    switchUser: refuse,
  };
}

import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';

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
  const live = mutationProfileAllowed(config.data.profile, config.data.copyTakenAt, isLiveServer() ? 'live' : 'dev');
  if (!live) throw new MutationGuardError('Change real data on the live server.', 403);
}

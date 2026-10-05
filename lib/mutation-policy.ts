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
  const host = request.headers.get('host') || url.host;
  const expected = `${url.protocol}//${host}`;
  // Behind a TLS-terminating proxy (Railway's edge) the server sees http while the browser says https. The
  // scheme the proxy reports may stand in for ours; the host still must match.
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const viaProxy = forwarded === 'https' || forwarded === 'http' ? `${forwarded}://${host}` : null;
  if (!origin || (origin !== expected && origin !== viaProxy) || (site !== null && site !== 'same-origin')) {
    throw new MutationGuardError('Use this server’s own page to make changes.', 403);
  }
}

export function mutationProfileAllowed(profile: 'demo' | 'real', copyTakenAt: string | null, role: 'dev' | 'live'): boolean {
  return profile === 'demo' || (!copyTakenAt && role === 'live');
}

/**
 * The refusal a server that is not the live one gives for a change to real data — a preview copy, or a checkout
 * that is not live. A fixed, user-facing sentence: the mail desk shows it verbatim (docs/27 §5), so change it only
 * with the doc. Nothing was written when it is returned.
 */
export const NOT_LIVE_REFUSAL = 'Nothing was changed: this server is not the live one (it may be a preview copy), and real records change only on the live server.';

export function requireMutationProfile(): void {
  if (config.data.profile !== 'real') return;
  const live = mutationProfileAllowed(config.data.profile, config.data.copyTakenAt, isLiveServer() ? 'live' : 'dev');
  if (!live) throw new MutationGuardError(NOT_LIVE_REFUSAL, 403);
}

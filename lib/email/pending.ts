import { config } from '@/config/deployment';
import type { PendingConnect } from '@/lib/connectors/gmail';

/**
 * The consent round trip's cookie (docs/25 §Per-user OAuth): the state that proves the answer is
 * the one this browser asked for, and the PKCE verifier. httpOnly, ten minutes, never a token.
 * The name carries the port, like every cookie here (config.data.cookiePrefix).
 */
export const PENDING_COOKIE = `${config.data.cookiePrefix}gmail_connect`;
export const PENDING_MAX_AGE = 600;

/**
 * The address the browser used, from its Host header: the dev server's own request.url says
 * 0.0.0.0, where this browser's cookies are not.
 */
export function requestOrigin(request: Request): string {
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return host && /^[A-Za-z0-9.\-:[\]]+$/.test(host) ? `${proto}://${host}` : new URL(request.url).origin;
}

export const writePending =(p: PendingConnect) => Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');

export function readPending(v: string | undefined): PendingConnect | null {
  if (!v || v.length > 4000) return null;
  try {
    const p = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as PendingConnect;
    return typeof p.state === 'string' && typeof p.verifier === 'string' && typeof p.challenge === 'string' && Array.isArray(p.scopes) && typeof p.handle === 'string' ? p : null;
  } catch {
    return null;
  }
}

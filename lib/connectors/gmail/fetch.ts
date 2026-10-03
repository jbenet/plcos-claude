import { allowedRequest, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL } from './allowlist';

/**
 * The only function in this repository that may send a request to Google (docs/25).
 *
 * Every request — to Google over HTTPS, or to the fake Google the demo and the properties use —
 * passes through `guarded`, so the fake proves the rules on the code that enforces them:
 *   - Gmail: the method, path and every query parameter are on the allowlist (allowlist.ts).
 *   - OAuth: POST to the token endpoint (grant_type authorization_code or refresh_token only) or
 *     the revoke endpoint, a form body, nothing else.
 *   - No method-override header, no redirects.
 * The boundary check fails the build if anything outside this folder names Google's API hosts.
 */

export class DraftOnlyViolation extends Error {
  constructor(what: string) {
    super(`Refused before sending: ${what}. The Gmail client only makes drafts (docs/25-email-drafts.md).`);
    this.name = 'DraftOnlyViolation';
  }
}

export interface GoogleRequest {
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: string;
}

export interface GoogleResponse {
  status: number;
  text(): Promise<string>;
}

/** What actually carries a request: Google's servers, or the fake. */
export type GoogleTransport = (url: URL, init: GoogleRequest) => Promise<GoogleResponse>;

export function httpsTransport(): GoogleTransport {
  return async (url, init) => {
    // GUESS: a draft of the largest size we allow uploads in well under a minute.
    const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'error', signal: AbortSignal.timeout(60_000) });
    return { status: res.status, text: () => res.text() };
  };
}

const OVERRIDE = /^x-http-method(-override)?$|^x-method-override$/i;

/** Refuse anything the rules above do not allow; pass the rest to the transport unchanged. */
export function guarded(transport: GoogleTransport): (url: URL, init: GoogleRequest) => Promise<GoogleResponse> {
  return async (url, init) => {
    const method = String(init.method ?? '').toUpperCase();
    if (Object.keys(init.headers ?? {}).some((h) => OVERRIDE.test(h))) throw new DraftOnlyViolation('a method-override header');
    if (url.href === GOOGLE_TOKEN_URL || url.href === GOOGLE_REVOKE_URL) {
      if (method !== 'POST') throw new DraftOnlyViolation(`${method} to the OAuth endpoint`);
      if (!/^application\/x-www-form-urlencoded/.test(init.headers['content-type'] ?? init.headers['Content-Type'] ?? '')) throw new DraftOnlyViolation('an OAuth request that is not a form');
      const form = new URLSearchParams(init.body ?? '');
      if (url.href === GOOGLE_TOKEN_URL && !['authorization_code', 'refresh_token'].includes(form.get('grant_type') ?? '')) throw new DraftOnlyViolation(`the grant type ${form.get('grant_type')}`);
      return transport(url, { ...init, method: 'POST' });
    }
    const verdict = allowedRequest(method, url);
    if ('refused' in verdict) throw new DraftOnlyViolation(verdict.refused);
    if (method === 'GET' && init.body !== undefined) throw new DraftOnlyViolation('a GET with a body');
    return transport(url, { ...init, method: method as GoogleRequest['method'] });
  };
}

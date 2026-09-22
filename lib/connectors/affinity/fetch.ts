/**
 * The only function in this repository that may send a request to Affinity.
 *
 * It exists so that read-only is a property of the code rather than a promise. The API key
 * can write and cannot be limited (docs/15), so the limit lives here: GET, no body, to
 * Affinity's host, over HTTPS, no redirects. Anything else throws before `fetch` is called.
 * The boundary check fails the build if anything outside this folder mentions the host.
 */
export const AFFINITY_ORIGIN = 'https://api.affinity.co';

export class ReadOnlyViolation extends Error {
  constructor(what: string) {
    super(`Refused before sending: ${what}. The Affinity client is read-only (docs/15).`);
    this.name = 'ReadOnlyViolation';
  }
}

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export function guardedFetch(fetchImpl: FetchLike = (u, i) => fetch(u, i)): FetchLike {
  return async (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET') throw new ReadOnlyViolation(`method ${method}`);
    if (init.body !== undefined && init.body !== null) throw new ReadOnlyViolation('a request body');
    if (url.origin !== AFFINITY_ORIGIN) throw new ReadOnlyViolation(`a request to ${url.origin}`);
    return fetchImpl(url, { ...init, method: 'GET', redirect: 'error' });
  };
}

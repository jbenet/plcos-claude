import { config } from '@/config/deployment';
import { logRequest, type RequestLogEntry } from '@/modules/sources';
import { AFFINITY_ORIGIN, type FetchLike } from './fetch';
import { affinityKey } from './key';

/**
 * The only code in this repository that may write to Affinity (Juan, 14 Oct 2026: PLC OS may add the people he emailed
 * who are missing from Affinity, and a note of the mail, approved by batch; memory affinity-writes-decision). Everything
 * else stays read-only, through client.ts and the GET-only guard in fetch.ts, which this file does not loosen.
 *
 *   - Two requests, and only these: create a person (POST /persons) and create a note on people (POST /notes). Both are
 *     Affinity's v1 API, which is where creating them lives; v2 has no create. Anything else throws before a request.
 *   - Only to Affinity's host, over HTTPS, JSON, no redirects. The key goes in the Authorization header and nowhere else.
 *   - Only lib/affinity-writes.ts calls it, and only for items a person approved (app/approvals AffinityBatch).
 *   - Every request is logged as the reads are (sources.request_log): endpoint, status, time. Never a body or a header.
 *   - The demo profile and a preview never reach Affinity: they get a fake that answers with invented ids.
 */

export const WRITE_ALLOWED = [
  { method: 'POST', path: '/persons', purpose: 'Create a person Juan emailed who is missing from Affinity: name and address, nothing else.' },
  { method: 'POST', path: '/notes', purpose: 'Add a note on a person: the dates and subjects of the mail Affinity did not capture.' },
] as const;

export class AffinityWriteRefused extends Error {
  constructor(what: string) { super(`Refused before sending: ${what}. Affinity writes are limited to creating a person and a note (lib/connectors/affinity/write.ts).`); this.name = 'AffinityWriteRefused'; }
}

export class AffinityWriteError extends Error {
  constructor(readonly status: number | null, message: string) { super(message); this.name = 'AffinityWriteError'; }
}

export interface WriteTransport {
  readonly kind: 'https' | 'fake' | 'scripted';
  post(url: URL, body: string, headers: Record<string, string>): Promise<{ status: number; text(): Promise<string> }>;
}

/** The guard on the wire: POST, an allowlisted path, Affinity's host, a JSON body, no redirects. */
export function guardedWrite(fetchImpl: FetchLike = (u, i) => fetch(u, i)): WriteTransport {
  return {
    kind: 'https',
    post: async (url, body, headers) => {
      if (url.origin !== AFFINITY_ORIGIN) throw new AffinityWriteRefused(`a request to ${url.origin}`);
      if (!WRITE_ALLOWED.some((w) => w.path === url.pathname) || url.search) throw new AffinityWriteRefused(`the path ${url.pathname}${url.search ? ' with a query' : ''}`);
      return fetchImpl(url, { method: 'POST', body, headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    },
  };
}

/** The demo's and a preview's Affinity: answers with invented ids, sends nothing. */
export function fakeWrite(): WriteTransport {
  let n = 900_000_000;
  return { kind: 'fake', post: async () => ({ status: 200, text: async () => JSON.stringify({ id: ++n }) }) };
}

export interface AffinityWriter {
  readonly kind: WriteTransport['kind'];
  createPerson(p: { firstName: string; lastName: string; emails: string[] }): Promise<number>;
  createNote(n: { personIds: number[]; content: string }): Promise<number>;
}

export function affinityWriter(opts: { transport?: WriteTransport; key?: string; log?: (e: RequestLogEntry) => Promise<void> } = {}): AffinityWriter {
  const real = config.data.profile === 'real' && !config.data.copyTakenAt;
  const transport = opts.transport ?? (real ? guardedWrite() : fakeWrite());
  if (real && transport.kind === 'fake') throw new Error('The live server writes to Affinity itself, never to a fake.');
  if (!real && transport.kind === 'https') throw new Error('Only the live server writes to Affinity.');
  const key = opts.key ?? (real ? affinityKey() : 'demo-fixture-key');
  if (!key) throw new AffinityWriteRefused('no Affinity key on this server');
  const log = opts.log ?? logRequest;

  async function send(path: (typeof WRITE_ALLOWED)[number]['path'], payload: unknown): Promise<number> {
    const started = Date.now();
    const endpoint = `POST ${path}`;
    let status: number | null = null;
    try {
      const res = await transport.post(new URL(path, AFFINITY_ORIGIN), JSON.stringify(payload), {
        Authorization: `Basic ${Buffer.from(`:${key}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json',
      });
      status = res.status;
      const text = await res.text();
      await log({ source: 'affinity', endpoint, path, outcome: status === 429 ? 'rate_limited' : 'sent', status, durationMs: Date.now() - started, userRemaining: null, orgRemaining: null, note: 'write' });
      if (status < 200 || status >= 300) {
        // Affinity's error text says what was wrong with the request (e.g. an address another person has); never the key.
        let why = '';
        try { const j = JSON.parse(text); why = String(j?.message ?? j?.errors?.[0]?.message ?? j?.error ?? '').slice(0, 200); } catch { why = ''; }
        throw new AffinityWriteError(status, `Affinity answered ${status}${why ? `: ${why}` : ''}`);
      }
      const id = Number(JSON.parse(text)?.id);
      if (!Number.isSafeInteger(id)) throw new AffinityWriteError(status, 'Affinity answered without an id');
      return id;
    } catch (err) {
      if (status === null && !(err instanceof AffinityWriteRefused)) {
        await log({ source: 'affinity', endpoint, path, outcome: 'network_error', status: null, durationMs: Date.now() - started, userRemaining: null, orgRemaining: null, note: 'write' });
      }
      throw err;
    }
  }

  return {
    kind: transport.kind,
    createPerson: (p) => send('/persons', { first_name: p.firstName, last_name: p.lastName, emails: p.emails }),
    createNote: (n) => send('/notes', { person_ids: n.personIds, content: n.content }),
  };
}

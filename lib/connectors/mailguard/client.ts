import { allowedRequest, KEY_FORMAT } from './allowlist';

/**
 * The mailguard client: drafts, and the ids a follow-up needs (docs/25 §12). There is no send here, by
 * design, and the guard under it refuses one if a later change tried.
 *
 *   whoami()                 GET  /api/v1/me                      which mailbox, what the key may do
 *   createDraft(fields)      POST /api/v1/drafts                  a new draft in the person's Drafts
 *   updateDraft(id, fields)  PUT  /api/v1/drafts/:id              replace one this key made; null when gone
 *   thread(threadId)         GET  /api/v1/threads/:id?format=metadata   ids and labels, never bodies
 *
 * Logged per request: the action's name, the status and the time. Never a body, the key, an address
 * or a subject. Error messages carry mailguard's own words (which never quote the key), cut short.
 */

export class DraftOnlyViolation extends Error {
  constructor(what: string) {
    super(`Refused before sending: ${what}. The mailguard client only makes drafts (docs/25-email-drafts.md §12).`);
    this.name = 'DraftOnlyViolation';
  }
}

export type MailguardErrorKind = 'unauthorized' | 'denied' | 'not_found' | 'rate_limited' | 'too_large' | 'unavailable' | 'unreachable' | 'bad_answer';

export class MailguardError extends Error {
  constructor(readonly status: number | null, readonly kind: MailguardErrorKind, message: string) {
    super(message);
    this.name = 'MailguardError';
  }
}

export interface MailguardRequest { method: 'GET' | 'POST' | 'PUT'; headers: Record<string, string>; body?: string }
export interface MailguardResponse { status: number; headers?: { get(name: string): string | null }; text(): Promise<string> }
/** What carries a request: mailguard over HTTPS, or the fake. */
export type MailguardTransport = (url: URL, init: MailguardRequest) => Promise<MailguardResponse>;

export function httpsTransport(): MailguardTransport {
  return async (url, init) => {
    // GUESS: a draft of the largest size we allow uploads in well under a minute; a read answers in seconds,
    // and a page that checks a key while it renders must not wait long for an unreachable mailguard.
    const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'error', signal: AbortSignal.timeout(init.method === 'GET' ? 8_000 : 60_000) });
    return { status: res.status, headers: res.headers, text: () => res.text() };
  };
}

const OVERRIDE = /^x-http-method(-override)?$|^x-method-override$/i;

/** The only way a request reaches mailguard: refuse anything the allowlist does not name. */
export function guarded(transport: MailguardTransport, base: URL): MailguardTransport {
  return async (url, init) => {
    const method = String(init.method ?? '').toUpperCase();
    const headers = init.headers ?? {};
    if (Object.keys(headers).some((h) => OVERRIDE.test(h))) throw new DraftOnlyViolation('a method-override header');
    const verdict = allowedRequest(method, url, base);
    if ('refused' in verdict) throw new DraftOnlyViolation(verdict.refused);
    if (method === 'GET' && init.body !== undefined) throw new DraftOnlyViolation('a GET with a body');
    const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? '';
    if (!KEY_FORMAT.test(auth.replace(/^Bearer /, '')) || !auth.startsWith('Bearer ')) throw new DraftOnlyViolation('a request without a well-formed mailguard key');
    return transport(url, { ...init, method: method as MailguardRequest['method'] });
  };
}

export interface MailguardRequestLog { name: string; status: number | null; ms: number; outcome: 'ok' | 'error' | 'refused' }

export interface DraftFields {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
  /** A Gmail message id: mailguard puts the draft in its thread with the reply headers. */
  replyTo?: string;
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
}

export interface DraftRef { draftId: string; messageId: string; threadId: string }
export interface ThreadMessage { id: string; threadId: string; labels: string[]; date: string }

export interface MailguardClient {
  whoami(): Promise<unknown>;
  createDraft(fields: DraftFields): Promise<DraftRef>;
  /** Null when mailguard has no such draft for this key: it was sent or deleted in Gmail. */
  updateDraft(draftId: string, fields: DraftFields): Promise<DraftRef | null>;
  /** Null when the thread is gone or hidden from this key. */
  thread(threadId: string): Promise<ThreadMessage[] | null>;
}

export interface ClientOptions {
  transport: MailguardTransport;
  base: URL;
  /** The person's key. Held in this closure; never logged, never in an error. */
  key: string;
  log?: (e: MailguardRequestLog) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** GUESS: wait out a rate limit of up to ten seconds once, for a click; longer, say so. */
const MAX_WAIT_S = 10;

function kindOf(status: number): MailguardErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'denied';
  if (status === 404) return 'not_found';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'unavailable' : 'bad_answer';
}

const PLAIN: Record<MailguardErrorKind, string> = {
  unauthorized: 'Mailguard does not accept this token (it was revoked, paused, or mistyped). Paste a new drafts-only token in Preferences → Email.',
  denied: 'Mailguard refused this',
  not_found: 'Mailguard has no such item for this token',
  too_large: 'This draft is larger than mailguard accepts',
  rate_limited: 'Mailguard’s rate limit for this token was reached',
  unavailable: 'Mailguard could not be reached or is busy',
  unreachable: 'Mailguard could not be reached',
  bad_answer: 'Mailguard gave an answer this tool could not read',
};

export function mailguardClient(opts: ClientOptions): MailguardClient {
  if (!KEY_FORMAT.test(opts.key)) throw new MailguardError(null, 'unauthorized', 'That is not a mailguard token: it should look like mg_ followed by letters and digits. Nothing was sent.');
  const send = guarded(opts.transport, opts.base);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function call(name: string, method: MailguardRequest['method'], path: string, query: Array<[string, string]> = [], body?: unknown, retryOn5xx = false): Promise<{ status: number; json: unknown }> {
    const url = new URL(path, opts.base);
    for (const [k, v] of query) url.searchParams.append(k, v);
    for (let attempt = 0; ; attempt++) {
      const t = Date.now();
      let res: MailguardResponse;
      try {
        res = await send(url, {
          method,
          headers: { authorization: `Bearer ${opts.key}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        const refused = e instanceof DraftOnlyViolation;
        opts.log?.({ name, status: null, ms: Date.now() - t, outcome: refused ? 'refused' : 'error' });
        if (refused) throw e;
        throw new MailguardError(null, 'unreachable', `${PLAIN.unreachable} (${e instanceof Error ? e.name : 'error'}). Nothing was changed.`);
      }
      const text = await res.text();
      opts.log?.({ name, status: res.status, ms: Date.now() - t, outcome: res.status < 400 ? 'ok' : 'error' });
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.status < 400 || res.status === 404) return { status: res.status, json };
      const err = (json && typeof json === 'object' ? json : {}) as { error?: unknown; layer?: unknown; rule?: unknown; retryAfter?: unknown };
      const retryAfter = Number(err.retryAfter ?? res.headers?.get('retry-after') ?? NaN);
      // A 429 or a busy 503 is refused before mailguard does anything, so trying again cannot make two drafts.
      const before = res.status === 429 || (res.status === 503 && Number.isFinite(retryAfter));
      if (attempt === 0 && before && Number.isFinite(retryAfter) && retryAfter <= MAX_WAIT_S) { await sleep(Math.max(1, retryAfter) * 1000); continue; }
      if (attempt === 0 && retryOn5xx && [502, 504].includes(res.status)) { await sleep(1000); continue; }
      const kind = kindOf(res.status);
      const said = typeof err.error === 'string' ? err.error.split('\n')[0]!.slice(0, 200) : '';
      const where = typeof err.layer === 'string' ? ` (${err.layer}${typeof err.rule === 'string' ? `: ${err.rule}` : ''})` : '';
      const wait = kind === 'rate_limited' && Number.isFinite(retryAfter) ? ` Try again in ${Math.ceil(retryAfter)} s.` : '';
      throw new MailguardError(res.status, kind, kind === 'unauthorized' ? PLAIN.unauthorized : `${PLAIN[kind]} — ${name} answered ${res.status}${said ? `: ${said}` : ''}${where}.${wait}`);
    }
  }

  const draftRef = (j: unknown): DraftRef => {
    const d = j as { id?: unknown; message?: { id?: unknown; threadId?: unknown } } | null;
    if (typeof d?.id !== 'string' || typeof d.message?.id !== 'string' || typeof d.message.threadId !== 'string') throw new MailguardError(502, 'bad_answer', `${PLAIN.bad_answer}: no draft id.`);
    return { draftId: d.id, messageId: d.message.id, threadId: d.message.threadId };
  };
  const id = (s: string) => {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(s)) throw new DraftOnlyViolation('an id that is not a Gmail id');
    return encodeURIComponent(s);
  };

  return {
    async whoami() {
      const r = await call('whoami', 'GET', '/api/v1/me', [], undefined, true);
      if (r.status === 404) throw new MailguardError(404, 'bad_answer', `${PLAIN.bad_answer}: /api/v1/me is missing — is this mailguard’s address?`);
      return r.json;
    },
    async createDraft(fields) {
      const r = await call('drafts.create', 'POST', '/api/v1/drafts', [], fields);
      if (r.status === 404) throw new MailguardError(404, 'not_found', 'Mailguard could not find the message this follow-up answers. Nothing was made.');
      return draftRef(r.json);
    },
    async updateDraft(draftId, fields) {
      const r = await call('drafts.update', 'PUT', `/api/v1/drafts/${id(draftId)}`, [], fields);
      return r.status === 404 ? null : draftRef(r.json);
    },
    async thread(threadId) {
      const r = await call('threads.get', 'GET', `/api/v1/threads/${id(threadId)}`, [['format', 'metadata']], undefined, true);
      if (r.status === 404) return null;
      const msgs = (r.json as { messages?: unknown } | null)?.messages;
      if (!Array.isArray(msgs)) throw new MailguardError(502, 'bad_answer', `${PLAIN.bad_answer}: no messages in the thread.`);
      return msgs.flatMap((m): ThreadMessage[] => {
        const x = m as { id?: unknown; threadId?: unknown; labels?: unknown; date?: unknown };
        return typeof x.id === 'string' ? [{ id: x.id, threadId: String(x.threadId ?? threadId), labels: Array.isArray(x.labels) ? x.labels.map(String) : [], date: String(x.date ?? '') }] : [];
      });
    },
  };
}

import { GMAIL_ORIGIN } from './allowlist';
import { guarded, type GoogleResponse, type GoogleTransport } from './fetch';

/**
 * The Gmail client: drafts, and the headers a reply needs. There is no send here, by design, and
 * the guard under it refuses one if a later change tried (docs/25 §Scope and safety).
 *
 *   profile()                    users.getProfile           which address is connected
 *   createDraft(raw, threadId?)  users.drafts.create        a new draft in the person's Drafts
 *   updateDraft(id, raw, …)      users.drafts.update        replace one this tool made
 *   getDraft(id)                 users.drafts.get           still a draft? null when sent or deleted
 *   threadHeaders(threadId)      users.threads.get          metadata only; needs the metadata scope
 *   messageHeaders(id)           users.messages.get         metadata only; needs the metadata scope
 *
 * Logged per request: the endpoint's name, the status and the time. Never a body, a token, an
 * address or a subject.
 */

export interface GmailRequestLog { name: string; status: number | null; ms: number; outcome: 'ok' | 'error' | 'refused' }

export interface GmailClientOptions {
  transport: GoogleTransport;
  /** A current access token; `fresh` forces a refresh after a 401. */
  accessToken: (fresh: boolean) => Promise<string>;
  log?: (e: GmailRequestLog) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface DraftRef { draftId: string; messageId: string; threadId: string }
export interface HeaderSet { gmailId: string; threadId: string; messageId: string | null; references: string[]; inReplyTo: string | null; subject: string | null }

export class GmailError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GmailError';
  }
}

const RETRY_MS = [1_000, 4_000]; // GUESS: two retries on 429/5xx are enough for a click.

export interface GmailClient {
  profile(): Promise<{ emailAddress: string }>;
  createDraft(raw: string, threadId?: string | null): Promise<DraftRef>;
  updateDraft(draftId: string, raw: string, threadId?: string | null): Promise<DraftRef>;
  getDraft(draftId: string): Promise<DraftRef | null>;
  threadHeaders(threadId: string): Promise<HeaderSet[]>;
  messageHeaders(gmailMessageId: string): Promise<HeaderSet | null>;
}

const HEADERS = ['Message-ID', 'References', 'In-Reply-To', 'Subject'];

interface GmailMessage { id?: string; threadId?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } }

function headerSet(m: GmailMessage): HeaderSet {
  const h = (name: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? null;
  return {
    gmailId: String(m.id ?? ''),
    threadId: String(m.threadId ?? ''),
    messageId: h('Message-ID'),
    references: (h('References') ?? '').split(/\s+/).filter((r) => /^<[^<>\s]+>$/.test(r)),
    inReplyTo: h('In-Reply-To'),
    subject: h('Subject'),
  };
}

export function gmailClient(opts: GmailClientOptions): GmailClient {
  const send = guarded(opts.transport);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function call(name: string, method: 'GET' | 'POST' | 'PUT', path: string, query: Array<[string, string]> = [], body?: unknown): Promise<GoogleResponse & { json: unknown }> {
    const url = new URL(path, GMAIL_ORIGIN);
    for (const [k, v] of query) url.searchParams.append(k, v);
    let fresh = false;
    for (let attempt = 0; ; attempt++) {
      const t = Date.now();
      const token = await opts.accessToken(fresh);
      let res: GoogleResponse;
      try {
        res = await send(url, {
          method,
          headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        opts.log?.({ name, status: null, ms: Date.now() - t, outcome: e instanceof Error && e.name === 'DraftOnlyViolation' ? 'refused' : 'error' });
        throw e;
      }
      const text = await res.text();
      opts.log?.({ name, status: res.status, ms: Date.now() - t, outcome: res.status < 400 ? 'ok' : 'error' });
      if (res.status === 401 && !fresh) { fresh = true; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < RETRY_MS.length) { await sleep(RETRY_MS[attempt]!); continue; }
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.status >= 400 && res.status !== 404) {
        // Google's error message names the problem without quoting the request; keep only its first line.
        const msg = (json as { error?: { message?: string } } | null)?.error?.message?.split('\n')[0]?.slice(0, 200) ?? 'no detail';
        throw new GmailError(res.status, `Gmail answered ${res.status} to ${name}: ${msg}`);
      }
      return { status: res.status, text: async () => text, json };
    }
  }

  const draftRef = (j: unknown): DraftRef => {
    const d = j as { id?: string; message?: { id?: string; threadId?: string } };
    if (!d?.id || !d.message?.id || !d.message.threadId) throw new GmailError(502, 'Gmail’s answer had no draft id.');
    return { draftId: d.id, messageId: d.message.id, threadId: d.message.threadId };
  };
  const message = (raw: string, threadId?: string | null) => (threadId ? { raw, threadId } : { raw });

  return {
    async profile() {
      const r = await call('users.getProfile', 'GET', '/gmail/v1/users/me/profile');
      const email = (r.json as { emailAddress?: string } | null)?.emailAddress;
      if (!email) throw new GmailError(502, 'Gmail did not say which address this is.');
      return { emailAddress: email };
    },
    async createDraft(raw, threadId) {
      const r = await call('users.drafts.create', 'POST', '/gmail/v1/users/me/drafts', [], { message: message(raw, threadId) });
      if (r.status === 404) throw new GmailError(404, 'Gmail could not find the thread to put this draft in.');
      return draftRef(r.json);
    },
    async updateDraft(draftId, raw, threadId) {
      const r = await call('users.drafts.update', 'PUT', `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, [], { id: draftId, message: message(raw, threadId) });
      if (r.status === 404) throw new GmailError(404, 'That draft is no longer in Gmail.');
      return draftRef(r.json);
    },
    async getDraft(draftId) {
      const r = await call('users.drafts.get', 'GET', `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, [['format', 'minimal']]);
      return r.status === 404 ? null : draftRef(r.json);
    },
    async threadHeaders(threadId) {
      const r = await call('users.threads.get', 'GET', `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`, [['format', 'metadata'], ...HEADERS.map((h): [string, string] => ['metadataHeaders', h])]);
      if (r.status === 404) return [];
      return ((r.json as { messages?: GmailMessage[] } | null)?.messages ?? []).map(headerSet);
    },
    async messageHeaders(id) {
      const r = await call('users.messages.get', 'GET', `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, [['format', 'metadata'], ...HEADERS.map((h): [string, string] => ['metadataHeaders', h])]);
      return r.status === 404 ? null : headerSet(r.json as GmailMessage);
    },
  };
}

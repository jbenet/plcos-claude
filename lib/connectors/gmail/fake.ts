import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { header, parseMime } from '@/lib/email/mime-parse';
import { GMAIL_ORIGIN, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, SCOPES } from './allowlist';
import type { GoogleRequest, GoogleResponse, GoogleTransport } from './fetch';

/**
 * A fake Google for the demo, the properties and the end-to-end check (docs/25 §Testing). It
 * answers the OAuth token and revoke endpoints and the Gmail endpoints the client uses, with
 * invented accounts and tokens, and keeps its mailbox in a JSON file beside the demo database so
 * a test can read what arrived. It never touches the network.
 *
 * It also answers users.drafts.send and users.messages.send — and records the attempt — so a
 * property can show that the guard, not the fake, is what stops a send.
 */

export const FAKE_CLIENT = { clientId: 'fake-client-id.apps.example.test', clientSecret: 'fake-client-secret-invented' };
export const FAKE_DOMAIN = 'fake-gmail.example.test';

interface FakeMessage { threadId: string; raw: string; labels: string[]; headers: Record<string, string> }
interface Mailbox {
  drafts: Record<string, string>;
  messages: Record<string, FakeMessage>;
  threads: Record<string, string[]>;
}
export interface FakeState {
  codes: Record<string, { challenge: string; redirectUri: string; scopes: string[]; email: string; expiresAt: number }>;
  access: Record<string, { email: string; scopes: string[]; expiresAt: number }>;
  refresh: Record<string, { email: string; scopes: string[] }>;
  mailboxes: Record<string, Mailbox>;
  sendAttempts: Array<{ at: string; path: string }>;
  revoked: number;
}

const empty = (): FakeState => ({ codes: {}, access: {}, refresh: {}, mailboxes: {}, sendAttempts: [], revoked: 0 });
const file = (dir: string) => join(dir, 'google.json');

const queues = new Map<string, Promise<unknown>>();
/** One change at a time per file: the demo server answers requests concurrently. */
async function withState<T>(dir: string, work: (s: FakeState) => T | Promise<T>): Promise<T> {
  const prev = queues.get(dir) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    let s: FakeState;
    try { s = { ...empty(), ...(JSON.parse(await readFile(file(dir), 'utf8')) as FakeState) }; } catch { s = empty(); }
    const out = await work(s);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(`${file(dir)}.tmp`, JSON.stringify(s, null, 1), { mode: 0o600 });
    await rename(`${file(dir)}.tmp`, file(dir));
    return out;
  });
  queues.set(dir, run);
  return run;
}

export async function readFake(dir: string): Promise<FakeState> {
  try { return { ...empty(), ...(JSON.parse(await readFile(file(dir), 'utf8')) as FakeState) }; } catch { return empty(); }
}

const id = (n = 8) => randomBytes(n).toString('hex');
const json = (status: number, body: unknown): GoogleResponse => ({ status, text: async () => JSON.stringify(body) });
const gerr = (status: number, message: string) => json(status, { error: { code: status, message } });

/** The consent screen, answered at once: the demo's "Allow". Returns where to send the browser. */
export async function fakeConsent(dir: string, q: URLSearchParams): Promise<string> {
  const redirect = new URL(q.get('redirect_uri') ?? '');
  if (q.get('client_id') !== FAKE_CLIENT.clientId) throw new Error('Unknown client.');
  if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) throw new Error('PKCE is required.');
  const code = `fake-code-${id()}`;
  const hint = q.get('login_hint') ?? '';
  const email = hint.endsWith(`@${FAKE_DOMAIN}`) ? hint : `someone@${FAKE_DOMAIN}`;
  await withState(dir, (s) => {
    s.codes[code] = { challenge: q.get('code_challenge')!, redirectUri: redirect.toString(), scopes: (q.get('scope') ?? '').split(' ').filter(Boolean), email, expiresAt: Date.now() + 5 * 60_000 };
  });
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', q.get('state') ?? '');
  redirect.searchParams.set('scope', q.get('scope') ?? '');
  return redirect.toString();
}

function headersOf(raw: string): Record<string, string> {
  const top = parseMime(raw);
  const out: Record<string, string> = {};
  for (const h of ['Message-ID', 'References', 'In-Reply-To', 'Subject', 'To', 'Cc', 'From']) {
    const v = header(top, h);
    if (v !== null) out[h] = v;
  }
  return out;
}

const metadata = (gmailId: string, m: FakeMessage) => ({
  id: gmailId, threadId: m.threadId, labelIds: m.labels,
  payload: { headers: Object.entries(m.headers).map(([name, value]) => ({ name, value })) },
});

/** The fake Google, as a transport. Use it under `guarded`, as the client does. */
export function fakeTransport(dir: string, opts: { now?: () => number } = {}): GoogleTransport {
  const now = opts.now ?? (() => Date.now());
  return (url: URL, init: GoogleRequest) => withState(dir, (s): GoogleResponse => {
    const form = new URLSearchParams(init.body ?? '');
    if (url.href === GOOGLE_TOKEN_URL) {
      if (form.get('client_id') !== FAKE_CLIENT.clientId || form.get('client_secret') !== FAKE_CLIENT.clientSecret) return json(401, { error: 'invalid_client' });
      if (form.get('grant_type') === 'authorization_code') {
        const c = s.codes[form.get('code') ?? ''];
        delete s.codes[form.get('code') ?? ''];
        const verifier = form.get('code_verifier') ?? '';
        if (!c || c.expiresAt < now() || c.redirectUri !== form.get('redirect_uri') || createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant' });
        const access = `fake-at-${id(16)}`, refresh = `fake-rt-${id(16)}`;
        s.access[access] = { email: c.email, scopes: c.scopes, expiresAt: now() + 3600_000 };
        s.refresh[refresh] = { email: c.email, scopes: c.scopes };
        s.mailboxes[c.email] ??= { drafts: {}, messages: {}, threads: {} };
        return json(200, { access_token: access, expires_in: 3599, refresh_token: refresh, scope: c.scopes.join(' '), token_type: 'Bearer' });
      }
      const r = s.refresh[form.get('refresh_token') ?? ''];
      if (!r) return json(400, { error: 'invalid_grant' });
      const access = `fake-at-${id(16)}`;
      s.access[access] = { email: r.email, scopes: r.scopes, expiresAt: now() + 3600_000 };
      return json(200, { access_token: access, expires_in: 3599, scope: r.scopes.join(' '), token_type: 'Bearer' });
    }
    if (url.href === GOOGLE_REVOKE_URL) {
      const t = form.get('token') ?? '';
      const owner = s.refresh[t]?.email ?? s.access[t]?.email;
      if (!owner) return json(400, { error: 'invalid_token' });
      delete s.refresh[t];
      delete s.access[t];
      s.revoked++;
      return json(200, {});
    }
    if (url.origin !== GMAIL_ORIGIN) return json(404, {});

    const bearer = /^Bearer (.+)$/.exec(init.headers.authorization ?? '')?.[1] ?? '';
    const grant = s.access[bearer];
    if (!grant || grant.expiresAt < now()) return gerr(401, 'Request had invalid authentication credentials.');
    const box = (s.mailboxes[grant.email] ??= { drafts: {}, messages: {}, threads: {} });
    const p = url.pathname;
    const body = init.body ? (JSON.parse(init.body) as { message?: { raw?: string; threadId?: string } }) : {};

    if (/\/send$/.test(p) || (init.method === 'POST' && p === '/gmail/v1/users/me/messages')) {
      s.sendAttempts.push({ at: new Date(now()).toISOString(), path: p });
      return json(200, { id: id(), labelIds: ['SENT'] });
    }
    if (init.method === 'GET' && p === '/gmail/v1/users/me/profile') {
      return json(200, { emailAddress: grant.email, messagesTotal: Object.keys(box.messages).length, threadsTotal: Object.keys(box.threads).length });
    }
    const store = (raw64: string | undefined, threadId: string | undefined): { gmailId: string; threadId: string } | GoogleResponse => {
      if (!raw64) return gerr(400, 'Missing message.raw');
      const raw = Buffer.from(raw64, 'base64url').toString('utf8');
      if (threadId && !box.threads[threadId]) return gerr(404, 'Requested entity was not found.');
      const gmailId = id();
      const t = threadId ?? id();
      box.messages[gmailId] = { threadId: t, raw, labels: ['DRAFT'], headers: headersOf(raw) };
      (box.threads[t] ??= []).push(gmailId);
      return { gmailId, threadId: t };
    };
    if (init.method === 'POST' && p === '/gmail/v1/users/me/drafts') {
      const m = store(body.message?.raw, body.message?.threadId);
      if ('status' in m) return m;
      const draftId = `r${BigInt(`0x${id(6)}`).toString()}`;
      box.drafts[draftId] = m.gmailId;
      return json(200, { id: draftId, message: { id: m.gmailId, threadId: m.threadId, labelIds: ['DRAFT'] } });
    }
    const draft = /^\/gmail\/v1\/users\/me\/drafts\/([^/]+)$/.exec(p)?.[1];
    if (draft) {
      const current = box.drafts[draft];
      if (!current) return gerr(404, 'Requested entity was not found.');
      if (init.method === 'GET') return json(200, { id: draft, message: { id: current, threadId: box.messages[current]!.threadId } });
      // An update replaces the message: Gmail gives it a new id, in the same thread unless told otherwise.
      const old = box.messages[current]!;
      const m = store(body.message?.raw, body.message?.threadId ?? old.threadId);
      if ('status' in m) return m;
      delete box.messages[current];
      box.threads[old.threadId] = (box.threads[old.threadId] ?? []).filter((x) => x !== current);
      box.drafts[draft] = m.gmailId;
      return json(200, { id: draft, message: { id: m.gmailId, threadId: m.threadId, labelIds: ['DRAFT'] } });
    }
    const needsMetadata = () => !grant.scopes.includes(SCOPES.metadata) ? gerr(403, 'Request had insufficient authentication scopes.') : null;
    const thread = /^\/gmail\/v1\/users\/me\/threads\/([^/]+)$/.exec(p)?.[1];
    if (thread && init.method === 'GET') {
      const denied = needsMetadata();
      if (denied) return denied;
      const ids = box.threads[thread];
      if (!ids) return gerr(404, 'Requested entity was not found.');
      return json(200, { id: thread, messages: ids.map((m) => metadata(m, box.messages[m]!)) });
    }
    const msg = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(p)?.[1];
    if (msg && init.method === 'GET') {
      const denied = needsMetadata();
      if (denied) return denied;
      const m = box.messages[msg];
      return m ? json(200, metadata(msg, m)) : gerr(404, 'Requested entity was not found.');
    }
    return gerr(404, 'Not found.');
  });
}

/**
 * The person pressing Send in Gmail, for the properties: the draft becomes a sent message in its
 * thread. `newMessageId` imitates Gmail giving the sent message a Message-ID of its own.
 */
export async function fakeSendInGmail(dir: string, email: string, draftId: string, newMessageId?: string): Promise<void> {
  await withState(dir, (s) => {
    const box = s.mailboxes[email];
    const gmailId = box?.drafts[draftId];
    if (!box || !gmailId) throw new Error('No such draft.');
    delete box.drafts[draftId];
    const m = box.messages[gmailId]!;
    m.labels = ['SENT'];
    if (newMessageId) m.headers['Message-ID'] = newMessageId;
  });
}

/** An answer in the thread, from the other side, for the properties. */
export async function fakeReceive(dir: string, email: string, threadId: string, headers: Record<string, string>): Promise<string> {
  return withState(dir, (s) => {
    const box = s.mailboxes[email]!;
    const gmailId = id();
    box.messages[gmailId] = { threadId, raw: '', labels: ['INBOX'], headers };
    (box.threads[threadId] ??= []).push(gmailId);
    return gmailId;
  });
}

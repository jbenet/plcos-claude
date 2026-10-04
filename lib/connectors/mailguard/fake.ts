import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MailguardRequest, MailguardResponse, MailguardTransport } from './client';
import { KNOWN_CAPABILITIES } from './scope';

/**
 * A fake mailguard for the demo, the properties and the end-to-end check (docs/25 §12). It answers the
 * four endpoints the client uses — and the send routes, recording each attempt, so a property can show
 * that our guard, not the fake, is what stops a send. Its keys are invented, with whatever grant a test
 * gives them; its mailbox is a JSON file beside the demo database. It never touches the network.
 *
 * It imitates mailguard's REST surface as read on 3 Oct 2026 (src/lib/rest.ts, actions.ts, gate.ts):
 * effective capabilities are the system grant ∩ the tool's; a key sees only drafts it made; a reply
 * takes the original's thread and headers; errors are `{error, layer, rule, requestId}`.
 */

export const FAKE_BASE = new URL('https://mailguard.fake.example.test');
export const FAKE_DOMAIN = 'fake-gmail.example.test';

interface FakeKey { mailbox: string; tool: string; grant: string[]; systemGrant: string[]; revoked: boolean; expiresAt?: string; drafts: string[] }
export interface FakeMessage {
  threadId: string; labels: string[]; messageIdHeader: string; subject: string;
  to: string[]; cc: string[]; bcc: string[]; text: string; html: string | null;
  attachments: Array<{ filename: string; mimeType: string; bytes: number }>;
  inReplyTo: string | null; references: string | null;
}
interface Mailbox { drafts: Record<string, string>; messages: Record<string, FakeMessage>; threads: Record<string, string[]> }
export interface FakeState {
  keys: Record<string, FakeKey>;
  mailboxes: Record<string, Mailbox>;
  sendAttempts: Array<{ at: string; path: string }>;
  /** Every request that reached the fake, by action, for the properties. */
  calls: Record<string, number>;
}

const empty = (): FakeState => ({ keys: {}, mailboxes: {}, sendAttempts: [], calls: {} });
const file = (dir: string) => join(dir, 'mailguard.json');

const queues = new Map<string, Promise<unknown>>();
/** One change at a time per file: the demo server answers requests concurrently. */
async function withState<T>(dir: string, work: (s: FakeState) => T | Promise<T>): Promise<T> {
  const prev = queues.get(dir) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const s = await readFake(dir);
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

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const alnum = (n: number) => Array.from(randomBytes(n), (b) => ALNUM[b % ALNUM.length]).join('');
const id = (n = 8) => randomBytes(n).toString('hex');
const json = (status: number, body: unknown): MailguardResponse => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const refuse = (status: number, error: string, layer?: string, rule?: string) => json(status, { error, ...(layer ? { layer } : {}), ...(rule ? { rule } : {}), requestId: `fake-${id(4)}` });

const grants = (list: string[], cap: string) => list.includes('*') || list.includes(cap) || (/^(read|organize)\./.test(cap) && list.includes(`${cap.split('.')[0]}.*`));
const effective = (k: FakeKey) => KNOWN_CAPABILITIES.filter((c) => grants(k.systemGrant, c) && grants(k.grant, c));

/** Make an invented key for a mailbox, with a grant. The default is the drafts-only one we accept. */
export async function fakeMintKey(dir: string, o: { mailbox: string; tool?: string; grant?: string[]; systemGrant?: string[]; expiresAt?: string }): Promise<string> {
  const key = `mg_${alnum(12)}_${alnum(40)}`;
  await withState(dir, (s) => {
    s.keys[key] = { mailbox: o.mailbox.toLowerCase(), tool: o.tool ?? 'PLC Raise Tools (demo)', grant: o.grant ?? ['draft', 'read.metadata'], systemGrant: o.systemGrant ?? ['*'], revoked: false, drafts: [], ...(o.expiresAt ? { expiresAt: o.expiresAt } : {}) };
    s.mailboxes[o.mailbox.toLowerCase()] ??= { drafts: {}, messages: {}, threads: {} };
  });
  return key;
}

/** Change a key's grant at "mailguard", as a person editing the tool's policy would. */
export async function fakeSetGrant(dir: string, key: string, grant: string[]): Promise<void> {
  await withState(dir, (s) => { if (s.keys[key]) s.keys[key]!.grant = grant; });
}

export async function fakeRevoke(dir: string, key: string): Promise<void> {
  await withState(dir, (s) => { if (s.keys[key]) s.keys[key]!.revoked = true; });
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : []).map((x) => x.trim()).filter(Boolean);

/** The fake mailguard, as a transport. Use it under `guarded`, as the client does. */
export function fakeTransport(dir: string, opts: { now?: () => number } = {}): MailguardTransport {
  const now = opts.now ?? (() => Date.now());
  return (url: URL, init: MailguardRequest) => withState(dir, (s): MailguardResponse => {
    const p = url.pathname;
    const count = (name: string) => { s.calls[name] = (s.calls[name] ?? 0) + 1; };
    if (url.origin !== FAKE_BASE.origin) return refuse(404, 'Not found');
    const bearer = /^Bearer (\S+)$/.exec(init.headers.authorization ?? '')?.[1] ?? '';
    const k = s.keys[bearer];
    if (!bearer) return refuse(401, 'Missing bearer key', 'auth', 'missing');
    if (!k) return refuse(401, 'Invalid key', 'auth', 'wrong-secret');
    if (k.revoked) return refuse(401, 'This key was revoked', 'auth', 'revoked');
    const box = (s.mailboxes[k.mailbox] ??= { drafts: {}, messages: {}, threads: {} });
    const caps = effective(k);
    const expired = k.expiresAt !== undefined && Date.parse(k.expiresAt) <= now();
    const may = (cap: string) => !expired && caps.includes(cap as never);
    const body = (init.body ? JSON.parse(init.body) : {}) as Record<string, unknown>;

    // The send routes answer — so only the guard in front can be what stops one.
    if ((init.method === 'POST' && p === '/api/v1/messages/send') || /^\/api\/v1\/drafts\/[^/]+\/send$/.test(p)) {
      count('send');
      s.sendAttempts.push({ at: new Date(now()).toISOString(), path: p });
      return json(200, { id: id(), threadId: id(), labels: ['SENT'] });
    }
    if (init.method === 'GET' && p === '/api/v1/me') {
      count('whoami');
      return json(200, {
        tool: k.tool, mailbox: k.mailbox, capabilities: expired ? [] : caps,
        layers: [{ layer: 'system', policy: { grant: k.systemGrant } }, { layer: 'tool', policy: { grant: k.grant, ...(k.expiresAt ? { expiresAt: k.expiresAt } : {}) } }],
      });
    }
    const write = (draftId: string | null): MailguardResponse => {
      if (!may('draft')) return refuse(403, 'Denied by tool policy (grant): drafts are not allowed', 'tool', 'grant');
      let threadId: string | null = null;
      let inReplyTo: string | null = null;
      let references: string | null = null;
      let subject = String(body.subject ?? '');
      if (typeof body.replyTo === 'string') {
        if (!may('read.metadata')) return refuse(403, 'Denied by tool policy (grant): reading headers is not allowed', 'tool', 'grant');
        const orig = box.messages[body.replyTo];
        if (!orig) return refuse(404, 'Message not found');
        threadId = orig.threadId;
        inReplyTo = orig.messageIdHeader;
        references = [orig.references, orig.messageIdHeader].filter(Boolean).join(' ');
        if (!subject) subject = /^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`;
      }
      const to = list(body.to), cc = list(body.cc), bcc = list(body.bcc);
      const addr = /^(?:"?[^"<>]*"?\s*<)?[^\s@<>]+@[^\s@<>]+>?$/;
      if (![...to, ...cc, ...bcc].every((a) => addr.test(a))) return refuse(400, 'Not a valid address');
      const atts = Array.isArray(body.attachments) ? body.attachments as Array<{ filename?: unknown; mimeType?: unknown; data?: unknown }> : [];
      if (!atts.every((a) => typeof a.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(a.data))) return refuse(400, 'not base64');
      let oldThread: string | null = null;
      if (draftId) {
        const current = box.drafts[draftId];
        if (!k.drafts.includes(draftId) || !current) return refuse(404, 'Draft not found');
        oldThread = box.messages[current]!.threadId;
        delete box.messages[current];
        box.threads[oldThread] = (box.threads[oldThread] ?? []).filter((x) => x !== current);
      }
      const gmailId = id();
      const t = threadId ?? oldThread ?? id();
      box.messages[gmailId] = {
        threadId: t, labels: ['DRAFT'], messageIdHeader: `<fake-${id(6)}@mail.${FAKE_DOMAIN}>`, subject, to, cc, bcc,
        text: String(body.text ?? ''), html: typeof body.html === 'string' ? body.html : null,
        attachments: atts.map((a) => ({ filename: String(a.filename), mimeType: String(a.mimeType), bytes: Buffer.from(String(a.data), 'base64').length })),
        inReplyTo, references,
      };
      (box.threads[t] ??= []).push(gmailId);
      const did = draftId ?? `r${BigInt(`0x${id(6)}`).toString()}`;
      box.drafts[did] = gmailId;
      if (!k.drafts.includes(did)) k.drafts.push(did);
      return json(200, { id: did, message: { id: gmailId, threadId: t, labels: ['DRAFT'], subject, to: to.join(', ') } });
    };
    if (init.method === 'POST' && p === '/api/v1/drafts') { count('drafts.create'); return write(null); }
    const draft = /^\/api\/v1\/drafts\/([^/]+)$/.exec(p)?.[1];
    if (draft && init.method === 'PUT') { count('drafts.update'); return write(draft); }
    const thread = /^\/api\/v1\/threads\/([^/]+)$/.exec(p)?.[1];
    if (thread && init.method === 'GET') {
      count('threads.get');
      const cap = url.searchParams.get('format') === 'metadata' ? 'read.metadata' : 'read.body';
      if (!may(cap)) return refuse(403, `Denied by tool policy (grant): ${cap} is not allowed`, 'tool', 'grant');
      const ids = box.threads[thread];
      if (!ids?.length) return refuse(404, 'Thread not found');
      return json(200, { id: thread, messages: ids.map((m) => { const x = box.messages[m]!; return { id: m, threadId: x.threadId, labels: x.labels, subject: x.subject, date: '' }; }) });
    }
    count('other');
    return refuse(404, `No route ${init.method} ${p}`);
  });
}

/** The person pressing Send in Gmail: the draft becomes a sent message, which Gmail gives its own Message-ID. */
export async function fakeSendInGmail(dir: string, mailbox: string, draftId: string): Promise<void> {
  await withState(dir, (s) => {
    const box = s.mailboxes[mailbox];
    const gmailId = box?.drafts[draftId];
    if (!box || !gmailId) throw new Error('No such draft.');
    delete box.drafts[draftId];
    const m = box.messages[gmailId]!;
    m.labels = ['SENT'];
    m.messageIdHeader = `<sent-${id(6)}@mail.${FAKE_DOMAIN}>`;
  });
}

/** An answer in the thread, from the other side. Returns its Gmail id. */
export async function fakeReceive(dir: string, mailbox: string, threadId: string, subject: string): Promise<string> {
  return withState(dir, (s) => {
    const box = s.mailboxes[mailbox]!;
    const before = (box.threads[threadId] ?? []).map((m) => box.messages[m]!).filter((m) => !m.labels.includes('DRAFT')).at(-1);
    const gmailId = id();
    box.messages[gmailId] = {
      threadId, labels: ['INBOX'], messageIdHeader: `<answer-${id(6)}@example.org>`, subject, to: [mailbox], cc: [], bcc: [], text: '', html: null, attachments: [],
      inReplyTo: before?.messageIdHeader ?? null, references: before ? [before.references, before.messageIdHeader].filter(Boolean).join(' ') : null,
    };
    (box.threads[threadId] ??= []).push(gmailId);
    return gmailId;
  });
}

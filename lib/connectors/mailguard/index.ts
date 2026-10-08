import { config } from '@/config/deployment';
import { KEY_FORMAT, parseBase } from './allowlist';
import { DraftOnlyViolation, httpsTransport, MailguardError, mailguardClient, type MailguardClient, type MailguardRequestLog, type MailguardTransport } from './client';
import { FAKE_BASE, fakeTransport } from './fake';
import { domainOf, draftOnlyVerdict, type CalendarAccess, type RefusalCode } from './scope';
import { databaseStore, fileStore, keychainStore, memoryStore, type TokenStore } from './tokens';
import { deployedServer } from '@/config/sign-in';
import { settingValue } from '@/lib/settings/store';
import { MAILGUARD_ADDRESS_SETTING } from './setting';

/**
 * Which mailguard this server talks to, and where each person's key is kept (docs/25 §12).
 *
 *   mailguard  the live server only: mailguard's address from MAILGUARD_URL, else Settings → Connections
 *              (lib/connectors/mailguard/setting.ts), else config; keys from the
 *              Keychain — pasted ones per person, and Juan's from MAILGUARD_TOKEN, which
 *              scripts/with-mailguard-token.sh reads from `plcos-claude / mailguard-token`.
 *   fake       the demo, always: lib/connectors/mailguard/fake.ts, beside the demo database.
 *   off        everything else — a preview (a copy of the real data) above all, which never sees a key.
 *
 * MAILGUARD_TOKEN and MAILGUARD_URL are read here and nowhere else (npm run boundaries).
 *
 * Every key is checked with mailguard's own `GET /api/v1/me` before it is used: when it is pasted (a
 * refused key is not stored), at server start, before every move, and at least daily. A key that can
 * send, or whose permissions cannot be read, is refused and drafting stops for that person.
 */

export interface MailguardRuntime {
  mode: 'mailguard' | 'fake';
  base: URL;
  transport: MailguardTransport;
  store: TokenStore;
  /** The key from the Keychain item, and whose it is. */
  envKey: { handle: string; key: string } | null;
  /** Where the fake keeps its mailbox; null for mailguard. */
  fakeDir: string | null;
}
export type RuntimeState = MailguardRuntime | { mode: 'off'; why: string };

export const fakeDir = () => `${config.db.localDir.replace(/\/+$/, '')}.mailguard-fake`;

export function mailguardRuntime(overrides: Partial<MailguardRuntime> = {}): RuntimeState {
  if (config.email.provider !== 'mailguard') return { mode: 'off', why: 'Email drafts are off on this server (config.email.provider).' };
  if (config.data.profile === 'demo') {
    const dir = overrides.fakeDir ?? fakeDir();
    return { mode: 'fake', base: FAKE_BASE, transport: fakeTransport(dir), store: fileStore(`${dir}/tokens.json`), envKey: null, fakeDir: dir, ...overrides };
  }
  if (config.data.copyTakenAt) return { mode: 'off', why: 'This is a preview, a copy of the real data: it never holds anyone’s mailguard token.' };
  const base = parseBase(settingValue(MAILGUARD_ADDRESS_SETTING.key) ?? config.email.mailguard.url);
  if (!(base instanceof URL)) return { mode: 'off', why: base.why };
  const key = process.env.MAILGUARD_TOKEN?.trim();
  return {
    // A deployed server keeps each person's key in the database, encrypted; the Mac keeps the Keychain.
    mode: 'mailguard', base, transport: httpsTransport(), store: deployedServer() ? databaseStore() : keychainStore(),
    envKey: key ? { handle: config.email.mailguard.keychainTokenFor, key } : null, fakeDir: null, ...overrides,
  };
}

export type KeySource = 'pasted' | 'keychain';

/** What a check found. Never holds the key. */
export type Inspection =
  | { ok: true; mailbox: string; tool: string; capabilities: string[]; canThread: boolean; extras: string[]; calendar: CalendarAccess; source: KeySource; at: number }
  | { ok: false; code: RefusalCode | MailguardError['kind'] | 'violation' | 'format'; reason: string; mailbox: string | null; tool: string | null; capabilities: string[]; source: KeySource; at: number };

/** The person's key: one they pasted, else the Keychain item's if it is theirs. */
export async function keyFor(rt: MailguardRuntime, handle: string): Promise<{ key: string; source: KeySource } | null> {
  const pasted = await rt.store.get(handle);
  if (pasted) return { key: pasted, source: 'pasted' };
  if (rt.envKey && rt.envKey.handle === handle) return { key: rt.envKey.key, source: 'keychain' };
  return null;
}

/** Read a key's permissions from mailguard, without using them. One `GET /api/v1/me`. */
export async function inspect(rt: MailguardRuntime, key: string, source: KeySource, log?: (e: MailguardRequestLog) => void): Promise<Inspection> {
  const at = Date.now();
  if (!KEY_FORMAT.test(key)) return { ok: false, code: 'format', reason: 'That is not a mailguard token: it looks like mg_, twelve letters or digits, _, and forty more. Nothing was sent.', mailbox: null, tool: null, capabilities: [], source, at };
  try {
    const answer = await mailguardClient({ transport: rt.transport, base: rt.base, key, log }).whoami();
    const v = draftOnlyVerdict(answer, at);
    return v.ok ? { ...v, source, at } : { ok: false, code: v.code, reason: v.reason, mailbox: v.mailbox, tool: v.tool, capabilities: v.capabilities, source, at };
  } catch (e) {
    if (e instanceof MailguardError) return { ok: false, code: e.kind, reason: e.message, mailbox: null, tool: null, capabilities: [], source, at };
    if (e instanceof DraftOnlyViolation) return { ok: false, code: 'violation', reason: e.message, mailbox: null, tool: null, capabilities: [], source, at };
    throw e;
  }
}

const checks = new Map<string, Inspection>();
const cacheKey = (rt: MailguardRuntime, handle: string) => `${rt.mode}:${rt.fakeDir ?? rt.base.origin}:${handle}`;
/** GUESS: once a day is often enough to catch a widened key between moves; every move checks anyway. */
export const RECHECK_MS = 24 * 3600_000;
/** GUESS: after mailguard could not be reached, a page asks again five minutes later. */
const RETRY_TRANSIENT_MS = 5 * 60_000;
/** A check that failed because mailguard did not answer, not because of what the key may do. Still no drafting meanwhile. */
export const isTransient = (code: string | null) => code === 'unreachable' || code === 'unavailable' || code === 'rate_limited';

export interface Connection { inspection: Inspection | null; source: KeySource | null }

/** The person's connection, checked at most a day ago (a check is one `GET /me`). */
export async function connection(rt: MailguardRuntime, handle: string, maxAgeMs = RECHECK_MS): Promise<Connection> {
  const k = await keyFor(rt, handle);
  if (!k) { checks.delete(cacheKey(rt, handle)); return { inspection: null, source: null }; }
  const hit = checks.get(cacheKey(rt, handle));
  // A failure to reach mailguard is not a verdict on the key: ask again sooner.
  const transient = hit && !hit.ok && isTransient(hit.code);
  if (hit && hit.source === k.source && Date.now() - hit.at < (transient ? Math.min(maxAgeMs, RETRY_TRANSIENT_MS) : maxAgeMs)) return { inspection: hit, source: k.source };
  const fresh = await inspect(rt, k.key, k.source);
  checks.set(cacheKey(rt, handle), fresh);
  return { inspection: fresh, source: k.source };
}

export class KeyRefused extends Error {
  constructor(readonly inspection: Inspection & { ok: false }) {
    super(inspection.reason);
    this.name = 'KeyRefused';
  }
}

export class NotConnected extends Error {
  constructor() { super('Connect a drafts-only mailguard token first, in Preferences → Email.'); this.name = 'NotConnected'; }
}

/** Check a pasted key and keep it only if it is drafts-only. A refused key is never stored. */
export async function connectKey(rt: MailguardRuntime, handle: string, raw: string): Promise<Inspection & { ok: true }> {
  const key = raw.trim();
  const i = await inspect(rt, key, 'pasted');
  if (!i.ok) throw new KeyRefused(i);
  await rt.store.put(handle, key);
  checks.set(cacheKey(rt, handle), i);
  return i;
}

/** Forget a pasted key here. It is not revoked at mailguard: that is done there. */
export async function forgetKey(rt: MailguardRuntime, handle: string): Promise<{ hadPasted: boolean; keychainRemains: boolean }> {
  const hadPasted = !!(await rt.store.get(handle));
  await rt.store.delete(handle);
  checks.delete(cacheKey(rt, handle));
  return { hadPasted, keychainRemains: rt.envKey?.handle === handle };
}

/**
 * A client acting as this person, after a fresh check of their key. Every move comes through here, so
 * a key widened at mailguard since it was connected is refused before anything is written.
 */
export async function checkedClient(rt: MailguardRuntime, handle: string, log?: (e: MailguardRequestLog) => void): Promise<{ client: MailguardClient; inspection: Inspection & { ok: true } }> {
  const k = await keyFor(rt, handle);
  if (!k) throw new NotConnected();
  const i = await inspect(rt, k.key, k.source, log);
  checks.set(cacheKey(rt, handle), i);
  if (!i.ok) throw new KeyRefused(i);
  return { client: mailguardClient({ transport: rt.transport, base: rt.base, key: k.key, log }), inspection: i };
}

/** Server start: check the Keychain key once and say what was found — never the key, only the mailbox's domain. */
export async function checkAtStart(): Promise<void> {
  const rt = mailguardRuntime();
  if (rt.mode !== 'mailguard' || !rt.envKey) return;
  const i = await inspect(rt, rt.envKey.key, 'keychain');
  checks.set(cacheKey(rt, rt.envKey.handle), i);
  if (i.ok) console.log(`[mailguard] The Keychain token for ${rt.envKey.handle} is drafts-only (a mailbox at ${domainOf(i.mailbox)}).`);
  else console.error(`[mailguard] Refused the Keychain token for ${rt.envKey.handle} (${i.code}): ${i.reason} Email drafting is off for ${rt.envKey.handle}.`);
}

/**
 * `npm run mailguard:check`: one `GET /api/v1/me` with the Keychain key, outside any server. Only the
 * verdict, the reason's code and the mailbox's domain come back — never the key or the address.
 */
export async function checkKeychainKey(): Promise<{ ok: boolean; code: string | null; reason: string | null; domain: string | null; canThread: boolean; extras: string[] }> {
  const base = parseBase(process.env.MAILGUARD_URL ?? config.email.mailguard.url);
  if (!(base instanceof URL)) return { ok: false, code: 'not_set', reason: base.why, domain: null, canThread: false, extras: [] };
  const key = process.env.MAILGUARD_TOKEN?.trim();
  if (!key) return { ok: false, code: 'not_set', reason: 'No token in the environment: run it through scripts/with-mailguard-token.sh (npm run mailguard:check does).', domain: null, canThread: false, extras: [] };
  const i = await inspect({ mode: 'mailguard', base, transport: httpsTransport(), store: memoryStore(), envKey: null, fakeDir: null }, key, 'keychain');
  return i.ok
    ? { ok: true, code: null, reason: null, domain: domainOf(i.mailbox), canThread: i.canThread, extras: i.extras }
    : { ok: false, code: i.code, reason: i.reason, domain: i.mailbox ? domainOf(i.mailbox) : null, canThread: false, extras: [] };
}

export { ALLOWED, MUST_REFUSE, KEY_FORMAT } from './allowlist';
export type { MailguardClient, MailguardRequestLog, DraftFields, DraftRef } from './client';
export { DraftOnlyViolation, MailguardError } from './client';
export { CAN_SEND, CAN_NOTIFY, domainOf } from './scope';
export type { CalendarAccess } from './scope';
export { fakeMintKey, readFake, FAKE_DOMAIN } from './fake';

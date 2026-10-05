/**
 * Settings, /setup and Google sign-in (docs/deploy/railway.md §3), on invented data and a fake Google:
 *   - encryption at rest: the raw row holds no plaintext, and a value moved to another key does not decrypt;
 *   - the environment wins, and the app (the store and the Connections action) cannot change an env-set field;
 *   - validation refuses a URL with credentials, javascript:, CRLF and an unknown key;
 *   - setup is open only until Google is configured, behind the code; wrong codes are limited per address
 *     (an IPv6 /64 counts once) and in total; a failed attempt writes nothing; a cross-site POST is refused;
 *   - the session cookie: tampering, expiry and a raised epoch are each refused;
 *   - the callback, through the real route handlers with the fake Google: a bad state, an unverified email, a
 *     non-Workspace account, an unknown and an inactive email are refused and logged; a known one is admitted
 *     with their role;
 *   - a non-admin is refused on every Connections action and the page, and each refusal is logged;
 *   - no secret value reaches an audit row, the log, the Connections page or /setup (a decoy is searched for);
 *   - the key readers read the store when the environment is unset, and a preview copy gets no keys.
 */
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { createRequestStore } from 'next/dist/server/async-storage/request-store';
import { actionAsyncStorage } from 'next/dist/server/app-render/action-async-storage.external';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '../../config/deployment';
import { withDb } from '../../lib/db';
import { USER_COOKIE } from '../../lib/auth/cookie';
import { decrypt, encrypt } from '../../lib/settings/crypto';
import { forgetRootSecret, secretSource } from '../../lib/settings/key';
import { SETTINGS, settingDef } from '../../lib/settings/registry';
import { checkSettings, forgetSettings, googleConfigured, loadSettings, settingsView, settingValue, unreadableSettings, writeSettings } from '../../lib/settings/store';
import { SettingError } from '../../lib/settings/types';
import { addressKey, noteSetupFailure, resetSetupFloodgate, setupBlocked, SETUP_FAILS_PER_ADDRESS, SETUP_FAILS_TOTAL } from '../../lib/settings/floodgate';
import { announceAtBoot, announceSetup, retireSetupCode, setupCode, setupOpen, SETUP_DONE_KEY } from '../../lib/settings/setup';
import { runSetup } from '../../lib/settings/setup-service';
import { reporterOf, sessionClaims, sessionCookie, sessionValue, userFromSession } from '../../lib/auth/session';
import { resolveLocalUser } from '../../lib/auth/local-user';
import { bootRefusal, dataDir } from '../../lib/settings/key';
import { clientIp } from '../../lib/settings/floodgate';
import { takeCopy } from '../preview-copy';
import { databaseStore } from '../../lib/connectors/mailguard/tokens';
import { personSecret } from '../../lib/settings/person-secrets';
import { maskSecret } from '../../lib/settings/store';
import { readFile as readF } from 'node:fs/promises';
import { mkdtemp, mkdir as mkdirp, readdir, rm as rmrf, writeFile as writeF } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeConsent, GOOGLE_AUTHORIZE_URL, useFakeGoogle } from '../../lib/connectors/google-signin/signin';
import { googleClientId } from '../../lib/connectors/google-signin/client-settings';
import { affinityKey } from '../../lib/connectors/affinity/key';
import { linearKey } from '../../lib/connectors/linear/key';
import { anthropicKey } from '../../lib/workflows/key';
import { dakotaSignIn } from '../../lib/connectors/dakota/key';
import type { Check, Db } from './harness';

const DECOY = 'sk-ant-invented-DECOY-7f3a9c2e1b';
const ORIGIN = 'http://localhost:3113';
const PUBLIC = 'https://raise.example.test';
const CLIENT_ID = 'invented-12345.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-invented-secret-0042';

type Store = ReturnType<typeof createRequestStore>;
const store = (phase: 'action' | 'render', cookie: string, pathname: string): Store => createRequestStore({
  phase, headers: new Headers({ host: 'localhost:3113', origin: ORIGIN, 'sec-fetch-site': 'same-origin', cookie }),
  url: { pathname }, rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() }, resumeDataCache: null,
  onUpdateCookies: undefined, previewProps: undefined, isHmrRefresh: false, serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, fallbackParams: null,
});
const inRequest = <T>(db: Db, phase: 'action' | 'render', cookie: string, pathname: string, work: () => Promise<T>) =>
  withDb(db, () => workAsyncStorage.run({ route: pathname, isStaticGeneration: false, incrementalCache: {}, pendingRevalidatedTags: [] } as unknown as WorkStore,
    () => workUnitAsyncStorage.run(store(phase, cookie, pathname), () => phase === 'action' ? actionAsyncStorage.run({ isAction: true }, work) : work())));

/** Every string in a React element tree's props, server components left unexecuted: what the page hands down. */
function strings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) { for (const n of node) strings(n, out, seen); return out; }
  if (isValidElement(node)) { strings((node as { props: unknown }).props, out, seen); return out; }
  for (const v of Object.values(node as Record<string, unknown>)) strings(v, out, seen);
  return out;
}

export async function railwaySetupProperties(check: Check, db: Db) {
  const envNames = [...SETTINGS.map((d) => d.env).filter((e): e is string => !!e), 'PLCOS_SECRET'];
  const savedEnv = Object.fromEntries(envNames.map((n) => [n, process.env[n]]));
  const savedProvider = config.auth.provider;
  const savedData = { ...config.data };
  const logs: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); original[k](...a); };
  const juan = (await db.one<{ id: string; handle: string; email: string }>(`select id::text, handle, email from platform.app_user where handle = 'juan'`))!;
  const gp = (await db.one<{ id: string; handle: string }>(`insert into platform.app_user (handle, name, initials, role, email, access)
    values ('setup-props-gp', 'Invented Setup GP', 'IG', 'Invented (props)', 'setup-gp@example.invalid', 'gp') returning id::text, handle`))!;
  const inactive = (await db.one<{ id: string }>(`insert into platform.app_user (handle, name, initials, role, email, access, active)
    values ('setup-props-gone', 'Invented Gone', 'IX', 'Invented (props)', 'gone@example.invalid', 'gp', false) returning id::text`))!;
  let demoted: string[] = [];
  try {
    for (const n of envNames) delete process.env[n];
    process.env.PLCOS_SECRET = Buffer.alloc(32, 7).toString('base64'); // invented test key
    forgetRootSecret();
    await db.query('delete from platform.setting');
    forgetSettings();
    await loadSettings(db);
    resetSetupFloodgate();
    retireSetupCode();
    // Settings are kept only behind a real sign-in; the switcher case is checked on its own below.
    Object.assign(config.auth, { provider: 'google' });
    /** A session cookie for a person at their current epoch, under both names (__Host- over https, plain over http). */
    const sessionFor = async (id: string) => {
      const e = (await db.one<{ e: number }>('select session_epoch e from platform.app_user where id = $1', [id]))!.e;
      const v = encodeURIComponent(sessionValue({ id, sessionEpoch: e }, 30).value);
      return `${sessionCookie(true)}=${v}; ${sessionCookie(false)}=${v}`;
    };
    const upsertMarker = async () => {
      await db.query(`insert into platform.setting (key, value, secret) values ($1, $2, false) on conflict (key) do nothing`, [SETUP_DONE_KEY, new Date().toISOString()]);
      await loadSettings(db);
    };
    const settingRows = async () => (await db.one<{ n: number }>('select count(*)::int n from platform.setting'))!.n;
    const auditCount = async (actions: string[]) => (await db.one<{ n: number }>('select count(*)::int n from platform.audit_log where action = any($1)', [actions]))!.n;

    // ── Encryption at rest ────────────────────────────────────────────────────────────────────
    await withDb(db, () => writeSettings(checkSettings({ 'anthropic.apiKey': DECOY }), { actorId: juan.id, via: 'settings' }));
    const raw = (await db.one<{ value: string; secret: boolean }>(`select value, secret from platform.setting where key = 'anthropic.apiKey'`))!;
    let moved = false;
    try { decrypt(raw.value, 'linear.apiKey'); } catch { moved = true; }
    const view = settingsView().find((v) => v.key === 'anthropic.apiKey')!;
    check('SETTINGS secrets are encrypted at rest, one by one, and never shown again in full',
      raw.secret && !raw.value.includes(DECOY) && !raw.value.includes('DECOY') && settingValue('anthropic.apiKey') === DECOY && moved
        && view.shown === `••••${DECOY.slice(-4)}` && view.source === 'app' && encrypt(DECOY, 'k') !== encrypt(DECOY, 'k') && secretSource().source === 'env',
      'AES-256-GCM with a fresh IV, bound to its key (a value moved to another row does not decrypt); the view shows the last four only.');

    // ── The environment wins ─────────────────────────────────────────────────────────────────
    const anthropicEnv = settingDef('anthropic.apiKey')!.env!;
    process.env[anthropicEnv] = 'sk-ant-invented-from-env';
    let refusedSet = false, refusedClear = false;
    try { checkSettings({ 'anthropic.apiKey': 'sk-ant-invented-other' }); } catch (e) { refusedSet = e instanceof SettingError; }
    try { checkSettings({ 'anthropic.apiKey': null }); } catch (e) { refusedClear = e instanceof SettingError; }
    const { saveSettingAction } = await import('../../app/settings/connections/actions');
    const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
    const viaUi = await inRequest(db, 'action', await sessionFor(juan.id), '/settings/connections',
      () => saveSettingAction(null, form({ key: 'anthropic.apiKey', value: 'sk-ant-invented-other' })));
    const envView = settingsView().find((v) => v.key === 'anthropic.apiKey')!;
    check('SETTINGS an environment value wins, and neither the store nor the Connections action can change that field',
      settingValue('anthropic.apiKey') === 'sk-ant-invented-from-env' && refusedSet && refusedClear && viaUi?.ok === false
        && /environment/.test(viaUi.ok === false ? viaUi.error : '') && envView.source === 'env' && envView.shown === '' && anthropicKey() === 'sk-ant-invented-from-env',
      'With the variable set, set and clear are refused before writing; the page shows “set in the environment” and no characters of a secret.');
    delete process.env[anthropicEnv];

    // ── Validation ───────────────────────────────────────────────────────────────────────────
    const refuses = (patch: Record<string, string | null>) => { try { checkSettings(patch); return false; } catch (e) { return e instanceof SettingError; } };
    const bad: Array<Record<string, string>> = [
      { 'app.publicUrl': 'https://user:pw@raise.example.test' }, { 'app.publicUrl': 'javascript:alert(1)' },
      { 'app.publicUrl': 'https://raise.example.test/?x=1' }, { 'anthropic.apiKey': 'sk-ant-x\r\nHost: evil.example' },
      { 'google.clientId': 'not-a-client' }, { 'nope.key': 'x' }, { 'session.days': '365' },
    ];
    const before = await settingRows();
    check('SETTINGS validation refuses credentials in a URL, javascript:, CRLF, a bad client ID, an unknown key and an out-of-range number',
      bad.every(refuses) && !refuses({ 'app.publicUrl': `${PUBLIC}/` }) && checkSettings({ 'app.publicUrl': `${PUBLIC}/` })[0]!.value === PUBLIC && await settingRows() === before,
      `${bad.length} invented bad values refused, nothing written; a good address is normalized to its origin.`);

    // ── The Mac's user switcher keeps nothing ────────────────────────────────────────────────
    Object.assign(config.auth, { provider: 'local' });
    const switcherRefused = refuses({ 'mailguard.url': 'https://mail.example.test' });
    const switcherUi = await inRequest(db, 'action', `${USER_COOKIE}=${juan.handle}`, '/settings/connections',
      () => saveSettingAction(null, form({ key: 'mailguard.url', value: 'https://mail.example.test' })));
    check('SETTINGS under the Mac’s user switcher nothing is written, even by an admin, so nobody on the network can repoint a connector',
      switcherRefused && switcherUi?.ok === false && /deployed server/.test(switcherUi.ok === false ? switcherUi.error : '') && settingValue('mailguard.url') === undefined,
      'checkSettings refuses unless the provider is google or labos; the Connections action answers why; the Mac keeps its environment and Keychain path.');

    // ── Masking ───────────────────────────────────────────────────────────────────────────────
    Object.assign(config.auth, { provider: 'google' });
    await withDb(db, () => writeSettings(checkSettings({ 'dakota.password': 'shortpw1' }), { actorId: juan.id, via: 'settings' }));
    const short = settingsView().find((v) => v.key === 'dakota.password')!;
    await withDb(db, () => writeSettings(checkSettings({ 'dakota.password': null }), { actorId: juan.id, via: 'settings' }));
    check('SETTINGS a secret under 16 characters shows only that it is set; a longer one its last four',
      short.shown === '••••' && short.source === 'app' && view.shown === `••••${DECOY.slice(-4)}`,
      'An 8-character invented password shows as ••••, the 33-character decoy as •••• and four.');

    // ── /setup ───────────────────────────────────────────────────────────────────────────────
    Object.assign(config.auth, { provider: 'local' });
    const closedOnMac = !setupOpen();
    Object.assign(config.auth, { provider: 'google' });
    const openBefore = setupOpen();
    const code = setupCode();
    const announced = announceSetup() && logs.some((l) => l.includes('Not set up yet. Open ') && l.includes('/setup and enter the code ') && l.includes(code)) && !announceSetup();
    const ip = '203.0.113.9';
    const wrong = await withDb(db, () => runSetup({ mode: 'check', code: 'AAAA-BBBB-CCCC' }, { ip }));
    const right = await withDb(db, () => runSetup({ mode: 'check', code: code.toLowerCase().replace(/-/g, ' ') }, { ip }));
    check('SETUP is open only on a deployed server until Google is configured, and the code is checked',
      closedOnMac && openBefore && announced && !wrong.ok && wrong.status === 403 && wrong.field === 'code' && right.ok,
      'Closed under the local switcher; the log says “Not set up yet. Open …/setup and enter the code …” once; a wrong code is refused (403), the right one accepted whatever its case or separators.');

    resetSetupFloodgate();
    for (let i = 0; i < SETUP_FAILS_PER_ADDRESS; i++) await withDb(db, () => runSetup({ mode: 'check', code: 'WRONG' }, { ip }));
    const blocked = await withDb(db, () => runSetup({ mode: 'check', code }, { ip }));
    const other = await withDb(db, () => runSetup({ mode: 'check', code }, { ip: '198.51.100.4' }));
    resetSetupFloodgate();
    for (let i = 0; i < SETUP_FAILS_PER_ADDRESS; i++) noteSetupFailure(`2001:db8:1:2::${i + 1}`);
    const v6 = setupBlocked('2001:db8:1:2:ffff::9') && !setupBlocked('2001:db8:1:3::1') && addressKey('::ffff:203.0.113.9') === ip;
    const later = !setupBlocked('2001:db8:1:2::1', Date.now() + 3_600_001);
    resetSetupFloodgate();
    noteSetupFailure('192.0.2.88');
    for (let i = 0; i < SETUP_FAILS_TOTAL; i++) noteSetupFailure(null);
    const total = !setupBlocked('192.0.2.77') && setupBlocked('192.0.2.88') && setupBlocked(null);
    const cleanStillIn = await withDb(db, () => runSetup({ mode: 'check', code }, { ip: '192.0.2.77' }));
    resetSetupFloodgate();
    check('SETUP wrong codes are limited: 10 an hour per address (an IPv6 /64 is one); past 10,000 in total only a clean address may try',
      !blocked.ok && blocked.status === 429 && other.ok && v6 && later && total && cleanStillIn.ok,
      'The eleventh try from one address is refused even with the right code; past the total cap an address with no wrong code still gets in with the right one; one that failed, and an unknown one, do not.');

    const xff = (v: string) => new Headers({ 'x-forwarded-for': v });
    check('SETUP the client address is the one the trusted proxy appended, counted from the right',
      clientIp(xff('6.6.6.6, 203.0.113.5')) === '203.0.113.5' && clientIp(xff('6.6.6.6, 203.0.113.5'), 2) === '6.6.6.6'
        && clientIp(xff('203.0.113.5'), 0) === null && clientIp(xff('203.0.113.5'), 2) === null && clientIp(xff('not-an-address')) === null,
      'One hop by default (a GUESS until the rehearsal); a client’s own X-Forwarded-For entries to the left are ignored; 0 hops trusts none.');

    const rowsBefore = await settingRows();
    const usersBefore = (await db.one<{ n: number }>('select count(*)::int n from platform.app_user'))!.n;
    const writesBefore = await auditCount(['settings.set', 'setup.complete']);
    const values = { publicUrl: PUBLIC, googleClientId: CLIENT_ID, googleClientSecret: CLIENT_SECRET, adminEmail: juan.email, linearKey: 'lin_api_invented0042' };
    const wrongCode = await withDb(db, () => runSetup({ mode: 'finish', code: 'AAAA-BBBB-CCCC', ...values }, { ip }));
    const badValue = await withDb(db, () => runSetup({ mode: 'finish', code, ...values, googleClientId: 'invented-not-a-client' }, { ip }));
    const badAdmin = await withDb(db, () => runSetup({ mode: 'finish', code, ...values, adminEmail: 'not an address' }, { ip }));
    const badOptional = await withDb(db, () => runSetup({ mode: 'finish', code, ...values, anthropicKey: 'nope' }, { ip }));
    check('SETUP a failed attempt writes nothing: a wrong code, a bad value, a bad admin, a bad optional key',
      !wrongCode.ok && !badValue.ok && badValue.field === 'googleClientId' && !badAdmin.ok && badAdmin.field === 'adminEmail' && !badOptional.ok && badOptional.field === 'anthropicKey'
        && await settingRows() === rowsBefore && (await db.one<{ n: number }>('select count(*)::int n from platform.app_user'))!.n === usersBefore
        && await auditCount(['settings.set', 'setup.complete']) === writesBefore && setupOpen(),
      'Every value is checked before any is written; the answer names the field, and the form keeps the rest.');

    const { POST: submit } = await import('../../app/setup/submit/route');
    const post = (body: unknown, origin = ORIGIN) => withDb(db, () => submit(new Request(`${ORIGIN}/setup/submit`, {
      method: 'POST', headers: { origin, host: 'localhost:3113', 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.10' }, body: JSON.stringify(body),
    })));
    const completesBefore = await auditCount(['setup.complete']);
    const crossSite = await post({ mode: 'finish', code, ...values }, 'https://evil.example');
    const crossRows = await settingRows();
    // Two finishes at once with the right code (the code survived the failed attempts above): one wins.
    const [first, second] = await Promise.all([post({ mode: 'finish', code, ...values }), post({ mode: 'finish', code, ...values, adminEmail: 'second-invented@example.com' })]);
    const done = first.status === 200 ? first : second;
    const doneBody = await done.json() as { ok: boolean };
    const raced = [first.status, second.status].sort().join(',');
    const secondAdmin = await db.one(`select 1 from platform.app_user where email = 'second-invented@example.com'`);
    const admin = await db.one<{ access: string }>(`select access::text from platform.app_user where id = $1`, [juan.id]);
    const again = await post({ mode: 'check', code });
    check('SETUP finishes through the real route: one transaction of settings, the first admin and audit rows; then it closes',
      crossSite.status === 403 && crossRows === rowsBefore && done.status === 200 && doneBody.ok && googleConfigured() && !setupOpen()
        && admin?.access === 'admin' && settingValue('app.publicUrl') === PUBLIC && again.status === 409
        && await auditCount(['setup.complete']) === completesBefore + 1 && raced === '200,403' && !secondAdmin,
      'A cross-site POST is refused before anything is read; a failed finish gave the code back; of two concurrent finishes one wins and the other’s code no longer exists; /setup then answers “already set up”.');

    // ── Setup never reopens ──────────────────────────────────────────────────────────────────
    await withDb(db, () => writeSettings(checkSettings({ 'google.clientSecret': null }), { actorId: juan.id, via: 'settings' }));
    const afterRemoval = setupOpen();
    await withDb(db, () => writeSettings(checkSettings({ 'google.clientSecret': CLIENT_SECRET }), { actorId: juan.id, via: 'settings' }));
    process.env.PLCOS_SECRET = Buffer.alloc(32, 9).toString('base64'); // another invented key: "rotated" or lost
    forgetRootSecret();
    const unreadable = unreadableSettings();
    const afterRotation = setupOpen();
    await db.query('delete from platform.setting where key = $1', [SETUP_DONE_KEY]);
    await loadSettings(db);
    const unmarkedButStored = setupOpen();
    const before2 = logs.length;
    await withDb(db, () => announceAtBoot());
    const loud = logs.slice(before2).some((l) => l.includes('do not decrypt') && l.includes('Setup stays closed'));
    const reopenTry = await withDb(db, () => runSetup({ mode: 'check', code: setupCode() }, { ip: '192.0.2.99' }));
    process.env.PLCOS_SECRET = Buffer.alloc(32, 7).toString('base64');
    forgetRootSecret();
    await upsertMarker();
    check('SETUP never reopens: not when the Google client is removed, not when PLCOS_SECRET changes, not when stored sign-in rows do not decrypt',
      !afterRemoval && unreadable.includes('google.clientSecret') && !afterRotation && !unmarkedButStored && loud && reopenTry.ok === false && reopenTry.status === 409,
      'A completion marker closes it for good; even without the marker, a stored sign-in client that does not decrypt keeps it closed and the boot log says so loudly.');
    check('BOOT a deployed server with no PLCOS_SECRET and no volume at the data folder refuses to start, and says why',
      /Refusing to start/.test(bootRefusal({ PLCOS_DEPLOYED: '1', RAILWAY_PROJECT_ID: 'invented' }) ?? '')
        && bootRefusal({ PLCOS_DEPLOYED: '1', RAILWAY_PROJECT_ID: 'invented', RAILWAY_VOLUME_MOUNT_PATH: dataDir() }) === null
        && bootRefusal({ PLCOS_DEPLOYED: '1', RAILWAY_PROJECT_ID: 'invented', PLCOS_SECRET: 'x' }) === null && bootRefusal({}) === null,
      'A key made on a disk lost at every deploy would orphan every stored secret; with a volume, or the variable, or on the Mac, it starts.');

    // ── Sessions ─────────────────────────────────────────────────────────────────────────────
    const epoch0 = (await db.one<{ e: number }>('select session_epoch e from platform.app_user where id = $1', [juan.id]))!.e;
    const s0 = sessionValue({ id: juan.id, sessionEpoch: epoch0 }, 30);
    const okUser = await withDb(db, () => userFromSession(s0.value, db));
    const [uid, ep, exp, sig] = s0.value.split('.') as [string, string, string, string];
    const tampered = [`${gp.id}.${ep}.${exp}.${sig}`, `${uid}.${ep}.${Number(exp) + 1}.${sig}`, `${uid}.${ep}.${exp}.${sig.slice(0, -2)}xx`, `${uid}.${ep}.${exp}`];
    const tamperedOk = (await Promise.all(tampered.map((t) => withDb(db, () => userFromSession(t, db))))).every((u) => u === null);
    const expired = await withDb(db, () => userFromSession(s0.value, db, Date.now() + 31 * 86_400_000));
    await db.query('update platform.app_user set session_epoch = session_epoch + 1 where id = $1', [juan.id]);
    const afterEpoch = await withDb(db, () => userFromSession(s0.value, db));
    check('SESSION cookie: a tampered, an expired and an old-epoch cookie are each refused',
      okUser?.id === juan.id && tamperedOk && expired === null && afterEpoch === null,
      'uid.epoch.expires.sig, HMAC-SHA256 under the session subkey; raising the epoch signs the person out everywhere.');
    const gpEpoch = (await db.one<{ e: number }>('select session_epoch e from platform.app_user where id = $1', [gp.id]))!.e;
    const gpCookie = sessionValue({ id: gp.id, sessionEpoch: gpEpoch }, 30).value;
    const gpReporter = reporterOf(sessionClaims(gpCookie)!);
    const reporterBefore = await withDb(db, () => resolveLocalUser(gpReporter, db));
    await db.query('update platform.app_user set active = false where id = $1', [gp.id]);
    await db.query('update platform.app_user set active = true where id = $1', [gp.id]);
    const revived = await withDb(db, () => userFromSession(gpCookie, db));
    const reporterAfter = await withDb(db, () => resolveLocalUser(gpReporter, db));
    const oldReporter = await withDb(db, () => resolveLocalUser(`uid:${gp.id}`, db));
    check('SESSION deactivating a person raises their epoch, and feedback carries the epoch, so neither an old cookie nor a queued report outlives sign-out',
      reporterBefore?.id === gp.id && revived === null && reporterAfter === null && oldReporter === null,
      'Deactivate and reactivate: the old cookie stays dead; a journal entry made before is refused at ingest instead of being filed as somebody.');

    // ── The callback, through the real route handlers, with the fake Google ──────────────────
    useFakeGoogle({ clientSecret: CLIENT_SECRET });
    const { GET: start } = await import('../../app/auth/google/route');
    const { GET: callback } = await import('../../app/auth/google/callback/route');
    const signIn = async (account: { sub: string; email: string; email_verified: boolean; hd?: string }, mangle?: (state: string) => string) => {
      const begun = await withDb(db, () => start(new Request(`${ORIGIN}/auth/google`, { headers: { host: 'localhost:3113' } })));
      const location = begun.headers.get('location') ?? '';
      const cookie = (begun.headers.get('set-cookie') ?? '').split(';')[0]!;
      const state = new URL(location).searchParams.get('state') ?? '';
      const code = fakeConsent(location, account);
      const back = await withDb(db, () => callback(new Request(`${PUBLIC}/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(mangle ? mangle(state) : state)}`, {
        headers: { host: 'raise.example.test', cookie, 'x-forwarded-for': '192.0.2.20' },
      })));
      return { begun, location, back, to: back.headers.get('location') ?? '', cookies: back.headers.getSetCookie() };
    };
    const refusals = async () => (await db.query<{ rule: string }>(`select detail->>'rule' rule from platform.audit_log where action = 'signin.refused' order by id`)).map((r) => r.rule);
    const priorRefusals = (await refusals()).length;
    const juanDomain = juan.email.split('@')[1]!;
    const workspace = { sub: 'invented-sub-1', email: juan.email.toUpperCase(), email_verified: true, hd: juanDomain };
    const badState = await signIn(workspace, (s) => `${s.slice(0, -2)}zz`);
    const unverified = await signIn({ ...workspace, email_verified: false });
    const personal = await signIn({ sub: 'invented-sub-2', email: juan.email, email_verified: true });
    const unknown = await signIn({ ...workspace, email: `nobody-invented@${juanDomain}` });
    const gone = await signIn({ ...workspace, email: 'gone@example.invalid', hd: 'example.invalid' });
    const alias = await signIn({ ...workspace, hd: 'invented-workspace.test' });
    await withDb(db, () => writeSettings(checkSettings({ 'signin.extraDomains': juanDomain }), { actorId: juan.id, via: 'settings' }));
    const aliasAllowed = await signIn({ ...workspace, hd: 'invented-workspace.test' });
    await withDb(db, () => writeSettings(checkSettings({ 'signin.extraDomains': null }), { actorId: juan.id, via: 'settings' }));
    const known = await signIn(workspace);
    const SESSION = sessionCookie(true);
    const sessionSet = known.cookies.find((c) => c.startsWith(`${SESSION}=`)) ?? '';
    const session = sessionSet.split(';')[0]?.slice(SESSION.length + 1) ?? '';
    const admitted = await withDb(db, () => userFromSession(decodeURIComponent(session), db));
    const rules = (await refusals()).slice(priorRefusals);
    const scope = new URL(known.location).searchParams;
    check('SIGN-IN start: PKCE S256, a signed state cookie for ten minutes, sign-in scopes only',
      known.begun.status === 303 && known.location.startsWith(GOOGLE_AUTHORIZE_URL) && scope.get('code_challenge_method') === 'S256'
        && scope.get('scope') === 'openid email profile' && scope.get('redirect_uri') === `${PUBLIC}/auth/google/callback`
        && /HttpOnly/.test(known.begun.headers.get('set-cookie') ?? '') && /Max-Age=600/.test(known.begun.headers.get('set-cookie') ?? '')
        && (known.begun.headers.get('set-cookie') ?? '').startsWith('__Host-'),
      'The redirect URI is built from the public address; no Gmail scope is asked for; over https the state cookie is __Host-.');
    check('SIGN-IN callback refuses a bad state, an unverified email, a non-Workspace account, another organization’s hd, an unknown and an inactive email, and logs why',
      badState.to.endsWith('/signin?error=oauth-state') && unverified.to.endsWith('error=email-unverified') && personal.to.endsWith('error=not-workspace')
        && unknown.to.endsWith('error=not-on-roster') && gone.to.endsWith('error=not-on-roster') && alias.to.endsWith('error=domain-mismatch')
        && aliasAllowed.to === `${PUBLIC}/today`
        && JSON.stringify(rules) === JSON.stringify(['oauth-state', 'email-unverified', 'not-workspace', 'not-on-roster', 'not-on-roster', 'domain-mismatch'])
        && [badState, unverified, personal, unknown, gone, alias].every((r) => !r.cookies.some((c) => c.includes('session=') && !/Max-Age=0/.test(c))),
      'Through the real /auth/google and callback handlers with the fake Google; each refusal is one signin.refused row with its rule and no session; an hd that is not the address’s own domain is admitted only once that domain is listed.');
    check('SIGN-IN callback admits a verified Workspace address on the roster (any case) with their role',
      known.to === `${PUBLIC}/today` && admitted?.id === juan.id && admitted?.access === 'admin'
        && /; Secure/.test(sessionSet) && /; Path=\//.test(sessionSet) && !/Domain=/i.test(sessionSet) && SESSION.startsWith('__Host-')
        && (await auditCount(['signin'])) > 0,
      'A __Host- session cookie (Secure, Path=/, no Domain) on an https address; the person is the roster row, with its access.');

    // ── Non-admins are refused on every Connections and People action, and logged ────────────
    const actions = await import('../../app/settings/connections/actions');
    const people = await import('../../app/settings/people/actions');
    const rosterBefore = JSON.stringify(await db.query('select id, access, vehicles::text[], active, session_epoch from platform.app_user order by id'));
    const settingsBefore = JSON.stringify(await db.query('select key, value from platform.setting order by key'));
    const refusedBefore = await auditCount(['authz.refused']);
    const attempts: Array<() => Promise<unknown>> = [
      () => actions.saveSettingAction(null, form({ key: 'app.publicUrl', value: 'https://evil.example' })),
      () => actions.clearSettingAction(form({ key: 'google.clientSecret' })),
      () => actions.checkSettingAction(null, form({ key: 'anthropic.apiKey', value: 'sk-ant-invented' })),
      () => people.addPersonAction(null, form({ name: 'Invented Intruder', email: 'intruder@example.invalid', access: 'admin', allVehicles: 'on' })),
      () => people.updatePersonAction(null, form({ userId: gp.id, access: 'admin', allVehicles: 'on' })),
      () => people.setPersonActiveAction(null, form({ userId: juan.id, active: '0' })),
      () => people.signOutEverywhereAction(null, form({ userId: juan.id })),
    ];
    const gpSession = await sessionFor(gp.id);
    const outcomes: boolean[] = [];
    for (const attempt of attempts) {
      try { await inRequest(db, 'action', gpSession, '/settings/connections', attempt); outcomes.push(false); }
      catch (e) { outcomes.push(isRedirectError(e) && getURLFromRedirectError(e) === '/access-denied'); }
    }
    const { default: ConnectionsPage } = await import('../../app/settings/connections/page');
    const { default: PeoplePage } = await import('../../app/settings/people/page');
    let pageRefused = false, peopleRefused = false;
    try { await inRequest(db, 'render', gpSession, '/settings/connections', () => ConnectionsPage()); }
    catch (e) { pageRefused = isRedirectError(e) && getURLFromRedirectError(e) === '/access-denied'; }
    try { await inRequest(db, 'render', gpSession, '/settings/people', () => PeoplePage()); }
    catch (e) { peopleRefused = isRedirectError(e) && getURLFromRedirectError(e) === '/access-denied'; }
    const refusedRows = await db.query<{ subject_id: string }>(`select subject_id from platform.audit_log where action = 'authz.refused' and actor_id = $1 order by id`, [gp.id]);
    check('CONNECTIONS and PEOPLE a non-admin is refused on every action and both pages, each refusal logged, nothing changed',
      outcomes.length === 7 && outcomes.every(Boolean) && pageRefused && peopleRefused && await auditCount(['authz.refused']) === refusedBefore + 9
        && refusedRows.length === 9 && JSON.stringify(await db.query('select key, value from platform.setting order by key')) === settingsBefore
        && JSON.stringify(await db.query('select id, access, vehicles::text[], active, session_epoch from platform.app_user order by id')) === rosterBefore,
      'Save, Remove, Check, Add, Edit, Deactivate and Sign out everywhere redirect to the refusal page; one authz.refused row each, with the action’s name; settings and roster unchanged.');

    // ── People: the roster Google sign-in admits ─────────────────────────────────────────────
    demoted = (await db.query<{ id: string }>(`update platform.app_user set access = 'gp' where access = 'admin' and id <> $1 returning id::text`, [juan.id])).map((r) => r.id);
    const juanSession = await sessionFor(juan.id);
    const asJuan = <T>(work: () => Promise<T>) => inRequest(db, 'action', juanSession, '/settings/people', work);
    const vehicle = (await db.one<{ id: string }>(`select id::text from platform.vehicle order by sort_order limit 1`))!.id;
    const added = await asJuan(() => people.addPersonAction(null, form({ name: 'Invented Newcomer', email: 'Newcomer@Example.invalid', access: 'gp', vehicle })));
    const row = await db.one<{ id: string; email: string; access: string; vehicles: string[] }>(`select id::text, email, access::text, vehicles::text[] from platform.app_user where email = 'newcomer@example.invalid'`);
    const dupe = await asJuan(() => people.addPersonAction(null, form({ name: 'Invented Twin', email: 'NEWCOMER@example.invalid', access: 'viewer', allVehicles: 'on' })));
    const demoteLast = await asJuan(() => people.updatePersonAction(null, form({ userId: juan.id, access: 'gp', allVehicles: 'on' })));
    const deactivateLast = await asJuan(() => people.setPersonActiveAction(null, form({ userId: juan.id, active: '0' })));
    const newcomerEpoch = async () => (await db.one<{ e: number }>('select session_epoch e from platform.app_user where id = $1', [row!.id]))!.e;
    const e0 = await newcomerEpoch();
    const off = await asJuan(() => people.setPersonActiveAction(null, form({ userId: row!.id, active: '0' })));
    const e1 = await newcomerEpoch();
    const dupeWhileOff = await asJuan(() => people.addPersonAction(null, form({ name: 'Invented Twin', email: 'newcomer@example.invalid', access: 'viewer', allVehicles: 'on' })));
    const on = await asJuan(() => people.setPersonActiveAction(null, form({ userId: row!.id, active: '1' })));
    const juanAfter = await db.one<{ access: string; active: boolean }>(`select access::text, active from platform.app_user where id = $1`, [juan.id]);
    Object.assign(config.auth, { provider: 'local' });
    const onMac = await inRequest(db, 'action', `${USER_COOKIE}=${juan.handle}`, '/settings/people', () => people.addPersonAction(null, form({ name: 'Invented Mac', email: 'mac@example.invalid', access: 'gp', allVehicles: 'on' })));
    Object.assign(config.auth, { provider: 'google' });
    check('PEOPLE an admin adds, deactivates and reactivates people; addresses are unique ignoring case; the last admin stays',
      added?.ok === true && row?.email === 'newcomer@example.invalid' && row.access === 'gp' && JSON.stringify(row.vehicles) === JSON.stringify([vehicle])
        && dupe?.ok === false && demoteLast?.ok === false && /no active admin/.test(demoteLast.ok === false ? demoteLast.error : '')
        && deactivateLast?.ok === false && juanAfter?.access === 'admin' && juanAfter.active
        && off?.ok === true && e1 === e0 + 1 && dupeWhileOff?.ok === false && /reactivate/.test(dupeWhileOff.ok === false ? dupeWhileOff.error : '') && on?.ok === true
        && onMac?.ok === false && !(await db.one(`select 1 from platform.app_user where email = 'mac@example.invalid'`))
        && await auditCount(['people.added', 'people.deactivated', 'people.reactivated']) >= 3,
      'Add a GP on one vehicle (address stored lower-case); the same address in another case is refused; the only admin can be neither demoted nor deactivated; deactivating raises the epoch; under the switcher the page changes nothing.');

    // ── No secret in audit rows, the log or the pages ────────────────────────────────────────
    await withDb(db, () => writeSettings(checkSettings({ 'anthropic.apiKey': DECOY }), { actorId: juan.id, via: 'settings' }));
    const page = await inRequest(db, 'render', await sessionFor(juan.id), '/settings/connections', () => ConnectionsPage());
    const pageText = strings(page).join('\n');
    const { default: SetupPage } = await import('../../app/setup/page');
    const { SetupWizard } = await import('../../app/setup/SetupWizard');
    // /setup as it was before anyone finished it.
    await db.query(`delete from platform.setting where key like 'google.%' or key = $1`, [SETUP_DONE_KEY]);
    await loadSettings(db);
    const setupEl = await inRequest(db, 'render', '', '/setup', () => SetupPage());
    const wizard = (setupEl as { props: { children: ReactNode } }).props.children as unknown as { props: Parameters<typeof SetupWizard>[0] };
    const setupHtml = renderToStaticMarkup(createElement(SetupWizard, wizard.props));
    const audits = (await db.query<{ t: string }>(`select concat_ws(' ', action, subject_id, detail::text) t from platform.audit_log`)).map((r) => r.t).join('\n');
    const secrets = [DECOY, CLIENT_SECRET, 'lin_api_invented0042'];
    check('SECRETS no stored secret value appears in an audit row, the log, the Connections page or /setup',
      pageText.includes(`••••${DECOY.slice(-4)}`) && pageText.includes('Connections') && setupHtml.includes('Enter the setup code')
        && secrets.every((x) => !audits.includes(x) && !logs.join('\n').includes(x) && !pageText.includes(x) && !setupHtml.includes(x) && !setupHtml.includes(code) && !setupHtml.includes(setupCode())),
      `Searched ${audits.split('\n').length} audit rows, ${logs.length} log lines and both pages for three invented decoys and the setup code.`);

    // ── Key readers: the store when the environment is unset; nothing for a preview copy ─────
    await withDb(db, () => writeSettings(checkSettings({ 'affinity.apiKey': 'invented-affinity-key-0042', 'google.clientId': CLIENT_ID, 'dakota.username': 'invented-dakota-user', 'dakota.password': 'invented-dakota-pass-0042' }), { actorId: juan.id, via: 'settings' }));
    Object.assign(config.data, { profile: 'real', copyTakenAt: null });
    const live = [affinityKey(), linearKey(), anthropicKey(), googleClientId(), dakotaSignIn()?.password];
    Object.assign(config.data, { copyTakenAt: '2026-10-04T00:00:00Z' });
    const preview = [affinityKey(), linearKey(), anthropicKey(), googleClientId(), dakotaSignIn(), settingValue('anthropic.apiKey')];
    Object.assign(config.data, savedData);
    check('KEYS the readers use the store when the environment is unset, and a preview copy gets none',
      JSON.stringify(live) === JSON.stringify(['invented-affinity-key-0042', 'lin_api_invented0042', DECOY, CLIENT_ID, 'invented-dakota-pass-0042']) && preview.every((k) => k === null || k === undefined),
      'affinityKey, linearKey, anthropicKey, Dakota’s sign-in and the Google client read the encrypted settings synchronously; with copyTakenAt every one is empty.');

    // ── Per-person mailguard keys, in the app ─────────────────────────────────────────────────
    const mgKey = `mg_invented0042_${'a1B2c3D4e5'.repeat(4)}`;
    const store = databaseStore();
    await withDb(db, () => store.put(juan.handle, mgKey));
    const rawKey = (await db.one<{ value: string }>(`select value from platform.person_secret where user_id = $1 and purpose = 'mailguard'`, [juan.id]))!.value;
    const readBack = await withDb(db, () => store.get(juan.handle));
    const gpHas = await withDb(db, () => store.get(gp.handle));
    // A row copied to another person does not decrypt for them.
    await db.query(`insert into platform.person_secret (user_id, purpose, value) values ($1, 'mailguard', $2)`, [gp.id, rawKey]);
    const copiedToGp = await withDb(db, () => personSecret(gp.id, 'mailguard'));
    const actionsSource = await readF('app/email/actions.ts', 'utf8');
    const ownOnly = !/formData\.get\(['"](handle|userId|user)['"]\)/.test(actionsSource);
    await withDb(db, () => store.delete(juan.handle));
    const afterDelete = await withDb(db, () => store.get(juan.handle));
    await db.query(`delete from platform.person_secret where user_id = $1`, [gp.id]);
    check('MAILGUARD each person’s key is kept encrypted in the app, bound to its owner, shown only masked, and set or removed only by its owner',
      readBack === mgKey && !rawKey.includes(mgKey) && !rawKey.includes(mgKey.slice(-12)) && gpHas === null && copiedToGp === null
        && maskSecret(mgKey) === `••••${mgKey.slice(-4)}` && maskSecret('short-key') === '••••' && ownOnly && afterDelete === null,
      'AES-256-GCM under the person-secret subkey, bound to user and purpose; the email actions take no other person’s id, so an admin cannot read or set another’s key.');

    const scratch = await mkdtemp(join(tmpdir(), 'preview-key-'));
    try {
      const source = join(scratch, 'source');
      await mkdirp(join(source, 'database'), { recursive: true });
      await writeF(join(source, 'dev-secret'), 'invented'); await writeF(join(source, 'database', 'x'), 'invented'); await writeF(join(source, 'notes.json'), '{}');
      await mkdirp(join(scratch, 'root', 'data'), { recursive: true });
      takeCopy(source, join(scratch, 'root'));
      const copied = await readdir(join(scratch, 'root', 'data', 'real'));
      check('KEYS a preview copy never carries the settings key beside the encrypted rows',
        !copied.includes('dev-secret') && !copied.includes('secret') && copied.includes('database') && copied.includes('notes.json'),
        'An invented real folder copied by scripts/preview-copy.ts: the database and files arrive; dev-secret does not.');
    } finally { await rmrf(scratch, { recursive: true, force: true }); }

    // ── Cross-site POSTs ──────────────────────────────────────────────────────────────────────
    const { POST: signout } = await import('../../app/auth/signout/route');
    const evil = await withDb(db, () => signout(new Request(`${ORIGIN}/auth/signout`, { method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost:3113', 'sec-fetch-site': 'cross-site' } })));
    const sameSite = await withDb(db, () => signout(new Request(`${ORIGIN}/auth/signout`, { method: 'POST', headers: { origin: 'http://other.localhost:3113', host: 'localhost:3113', 'sec-fetch-site': 'same-site' } })));
    const own = await withDb(db, () => signout(new Request(`${ORIGIN}/auth/signout`, { method: 'POST', headers: { origin: ORIGIN, host: 'localhost:3113', 'sec-fetch-site': 'same-origin' } })));
    check('CROSS-SITE a cookie-acting POST from another site, or a sibling subdomain, is refused',
      evil.status === 403 && sameSite.status === 403 && own.status === 303 && crossSite.status === 403,
      'Sign-out and /setup refuse a foreign Origin; this server’s own page signs out.');
  } finally {
    for (const k of ['log', 'warn', 'error'] as const) console[k] = original[k];
    useFakeGoogle(null);
    for (const [n, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    forgetRootSecret();
    Object.assign(config.auth, { provider: savedProvider });
    Object.assign(config.data, savedData);
    resetSetupFloodgate();
    retireSetupCode();
    await db.query('delete from platform.setting');
    await db.query('update platform.app_user set session_epoch = 0 where id = $1', [juan.id]);
    await db.query(`update platform.app_user set active = false where handle in ('setup-props-gp', 'setup-props-gone') or email = 'newcomer@example.invalid'`);
    if (demoted.length) await db.query(`update platform.app_user set access = 'admin' where id = any($1::uuid[])`, [demoted]);
    forgetSettings();
    await loadSettings(db);
  }
}

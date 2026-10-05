/**
 * The page warm-up behind Google sign-in (lib/page-warm.ts, lib/auth/warm.ts; 5 Oct 2026), on invented data:
 *   - with setup open (or no sign-in client, or no active admin) it skips, says why, and mints nothing;
 *   - once set up, a loopback GET of a listed page carrying the pass is the oldest active admin, through the
 *     same Google currentUser the root layout and every page call: a page, not a redirect to /signin;
 *   - the pass is refused from another host, after expiry or revocation, for an unlisted path or a non-GET,
 *     with a forged signature, for a non-admin, and by the mutation guard; reading it writes nothing;
 *   - the cached loaders a warm-up fills never read the current user;
 *   - the Mac's user switcher is unchanged.
 */
import { readFile } from 'node:fs/promises';
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { createRequestStore } from 'next/dist/server/async-storage/request-store';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { config } from '../../config/deployment';
import { withDb, type Queryable } from '../../lib/db';
import { USER_COOKIE } from '../../lib/auth/cookie';
import { googleAuth } from '../../lib/auth/google';
import { localAuth } from '../../lib/auth/local';
import { mintWarmPass, revokeWarmPass, WARM_COOKIE, WARM_PASS_MS, warmPassUser } from '../../lib/auth/warm';
import { initializeRoutingSecret, internalRoutingHeaders } from '../../lib/internal-routing';
import { MutationGuardError, mutationRouteGuard, requireMutationUser } from '../../lib/mutation-guard';
import { warmAccess } from '../../lib/page-warm';
import { forgetRootSecret } from '../../lib/settings/key';
import { checkSettings, forgetSettings, loadSettings, writeSettings } from '../../lib/settings/store';
import { SETUP_DONE_KEY } from '../../lib/settings/setup';
import type { Check, Db } from './harness';

const PATH = '/today';

/** The request headers a loopback page GET has after the proxy: Host, the cookie, the signed routing context. */
function pageHeaders(cookie: string, opts: { host?: string; path?: string; method?: string } = {}): Headers {
  const base = new Headers({ host: opts.host ?? '127.0.0.1:3113', cookie });
  return internalRoutingHeaders(base, opts.path ?? PATH, opts.method ?? 'GET', opts.path ?? PATH, null);
}

const inRequest = <T>(db: Db, headers: Headers, phase: 'render' | 'action', work: () => Promise<T>) =>
  withDb(db, () => workAsyncStorage.run({ route: PATH, isStaticGeneration: false } as WorkStore,
    () => workUnitAsyncStorage.run(createRequestStore({
      phase, headers, url: { pathname: PATH }, rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() }, resumeDataCache: null,
      onUpdateCookies: undefined, previewProps: undefined, isHmrRefresh: false, serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, fallbackParams: null,
    }), work)));

export async function warmSessionProperties(check: Check, db: Db) {
  initializeRoutingSecret();
  const savedProvider = config.auth.provider;
  const savedSecret = process.env.PLCOS_SECRET;
  const admin = (await db.one<{ id: string; epoch: number }>(`select id::text, session_epoch epoch from platform.app_user
    where active and access = 'admin' and email <> '' order by created_at, id limit 1`))!;
  const gp = (await db.one<{ id: string; epoch: number }>(`insert into platform.app_user (handle, name, initials, role, email, access)
    values ('warm-props-gp', 'Invented Warm GP', 'IW', 'Invented (props)', 'warm-gp@invented.test', 'team') returning id::text, session_epoch epoch`))!;
  const asPage = async (cookie: string, opts: { host?: string; path?: string; method?: string } = {}) => {
    try { return { user: await inRequest(db, pageHeaders(cookie, opts), 'render', () => googleAuth().currentUser()), to: null as string | null }; }
    catch (e) { if (isRedirectError(e)) return { user: null, to: getURLFromRedirectError(e) }; throw e; }
  };
  try {
    process.env.PLCOS_SECRET = Buffer.alloc(32, 13).toString('base64'); // invented test key
    forgetRootSecret();
    Object.assign(config.auth, { provider: 'google' });
    await db.query('delete from platform.setting');
    forgetSettings();
    await loadSettings(db);

    // ── Setup open: skip, no pass ─────────────────────────────────────────────────────────────
    const before = await withDb(db, () => warmAccess([PATH]));
    const noPass = await asPage(`${WARM_COOKIE}=anything`);
    check('WARM while setup is open it skips, says why, and mints no pass (no failures counted)',
      'skip' in before && /not set up yet/.test(before.skip) && noPass.to === '/signin',
      'The warm-up logs one “[warm] skipped: …” line and leaves the revision unwarmed for later; nothing is requested.');

    // ── Set up: the pass is the oldest active admin for a loopback GET of a listed page ──────────
    await withDb(db, () => writeSettings(checkSettings({ 'google.clientId': 'invented-warm-0042.apps.googleusercontent.com', 'google.clientSecret': 'GOCSPX-invented-warm' }), { actorId: admin.id, via: 'settings' }));
    await db.query(`insert into platform.setting (key, value, secret) values ($1, $2, false) on conflict (key) do nothing`, [SETUP_DONE_KEY, new Date().toISOString()]);
    await loadSettings(db);
    const access = await withDb(db, () => warmAccess([PATH, '/invented/pipeline']));
    const cookie = 'cookie' in access ? access.cookie ?? '' : '';
    const page = await asPage(cookie);
    const unlisted = await asPage(cookie, { path: '/developer/settings' });
    const posted = await asPage(cookie, { method: 'POST' });
    const outside = await asPage(cookie, { host: 'raise.example.test' });
    check('WARM once set up, a loopback GET of a listed page with the pass is the oldest active admin: a page, not /signin',
      cookie.startsWith(`${WARM_COOKIE}=`) && page.user?.id === admin.id && page.to === null
        && unlisted.to === '/signin' && posted.to === '/signin' && outside.to === '/signin',
      'Through the Google currentUser the root layout and every page call; an unlisted path, a POST and another Host get /signin.');

    // ── Refusals ──────────────────────────────────────────────────────────────────────────────
    const value = decodeURIComponent(cookie.slice(WARM_COOKIE.length + 1));
    const h = pageHeaders(cookie);
    const late = await withDb(db, () => warmPassUser(value, h, db, Date.now() + WARM_PASS_MS + 1000));
    const [uid, epoch, exp, nonce] = value.split('.');
    const forged = await withDb(db, () => warmPassUser(`${uid}.${epoch}.${exp}.${nonce}.${'A'.repeat(43)}`, h, db));
    const gpValue = mintWarmPass({ id: gp.id, sessionEpoch: gp.epoch }, [PATH]);
    const gpPass = await withDb(db, () => warmPassUser(gpValue, pageHeaders(`${WARM_COOKIE}=${encodeURIComponent(gpValue)}`), db));
    const fresh = mintWarmPass({ id: admin.id, sessionEpoch: admin.epoch }, [PATH]);
    const replaced = await withDb(db, () => warmPassUser(value, h, db));
    const freshCookie = `${WARM_COOKIE}=${encodeURIComponent(fresh)}`;
    let writeRefused = false, routeRefused = false;
    try { await inRequest(db, pageHeaders(freshCookie), 'action', () => requireMutationUser()); } catch (e) { writeRefused = e instanceof MutationGuardError && e.status === 403; }
    const routed = await withDb(db, () => mutationRouteGuard(new Request('http://127.0.0.1:3113/api/identity/entity-type', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:3113', host: '127.0.0.1:3113', cookie: freshCookie } })));
    routeRefused = 'response' in routed && routed.response.status === 403;
    let reads = 0;
    const readOnly: Queryable = {
      async one<T>(sql: string, params?: unknown[]) { if (!/^\s*select /i.test(sql)) throw new Error('write'); reads++; return db.one<T>(sql, params); },
      async query() { throw new Error('A warm pass attempted a write'); },
      async exec() { throw new Error('A warm pass attempted DDL'); },
    };
    const repeated = await Promise.all(Array.from({ length: 5 }, () => withDb(db, () => warmPassUser(fresh, pageHeaders(freshCookie), readOnly))));
    revokeWarmPass();
    const revoked = await withDb(db, () => warmPassUser(fresh, pageHeaders(freshCookie), db));
    check('WARM the pass is refused after expiry, revocation or replacement, with a forged signature, for a non-admin, and by every write path; reading it writes nothing',
      late === null && forged === null && gpPass === null && replaced === null && revoked === null && writeRefused && routeRefused
        && repeated.every((u) => u?.id === admin.id) && reads === 5,
      'Signed under its own warm subkey, held only in this process, revoked after each warm-up; requireMutationUser (every server action) and mutationRouteGuard refuse a request that carries one.');

    // ── The caches a warm-up fills hold no one's view ───────────────────────────────────────
    const loaders = await Promise.all(['lib/pipeline-data.ts', 'lib/lp-stats/data.ts', 'modules/network/cache.ts'].map((f) => readFile(f, 'utf8')));
    const renderKey = await readFile('lib/page-render.ts', 'utf8');
    const facade = await readFile('lib/authz/read/pipeline.ts', 'utf8');
    check('WARM the cached loaders a warm-up fills never read the current user, renders are shared only per user, and pages redact after the cache',
      loaders.every((src) => !/currentUser|auth\(\)/.test(src)) && /cookies: jar\.toString\(\)/.test(renderKey) && /access: principal\.access/.test(renderKey)
        && /Redact after the shared cache/.test(facade),
      'buildCache memos are keyed by vehicle and hold unredacted rows; lib/authz/read facades redact them per person on read; a warm render is keyed by its own cookies.');

    // ── The Mac's switcher is unchanged ─────────────────────────────────────────────────────
    Object.assign(config.auth, { provider: 'local' });
    const local = await withDb(db, () => warmAccess([PATH]));
    const juan = await inRequest(db, new Headers({ host: '127.0.0.1:3113', cookie: `${USER_COOKIE}=juan` }), 'render', () => localAuth().currentUser(db));
    check('WARM on the Mac’s user switcher nothing changes: no pass, no cookie, the switcher’s person',
      'cookie' in local && local.cookie === null && juan.handle === 'juan',
      'The warm-up requests pages exactly as before.');
  } finally {
    revokeWarmPass();
    Object.assign(config.auth, { provider: savedProvider });
    if (savedSecret === undefined) delete process.env.PLCOS_SECRET; else process.env.PLCOS_SECRET = savedSecret;
    forgetRootSecret();
    await db.query('delete from platform.setting');
    forgetSettings();
    await loadSettings(db);
    await db.query(`update platform.app_user set active = false where handle = 'warm-props-gp'`);
  }
}

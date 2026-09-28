import assert from 'node:assert/strict';
import { labosUser, labosAuth, LABOS_SIGN_IN } from '../../lib/auth/labos';
import { MutationGuardError, requireMutationProfile } from '../../lib/mutation-policy';
import { resolveLabosUser } from '../../modules/platform/repo';
import { linearLiveServer } from '../../lib/connectors/linear/sync';
import { dakotaLiveServer } from '../../lib/connectors/dakota/job';
import type { Queryable } from '../../lib/db';
import type { Check, Db } from './harness';
import { config } from '../../config/deployment';
import { feedbackHome } from '../../config/ports';
import Home from '../../app/page';
import { healthRoute } from '../../lib/authz/route';
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { createRequestStore } from 'next/dist/server/async-storage/request-store';

export async function labosProperties(check: Check, db: Db) {
  const originalFetch = globalThis.fetch, originalNow = Date.now, originalUrl = process.env.LABOS_ME_URL;
  let now = originalNow(), calls = 0, status = 200;
  process.env.LABOS_ME_URL = 'https://labos.invalid/v1/ai-apps/me';
  Date.now = () => now;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, process.env.LABOS_ME_URL);
    assert.equal(options?.headers && new Headers(options.headers).get('Authorization'), 'Bearer invented-token');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    return Response.json({ uid: 'invented-labos-uid', name: 'Example Member' }, { status });
  };
  try {
    const viewer = await labosUser('%22invented-token%22', db);
    assert.equal(viewer.access, 'viewer');
    assert.equal(viewer.name, 'Example Member');
    // Reject every write at the DB seam, even a no-op INSERT whose trigger invalidates pages.
    let reads = 0;
    const readOnly: Queryable = {
      async one<T>(sql: string, params?: unknown[]) {
        assert.match(sql, /^select /i); reads++;
        return db.one<T>(sql, params);
      },
      async query() { throw new Error('Known UID attempted a write'); },
      async exec() { throw new Error('Known UID attempted DDL'); },
    };
    const revision = () => db.one('select revision::text from network.read_revision where singleton');
    const before = await revision();
    const repeated = await Promise.all(Array.from({ length: 10 }, () => resolveLabosUser('invented-labos-uid', 'Changed Name', readOnly)));
    assert.ok(repeated.every(user => user?.id === viewer.id && user.name === 'Example Member'));
    assert.equal(reads, 10);
    assert.deepEqual(await revision(), before);
    check('LabOS known UID makes zero writes and preserves read revision under repeated sign-in', true,
      '10 concurrent resolutions: 10 SELECTs, zero mutations, unchanged name and revision.');
    const again = await labosUser('invented-token', db);
    assert.equal(again.id, viewer.id);
    assert.equal(calls, 1);
    await db.query("update platform.app_user set access = 'admin', name = 'Roster Name' where id = $1", [viewer.id]);
    const bound = await labosUser('invented-token', db);
    assert.equal(bound.access, 'admin');
    assert.equal(bound.name, 'Roster Name');
    now += 5 * 60_000;
    await labosUser('invented-token', db);
    assert.equal(calls, 2);
    check('LabOS identity caches five minutes; UID binding preserves live roles', true, 'Unknown UID is one viewer; cached identity still reads current app permissions.');

    const anonymous = (e: unknown) => e instanceof MutationGuardError && e.status === 401 && e.message === LABOS_SIGN_IN;
    await assert.rejects(labosUser(undefined, db), anonymous);
    await assert.rejects(labosUser('%invalid', db), anonymous);
    assert.equal(calls, 2);
    await db.query('update platform.app_user set active = false where id = $1', [viewer.id]);
    await assert.rejects(labosUser('invented-token', db), (e: unknown) => e instanceof MutationGuardError && e.status === 403);
    const inactiveRevision = await revision();
    assert.equal(await resolveLabosUser('invented-labos-uid', 'Changed Name', readOnly), null);
    assert.deepEqual(await revision(), inactiveRevision);
    check('LabOS inactive known UID is refused without a write', true, 'No insert, reactivation or revision bump.');

    status = 401;
    now += 5 * 60_000;
    await assert.rejects(labosUser('invented-token', db), anonymous);
    assert.equal(labosAuth().switchable, false);
    await assert.rejects(labosAuth().switchUser('juan'));
    check('LabOS refuses anonymous, expired and inactive identities and switching', true, 'Missing/malformed cookies and /me 401 fail closed; no local fallback or reactivation.');
    const originalData = { ...config.data }, originalRehearsal = process.env.POSTGRES_REHEARSAL;
    try {
      delete process.env.POSTGRES_REHEARSAL;
      Object.assign(config.data, { profile: 'real', copyTakenAt: null });
      requireMutationProfile();
      assert.equal(linearLiveServer(), true);
      assert.equal(dakotaLiveServer(), true);
      Object.assign(config.data, { copyTakenAt: '2026-01-01T00:00:00Z' });
      assert.throws(requireMutationProfile, (e: unknown) => e instanceof MutationGuardError && e.status === 403);
      assert.equal(linearLiveServer(), false);
      assert.equal(dakotaLiveServer(), false);
      Object.assign(config.data, { profile: 'demo', copyTakenAt: null });
      requireMutationProfile();
      assert.equal(linearLiveServer(), false);
      assert.equal(dakotaLiveServer(), false);
      check('LabOS live gates permit real writes and jobs but still refuse preview copies', true,
        'Mutation, Linear and Dakota gates agree; demo never becomes a real connector. No job or connector invoked.');
    } finally {
      Object.assign(config.data, originalData);
      if (originalRehearsal === undefined) delete process.env.POSTGRES_REHEARSAL;
      else process.env.POSTGRES_REHEARSAL = originalRehearsal;
    }
    const provider = config.auth.provider;
    try {
      Object.assign(config.auth, { provider: 'labos' });
      const request = createRequestStore({ phase: 'render', headers: new Headers(), url: { pathname: '/' },
        rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() }, resumeDataCache: null,
        onUpdateCookies: undefined, previewProps: undefined, isHmrRefresh: false,
        serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, fallbackParams: null });
      const root = await workAsyncStorage.run({ route: '/', isStaticGeneration: false } as WorkStore,
        () => workUnitAsyncStorage.run(request, () => Home()));
      assert.equal(root, null);
      assert.equal(healthRoute().status, 200);
      Object.assign(config.auth, { provider: 'local' });
      await assert.rejects(Home(), (e: unknown) => e instanceof Error && e.message === 'NEXT_REDIRECT');
      check('Kit anonymous root leaves sign-in to layout; health stays public', true,
        'Missing LabOS cookie neither redirects nor throws; local root keeps its redirect.');
      assert.deepEqual(feedbackHome('demo'), { filesHere: true, livePort: null });
      check('Kit feedback stays on the deployed origin', true, 'LabOS accepts feedback here without linking to a Mac port.');
    } finally { Object.assign(config.auth, { provider }); }
  } finally {
    globalThis.fetch = originalFetch; Date.now = originalNow;
    if (originalUrl === undefined) delete process.env.LABOS_ME_URL; else process.env.LABOS_ME_URL = originalUrl;
    await db.query("delete from platform.app_user where labos_uid = 'invented-labos-uid'");
  }
}

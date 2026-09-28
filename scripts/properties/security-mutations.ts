import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { createRequestStore } from 'next/dist/server/async-storage/request-store';
import { actionAsyncStorage } from 'next/dist/server/app-render/action-async-storage.external';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { USER_COOKIE } from '../../lib/auth/cookie';
import { MutationGuardError, requireMutationOrigin, mutationProfileAllowed, resolveMutationUser } from '../../lib/mutation-guard';
import { POST as merge } from '../../app/api/identity/pursuit-merge/route';
import { GET as importProgress } from '../../app/api/import-jobs/route';
import { addUpdateAction } from '../../app/targets/actions';
import AccessDeniedPage from '../../app/access-denied/page';
import { AuthorizationError } from '../../lib/authz';
import { withDb } from '../../lib/db';
import type { Check, Db } from './harness';

export async function securityMutationProperties(check: Check, db: Db) {
  const viewer = await db.one<{ id: string; handle: string }>(`insert into platform.app_user(handle,name,initials,role,email,access)
    values ('security-action-viewer','Invented Action Viewer','IV','test','viewer@example.invalid','viewer') returning id,handle`);
  try {
    const counts = () => db.one(`select (select count(*) from strategy.pursuit_update) updates,
      (select count(*) from platform.audit_log) audits, (select count(*) from meetings.meeting) touchpoints`);
    const before = JSON.stringify(await counts());
    const outcomes: boolean[] = [];
    for (const enhanced of [false, true]) {
      const headers = new Headers({ host: 'localhost:3211', origin: 'http://localhost:3211',
        'sec-fetch-site': 'same-origin', cookie: `${USER_COOKIE}=${viewer!.handle}` });
      if (enhanced) headers.set('next-action', 'invented-action-id');
      const store = createRequestStore({ phase: 'action', headers, url: { pathname: '/all/pipeline' },
        rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() },
        resumeDataCache: null, onUpdateCookies: undefined, previewProps: undefined, isHmrRefresh: false,
        serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, fallbackParams: null });
      const form = new FormData();
      form.set('pursuitId', '00000000-0000-4000-8000-000000000001');
      form.set('body', 'Invented refused update');
      form.set('key', `invented-viewer-${enhanced}`);
      try {
        await withDb(db, () => workAsyncStorage.run({ route: '/all/pipeline', isStaticGeneration: false } as WorkStore,
          () => workUnitAsyncStorage.run(store, () => actionAsyncStorage.run({ isAction: true }, () => addUpdateAction(form)))));
        outcomes.push(false);
      } catch (error) {
        // Next's action handler turns this signal into a 303 for an ordinary post,
        // or client navigation for an enhanced action. Neither is an unhandled error.
        outcomes.push(isRedirectError(error) && getURLFromRedirectError(error) === '/access-denied');
      }
    }
    check('SEC viewer form posts and enhanced actions navigate to the refusal message without writing',
      outcomes.every(Boolean) && JSON.stringify(await counts()) === before,
      'Real addUpdateAction, invented viewer cookie, both request shapes: framework redirect before parsing or writes; update, touchpoint and audit counts unchanged.');
    const message = renderToStaticMarkup(createElement(AccessDeniedPage));
    check('SEC action refusal page explains the refusal and safe next step',
      message.includes(new AuthorizationError().message) && message.includes('No change was made.')
        && message.includes('administrator') && message.includes('href="/today"'),
      'Fixed policy message is rendered with no submitted data or target details.');
    const refusedRoute = await withDb(db, () => merge(new Request('http://localhost:3211/api/identity/pursuit-merge', {
      method: 'POST', headers: { origin: 'http://localhost:3211', cookie: `${USER_COOKIE}=${viewer!.handle}` },
    })));
    check('SEC viewer API refusal remains HTTP 403 with the same policy message',
      refusedRoute.status === 403 && (await refusedRoute.json()).error === new AuthorizationError().message,
      'The action redirect does not change API transport semantics.');
  } finally {
    await db.query('delete from platform.app_user where id=$1', [viewer!.id]);
  }
  const actor = await db.one<{ id: string; handle: string }>(`insert into platform.app_user(handle,name,initials,role,email,access)
    values ('security-progress-fixture','Invented Progress Admin','IP','test','progress@example.invalid','admin') returning id,handle`);
  const jobs = await db.query<{ id: string }>(`insert into platform.import_job(kind,actor,status,started_at,heartbeat_at)
    values ('strategy-moves',$1,'running',clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes'),
           ('export',$1,'queued',null,null) returning id`, [actor!.id]);
  try {
    const snapshot = () => db.query('select * from platform.import_job where id=any($1::uuid[]) order by id', [jobs.map(j => j.id)]);
    const before = JSON.stringify(await snapshot());
    const req = new Request('http://localhost:3211/api/import-jobs', { headers: { cookie: `${USER_COOKIE}=${actor!.handle}` } });
    const requestStore = createRequestStore({ phase: 'render', headers: req.headers,
      url: { pathname: '/api/import-jobs' }, rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() },
      resumeDataCache: null, onUpdateCookies: undefined, previewProps: undefined, isHmrRefresh: false,
      serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, fallbackParams: null });
    const workStore = { route: '/api/import-jobs', isStaticGeneration: false } as WorkStore;
    const response = await withDb(db, () => workAsyncStorage.run(workStore,
      () => workUnitAsyncStorage.run(requestStore, () => importProgress(req))));
    const payload = await response.json() as { jobs?: Array<{ id: string }> };
    check('SEC import progress GET neither launches queued work nor changes stale running jobs',
      response.status === 200 && jobs.every(j => payload.jobs?.some(row => row.id === j.id)) && JSON.stringify(await snapshot()) === before,
      'Actual GET with an explicit fictional Admin cookie, invented queued and stale-running jobs, complete rows unchanged.');
  } finally { await db.query('delete from platform.import_job where id=any($1::uuid[])', [jobs.map(j => j.id)]); }
  const request = (headers: Record<string, string>) => new Request('http://localhost:3211/api/identity/pursuit-merge', { method: 'POST', headers });
  const refuses = async (f: () => unknown, status: number) => {
    try { await f(); return false; } catch (e) { return e instanceof MutationGuardError && e.status === status; }
  };
  check('SEC mutation origin requires an explicit same origin',
    await refuses(() => requireMutationOrigin(request({})), 403)
    && await refuses(() => requireMutationOrigin(request({ origin: 'http://evil.localhost:3211' })), 403)
    && await refuses(() => requireMutationOrigin(request({ origin: 'https://localhost:3211' })), 403)
    && await refuses(() => requireMutationOrigin(request({ origin: 'http://localhost:3212' })), 403), 'Missing, sibling, wrong scheme and wrong port fail closed.');
  check('SEC mutation origin rejects conflicting fetch metadata', await refuses(() => requireMutationOrigin(request({ origin: 'http://localhost:3211', 'sec-fetch-site': 'same-site' })), 403), 'Same-site is weaker than same-origin.');
  requireMutationOrigin(request({ origin: 'http://localhost:3211', 'sec-fetch-site': 'same-origin' }));
  requireMutationOrigin(request({ origin: 'http://lan.example:3211', host: 'lan.example:3211' }));
  check('SEC same-origin LAN mutation is accepted', true, 'The browser Host can differ from Next’s bind address.');
  const response = await merge(request({ origin: 'http://localhost:3211' }));
  check('SEC merge route refuses anonymous before parsing or mutating', response.status === 401, 'Actual POST handler; no cookie, no body, no default-user fallback.');
  const roster = await db.query<{ handle: string }>('select handle from platform.app_user where active limit 1');
  check('SEC mutations resolve a known active actor', Boolean(roster[0] && (await resolveMutationUser(roster[0].handle, db)).id), 'Invented seeded roster.');
  check('SEC mutation actor rejects anonymous and unknown cookies', await refuses(() => resolveMutationUser(undefined, db), 401) && await refuses(() => resolveMutationUser('security-unknown-fixture', db), 401), 'No fallback to the first user.');
  await db.query("insert into platform.app_user(handle,name,initials,role,email,active) values ('security-inactive-fixture','Inactive Fixture','IF','test','inactive@example.invalid',false)");
  check('SEC mutation actor rejects inactive cookies', await refuses(() => resolveMutationUser('security-inactive-fixture', db), 401), 'Inactive rows cannot act.');
  check('SEC mutation profile rejects real preview and non-live writes', !mutationProfileAllowed('real', '2026-09-28T00:00:00Z', 'live') && !mutationProfileAllowed('real', null, 'dev') && mutationProfileAllowed('real', null, 'live') && mutationProfileAllowed('demo', null, 'dev'), 'Only the real live server may write; demo fixtures remain usable.');
}

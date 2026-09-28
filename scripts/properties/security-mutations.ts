import { MutationGuardError, requireMutationOrigin, mutationProfileAllowed, resolveMutationUser } from '../../lib/mutation-guard';
import { POST as merge } from '../../app/api/identity/pursuit-merge/route';
import { GET as importProgress } from '../../app/api/import-jobs/route';
import { withDb } from '../../lib/db';
import type { Check, Db } from './harness';

export async function securityMutationProperties(check: Check, db: Db) {
  const actor = await db.one<{ id: string }>('select id from platform.app_user where active limit 1');
  const jobs = await db.query<{ id: string }>(`insert into platform.import_job(kind,actor,status,started_at,heartbeat_at)
    values ('strategy-moves',$1,'running',clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes'),
           ('export',$1,'queued',null,null) returning id`, [actor!.id]);
  try {
    const snapshot = () => db.query('select * from platform.import_job where id=any($1::uuid[]) order by id', [jobs.map(j => j.id)]);
    const before = JSON.stringify(await snapshot());
    const response = await withDb(db, () => importProgress());
    const payload = await response.json() as { jobs?: Array<{ id: string }> };
    check('SEC import progress GET neither launches queued work nor changes stale running jobs',
      response.status === 200 && jobs.every(j => payload.jobs?.some(row => row.id === j.id)) && JSON.stringify(await snapshot()) === before,
      'Actual unauthenticated GET, invented queued and stale-running jobs, complete rows unchanged.');
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

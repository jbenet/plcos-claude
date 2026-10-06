import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncGuard } from '../../lib/sync/auth';
import { recordRun } from '../../lib/sync/runs';
import { SYNC_PUSH, SYNC_SNAPSHOT } from '../../lib/sync/scopes';
import { readRuns } from '../../lib/workflows/ledger';
import { createMcpToken, type AppUser } from '../../modules/platform';
import { freshDb, type Check } from './harness';

/**
 * The cloud ledger route (lib/sync/runs.ts, docs/28 §5) on invented metadata: a Mac run begins and finishes
 * in the server's ledger with a push token, by the ledger's own writer and rules.
 */
export async function syncRunsProperties(check: Check) {
  const db = await freshDb();
  const sel = 'id::text, handle, name, initials, role, email, access::text, vehicles, approves';
  const juan = (await db.one<AppUser>(`select ${sel} from platform.app_user where handle = 'juan'`))!;
  const gp = (await db.one<AppUser>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
    values ('runs-gp', 'Invented runs-gp', 'IR', 'Invented (props)', 'runs-gp@example.invalid', 'team', null)
    on conflict (handle) do update set active = true returning ${sel}`))!;
  const mint = (owner: AppUser, scope: string) => createMcpToken(owner, { label: 'props runs', tools: [scope], vehicles: null, callsPerDay: 100, days: 30 }, db);
  const mine = await mint(juan, SYNC_PUSH), theirs = await mint(gp, SYNC_PUSH), snap = await mint(juan, SYNC_SNAPSHOT);
  const root = await mkdtemp(join(tmpdir(), 'plcos-sync-runs-'));
  const call = async (secret: string, body: unknown) => {
    const req = () => new Request('http://localhost:3119/api/sync/runs', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const guard = await syncGuard(req(), 'push');
    if ('response' in guard) return { status: guard.response.status, body: await guard.response.json() as Record<string, any> };
    return recordRun(guard.caller, req(), { root }) as Promise<{ status: number; body: Record<string, any> }>;
  };
  const h = 'a'.repeat(64);
  const metadata = { parentRunId: null, workflow: 'W1c', operation: 'check', protocol: { version: '1.0', hash: h }, source: 'claude-code', agent: 'fact-checker',
    model: 'claude-haiku-4-5', launchFolder: '/Invented/live', workerFolder: '/Invented/live', batch: { id: 'w1c-91a', manifest: 'enrich/batches/w1c-91a.jsonl', hash: h, planned: 3 } };
  const result = { counts: { selected: 3, written: 3, valid: 3, failed: 0, skipped: 0 }, checks: [{ name: 'review parses', status: 'pass' }],
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured' }, outcome: 'succeeded', reason: null };
  try {
    const asApp = await call(mine.secret, { event: 'begin', run: { ...metadata, source: 'app' } });
    const badHash = await call(mine.secret, { event: 'begin', run: { ...metadata, protocol: { version: null, hash: 'nope' } } });
    const bySnapshot = await call(snap.secret, { event: 'begin', run: metadata });
    const noEvent = await call(mine.secret, { run: metadata });
    const refusedFirst = (await readRuns({ root })).runs.length;
    const begun = await call(mine.secret, { event: 'begin', run: metadata });
    const runId = begun.body.runId as string;
    const byOther = await call(theirs.secret, { event: 'finish', runId, result });
    const unknown = await call(mine.secret, { event: 'finish', runId: '11111111-2222-4333-8444-555555555555', result });
    const finished = await call(mine.secret, { event: 'finish', runId, result });
    const repeated = await call(mine.secret, { event: 'finish', runId, result });
    const changed = await call(mine.secret, { event: 'finish', runId, result: { ...result, outcome: 'failed', reason: 'changed my mind' } });
    const ledger = await readRuns({ root });
    const run = ledger.runs.find((r) => r.runId === runId);
    const audit = await db.query<{ detail: Record<string, any> }>(`select detail from platform.audit_log where action = 'mcp.call' and subject_id = $1 order by id`, [mine.token.tokenId]);
    check('Cloud ledger: refuses an app source, a bad hash, a snapshot token and a call with no event, writing nothing',
      asApp.status === 422 && badHash.status === 422 && bySnapshot.status === 403 && noEvent.status === 422 && refusedFirst === 0,
      `${asApp.status} ${badHash.status} ${bySnapshot.status} ${noEvent.status}; ${refusedFirst} runs written`);
    check('Cloud ledger: a Mac run begins and finishes here, only by the person who began it; a repeat finish is harmless and a different one refused',
      begun.status === 201 && byOther.status === 403 && unknown.status === 404 && finished.status === 200 && finished.body.outcome === 'succeeded'
      && repeated.status === 200 && changed.status === 422 && ledger.issues.length === 0 && ledger.runs.length === 1
      && run?.start?.launchFolder === '/Invented/live [by juan, cloud ledger]' && run.finish?.usage?.input === 100 && run.outcome === 'succeeded',
      `${begun.status} ${byOther.status} ${unknown.status} ${finished.status} ${repeated.status} ${changed.status}; issues ${ledger.issues.join('; ')}`);
    check('Cloud ledger: every call is audited as the push token\'s, with the run id and never the metadata',
      audit.length >= 6 && audit.every((a) => a.detail.via === 'sync' && a.detail.op === 'ledger' && !JSON.stringify(a.detail).includes('fact-checker') && !JSON.stringify(a.detail).includes('/Invented/live'))
      && audit.some((a) => a.detail.affected?.runId === runId && a.detail.outcome === 'ok'),
      `${audit.length} audit rows`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

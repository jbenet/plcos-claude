import { syncGuard } from '../../lib/sync/auth';
import { SYNC_ADMIN, SYNC_PUSH } from '../../lib/sync/scopes';
import { astraCall } from '../../lib/sync/astra';
import { cancel, enqueue, inWindow, readRunner, recentJobs, saveSettings } from '../../lib/astra/jobs';
import { batchPrefix, codexArgs, fill, nightOf, shouldFallBack } from '../../lib/astra/runner';
import { createMcpToken, type AppUser } from '../../modules/platform';
import { freshDb, type Check } from './harness';

/**
 * The Astra runner (docs/30) on invented data: the night window and the night a time belongs to, the brief
 * filler, codex's arguments, and the server's queue — a person queues, the runner's poll claims only what the
 * window allows, Auto queues one night once, cancels reach the runner, lost runs fail, reports keep counts only.
 */
export async function astraProperties(check: Check) {
  check('astra window wraps midnight', inWindow(23, 22, 7) && inWindow(3, 22, 7) && !inWindow(7, 22, 7) && !inWindow(12, 22, 7) && inWindow(12, 9, 9), 'window');
  const late = nightOf(new Date(2026, 9, 11, 2), 22, 7), early = nightOf(new Date(2026, 9, 10, 23), 22, 7), day = nightOf(new Date(2026, 9, 11, 12), 22, 7);
  check('astra counts 02:00 as the night before', late.night === '2026-10-10' && late.inWindow && early.night === '2026-10-10' && !day.inWindow, JSON.stringify([late, early, day]));
  let unknown = false;
  try { fill('{{nope}}', {}); } catch { unknown = true; }
  check('astra brief filler refuses an unknown placeholder', unknown && fill('a {{x}} b', { x: '1' }) === 'a 1 b', 'fill');
  const args = codexArgs({ model: 'gpt-6-astra', worker: '/w', enrich: '/d/enrich', last: '/l.md' });
  check('astra codex runs sandboxed with web search and the brief on stdin', args.includes('workspace-write') && args.includes('tools.web_search=true')
    && args.at(-1) === '-' && !args.includes('danger-full-access'), args.join(' '));
  check('astra falls back only on capacity with no final message', shouldFallBack('', 'model is at capacity') && !shouldFallBack('done', 'model is at capacity') && !shouldFallBack('', 'error'), 'fallback');
  check('astra batch prefix is short and the runner\'s', batchPrefix('0123456789abcdef') === 'astra-01234567-', batchPrefix('0123456789abcdef'));

  const db = await freshDb();
  const sel = 'id::text, handle, name, initials, role, email, access::text, vehicles, approves';
  const juan = (await db.one<AppUser>(`select ${sel} from platform.app_user where handle = 'juan'`))!;
  const mint = (tools: string[]) => createMcpToken(juan, { label: 'props astra', tools, vehicles: null, callsPerDay: 100, days: 30 }, db);
  const admin = await mint([SYNC_ADMIN]), pushOnly = await mint([SYNC_PUSH]);
  const call = async (secret: string, body: unknown) => {
    const req = () => new Request('http://localhost:3119/api/sync/astra', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const guard = await syncGuard(req(), 'astra');
    if ('response' in guard) return { status: guard.response.status, body: await guard.response.json() as Record<string, any> };
    return astraCall(guard.caller, req(), { db }) as Promise<{ status: number; body: Record<string, any> }>;
  };
  const poll = (o: Partial<{ inWindow: boolean; free: number; held: string[]; night: string }> = {}) =>
    call(admin.secret, { op: 'poll', host: 'props', inWindow: false, night: '2026-10-10', free: 4, held: [], slots: [{ slot: 's1', job: null }], ...o });

  check('astra refuses a push-only token', (await call(pushOnly.secret, { op: 'poll' })).status === 403, 'push-only');
  await enqueue(db, juan.id, { workflow: 'w1w5', size: 5, count: 2, runNow: false });
  await enqueue(db, juan.id, { workflow: 'w5', size: 6, count: 1, runNow: true });
  const day1 = await poll();
  check('astra hands out only Now runs outside the window', day1.status === 200 && day1.body.jobs.length === 1 && day1.body.jobs[0].workflow === 'w5', JSON.stringify(day1.body));
  const nowId = day1.body.jobs[0]?.id as string;
  const night1 = await poll({ inWindow: true, free: 1, held: [nowId] });
  check('astra claims no more than the free slots', night1.body.jobs.length === 1 && night1.body.jobs[0].workflow === 'w1w5', JSON.stringify(night1.body.jobs));
  const nightId = night1.body.jobs[0]?.id as string;
  const report = await call(admin.secret, { op: 'report', id: nightId, status: 'running', batch: 'astra-x-01', counts: { selected: 5, names: 'Invented Person', valid: 'x' } });
  const row = (await recentJobs(db)).find((j) => j.id === nightId);
  check('astra reports keep numeric counts only', report.status === 200 && row?.status === 'running' && row.counts.selected === 5 && !('names' in row.counts) && !('valid' in row.counts), JSON.stringify(row?.counts));
  await cancel(db, nightId);
  const told = await poll({ inWindow: true, free: 0, held: [nowId, nightId] });
  check('astra tells the runner which held run was cancelled', told.body.cancel.length === 1 && told.body.cancel[0] === nightId, JSON.stringify(told.body.cancel));
  await poll({ inWindow: true, free: 0, held: [] });
  const lost = (await recentJobs(db)).find((j) => j.id === nowId);
  check('astra fails a run the runner no longer holds', lost?.status === 'failed', String(lost?.status));
  const late2 = await call(admin.secret, { op: 'report', id: nowId, status: 'done', counts: { selected: 6 } });
  check('astra refuses a report on a run that already ended', late2.status === 409, String(late2.status));

  await saveSettings(db, juan.id, { autoOn: true, autoWorkflow: 'w1', autoBatches: 3, batchSize: 4 });
  await saveSettings(db, juan.id, { paused: true });
  const paused = await poll({ inWindow: true, night: '2026-10-11' });
  check('astra hands out nothing while paused', paused.body.paused === true && paused.body.jobs.length === 0, JSON.stringify(paused.body));
  await saveSettings(db, juan.id, { paused: false });
  await poll({ inWindow: true, night: '2026-10-11', free: 0 });
  await poll({ inWindow: true, night: '2026-10-11', free: 0 });
  const autos = (await recentJobs(db)).filter((j) => j.source === 'auto' && j.night === '2026-10-11');
  check('astra Auto queues one night\'s runs once', autos.length === 3 && autos.every((j) => j.workflow === 'w1' && j.size === 4), String(autos.length));
  const r = await readRunner(db);
  check('astra records the runner\'s heartbeat and slots', Boolean(r.heartbeatAt) && r.host === 'props' && r.slots.length === 1, JSON.stringify(r.slots));
  const badPoll = await call(admin.secret, { op: 'poll', inWindow: true });
  check('astra refuses a poll without a night', badPoll.status === 422, String(badPoll.status));
}

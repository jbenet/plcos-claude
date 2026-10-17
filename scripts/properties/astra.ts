import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { researchExport, RESEARCH_FRESH_MS } from '../../lib/astra/research';
import { syncGuard } from '../../lib/sync/auth';
import { SYNC_ADMIN, SYNC_PUSH } from '../../lib/sync/scopes';
import { astraCall } from '../../lib/sync/astra';
import { ASTRA_WORKFLOWS, cancel, cancelQueued, enqueue, inWindow, parsePlan, planText, readRunner, recentJobs, saveSettings } from '../../lib/astra/jobs';
import { batchPrefix, codexArgs, fill, nightOf, RUN_LIMIT_MS, shouldFallBack, WEB_WORKFLOWS } from '../../lib/astra/runner';
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
  const local = codexArgs({ model: 'gpt-6-astra', worker: '/w', enrich: '/d/enrich', last: '/l.md', web: false });
  check('astra strategy-only runs get no web search or network, and every workflow has a time limit', local.includes('tools.web_search=false') && local.includes('sandbox_workspace_write.network_access=false')
    && args.includes('sandbox_workspace_write.network_access=true')
    && !WEB_WORKFLOWS.includes('w5t') && ASTRA_WORKFLOWS.every((w) => RUN_LIMIT_MS[w]! > 0 && RUN_LIMIT_MS[w]! <= 2 * 3600_000), local.join(' '));
  const templates = await Promise.all(ASTRA_WORKFLOWS.map((w) => readFile(`scripts/astra/templates/${w}.md`, 'utf8').then(() => true, () => false)));
  check('astra has a brief for every workflow; the search pass searches and revising strategies does not',
    templates.every(Boolean) && WEB_WORKFLOWS.includes('w1s') && !WEB_WORKFLOWS.includes('w5r'), ASTRA_WORKFLOWS.join(' '));
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
  const poll = (o: Partial<{ inWindow: boolean; free: number; held: string[]; night: string; workflows: string[]; commands: string[]; commit: string; startedAt: string;
    features: string[]; slots: Array<{ slot: string; job: string | null }> }> = {}) =>
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
  const rival = await call(admin.secret, { op: 'poll', host: 'props-other', inWindow: true, night: '2026-10-10', free: 4, held: [], slots: [] });
  const stillHeld = await db.query<{ status: string }>(`select status from platform.astra_job where id = any($1::uuid[])`, [[nowId, nightId]]);
  check('astra refuses a second runner while the first is alive, and its poll fails none of the first one\'s runs',
    rival.status === 409 && stillHeld.every((j) => j.status === 'claimed'), `${rival.status}; ${stillHeld.map((j) => j.status).join(',')}`);
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

  const before = (await recentJobs(db)).length;
  const queued = await call(admin.secret, { op: 'queue', workflow: 'w1w5', size: 3, count: 2, runNow: true });
  const after = await recentJobs(db);
  check('astra queues runs by token, as a person does', queued.status === 200 && queued.body.queued === 2 && after.length === before + 2
    && after.filter((j) => j.source === 'person' && j.runNow && j.size === 3).length >= 2, JSON.stringify(queued.body));
  const tooMany = await call(admin.secret, { op: 'queue', workflow: 'w1w5', size: 3, count: 50, runNow: true });
  const noFlow = await call(admin.secret, { op: 'queue', workflow: 'rm -rf', size: 3, count: 1, runNow: true });
  check('astra refuses a queue call out of bounds or with an unknown workflow', tooMany.status === 422 && noFlow.status === 422, `${tooMany.status} ${noFlow.status}`);
  const status = await call(admin.secret, { op: 'status' });
  check('astra status gives the runner and recent runs', status.status === 200 && typeof status.body.up === 'boolean' && status.body.runner.host === 'props'
    && Array.isArray(status.body.jobs) && status.body.jobs.length > 0, JSON.stringify(Object.keys(status.body)));
  check('astra status and queue refuse a push-only token', (await call(pushOnly.secret, { op: 'status' })).status === 403
    && (await call(pushOnly.secret, { op: 'queue', workflow: 'w1', size: 3, count: 1, runNow: true })).status === 403, 'push-only');

  // w5t (Shorten strategies): a runner from before it names no workflows and must never be handed one.
  await cancelQueued(db);
  await enqueue(db, juan.id, { workflow: 'w5t', size: 8, count: 1, runNow: true });
  await enqueue(db, juan.id, { workflow: 'w5', size: 4, count: 1, runNow: true });
  const older = await poll({ free: 4 });
  const newer = await poll({ free: 4, held: older.body.jobs.map((j: { id: string }) => j.id), workflows: ['w1w5', 'w1', 'w5', 'w5t', 'w9'] });
  check('astra hands w5t only to a runner that names it', older.body.jobs.length === 1 && older.body.jobs[0].workflow === 'w5'
    && newer.body.jobs.length === 1 && newer.body.jobs[0].workflow === 'w5t' && newer.body.jobs[0].size === 8,
    `${JSON.stringify(older.body.jobs)} ${JSON.stringify(newer.body.jobs)}`);
  const values = Object.fromEntries(['worker', 'repo', 'data', 'count', 'batch', 'rawExamples', 'strategyExamples'].map((k) => [k, `<${k}>`]));
  const filled = await Promise.all(ASTRA_WORKFLOWS.map(async (w) => {
    try { return fill(await readFile(`scripts/astra/templates/${w}.md`, 'utf8'), { ...values, common: 'COMMON' }).startsWith('COMMON'); } catch { return false; }
  }));
  check('astra has a brief template the runner can fill for every workflow', filled.every(Boolean), JSON.stringify(filled));

  // Runner commands (Juan, 11 Oct 2026: "built some RC type thing for the runner on the Mac so you can help admin it").
  const issued = await call(admin.secret, { op: 'command', command: 'diagnose' });
  const again = await call(admin.secret, { op: 'command', command: 'diagnose' });
  const shell = await call(admin.secret, { op: 'command', command: 'rm -rf ~' });
  check('astra issues a runner command by token, once per kind, from the fixed list only', issued.status === 200 && again.body.existing === true
    && again.body.id === issued.body.id && shell.status === 422, `${issued.status} ${JSON.stringify(again.body)} ${shell.status}`);
  const oldRunner = await poll({ free: 0 });
  const newRunner = await poll({ free: 0, commands: ['diagnose', 'restart', 'update', 'format-disk'], commit: 'abcdef1234567', startedAt: '2026-10-11T23:00:00Z' });
  check('astra hands commands only to a runner that takes them, and records its code', oldRunner.body.commands.length === 0
    && newRunner.body.commands.length === 1 && newRunner.body.commands[0].op === 'diagnose' && (await readRunner(db)).code === 'abcdef1234567',
    `${JSON.stringify(oldRunner.body.commands)} ${JSON.stringify(newRunner.body.commands)}`);
  const answered = await call(admin.secret, { op: 'command-report', id: issued.body.id, status: 'done', message: 'Checked.',
    result: { head: 'abcdef123456', behind: 2, supervised: true, names: ['Invented Person'], nested: { a: 1 }, 'bad key!': 'x' } });
  const twice = await call(admin.secret, { op: 'command-report', id: issued.body.id, status: 'done', result: {} });
  const done = (await call(admin.secret, { op: 'status' })).body.commands.find((c: { id: string }) => c.id === issued.body.id);
  check('astra keeps short scalar command results only, and takes one answer', answered.status === 200 && twice.status === 409 && done?.status === 'done'
    && done.result.behind === 2 && !('names' in done.result) && !('nested' in done.result) && Object.keys(done.result).length === 3, JSON.stringify(done));

  // Night plan (migration 027; Juan, 12 Oct 2026: "i asked you to keep it busy", "would be good to come up with a schedule").
  let badPlan = '';
  try { parsePlan('w5 5 neurotech\nrm -rf 3'); } catch (e) { badPlan = e instanceof Error ? e.message : ''; }
  const plan = parsePlan('# focus first\nw5 5 neurotech, spv-netholabs\nw5t 8\nw1w5 5');
  check('astra parses a night plan and refuses a line it cannot read', plan.length === 3 && plan[0]!.focus.length === 2 && plan[1]!.focus.length === 0
    && /Step 2/.test(badPlan) && planText(plan).split('\n')[0] === 'w5 5 neurotech, spv-netholabs', `${JSON.stringify(plan)} ${badPlan}`);
  await saveSettings(db, juan.id, { autoOn: false });
  await cancelQueued(db);
  await poll({ free: 0, held: [] });
  const all = ['w1w5', 'w1', 'w5', 'w5t'], two = [{ slot: 's1', job: null }, { slot: 's2', job: null }];
  const viaToken = await call(admin.secret, { op: 'plan', keepBusy: true, plan: plan.map((p) => ({ ...p })), windowStart: 22, windowEnd: 10 });
  const badStep = await call(admin.secret, { op: 'plan', plan: [{ workflow: 'w9', size: 3 }] });
  check('astra saves a night plan by token and refuses an unknown step', viaToken.status === 200 && viaToken.body.runner.keepBusy === true
    && viaToken.body.runner.plan.length === 3 && viaToken.body.runner.windowEnd === 10 && badStep.status === 422, `${JSON.stringify(viaToken.body.runner?.plan)} ${badStep.status}`);
  await poll({ inWindow: true, night: '2026-10-12', free: 0, workflows: all, features: ['focus'], slots: two });
  await poll({ inWindow: true, night: '2026-10-12', free: 0, workflows: all, features: ['focus'], slots: two });
  const step0 = (await recentJobs(db)).filter((j) => j.source === 'plan' && j.night === '2026-10-12' && j.status === 'queued');
  check('astra keeps two runs per slot queued from the first plan step, with its focus, and no more', step0.length === 4
    && step0.every((j) => j.step === 0 && j.workflow === 'w5' && j.focus.join() === 'neurotech,spv-netholabs'), JSON.stringify(step0.map((j) => [j.step, j.workflow, j.focus])));
  const unfocused = await poll({ inWindow: true, night: '2026-10-12', free: 4, workflows: all, slots: two });
  check('astra never hands a focused run to a runner that cannot cut one', unfocused.body.jobs.length === 0, JSON.stringify(unfocused.body.jobs));
  const night2 = await poll({ inWindow: true, night: '2026-10-13', free: 1, workflows: all, slots: two });
  const left = (await recentJobs(db)).filter((j) => j.source === 'plan' && j.night === '2026-10-12');
  check('astra skips a focused step for such a runner, and drops an earlier night\'s plan runs', night2.body.jobs.length === 1 && night2.body.jobs[0].workflow === 'w5t'
    && left.every((j) => j.status === 'cancelled'), `${JSON.stringify(night2.body.jobs)} ${JSON.stringify(left.map((j) => j.status))}`);
  const empty = night2.body.jobs[0].id as string;
  await call(admin.secret, { op: 'report', id: empty, status: 'done', counts: { selected: 0 }, message: 'Nobody is left for this workflow.' });
  await poll({ inWindow: true, night: '2026-10-13', free: 0, workflows: all, slots: two });
  const n2 = (await recentJobs(db)).filter((j) => j.source === 'plan' && j.night === '2026-10-13');
  check('astra moves to the next plan step when a run finds nobody, cancelling that step\'s leftovers',
    n2.filter((j) => j.step === 1 && j.status === 'queued').length === 0 && n2.filter((j) => j.step === 2 && j.status === 'queued').length > 0,
    JSON.stringify(n2.map((j) => [j.step, j.status])));
  await saveSettings(db, juan.id, { keepBusy: false });
  await cancelQueued(db);
  await poll({ inWindow: true, night: '2026-10-14', free: 0, workflows: all, slots: two });
  check('astra queues nothing from the plan with Keep busy off', (await recentJobs(db)).every((j) => j.night !== '2026-10-14'), 'keep busy off');

  // The research export the runner fetches each night (14 Oct 2026: a stale Mac copy left every plan step "Nobody is left").
  const dir = await mkdtemp(join(tmpdir(), 'astra-research-'));
  try {
    let queued = 0;
    const queue = async () => { queued++; return { id: '00000000-0000-0000-0000-000000000001' }; };
    const none = await researchExport(db, juan.id, { dir, queue });
    await writeFile(join(dir, 'candidates.jsonl'), '{"key":"invented-1"}\n');
    await writeFile(join(dir, 'team.json'), '[]\n');
    await writeFile(join(dir, 'notes.json'), '{}\n');
    const fresh = await researchExport(db, juan.id, { dir, queue });
    const old = new Date(Date.now() - RESEARCH_FRESH_MS - 60_000);
    await utimes(join(dir, 'candidates.jsonl'), old, old);
    const stale = await researchExport(db, juan.id, { dir, queue });
    check('astra research export: none or stale queues a fresh export; a fresh one hands out only the export files, hashed',
      none.pending && stale.pending && queued === 2 && !fresh.pending && Object.keys(fresh.files).sort().join() === 'candidates.jsonl,team.json'
        && fresh.files['candidates.jsonl']!.sha256.length === 64, JSON.stringify({ queued, files: fresh.pending ? null : Object.keys(fresh.files) }));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

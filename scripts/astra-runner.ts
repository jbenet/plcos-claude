/**
 * The Astra runner (docs/30-astra-runner.md). Juan, 10 Oct 2026: "a setup with Astra that I run ... not coordinated
 * by you", "should not go through claude, should be able to have a UI and trigger astra automatically".
 *
 *   npm run astra                 from the live checkout; runs until stopped (Ctrl-C, or npm run astra:uninstall)
 *   npm run astra:install         the same as a login item (launchd), started now and at every login
 *
 * Every minute it polls Developer → Astra on the server with the Admin token in the Keychain (plcos-railway /
 * push-token; app-url), never printed and never on a command line. For each run it is handed, it cuts a batch with
 * enrich-batch.ts, fills a fixed brief from scripts/astra/templates, records the run in the ledger, runs ChatGPT's
 * codex (gpt-6-astra, gpt-6-sol only when the first is at capacity), pushes what passed the importer's checks with
 * cloud-push.sh, finishes the ledger run and reports counts back. The server hands out only a workflow and a size:
 * it can never make this runner run a command or a brief of its choosing. Names stay on the Mac; logs and briefs
 * stay under plcos-data/real/workflows/astra/.
 *
 * Each poll names the workflows this copy can run, so the server never hands an older runner a workflow it doesn't
 * know, and the commands it takes from Developer → Astra (Juan, 11 Oct 2026: "built some RC type thing for the runner
 * on the Mac so you can help admin it"): Check reports the checkout's state, Restart exits so launchd or the Astra
 * app starts it again, Update fast-forwards to origin/master (npm ci when the dependencies changed) and restarts.
 * Only those three, from a fixed list: the server can never hand it a command line. Under launchd or the Astra app,
 * an idle runner also fast-forwards every ten minutes and restarts whenever the checkout differs from the code it
 * started on (never with local changes, off master, or when the dependencies changed: that waits for Update).
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { beginRun, realRoot } from '../lib/workflows/ledger';
import { finishWithUsage } from '../lib/workflows/usage';
import { batchPrefix, CAPACITY_WAIT_MS, CODEX, codexArgs, fill, MODELS, nightOf, RUN_LIMIT_MS, shouldFallBack, WEB_WORKFLOWS } from '../lib/astra/runner';

const run = promisify(execFile);
const REPO = process.cwd();
// Juan, 12 Oct 2026: "run many more astra runs in parallel". 8 by default (guessed; codex's own rate limit is the
// real ceiling, and "at capacity" pauses claiming); slots past the codex worktrees use plain folders.
const SLOTS = Math.max(1, Math.min(12, Number(process.env.ASTRA_SLOTS ?? 8)));
const POLL_MS = 60_000;
const WORKFLOWS = ['w1w5', 'w1', 'w5', 'w5t'] as const;
type Job = { id: string; workflow: (typeof WORKFLOWS)[number]; size: number; focus?: string[] };
/** What this runner can do beyond the first runners: `focus` = cut a batch for named vehicles (the night plan, migration 027). */
const FEATURES = ['focus'] as const;
/** Restarted when it exits: by launchd (the login item), or by the Astra app — found by its env, or up the parent chain for app builds before it set one. */
let SUPERVISED = process.env.ASTRA_SUPERVISED === '1' || process.env.XPC_SERVICE_NAME === 'com.plcos.astra-runner';
async function underAstraApp(): Promise<boolean> {
  let pid = process.ppid;
  for (let i = 0; i < 8 && pid > 1; i++) {
    try {
      const [ppid, ...comm] = (await run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)])).stdout.trim().split(/\s+/);
      if (/Astra\.app\/Contents\/MacOS\//.test(comm.join(' '))) return true;
      pid = Number(ppid);
    } catch { return false; }
  }
  return false;
}
const UPDATE_MS = 10 * 60_000;
type Slot = { name: string; folder: string; git: string[]; job: Job | null; child: ChildProcess | null; cancelled: boolean };

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);

async function keychain(account: string): Promise<string | null> {
  if (account === 'push-token' && process.env.CLOUD_PUSH_TOKEN) return process.env.CLOUD_PUSH_TOKEN;
  if (account === 'app-url' && process.env.CLOUD_APP_URL) return process.env.CLOUD_APP_URL;
  try { return (await run('security', ['find-generic-password', '-s', 'plcos-railway', '-a', account, '-w'])).stdout.trim() || null; }
  catch { return null; }
}

async function call(body: Record<string, unknown>): Promise<Record<string, any>> {
  const [token, url] = [await keychain('push-token'), await keychain('app-url')];
  if (!token || !url) throw new Error('No Admin token or app URL in the Keychain item plcos-railway (push-token, app-url).');
  const res = await fetch(new URL('/api/sync/astra', url), { method: 'POST', body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw new Error(`The server answered ${res.status}: ${String(json.error ?? '').slice(0, 200)}`);
  return json;
}
const reportJob = (id: string, status: 'running' | 'done' | 'failed', extra: Record<string, unknown> = {}) =>
  call({ op: 'report', id, status, ...extra }).catch((e) => log(`report failed: ${e instanceof Error ? e.message : e}`));

/** Worker folders: the codex worktrees beside the live checkout when they exist (as in docs/codex-headless.md), else plain folders. */
async function slots(astra: string): Promise<Slot[]> {
  const out: Slot[] = [];
  for (let i = 1; i <= SLOTS; i++) {
    const tree = resolve(REPO, `../plcos-codex-b${i}`);
    const gitDir = resolve(REPO, '.git');
    if (existsSync(join(tree, '.git'))) {
      out.push({ name: `b${i}`, folder: tree, git: [join(gitDir, 'worktrees', basename(tree)), join(gitDir, 'objects')], job: null, child: null, cancelled: false });
    } else {
      const folder = join(astra, 'slots', `s${i}`);
      await mkdir(folder, { recursive: true });
      out.push({ name: `s${i}`, folder, git: [], job: null, child: null, cancelled: false });
    }
  }
  return out;
}

/** Newest finished files of one kind, as example paths for the brief (never their contents). */
async function examples(dir: string, skip: Set<string>, n: number): Promise<string> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json') && !skip.has(f.replace(/\.json$/, '')));
  const dated = await Promise.all(files.slice(-400).map(async (f) => ({ f, t: (await stat(join(dir, f))).mtimeMs })));
  return dated.sort((a, b) => b.t - a.t).slice(0, n).map((x) => join(dir, x.f)).join(', ') || 'none on file';
}

/** Files for these keys written since `since`; with `folders`, also in each vehicle folder (strategy/<vehicle>/<key>.json). */
async function writtenSince(dir: string, keys: string[], since: number, folders = false): Promise<string[]> {
  const dirs = [dir, ...(folders ? (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => join(dir, e.name)) : [])];
  const out: string[] = [];
  for (const d of dirs) for (const k of keys) {
    const f = join(d, `${k}.json`);
    try { if ((await stat(f)).mtimeMs >= since) out.push(f); } catch { /* not written */ }
  }
  return out;
}

/**
 * The batch's keys and their identity aliases (entity-keys.json, alias → LP): a worker revising an LP's strategy keeps
 * the file it found, which may sit under an alias (12 Oct 2026: three W5 runs wrote 15 strategies the runner missed).
 */
async function withAliases(enrich: string, keys: string[]): Promise<string[]> {
  const aliases: Record<string, string> = JSON.parse(await readFile(join(enrich, 'entity-keys.json'), 'utf8').catch(() => '{}'));
  const wanted = new Set(keys);
  const out = new Set(keys);
  for (const [from, to] of Object.entries(aliases)) {
    if (wanted.has(to)) out.add(from);
    if (wanted.has(from)) out.add(to);
  }
  return [...out];
}

/**
 * Push each file on its own, so one that fails the importer's checks costs only itself. The server takes one push at a
 * time and answers others "Another push is being taken" (409): runs finishing together collided on the first night
 * (10 of 237 files), so that answer is retried with a growing wait; a refusal on the file's merits is not.
 */
const BUSY_WAITS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
async function push(workflow: 'W1' | 'W5', runId: string, files: string[]): Promise<number> {
  let ok = 0;
  for (const f of files) {
    for (let attempt = 0; ; attempt++) {
      try { await run('bash', ['scripts/cloud-push.sh', '--workflow', workflow, '--run', runId, f], { cwd: REPO, timeout: 180_000 }); ok++; break; }
      catch (e) {
        const out = e && typeof e === 'object' ? `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}` : '';
        if (/Another push is being taken/.test(out) && attempt < BUSY_WAITS_MS.length) { await new Promise((r) => setTimeout(r, BUSY_WAITS_MS[attempt])); continue; }
        log(`push refused for one ${workflow} file of run ${runId}`);
        break;
      }
    }
  }
  return ok;
}

async function codex(slot: Slot, brief: string, base: string, enrich: string): Promise<{ model: string; finished: boolean; capacity: boolean }> {
  const last = `${base}-last.md`;
  for (const model of MODELS) {
    await writeFile(last, '');
    const out = createWriteStream(`${base}-${model}.log`);
    const child = spawn(process.env.ASTRA_CODEX ?? CODEX, codexArgs({ model, worker: slot.folder, enrich, last, git: slot.git, web: WEB_WORKFLOWS.includes(slot.job?.workflow ?? 'w1') }), { stdio: ['pipe', 'pipe', 'pipe'] });
    slot.child = child;
    child.stdout!.pipe(out); child.stderr!.pipe(out);
    child.stdin!.on('error', () => undefined); // a worker that exits before reading its brief
    child.stdin!.end(brief);
    const timer = setTimeout(() => child.kill('SIGTERM'), RUN_LIMIT_MS[slot.job?.workflow ?? ''] ?? 2 * 3600_000);
    await new Promise<void>((done) => { child.on('close', () => done()); child.on('error', (e) => { out.write(`spawn failed: ${e.message}\n`); done(); }); });
    clearTimeout(timer);
    slot.child = null;
    const message = await readFile(last, 'utf8').catch(() => '');
    if (message.trim()) return { model, finished: true, capacity: false };
    if (slot.cancelled || !shouldFallBack(message, await readFile(`${base}-${model}.log`, 'utf8').catch(() => ''))) return { model, finished: false, capacity: false };
  }
  return { model: MODELS[MODELS.length - 1], finished: false, capacity: true };
}

let capacityUntil = 0;
let cutting: Promise<unknown> = Promise.resolve();

async function work(slot: Slot, job: Job, root: string) {
  const astra = join(root, 'workflows', 'astra'), enrich = join(root, 'enrich'), batches = join(enrich, 'batches');
  const env = { ...process.env, DATA_PROFILE: 'real' };
  await reportJob(job.id, 'running', { slot: slot.name });
  // Cut one batch at a time, so two runs never take the same LPs.
  const mode = job.workflow === 'w5' || job.workflow === 'w5t' ? 'w5' : 'w1';
  const prefix = batchPrefix(job.id);
  const cut = cutting.then(() => run('npx', ['tsx', 'scripts/enrich-batch.ts', mode, prefix, String(job.size), '--max', '1',
    ...(job.workflow === 'w5t' ? ['--tighten'] : []), ...(job.focus?.length ? ['--vehicle', job.focus.join(',')] : [])], { cwd: REPO, env, timeout: 600_000 }));
  cutting = cut.catch(() => undefined);
  try { await cut; } catch { return reportJob(job.id, 'failed', { message: 'The batch cutter failed; see the runner log on the Mac.' }); }
  const batch = `${prefix}01`, file = join(batches, `${batch}.${mode === 'w1' ? 'jsonl' : 'txt'}`);
  if (!existsSync(file)) return reportJob(job.id, 'done', { counts: { selected: 0 }, message: 'Nobody is left for this workflow.' });
  const text = await readFile(file, 'utf8');
  const keys = mode === 'w1' ? lines(text).map((l) => JSON.parse(l).key as string) : lines(text);
  if (job.workflow === 'w1w5') await writeFile(join(batches, `${batch}.txt`), keys.join('\n') + '\n');
  const skip = new Set(keys);
  const values: Record<string, string> = { worker: slot.folder, repo: REPO, data: root, count: String(keys.length), batch,
    rawExamples: mode === 'w5' ? '' : await examples(join(enrich, 'raw'), skip, 3),
    strategyExamples: job.workflow === 'w1' ? '' : await examples(join(enrich, 'strategy'), skip, 2) };
  const templates = join(REPO, 'scripts', 'astra', 'templates');
  const template = await readFile(join(templates, `${job.workflow}.md`), 'utf8');
  const brief = fill(template, { ...values, common: fill(await readFile(join(templates, 'common.md'), 'utf8'), values) });
  const base = join(astra, 'runs', job.id);
  await mkdir(join(astra, 'runs'), { recursive: true });
  await writeFile(`${base}-brief.md`, brief);
  const protocol = mode === 'w1' ? 'w1-profile.md' : 'w5-strategy.md';
  const runId = await beginRun({ parentRunId: null, workflow: mode === 'w1' ? 'W1' : 'W5', operation: job.workflow === 'w1w5' ? 'astra profile+strategy' : job.workflow === 'w5t' ? 'astra shorten strategies' : `astra ${mode}`,
    protocol: { version: null, hash: sha(template + await readFile(join(REPO, 'docs', 'workflows', protocol), 'utf8')) },
    source: 'chatgpt', agent: 'astra-runner', model: MODELS[0], launchFolder: REPO, workerFolder: slot.folder,
    batch: { id: batch, manifest: `enrich/batches/${basename(file)}`, hash: sha(text), planned: keys.length } });
  await reportJob(job.id, 'running', { batch, slot: slot.name, model: MODELS[0], counts: { selected: keys.length } });
  const started = Date.now();
  const result = await codex(slot, brief, base, enrich);
  if (result.capacity) capacityUntil = Date.now() + CAPACITY_WAIT_MS;
  const raw = mode === 'w1' ? await writtenSince(join(enrich, 'raw'), keys, started) : [];
  const strategies = job.workflow === 'w1' ? [] : await writtenSince(join(enrich, 'strategy'), await withAliases(enrich, keys), started, true);
  const pushed = (raw.length ? await push('W1', runId, raw) : 0) + (strategies.length ? await push('W5', runId, strategies) : 0);
  const written = raw.length + strategies.length;
  const why = slot.cancelled ? 'Stopped from the page.' : result.capacity ? 'Both models were at capacity.' : !result.finished ? 'The worker ended without a final message.' : null;
  const outcome = slot.cancelled ? 'cancelled' : !written ? 'failed' : pushed < written || !result.finished ? 'partial' : 'succeeded';
  // A batch that wrote nothing gives its LPs back to the next cut.
  if (!written) await rename(file, `${file}.unrun`).catch(() => undefined);
  try {
    await finishWithUsage(runId, { counts: { selected: keys.length, written, valid: pushed, failed: written - pushed, skipped: null },
      checks: [{ name: 'cloud-push', status: written ? (pushed === written ? 'pass' : 'fail') : 'not-run' }], outcome, reason: why });
  } catch (e) { log(`ledger finish failed for ${runId}: ${e instanceof Error ? e.message : e}`); }
  await reportJob(job.id, outcome === 'failed' || outcome === 'cancelled' ? 'failed' : 'done', { model: result.model,
    counts: { selected: keys.length, written, valid: pushed, pushed, strategies: strategies.length }, message: why ?? undefined });
  log(`run ${job.id.slice(0, 8)} ${outcome}: ${keys.length} LPs, ${written} files, ${pushed} pushed`);
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' };
const git = async (...args: string[]) => (await run('git', args, { cwd: REPO, env: GIT_ENV, timeout: 120_000 })).stdout.trim();
const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 200);
let lastUpdate = 0, heldBack = '', startCommit = '';
const startedAt = new Date().toISOString();

/**
 * Bring origin/master up to date. HTTPS first for a GitHub remote: under launchd the SSH agent (1Password) can refuse
 * to sign, and git's own credential helper (gh) serves HTTPS without a prompt. SSH, in batch mode, is the fallback.
 */
async function fetchMaster(): Promise<string> {
  const origin = await git('remote', 'get-url', 'origin');
  const https = origin.replace(/^git@github\.com:/, 'https://github.com/').replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
  if (https.startsWith('https://')) {
    try { await git('fetch', '--quiet', https, '+refs/heads/master:refs/remotes/origin/master'); return 'https'; } catch { /* try the remote as configured */ }
  }
  await git('fetch', '--quiet', 'origin', '+refs/heads/master:refs/remotes/origin/master');
  return 'origin';
}

/** The checkout's state, for the page's Check command. Counts and commits only. */
async function diagnose(pool: Slot[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { startCommit: startCommit.slice(0, 12), startedAt, supervised: SUPERVISED, node: process.version,
    busy: pool.filter((x) => x.job).length, slots: pool.length };
  try {
    out.fetch = await fetchMaster();
  } catch (e) { out.fetch = `failed: ${firstLine(e)}`; }
  try {
    out.branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
    out.head = (await git('rev-parse', 'HEAD')).slice(0, 12);
    out.master = (await git('rev-parse', 'origin/master')).slice(0, 12);
    out.behind = Number(await git('rev-list', '--count', 'HEAD..origin/master'));
    out.ahead = Number(await git('rev-list', '--count', 'origin/master..HEAD'));
    out.changedFiles = (await git('status', '--porcelain', '--untracked-files=no')).split('\n').filter(Boolean).length;
  } catch (e) { out.git = `failed: ${firstLine(e)}`; }
  return out;
}

/**
 * Fast-forward the live checkout to origin/master. `deps` runs npm ci when the dependencies changed (the page's Update);
 * otherwise such an update is held back. Answers whether the checkout now differs from the code this runner started on.
 */
async function advance(deps: boolean): Promise<{ restart: boolean; message: string }> {
  if (await git('rev-parse', '--abbrev-ref', 'HEAD') !== 'master') return { restart: false, message: 'The live checkout is not on master; not updated.' };
  if (await git('status', '--porcelain', '--untracked-files=no')) return { restart: false, message: 'The live checkout has local changes; not updated.' };
  const via = await fetchMaster();
  const [head, next] = [await git('rev-parse', 'HEAD'), await git('rev-parse', 'origin/master')];
  if (head !== next) {
    try { await git('merge-base', '--is-ancestor', head, next); } catch { return { restart: false, message: 'master is not a fast-forward of the checkout; not updated.' }; }
    const depsChanged = /^package(-lock)?\.json$/m.test(await git('diff', '--name-only', head, next));
    if (depsChanged && !deps) {
      if (heldBack !== next) log(`Not updating to ${next.slice(0, 7)}: its dependencies changed. Use Update on Developer → Astra.`);
      heldBack = next;
      return { restart: false, message: 'Held back: the dependencies changed.' };
    }
    await git('merge', '--ff-only', '--quiet', next);
    if (depsChanged) await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: REPO, timeout: 900_000 });
    log(`Updated the live checkout ${head.slice(0, 7)} → ${next.slice(0, 7)} over ${via}${depsChanged ? ', with npm ci' : ''}.`);
  }
  const now = await git('rev-parse', 'HEAD');
  return { restart: now !== startCommit, message: now === startCommit ? `Already on ${now.slice(0, 7)}.` : `On ${now.slice(0, 7)}; restarting on it.` };
}

/** Idle and supervised: update every ten minutes, and restart whenever the checkout moved past the code this runner started on. */
async function selfUpdate(): Promise<boolean> {
  if (!SUPERVISED || Date.now() - lastUpdate < UPDATE_MS) return false;
  lastUpdate = Date.now();
  try { return (await advance(false)).restart; }
  catch (e) { log(`update check skipped: ${firstLine(e)}`); return false; }
}

type Command = { id: string; op: 'restart' | 'update' | 'diagnose' };
const COMMANDS = ['restart', 'update', 'diagnose'] as const;
const pendingCommands: Command[] = [];
const reportCommand = (id: string, status: 'done' | 'failed', result: Record<string, unknown>, message: string) =>
  call({ op: 'command-report', id, status, result, message }).catch((e) => log(`command report failed: ${firstLine(e)}`));

/** Run what the page asked. Check runs at once; Restart and Update wait until no run is working, and nothing new starts meanwhile. */
async function runCommands(pool: Slot[]): Promise<void> {
  while (pendingCommands.length) {
    const c = pendingCommands[0]!;
    if (c.op !== 'diagnose' && pool.some((x) => x.job)) return;
    pendingCommands.shift();
    log(`command ${c.op} from the page`);
    if (c.op === 'diagnose') { await reportCommand(c.id, 'done', await diagnose(pool), 'Checked.'); continue; }
    const tail = SUPERVISED ? '' : ' Started by hand: it will not come back by itself.';
    if (c.op === 'restart') { await reportCommand(c.id, 'done', { startCommit: startCommit.slice(0, 12) }, `Restarting.${tail}`); process.exit(0); }
    try {
      const r = await advance(true);
      await reportCommand(c.id, 'done', await diagnose(pool), `${r.message}${r.restart ? tail : ''}`);
      if (r.restart) process.exit(0);
    } catch (e) {
      await reportCommand(c.id, 'failed', {}, `Update failed: ${firstLine(e)}`);
    }
  }
}

async function main() {
  const root = await realRoot();
  const astra = join(root, 'workflows', 'astra');
  await mkdir(astra, { recursive: true });
  const pool = await slots(astra);
  startCommit = await git('rev-parse', 'HEAD').catch(() => '');
  SUPERVISED ||= await underAstraApp();
  let window: [number, number] = [22, 7];
  log(`Astra runner up on ${startCommit.slice(0, 7) || 'unknown code'}${SUPERVISED ? '' : ' (started by hand: no self-update)'}: ${pool.length} slots (${pool.map((s) => s.name).join(', ')}), polling every minute.`);
  for (;;) {
    const { night, inWindow } = nightOf(new Date(), window[0], window[1]);
    const idle = pool.filter((s) => !s.job);
    const waiting = capacityUntil > Date.now();
    // A Restart or Update waiting for the running batches: start nothing new meanwhile.
    const holding = pendingCommands.some((c) => c.op !== 'diagnose');
    try {
      const answer = await call({ op: 'poll', host: hostname().slice(0, 60), workflows: WORKFLOWS, features: FEATURES, commands: COMMANDS, commit: startCommit.slice(0, 12), startedAt,
        inWindow, night, free: waiting || holding ? 0 : idle.length,
        held: pool.flatMap((s) => (s.job ? [s.job.id] : [])), slots: pool.map((s) => ({ slot: s.name, job: s.job?.id ?? null })),
        capacityUntil: waiting ? new Date(capacityUntil).toISOString() : null, note: holding ? 'Waiting for running batches to finish before a restart.' : null });
      window = answer.window ?? window;
      for (const c of (answer.commands ?? []) as Command[]) if (COMMANDS.includes(c.op) && !pendingCommands.some((x) => x.id === c.id)) pendingCommands.push(c);
      for (const id of answer.cancel ?? []) {
        const slot = pool.find((s) => s.job?.id === id);
        if (slot) { slot.cancelled = true; slot.child?.kill('SIGTERM'); }
      }
      for (const job of (answer.jobs ?? []) as Job[]) {
        const slot = pool.find((s) => !s.job);
        if (!slot) break;
        slot.job = job; slot.cancelled = false;
        work(slot, job, root)
          .catch((e) => { log(`run ${job.id.slice(0, 8)} failed: ${e instanceof Error ? e.message : e}`); return reportJob(job.id, 'failed', { message: 'The runner hit an error; see its log on the Mac.' }); })
          .finally(() => { slot.job = null; slot.child = null; });
      }
    } catch (e) {
      log(`poll failed: ${e instanceof Error ? e.message : e}`);
    }
    await runCommands(pool);
    if (pool.every((s) => !s.job) && await selfUpdate()) process.exit(0);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'The Astra runner stopped.');
  process.exitCode = 1;
});

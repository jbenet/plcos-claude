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
import { batchPrefix, CAPACITY_WAIT_MS, CODEX, codexArgs, fill, MODELS, nightOf, RUN_LIMIT_MS, shouldFallBack } from '../lib/astra/runner';

const run = promisify(execFile);
const REPO = process.cwd();
const SLOTS = Math.max(1, Math.min(6, Number(process.env.ASTRA_SLOTS ?? 4)));
const POLL_MS = 60_000;
type Job = { id: string; workflow: 'w1w5' | 'w1' | 'w5'; size: number };
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

async function writtenSince(dir: string, keys: string[], since: number): Promise<string[]> {
  const out: string[] = [];
  for (const k of keys) {
    const f = join(dir, `${k}.json`);
    try { if ((await stat(f)).mtimeMs >= since) out.push(f); } catch { /* not written */ }
  }
  return out;
}

/** Push each file on its own, so one that fails the importer's checks costs only itself. */
async function push(workflow: 'W1' | 'W5', runId: string, files: string[]): Promise<number> {
  let ok = 0;
  for (const f of files) {
    try { await run('bash', ['scripts/cloud-push.sh', '--workflow', workflow, '--run', runId, f], { cwd: REPO, timeout: 180_000 }); ok++; }
    catch { log(`push refused for one ${workflow} file of run ${runId}`); }
  }
  return ok;
}

async function codex(slot: Slot, brief: string, base: string, enrich: string): Promise<{ model: string; finished: boolean; capacity: boolean }> {
  const last = `${base}-last.md`;
  for (const model of MODELS) {
    await writeFile(last, '');
    const out = createWriteStream(`${base}-${model}.log`);
    const child = spawn(process.env.ASTRA_CODEX ?? CODEX, codexArgs({ model, worker: slot.folder, enrich, last, git: slot.git }), { stdio: ['pipe', 'pipe', 'pipe'] });
    slot.child = child;
    child.stdout!.pipe(out); child.stderr!.pipe(out);
    child.stdin!.on('error', () => undefined); // a worker that exits before reading its brief
    child.stdin!.end(brief);
    const timer = setTimeout(() => child.kill('SIGTERM'), RUN_LIMIT_MS);
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
  const mode = job.workflow === 'w5' ? 'w5' : 'w1';
  const prefix = batchPrefix(job.id);
  const cut = cutting.then(() => run('npx', ['tsx', 'scripts/enrich-batch.ts', mode, prefix, String(job.size), '--max', '1'], { cwd: REPO, env, timeout: 600_000 }));
  cutting = cut.catch(() => undefined);
  try { await cut; } catch { return reportJob(job.id, 'failed', { message: 'The batch cutter failed; see the runner log on the Mac.' }); }
  const batch = `${prefix}01`, file = join(batches, `${batch}.${mode === 'w1' ? 'jsonl' : 'txt'}`);
  if (!existsSync(file)) return reportJob(job.id, 'done', { counts: { selected: 0 }, message: 'Nobody is left for this workflow.' });
  const text = await readFile(file, 'utf8');
  const keys = mode === 'w1' ? lines(text).map((l) => JSON.parse(l).key as string) : lines(text);
  if (job.workflow === 'w1w5') await writeFile(join(batches, `${batch}.txt`), keys.join('\n') + '\n');
  const skip = new Set(keys);
  const values: Record<string, string> = { worker: slot.folder, repo: REPO, data: root, count: String(keys.length), batch,
    rawExamples: job.workflow === 'w5' ? '' : await examples(join(enrich, 'raw'), skip, 3),
    strategyExamples: job.workflow === 'w1' ? '' : await examples(join(enrich, 'strategy'), skip, 2) };
  const templates = join(REPO, 'scripts', 'astra', 'templates');
  const template = await readFile(join(templates, `${job.workflow}.md`), 'utf8');
  const brief = fill(template, { ...values, common: fill(await readFile(join(templates, 'common.md'), 'utf8'), values) });
  const base = join(astra, 'runs', job.id);
  await mkdir(join(astra, 'runs'), { recursive: true });
  await writeFile(`${base}-brief.md`, brief);
  const protocol = mode === 'w1' ? 'w1-profile.md' : 'w5-strategy.md';
  const runId = await beginRun({ parentRunId: null, workflow: mode === 'w1' ? 'W1' : 'W5', operation: job.workflow === 'w1w5' ? 'astra profile+strategy' : `astra ${mode}`,
    protocol: { version: null, hash: sha(template + await readFile(join(REPO, 'docs', 'workflows', protocol), 'utf8')) },
    source: 'chatgpt', agent: 'astra-runner', model: MODELS[0], launchFolder: REPO, workerFolder: slot.folder,
    batch: { id: batch, manifest: `enrich/batches/${basename(file)}`, hash: sha(text), planned: keys.length } });
  await reportJob(job.id, 'running', { batch, slot: slot.name, model: MODELS[0], counts: { selected: keys.length } });
  const started = Date.now();
  const result = await codex(slot, brief, base, enrich);
  if (result.capacity) capacityUntil = Date.now() + CAPACITY_WAIT_MS;
  const raw = mode === 'w1' ? await writtenSince(join(enrich, 'raw'), keys, started) : [];
  const strategies = job.workflow === 'w1' ? [] : await writtenSince(join(enrich, 'strategy'), keys, started);
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

async function main() {
  const root = await realRoot();
  const astra = join(root, 'workflows', 'astra');
  await mkdir(astra, { recursive: true });
  const pool = await slots(astra);
  let window: [number, number] = [22, 7];
  log(`Astra runner up: ${pool.length} slots (${pool.map((s) => s.name).join(', ')}), polling every minute.`);
  for (;;) {
    const { night, inWindow } = nightOf(new Date(), window[0], window[1]);
    const idle = pool.filter((s) => !s.job);
    const waiting = capacityUntil > Date.now();
    try {
      const answer = await call({ op: 'poll', host: hostname().slice(0, 60), inWindow, night, free: waiting ? 0 : idle.length,
        held: pool.flatMap((s) => (s.job ? [s.job.id] : [])), slots: pool.map((s) => ({ slot: s.name, job: s.job?.id ?? null })),
        capacityUntil: waiting ? new Date(capacityUntil).toISOString() : null, note: null });
      window = answer.window ?? window;
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
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'The Astra runner stopped.');
  process.exitCode = 1;
});

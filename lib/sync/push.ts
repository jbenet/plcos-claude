import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { getDb, type Db } from '@/lib/db';
import { factReviewProblems } from '@/lib/enrich/fact-review';
import { mutationProfileAllowed } from '@/lib/mutation-policy';
import { beginRun, finishRun } from '@/lib/workflows/ledger';
import { auditSync, type SyncCaller } from './auth';
import { bundleHash, checkBundle, keyOf, REVIEW, writtenAt, type PushBundle, type Rejection } from './bundle';

/**
 * POST /api/sync/push (docs/deploy/railway.md §7; Juan, 4 Oct 2026, decision F: research runs in the cloud
 * and on the Mac, and the Mac pushes its results up). One finished W1, W1c or W5 output:
 *
 *   1. checked whole — shape, paths, the importer's own validators, no Dakota (./bundle.ts) — and against
 *      what the server holds: an older finding or strategy never replaces a newer one, a review grades the
 *      server's finding, a review file name is not reused for other rows;
 *   2. idempotent by content hash: the same push again answers the first run and writes nothing;
 *   3. recorded as a workflow-ledger run (operation "push", its Mac run as parent when given);
 *   4. kept as received under enrich/inbox/<run>/, with any file it replaces under replaced/;
 *   5. published into enrich/raw, enrich/strategy or enrich/ as the workflow would have written it;
 *   6. followed by the normal findings import, queued as the token's owner.
 * A refused push writes nothing and answers every reason, by file. Only an accepted push touches disk.
 */

const g = globalThis as typeof globalThis & { __syncPushBusy?: boolean };
const PROTOCOLS: Record<PushBundle['workflow'], string> = { W1: 'w1-profile', W1c: 'w1c-fact-check', W5: 'w5-strategy' };
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QueueImport = (db: Db, actor: string) => Promise<{ id: string; status: string }>;
export interface PushOptions { root?: string; db?: Db; queue?: QueueImport }
export interface PushAnswer { status: number; body: Record<string, unknown> }

export function pushRefusal(): string | null {
  if (config.data.copyTakenAt) return 'This server serves a copy of the data; push to the live server.';
  if (!mutationProfileAllowed(config.data.profile, config.data.copyTakenAt, isLiveServer() ? 'live' : 'dev')) return 'Only the live server takes pushes of real research.';
  return null;
}

const text = (path: string, content: unknown) => REVIEW.test(path) ? (content as unknown[]).map((r) => JSON.stringify(r)).join('\n') + '\n' : JSON.stringify(content, null, 2);
async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; return null; }
}

/** What the server holds that the push would contradict. */
async function serverProblems(bundle: PushBundle, enrich: string): Promise<Rejection[]> {
  const out: Rejection[] = [];
  for (const f of bundle.files) {
    const target = join(enrich, f.path);
    if (REVIEW.test(f.path)) {
      const existing = await readFile(target, 'utf8').catch(() => null);
      if (existing !== null && existing !== text(f.path, f.content)) out.push({ path: f.path, problems: ['a review file of this name is on the server with other rows; name this round\'s file anew'] });
      const problems: string[] = [];
      for (const [r, row] of (f.content as Array<{ key: string }>).entries()) {
        const original = await readJson(join(enrich, 'raw', `${row.key}.json`));
        if (original === undefined) { problems.push(`row ${r}: the server has no finding ${row.key} to review; push its W1 first`); continue; }
        problems.push(...factReviewProblems(row, original as { facts?: unknown[] }).map((p) => `row ${r}: ${p} (against the server's finding)`));
      }
      if (problems.length) out.push({ path: f.path, problems });
      continue;
    }
    const existing = await readJson(target);
    if (existing === undefined) continue;
    if (existing === null) { out.push({ path: f.path, problems: ['the server\'s copy does not parse; an Admin looks at it first'] }); continue; }
    if (JSON.stringify(existing) === JSON.stringify(f.content)) continue;
    const theirs = writtenAt(existing), ours = writtenAt(f.content);
    if (theirs !== null && (ours === null || ours < theirs)) out.push({ path: f.path, problems: [`older than the server's copy (${new Date(ours ?? 0).toISOString().slice(0, 10)} against ${new Date(theirs).toISOString().slice(0, 10)}); nothing replaced`] });
    else if (theirs !== null && ours === theirs) out.push({ path: f.path, problems: ['differs from the server\'s copy but carries the same date; correct it with a dated entry (researched.corrected or made.revised)'] });
  }
  return out;
}

async function protocolHash(workflow: PushBundle['workflow'], given?: string): Promise<string> {
  if (given && /^[0-9a-f]{64}$/i.test(given)) return given.toLowerCase();
  return sha(await readFile(join(process.cwd(), 'docs/workflows', `${PROTOCOLS[workflow]}.md`), 'utf8').catch(() => `protocol ${workflow}`));
}

/** Write a file by temporary name and rename, inside enrich only; refuses to follow a link out of it. */
async function place(enrich: string, path: string, data: string, tag: string): Promise<void> {
  const target = join(enrich, path);
  await mkdir(dirname(target), { recursive: true });
  if (!(await realpath(dirname(target)) + sep).startsWith(enrich + sep)) throw new Error('A path escapes enrich.');
  const temporary = `${target}.${tag}.tmp`;
  await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
}

export async function acceptPush(caller: SyncCaller, request: Request, o: PushOptions = {}): Promise<PushAnswer> {
  const started = Date.now();
  const answer = async (status: number, outcome: Parameters<typeof auditSync>[2], body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'push', outcome, { ms: Date.now() - started, ...detail });
    return { status, body: { ok: status < 300, ...body } };
  };
  const refusal = pushRefusal();
  if (refusal) return answer(403, 'refused', { error: refusal }, { reason: 'profile' });
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > config.sync.maxPushBytes) return answer(413, 'rejected', { error: `The push is larger than ${config.sync.maxPushBytes} bytes; push the batch in parts.` }, { reason: 'size', bytes: declared });
  if (g.__syncPushBusy) return answer(409, 'busy', { error: 'Another push is being taken. Try again in a moment.' });
  g.__syncPushBusy = true;
  try {
    const raw = await request.text();
    const bytes = Buffer.byteLength(raw, 'utf8');
    if (bytes > config.sync.maxPushBytes) return answer(413, 'rejected', { error: `The push is larger than ${config.sync.maxPushBytes} bytes; push the batch in parts.` }, { reason: 'size', bytes });
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return answer(400, 'rejected', { error: 'The push is not JSON.', rejected: [{ path: null, problems: ['not JSON'] }] }, { reason: 'json', bytes }); }
    const { bundle, rejections } = checkBundle(input, config.sync.maxPushFiles);
    const workflow = (input as { workflow?: unknown })?.workflow;
    const shape = { workflow: typeof workflow === 'string' ? workflow.slice(0, 8) : null, files: Array.isArray((input as { files?: unknown })?.files) ? (input as { files: unknown[] }).files.length : 0, bytes };
    const dakota = rejections.filter((r) => r.problems.some((p) => p.includes('Dakota'))).length;
    if (!bundle) return answer(422, 'rejected', { error: 'Refused; nothing was written.', rejected: rejections }, { ...shape, reason: 'invalid', rejectedFiles: rejections.length, dakota });

    const hash = bundleHash(bundle);
    const db = o.db ?? await getDb();
    const seen = await db.one<{ run_id: string; job_id: string | null; created_at: Date }>('select run_id::text, job_id::text, created_at from platform.sync_push where content_hash = $1', [hash]);
    if (seen) return answer(200, 'duplicate', { duplicate: true, runId: seen.run_id, contentHash: hash, import: seen.job_id ? { jobId: seen.job_id } : null,
      message: `Already taken on ${new Date(seen.created_at).toISOString()}; nothing was written again.` }, { ...shape, hash, runId: seen.run_id });

    const root = resolve(o.root ?? resolve(process.cwd(), config.data.root));
    const enrich = join(await realpath(root), 'enrich');
    await mkdir(enrich, { recursive: true });
    const enrichReal = await realpath(enrich);
    const contradictions = await serverProblems(bundle, enrichReal);
    if (contradictions.length) return answer(422, 'rejected', { error: 'Refused; nothing was written.', rejected: contradictions }, { ...shape, hash, reason: 'server', rejectedFiles: contradictions.length });

    const ledger = { root };
    let runId: string;
    try {
      runId = await beginRun({
      parentRunId: bundle.run?.id && UUID.test(bundle.run.id) ? bundle.run.id : null, workflow: bundle.workflow, operation: 'push',
      protocol: { version: typeof bundle.run?.protocol?.version === 'string' ? bundle.run.protocol.version.slice(0, 16) : null, hash: await protocolHash(bundle.workflow, bundle.run?.protocol?.hash) },
      // Always 'script' here: an agent source would make the ledger record the Mac's activity, which it reads from
      // the Mac's own layout. Who made the files rides in the agent field, and their run is the parent.
      source: 'script',
      agent: `cloud-push from ${(['claude-code', 'chatgpt', 'script'] as const).find((s) => s === bundle.run?.source) ?? 'unknown'}${typeof bundle.run?.agent === 'string' && bundle.run.agent.trim() ? ` (${bundle.run.agent.trim().slice(0, 60)})` : ''}`,
      model: typeof bundle.run?.model === 'string' && bundle.run.model.trim() ? bundle.run.model.trim().slice(0, 80) : null,
      launchFolder: `pushed by token ${caller.token.prefix}`, workerFolder: process.cwd(),
      batch: { id: `push-${hash.slice(0, 12)}`, manifest: `enrich/inbox/<run>/receipt.json`, hash, planned: bundle.files.length },
      }, ledger);
    } catch (e) {
      console.error('[sync] push could not record its run:', e instanceof Error ? e.message.slice(0, 200) : 'error');
      return answer(503, 'error', { error: 'The workflow ledger could not record this push (it may need an Admin\'s review); nothing was written.' }, { ...shape, hash, reason: 'ledger' });
    }
    let written = 0, replaced = 0, job: { id: string; status: string } | null = null, importNote: string | null = null;
    const finish = (ok: boolean, reason: string | null) => finishRun(runId, {
      counts: { selected: bundle.files.length, written, valid: ok ? written : 0, failed: ok ? 0 : bundle.files.length - written, skipped: null },
      checks: [{ name: 'importer validation', status: 'pass' }, { name: 'no Dakota claims', status: 'pass' }, { name: 'not older than the server', status: 'pass' }],
      usage: { input: null, output: null, cacheRead: null, cacheWrite: null, cost: null, source: 'estimated', method: 'unavailable: pushed from another machine; its own run has the usage' },
      outcome: ok ? 'succeeded' : 'failed', reason }, ledger);
    try {
      // 4. As received, first: the inbox is the record of what came, whatever happens next.
      const inbox = `inbox/${runId}`;
      await place(enrichReal, `${inbox}/receipt.json`, JSON.stringify({ runId, contentHash: hash, workflow: bundle.workflow, files: bundle.files.map((f) => f.path),
        token: caller.token.prefix, by: caller.user.handle, at: new Date().toISOString(), parentRunId: bundle.run?.id ?? null }, null, 2), runId);
      for (const f of bundle.files) await place(enrichReal, `${inbox}/${f.path}`, text(f.path, f.content), runId);
      // 5. Published where the workflow writes, keeping what it replaces.
      for (const f of bundle.files) {
        const target = join(enrichReal, f.path);
        const before = await readFile(target, 'utf8').catch(() => null);
        if (before !== null && before !== text(f.path, f.content)) {
          await mkdir(dirname(join(enrichReal, inbox, 'replaced', f.path)), { recursive: true });
          await copyFile(target, join(enrichReal, inbox, 'replaced', f.path));
          replaced++;
        }
        await place(enrichReal, f.path, text(f.path, f.content), runId);
        written++;
      }
      await db.query(`insert into platform.sync_push (content_hash, run_id, token_id, user_id, workflow, files) values ($1, $2, $3, $4, $5, $6)`,
        [hash, runId, caller.token.tokenId, caller.user.id, bundle.workflow, bundle.files.length]);
      // 6. The normal findings import (raw and strategy files); a review file is read by the quality page.
      const imports = bundle.files.some((f) => keyOf(f.path) !== null);
      if (imports) {
        try {
          job = await (o.queue ?? (async (d, actor) => (await import('@/lib/import-jobs/server')).queueImportJob(d, 'findings', actor)))(db, caller.user.id);
          await db.query('update platform.sync_push set job_id = $2 where content_hash = $1', [hash, job.id]);
          if (job.status === 'running') importNote = 'A findings import was already running and may not include these files; run Import findings again when it finishes.';
        } catch (e) {
          importNote = `The files are in place but the import was not queued (${e instanceof Error ? e.message.slice(0, 120) : 'error'}); run Import findings from Developer → Enrichment.`;
        }
      }
      await finish(true, null);
      return answer(201, 'ok', { runId, contentHash: hash, files: bundle.files.map((f) => f.path), replaced,
        import: job ? { jobId: job.id, status: job.status } : null, ...(importNote ? { note: importNote } : {}) },
      { ...shape, hash, runId, replaced, jobId: job?.id ?? null });
    } catch (e) {
      console.error('[sync] push failed after its run began:', e instanceof Error ? e.message.slice(0, 200) : 'error');
      await finish(false, 'Writing the pushed files failed; see enrich/inbox for what arrived.').catch(() => undefined);
      return answer(500, 'error', { error: 'The push failed on the server after it was checked; nothing was imported. Its run is recorded as failed.', runId }, { ...shape, hash, runId, written });
    }
  } finally {
    g.__syncPushBusy = false;
  }
}

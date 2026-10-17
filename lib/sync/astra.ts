import { getDb, type Db } from '@/lib/db';
import { cappedText } from '@/lib/body-cap';
import { auditSync, type SyncCaller } from './auth';
import type { PushAnswer } from './push';

/**
 * POST /api/sync/astra: the Mac's Astra runner (scripts/astra-runner.ts, docs/30-astra-runner.md) polls and
 * reports with an Admin's token. Juan, 10 Oct 2026: "should not go through claude, should be able to have a UI
 * and trigger astra automatically". Counts only, never a name; the server launches nothing.
 *
 *   POST { op: "poll", host, instance?, workflows?, commands?, commit?, startedAt?, inWindow, night, free, held: [jobId], slots: [{slot, job}],
 *        capacityUntil, note } → 200 { paused, batchSize, window, jobs: [{ id, workflow, size }], cancel: [jobId], commands: [{ id, op }] }
 *   POST { op: "report", id, instance?, status: "running" | "done" | "failed", batch?, slot?, model?, counts?, message? }
 *   POST { op: "queue", workflow, size, count, runNow } → 200 { queued }: what Queue runs does on the page, for the
 *        Astra menu-bar app (desktop/astra), queued as the token's holder.
 *   POST { op: "status" } → 200 { runner, up, jobs, commands }: the page's runner state, recent runs and commands (counts, no names).
 *   POST { op: "command", command: "diagnose" | "restart" | "update" } → 200 { id, existing }: what Check, Restart and Update
 *        do on the page (Juan, 11 Oct 2026: "built some RC type thing for the runner on the Mac so you can help admin it").
 *   POST { op: "command-report", id, status: "done" | "failed", result?, message? }: the runner answers a command it took.
 *   POST { op: "plan", keepBusy?, plan?: [{ workflow, size, focus? }], windowStart?, windowEnd? } → 200 { runner }: what the
 *        page's Night plan form saves (migration 027; Juan, 12 Oct 2026: "would be good to come up with a schedule").
 *   POST { op: "research" } → 200 { pending: true, job } while a fresh research export is built (one older than 12 h is
 *        redone), else { pending: false, exportedAt, files: { name: { text, sha256 } } }: the export the runner cuts its
 *        batches from (lib/astra/research.ts). Names leave the server here, as they do in a snapshot, to the Admin's Mac.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The runner's per-process id (migration 030): a runner from before it sends none, and is told apart by host. */
const INSTANCE = /^[0-9a-z-]{8,64}$/i;
/** null when absent; false when sent but malformed, which is refused rather than read as an older runner. */
const instanceOf = (v: unknown): string | null | false => (v === undefined || v === null ? null : typeof v === 'string' && INSTANCE.test(v) ? v : false);
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function astraCall(caller: SyncCaller, request: Request, o: { db?: Db } = {}): Promise<PushAnswer> {
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'astra', outcome, detail);
    return { status, body: { ok: status < 300, ...body } };
  };
  let input: Record<string, unknown>;
  try { input = JSON.parse(((await cappedText(request, 64 * 1024)) ?? '').slice(0, 8192)); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  const db = o.db ?? await getDb();
  const astra = await import('@/lib/astra/jobs');
  if (input?.op === 'poll') {
    const held = Array.isArray(input.held) ? input.held.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 24) : [];
    const slots = Array.isArray(input.slots) ? input.slots.slice(0, 12).flatMap((s) => {
      const slot = text((s as Record<string, unknown>)?.slot, 40);
      const job = text((s as Record<string, unknown>)?.job, 40);
      return slot ? [{ slot, job: job && UUID.test(job) ? job : null }] : [];
    }) : [];
    const instance = instanceOf(input.instance);
    if (instance === false) return answer(422, 'invalid', { error: 'instance is 8 to 64 letters, digits or dashes.' }, { reason: 'poll' });
    const night = typeof input.night === 'string' && /^\d{4}-\d\d-\d\d$/.test(input.night) ? input.night : null;
    if (!night || typeof input.inWindow !== 'boolean') return answer(422, 'invalid', { error: 'A poll needs night (YYYY-MM-DD) and inWindow.' }, { reason: 'poll' });
    const capacity = typeof input.capacityUntil === 'string' && Number.isFinite(Date.parse(input.capacityUntil)) ? new Date(input.capacityUntil).toISOString() : null;
    const free = Number.isSafeInteger(input.free) ? Math.max(0, input.free as number) : 0;
    const workflows = Array.isArray(input.workflows) ? astra.ASTRA_WORKFLOWS.filter((w) => (input.workflows as unknown[]).includes(w)) : undefined;
    const commands = Array.isArray(input.commands) ? astra.ASTRA_COMMANDS.filter((c) => (input.commands as unknown[]).includes(c)) : undefined;
    const code = typeof input.commit === 'string' && /^[0-9a-f]{7,40}$/.test(input.commit) ? input.commit : null;
    const codeStartedAt = typeof input.startedAt === 'string' && Number.isFinite(Date.parse(input.startedAt)) ? new Date(input.startedAt).toISOString() : null;
    const features = Array.isArray(input.features) ? (['focus'] as const).filter((f) => (input.features as unknown[]).includes(f)) : [];
    let result: Awaited<ReturnType<typeof astra.poll>>;
    try { result = await astra.poll(db, { host: text(input.host, 60) ?? 'mac', instance, workflows, commands, features, code, codeStartedAt, inWindow: input.inWindow, night, free, held, slots,
      capacityUntil: capacity, note: text(input.note, 300) }); }
    catch (e) { if (e instanceof astra.AstraRunnerBusy) return answer(409, 'refused', { error: e.message }, { op: 'poll', reason: 'busy' }); throw e; }
    // Polls come every minute; only those that hand out or cancel work go in the audit log.
    if (result.jobs.length || result.cancel.length || result.commands.length) {
      await auditSync(caller, 'astra', 'ok', { op: 'poll', claimed: result.jobs.length, cancelled: result.cancel.length, commands: result.commands.map((c) => c.op) });
    }
    return { status: 200, body: { ok: true, ...result } };
  }
  if (input?.op === 'report') {
    const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
    const status = ['running', 'done', 'failed'].find((s) => s === input.status) as 'running' | 'done' | 'failed' | undefined;
    const instance = instanceOf(input.instance);
    if (!id || !status || instance === false) return answer(422, 'invalid', { error: 'A report needs a job id and a status of running, done or failed.' }, { reason: 'report' });
    const counts = input.counts && typeof input.counts === 'object' && !Array.isArray(input.counts) ? input.counts as Record<string, unknown> : undefined;
    const ok = await astra.report(db, { id, status, batch: text(input.batch, 80) ?? undefined, slot: text(input.slot, 40) ?? undefined,
      model: text(input.model, 40) ?? undefined, counts, message: text(input.message, 300) ?? undefined, instance });
    if (!ok) return answer(409, 'refused', { error: 'That run is not claimed or running (it may have been cancelled), or another runner claimed it.' }, { op: 'report', reason: 'state' });
    return status === 'running' ? { status: 200, body: { ok: true } } : answer(200, 'ok', {}, { op: 'report', status });
  }
  if (input?.op === 'queue') {
    const workflow = astra.ASTRA_WORKFLOWS.find((w) => w === input.workflow);
    if (!workflow || typeof input.runNow !== 'boolean') return answer(422, 'invalid', { error: 'A queue call needs workflow, size, count and runNow.' }, { op: 'queue', reason: 'shape' });
    try {
      const queued = await astra.enqueue(db, caller.user.id, { workflow, size: Number(input.size), count: Number(input.count), runNow: input.runNow });
      return answer(200, 'ok', { queued }, { op: 'queue', workflow, count: queued, now: input.runNow });
    } catch (e) {
      return answer(422, 'invalid', { error: e instanceof Error ? e.message : 'Not queued.' }, { op: 'queue', reason: 'enqueue' });
    }
  }
  if (input?.op === 'status') {
    const runner = await astra.readRunner(db);
    return { status: 200, body: { ok: true, runner, up: astra.runnerUp(runner), jobs: await astra.recentJobs(db, 20), commands: await astra.recentCommands(db) } };
  }
  if (input?.op === 'command') {
    const op = astra.ASTRA_COMMANDS.find((c) => c === input.command);
    if (!op) return answer(422, 'invalid', { error: 'command must be diagnose, restart or update.' }, { op: 'command', reason: 'shape' });
    const issued = await astra.issueCommand(db, caller.user.id, op);
    return answer(200, 'ok', issued, { op: 'command', command: op, existing: issued.existing });
  }
  if (input?.op === 'command-report') {
    const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
    const status = input.status === 'done' || input.status === 'failed' ? input.status : null;
    if (!id || !status) return answer(422, 'invalid', { error: 'A command report needs an id and a status of done or failed.' }, { op: 'command-report', reason: 'shape' });
    const result = input.result && typeof input.result === 'object' && !Array.isArray(input.result) ? input.result as Record<string, unknown> : undefined;
    const ok = await astra.reportCommand(db, { id, status, result, message: text(input.message, 300) ?? undefined });
    if (!ok) return answer(409, 'refused', { error: 'That command was not sent to the runner, or was already answered.' }, { op: 'command-report', reason: 'state' });
    return answer(200, 'ok', {}, { op: 'command-report', status });
  }
  if (input?.op === 'plan') {
    const hour = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? v as number : undefined);
    if (input.plan !== undefined && !Array.isArray(input.plan)) return answer(422, 'invalid', { error: 'plan is a list of { workflow, size, focus? }.' }, { op: 'plan', reason: 'shape' });
    const plan = input.plan === undefined ? undefined : astra.readPlan(input.plan);
    if (plan && plan.length !== (input.plan as unknown[]).length) return answer(422, 'invalid', { error: 'A step needs a known workflow, 1–20 LPs per run, and at most 8 vehicles.' }, { op: 'plan', reason: 'step' });
    await astra.saveSettings(db, caller.user.id, { keepBusy: typeof input.keepBusy === 'boolean' ? input.keepBusy : undefined, plan,
      windowStart: hour(input.windowStart), windowEnd: hour(input.windowEnd) });
    const runner = await astra.readRunner(db);
    return answer(200, 'ok', { runner }, { op: 'plan', keepBusy: runner.keepBusy, steps: runner.plan.length });
  }
  if (input?.op === 'research') {
    const { researchExport } = await import('@/lib/astra/research');
    const { enrichDir } = await import('@/lib/enrich/candidates');
    try {
      const got = await researchExport(db, caller.user.id, { dir: enrichDir() });
      return got.pending ? answer(200, 'ok', got, { op: 'research', pending: true })
        : answer(200, 'ok', got, { op: 'research', pending: false, files: Object.keys(got.files).length });
    } catch (e) {
      return answer(409, 'refused', { error: e instanceof Error ? e.message.slice(0, 200) : 'No export.' }, { op: 'research', reason: 'export' });
    }
  }
  return answer(422, 'invalid', { error: 'op must be poll, report, queue, status, command, command-report, plan or research.' }, { reason: 'op' });
}

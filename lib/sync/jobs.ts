import { getDb, type Db } from '@/lib/db';
import type { ImportKind } from '@/lib/import-jobs/types';
import { auditSync, type SyncCaller } from './auth';
import { pushRefusal, type PushAnswer } from './push';

/**
 * POST|GET /api/sync/jobs: an Admin's token (sync:admin) queues the jobs Developer → Enrichment's buttons queue,
 * as the token's owner, and reads any job's state (7 Oct 2026: the Mac needed a fresh research export from the
 * cloud to write SPV Science strategies, and nobody to click the button). Only these kinds: a research export,
 * a findings import, and Merge duplicate identities (8 Oct 2026, Juan: the W13 proposals are Claude's to apply, "ideally
 * you do it"; the button is Admin-only, as this token is). Counts only, never a name; the job's own checks and audit
 * are the button's.
 *
 *   POST { "kind": "export" | "findings" | "duplicates" }   → 202 { job: { id, kind, status } }
 *   GET  ?job=<id>                          → 200 { job: { id, kind, status, phase, error, counts, … } }
 */
const KINDS: readonly ImportKind[] = ['export', 'findings', 'duplicates'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function queueJob(caller: SyncCaller, request: Request, o: { db?: Db } = {}): Promise<PushAnswer> {
  const started = Date.now();
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'jobs', outcome, { ms: Date.now() - started, ...detail });
    return { status, body: { ok: status < 300, ...body } };
  };
  const refusal = pushRefusal();
  if (refusal) return answer(403, 'refused', { error: refusal }, { reason: 'profile' });
  let input: { kind?: unknown };
  try { input = JSON.parse((await request.text()).slice(0, 1024)); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  const kind = KINDS.find((k) => k === input?.kind);
  if (!kind) return answer(422, 'invalid', { error: `kind must be ${KINDS.join(' or ')}.` }, { reason: 'kind' });
  const db = o.db ?? await getDb();
  try {
    const server = await import('@/lib/import-jobs/server');
    // Recovery first, so a job a restart stopped does not block this one (lib/sync/push.ts does the same).
    await server.importJobStatus(db).catch(() => undefined);
    const job = await server.queueImportJob(db, kind, caller.user.id);
    if (job.status === 'running' && kind === 'findings') server.importAfterRunning(kind, caller.user.id);
    return answer(202, 'ok', { job: { id: job.id, kind, status: job.status } }, { kind, jobId: job.id });
  } catch (e) {
    return answer(409, 'refused', { error: e instanceof Error ? e.message.slice(0, 200) : 'The job was not queued.' }, { kind, reason: 'queue' });
  }
}

export async function jobState(caller: SyncCaller, request: Request, o: { db?: Db } = {}): Promise<PushAnswer> {
  const id = new URL(request.url).searchParams.get('job') ?? '';
  if (!UUID.test(id)) return { status: 400, body: { ok: false, error: 'Give a job id as ?job=<id>.' } };
  const db = o.db ?? await getDb();
  if (!o.db) await (await import('@/lib/import-jobs/server')).importJobStatus(db).catch(() => undefined);
  const row = await db.one<{ id: string; kind: string; status: string; phase: string; result: Record<string, unknown> | null; error: string | null; created_at: Date; finished_at: Date | null }>(
    'select id::text, kind::text, status, phase, result, error, created_at, finished_at from platform.import_job where id = $1', [id]);
  await auditSync(caller, 'jobs', row ? 'ok' : 'invalid', { op: 'status', jobId: id, reason: row ? undefined : 'unknown-job' });
  if (!row) return { status: 404, body: { ok: false, error: 'No job has that id.' } };
  const counts = Object.fromEntries(Object.entries(row.result ?? {}).filter(([, v]) => typeof v === 'number'));
  // Merge duplicate identities also says which proposals applied and why any were refused (ids, line numbers, reasons).
  const decisions = row.result && typeof row.result.decisions === 'object' ? row.result.decisions : undefined;
  return { status: 200, body: { ok: true, job: { id: row.id, kind: row.kind, status: row.status, phase: row.phase, error: row.error,
    createdAt: new Date(row.created_at).toISOString(), finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null, counts, ...(decisions ? { decisions } : {}) } } };
}

import { getDb, type Db } from '@/lib/db';
import { auditSync, type SyncCaller } from './auth';
import type { PushAnswer } from './push';

/**
 * POST /api/sync/astra: the Mac's Astra runner (scripts/astra-runner.ts, docs/30-astra-runner.md) polls and
 * reports with an Admin's token. Juan, 10 Oct 2026: "should not go through claude, should be able to have a UI
 * and trigger astra automatically". Counts only, never a name; the server launches nothing.
 *
 *   POST { op: "poll", host, inWindow, night, free, held: [jobId], slots: [{slot, job}], capacityUntil, note }
 *        → 200 { paused, batchSize, window, jobs: [{ id, workflow, size }], cancel: [jobId] }
 *   POST { op: "report", id, status: "running" | "done" | "failed", batch?, slot?, model?, counts?, message? }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function astraCall(caller: SyncCaller, request: Request, o: { db?: Db } = {}): Promise<PushAnswer> {
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'astra', outcome, detail);
    return { status, body: { ok: status < 300, ...body } };
  };
  let input: Record<string, unknown>;
  try { input = JSON.parse((await request.text()).slice(0, 8192)); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  const db = o.db ?? await getDb();
  const astra = await import('@/lib/astra/jobs');
  if (input?.op === 'poll') {
    const held = Array.isArray(input.held) ? input.held.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 24) : [];
    const slots = Array.isArray(input.slots) ? input.slots.slice(0, 12).flatMap((s) => {
      const slot = text((s as Record<string, unknown>)?.slot, 40);
      const job = text((s as Record<string, unknown>)?.job, 40);
      return slot ? [{ slot, job: job && UUID.test(job) ? job : null }] : [];
    }) : [];
    const night = typeof input.night === 'string' && /^\d{4}-\d\d-\d\d$/.test(input.night) ? input.night : null;
    if (!night || typeof input.inWindow !== 'boolean') return answer(422, 'invalid', { error: 'A poll needs night (YYYY-MM-DD) and inWindow.' }, { reason: 'poll' });
    const capacity = typeof input.capacityUntil === 'string' && Number.isFinite(Date.parse(input.capacityUntil)) ? new Date(input.capacityUntil).toISOString() : null;
    const free = Number.isSafeInteger(input.free) ? Math.max(0, input.free as number) : 0;
    const result = await astra.poll(db, { host: text(input.host, 60) ?? 'mac', inWindow: input.inWindow, night, free, held, slots,
      capacityUntil: capacity, note: text(input.note, 300) });
    // Polls come every minute; only those that hand out or cancel work go in the audit log.
    if (result.jobs.length || result.cancel.length) await auditSync(caller, 'astra', 'ok', { op: 'poll', claimed: result.jobs.length, cancelled: result.cancel.length });
    return { status: 200, body: { ok: true, ...result } };
  }
  if (input?.op === 'report') {
    const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
    const status = ['running', 'done', 'failed'].find((s) => s === input.status) as 'running' | 'done' | 'failed' | undefined;
    if (!id || !status) return answer(422, 'invalid', { error: 'A report needs a job id and a status of running, done or failed.' }, { reason: 'report' });
    const counts = input.counts && typeof input.counts === 'object' && !Array.isArray(input.counts) ? input.counts as Record<string, unknown> : undefined;
    const ok = await astra.report(db, { id, status, batch: text(input.batch, 80) ?? undefined, slot: text(input.slot, 40) ?? undefined,
      model: text(input.model, 40) ?? undefined, counts, message: text(input.message, 300) ?? undefined });
    if (!ok) return answer(409, 'refused', { error: 'That run is not claimed or running (it may have been cancelled).' }, { op: 'report', reason: 'state' });
    return status === 'running' ? { status: 200, body: { ok: true } } : answer(200, 'ok', {}, { op: 'report', status });
  }
  return answer(422, 'invalid', { error: 'op must be poll or report.' }, { reason: 'op' });
}

import { resolve } from 'node:path';
import { config } from '@/config/deployment';
import { beginRun, finishRun, readRuns, validateLine, type Begin, type Finish, type RunLine } from '@/lib/workflows/ledger';
import { auditSync, type SyncCaller } from './auth';
import { pushRefusal, type PushAnswer } from './push';

/**
 * POST /api/sync/runs: the workflow ledger in the cloud (docs/28-cloud-workflows.md §5; handoff of 5 Oct 2026).
 * Since the move, the Mac's database and its plcos-data/real/workflows/runs.jsonl are frozen, so a run made
 * on the Mac (a Claude sub-agent, ChatGPT, a script) is recorded here instead, by the same writer
 * (lib/workflows/ledger.ts) and so under the same rules: a line under 4 KB, validated before it is written,
 * pinned protocol and batch hashes, a finish only after an unambiguous start, a second identical finish
 * harmless and a different one refused.
 *
 *   { "event": "begin",  "run": <ledger begin metadata> }            → { runId }
 *   { "event": "finish", "runId": "<uuid>", "result": <finish> }     → { runId, outcome }
 *
 * A sync:push token (a Team member's or an Admin's), the push's guard. Two limits keep it the Mac's ledger
 * and not a way to write the app's: `source` is claude-code, chatgpt or script, never app; and a run is
 * finished only by the person who began it (their handle is written into the run's launchFolder). Every
 * call is one `mcp.call` audit row, with the run id and the hashes, never the metadata.
 */

const MAX_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = ['claude-code', 'chatgpt', 'script'] as const;
const by = (caller: SyncCaller) => ` [by ${caller.user.handle}, cloud ledger]`;

export interface RunsOptions { root?: string }

export async function recordRun(caller: SyncCaller, request: Request, o: RunsOptions = {}): Promise<PushAnswer> {
  const started = Date.now();
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'push', outcome, { op: 'ledger', ms: Date.now() - started, ...detail });
    return { status, body: { ok: status < 300, ...body } };
  };
  const refusal = pushRefusal();
  if (refusal) return answer(403, 'refused', { error: refusal }, { reason: 'profile' });
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return answer(413, 'invalid', { error: `A ledger call is at most ${MAX_BYTES} bytes; a run line is under 4 KB.` }, { reason: 'size' });
  let input: { event?: unknown; run?: unknown; runId?: unknown; result?: unknown };
  try { input = JSON.parse(raw); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  const root = resolve(o.root ?? resolve(process.cwd(), config.data.root));
  const ledger = { root };

  if (input?.event === 'begin') {
    const m = input.run as Partial<Begin> | undefined;
    if (!m || typeof m !== 'object') return answer(422, 'invalid', { error: 'A begin carries the run\'s metadata as "run".' }, { reason: 'shape' });
    if (!(SOURCES as readonly unknown[]).includes(m.source)) return answer(422, 'invalid', { error: `source must be ${SOURCES.join(', ')}; the app records its own runs.` }, { reason: 'source' });
    const metadata: Begin = { parentRunId: m.parentRunId ?? null, workflow: m.workflow ?? null, operation: m.operation!, protocol: m.protocol!, source: m.source!,
      agent: m.agent!, model: m.model ?? null, launchFolder: `${typeof m.launchFolder === 'string' ? m.launchFolder.slice(0, 200) : 'unknown'}${by(caller)}`,
      workerFolder: m.workerFolder!, batch: m.batch! };
    // The writer's own check, on the line it would write, before anything is appended.
    const probe: RunLine = { ...metadata, event: 'started', runId: '00000000-0000-4000-8000-000000000000', startedAt: new Date().toISOString(), endedAt: null,
      counts: { selected: metadata.batch?.planned ?? null, written: null, valid: null, failed: null, skipped: null }, checks: [], usage: null, outcome: 'unknown', reason: null };
    try { validateLine(probe); } catch (e) { return answer(422, 'invalid', { error: e instanceof Error ? e.message : 'Invalid run metadata.' }, { reason: 'metadata' }); }
    try {
      const runId = await beginRun(metadata, ledger);
      return answer(201, 'ok', { runId }, { runId, hash: metadata.batch.hash });
    } catch (e) {
      return answer(503, 'error', { error: `The ledger did not take the run: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}` }, { reason: 'ledger' });
    }
  }

  if (input?.event === 'finish') {
    const runId = typeof input.runId === 'string' && UUID.test(input.runId) ? input.runId : null;
    if (!runId) return answer(422, 'invalid', { error: 'A finish names the runId its begin answered.' }, { reason: 'shape' });
    const run = (await readRuns(ledger)).runs.find((r) => r.runId === runId);
    if (!run?.start) return answer(404, 'invalid', { error: 'No run with that id has begun here.' }, { reason: 'unknown-run', runId });
    if (!run.start.launchFolder.endsWith(by(caller))) return answer(403, 'refused', { error: 'Only the person who began a run finishes it.' }, { reason: 'owner', runId });
    try {
      await finishRun(runId, input.result as Finish, ledger);
      const after = (await readRuns(ledger)).runs.find((r) => r.runId === runId);
      return answer(200, 'ok', { runId, outcome: after?.outcome ?? 'unknown' }, { runId });
    } catch (e) {
      return answer(422, 'invalid', { error: e instanceof Error ? e.message.slice(0, 200) : 'The ledger refused the finish.' }, { reason: 'finish', runId });
    }
  }
  return answer(422, 'invalid', { error: 'event must be begin or finish.' }, { reason: 'shape' });
}

import type { Db, Queryable } from '@/lib/db';

/**
 * Astra runs a person starts and watches from Developer → Astra, and the Mac's runner claims and reports
 * (docs/30-astra-runner.md; Juan, 10 Oct 2026: "should not go through claude, should be able to have a UI and
 * trigger astra automatically"). The server queues and records only; the runner cuts each batch on the Mac,
 * so no name or record content ever reaches these tables, and nothing here launches anything.
 */
export const ASTRA_WORKFLOWS = ['w1w5', 'w1', 'w5'] as const;
export type AstraWorkflow = (typeof ASTRA_WORKFLOWS)[number];
export const WORKFLOW_LABEL: Record<AstraWorkflow, string> = { w1w5: 'Profile, then strategy (W1+W5)', w1: 'Profile (W1)', w5: 'Strategy (W5)' };
export type AstraStatus = 'queued' | 'claimed' | 'running' | 'done' | 'failed' | 'cancelled';
const COUNT_KEYS = ['selected', 'written', 'valid', 'failed', 'pushed', 'strategies'] as const;
/** The runner is up when it has polled within this long (it polls every minute). */
export const RUNNER_STALE_MS = 3 * 60_000;

export interface AstraJob {
  id: string; workflow: AstraWorkflow; size: number; runNow: boolean; source: 'person' | 'auto'; night: string | null;
  status: AstraStatus; batch: string | null; slot: string | null; model: string | null; counts: Record<string, number>;
  message: string | null; createdAt: string; claimedAt: string | null; startedAt: string | null; finishedAt: string | null;
}
export interface AstraRunner {
  paused: boolean; autoOn: boolean; autoWorkflow: AstraWorkflow; autoBatches: number; batchSize: number;
  windowStart: number; windowEnd: number; heartbeatAt: string | null; host: string | null;
  slots: Array<{ slot: string; job: string | null }>; inWindow: boolean | null; capacityUntil: string | null; note: string | null;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const JOB_COLUMNS = `id::text, workflow, size, run_now, source, night::text, status, batch, slot, model, counts, message,
  created_at, claimed_at, started_at, finished_at`;
type JobRow = { id: string; workflow: AstraWorkflow; size: number; run_now: boolean; source: 'person' | 'auto'; night: string | null;
  status: AstraStatus; batch: string | null; slot: string | null; model: string | null; counts: Record<string, number> | null;
  message: string | null; created_at: Date; claimed_at: Date | null; started_at: Date | null; finished_at: Date | null };
const job = (r: JobRow): AstraJob => ({ id: r.id, workflow: r.workflow, size: r.size, runNow: r.run_now, source: r.source, night: r.night,
  status: r.status, batch: r.batch, slot: r.slot, model: r.model, counts: r.counts ?? {}, message: r.message,
  createdAt: iso(r.created_at)!, claimedAt: iso(r.claimed_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at) });

export async function readRunner(db: Queryable): Promise<AstraRunner> {
  const r = await db.one<Record<string, any>>('select * from platform.astra_runner where id = 1');
  if (!r) throw new Error('The Astra runner row is missing; migration 024 did not apply.');
  return { paused: r.paused, autoOn: r.auto_on, autoWorkflow: r.auto_workflow, autoBatches: r.auto_batches, batchSize: r.batch_size,
    windowStart: r.window_start, windowEnd: r.window_end, heartbeatAt: iso(r.heartbeat_at), host: r.host,
    slots: Array.isArray(r.slots) ? r.slots : [], inWindow: r.in_window, capacityUntil: iso(r.capacity_until), note: r.note };
}

export async function recentJobs(db: Queryable, limit = 60): Promise<AstraJob[]> {
  return (await db.query<JobRow>(`select ${JOB_COLUMNS} from platform.astra_job order by created_at desc limit $1`, [limit])).map(job);
}

/** Whether the local hour is inside a night window that may wrap midnight (22 → 7). Equal ends mean all day. */
export function inWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function runnerUp(runner: Pick<AstraRunner, 'heartbeatAt'>, now = Date.now()): boolean {
  return Boolean(runner.heartbeatAt && now - Date.parse(runner.heartbeatAt) < RUNNER_STALE_MS);
}

/** A person queues `count` runs of one workflow. `runNow` skips the night window; nothing else is skipped. */
export async function enqueue(db: Queryable, actor: string, input: { workflow: AstraWorkflow; size: number; count: number; runNow: boolean }): Promise<number> {
  if (!ASTRA_WORKFLOWS.includes(input.workflow)) throw new Error('Pick a workflow.');
  const size = Math.trunc(input.size), count = Math.trunc(input.count);
  if (!(size >= 1 && size <= 20)) throw new Error('A batch holds 1 to 20 LPs.');
  if (!(count >= 1 && count <= 12)) throw new Error('Queue 1 to 12 runs at a time.');
  for (let i = 0; i < count; i++) {
    await db.query(`insert into platform.astra_job(workflow, size, run_now, source, actor) values ($1, $2, $3, 'person', $4)`,
      [input.workflow, size, input.runNow, actor]);
  }
  return count;
}

/** Cancel a queued job outright; a claimed or running one is cancelled here and stopped by the runner on its next poll. */
export async function cancel(db: Queryable, id: string): Promise<boolean> {
  const rows = await db.query(`update platform.astra_job set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp(),
    message = coalesce(message, 'Cancelled from the page.') where id = $1 and status in ('queued','claimed','running') returning id`, [id]);
  return rows.length > 0;
}

export async function cancelQueued(db: Queryable): Promise<number> {
  return (await db.query(`update platform.astra_job set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp(),
    message = 'Cancelled from the page.' where status = 'queued' returning id`)).length;
}

export async function saveSettings(db: Queryable, actor: string, s: Partial<Pick<AstraRunner, 'paused' | 'autoOn' | 'autoWorkflow' | 'autoBatches' | 'batchSize' | 'windowStart' | 'windowEnd'>>): Promise<void> {
  const cols: Record<string, unknown> = { paused: s.paused, auto_on: s.autoOn, auto_workflow: s.autoWorkflow, auto_batches: s.autoBatches,
    batch_size: s.batchSize, window_start: s.windowStart, window_end: s.windowEnd };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (s.autoWorkflow !== undefined && !ASTRA_WORKFLOWS.includes(s.autoWorkflow)) throw new Error('Pick a workflow.');
  const params = set.map(([, v]) => v);
  await db.query(`update platform.astra_runner set ${set.map(([k], i) => `${k} = $${i + 1}`).join(', ')}${set.length ? ', ' : ''}
    updated_by = $${params.length + 1}, updated_at = clock_timestamp() where id = 1`, [...params, actor]);
}

export interface Poll {
  host: string; inWindow: boolean; night: string; free: number; held: string[];
  slots: Array<{ slot: string; job: string | null }>; capacityUntil: string | null; note: string | null;
}
export interface PollAnswer { paused: boolean; batchSize: number; window: [number, number]; jobs: Array<Pick<AstraJob, 'id' | 'workflow' | 'size'>>; cancel: string[] }

/**
 * The runner's poll, every minute: record its heartbeat and slots; on the first poll of a night window with
 * Auto on, queue that night's runs (once: the night and sequence are unique); tell it which held jobs were
 * cancelled; mark any job it no longer holds as lost; and hand it up to `free` queued jobs it may start now.
 */
export async function poll(db: Db, p: Poll): Promise<PollAnswer> {
  return db.transaction(async (tx) => {
    await tx.query(`update platform.astra_runner set heartbeat_at = clock_timestamp(), host = $1, slots = $2::jsonb, in_window = $3,
      capacity_until = $4, note = $5 where id = 1`, [p.host, JSON.stringify(p.slots), p.inWindow, p.capacityUntil, p.note]);
    const r = await readRunner(tx);
    if (r.autoOn && p.inWindow && !r.paused) {
      const owner = await tx.one<{ updated_by: string | null }>('select updated_by::text from platform.astra_runner where id = 1');
      if (owner?.updated_by) {
        for (let seq = 1; seq <= r.autoBatches; seq++) {
          await tx.query(`insert into platform.astra_job(workflow, size, run_now, source, night, seq, actor) values ($1, $2, false, 'auto', $3, $4, $5)
            on conflict (night, seq) where source = 'auto' do nothing`, [r.autoWorkflow, r.batchSize, p.night, seq, owner.updated_by]);
        }
      }
    }
    const cancelled = p.held.length ? (await tx.query<{ id: string }>(
      `select id::text from platform.astra_job where id::text = any($1::text[]) and status = 'cancelled'`, [p.held])).map((x) => x.id) : [];
    await tx.query(`update platform.astra_job set status = 'failed', finished_at = clock_timestamp(), updated_at = clock_timestamp(),
      message = 'The runner no longer holds this run (it restarted or lost it).' where status in ('claimed','running') and not (id::text = any($1::text[]))`, [p.held]);
    const jobs = r.paused || p.free <= 0 ? [] : await tx.query<{ id: string; workflow: AstraWorkflow; size: number }>(
      `update platform.astra_job set status = 'claimed', claimed_at = clock_timestamp(), updated_at = clock_timestamp()
       where id in (select id from platform.astra_job where status = 'queued' and (run_now or $1) order by created_at limit $2)
       returning id::text, workflow, size`, [p.inWindow, Math.min(p.free, 12)]);
    return { paused: r.paused, batchSize: r.batchSize, window: [r.windowStart, r.windowEnd], jobs, cancel: cancelled };
  });
}

export interface Report { id: string; status: 'running' | 'done' | 'failed'; batch?: string; slot?: string; model?: string; counts?: Record<string, unknown>; message?: string }

/** The runner reports one job's progress. Counts only: unknown keys and non-numbers are dropped, messages are cut short. */
export async function report(db: Queryable, r: Report): Promise<boolean> {
  const counts = Object.fromEntries(COUNT_KEYS.flatMap((k) => (Number.isSafeInteger(r.counts?.[k]) && (r.counts![k] as number) >= 0 ? [[k, r.counts![k]]] : [])));
  const rows = await db.query(`update platform.astra_job set status = $2, batch = coalesce($3, batch), slot = coalesce($4, slot), model = coalesce($5, model),
      counts = counts || $6::jsonb, message = coalesce($7, message), updated_at = clock_timestamp(),
      started_at = case when $2 = 'running' then coalesce(started_at, clock_timestamp()) else started_at end,
      finished_at = case when $2 in ('done','failed') then clock_timestamp() else finished_at end
    where id::text = $1 and status in ('claimed','running') returning id`,
    [r.id, r.status, r.batch?.slice(0, 80) ?? null, r.slot?.slice(0, 40) ?? null, r.model?.slice(0, 40) ?? null, JSON.stringify(counts), r.message?.slice(0, 300) ?? null]);
  return rows.length > 0;
}

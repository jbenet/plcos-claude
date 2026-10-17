import type { Db, Queryable } from '@/lib/db';

/**
 * Astra runs a person starts and watches from Developer → Astra, and the Mac's runner claims and reports
 * (docs/30-astra-runner.md; Juan, 10 Oct 2026: "should not go through claude, should be able to have a UI and
 * trigger astra automatically"). The server queues and records only; the runner cuts each batch on the Mac,
 * so no name or record content ever reaches these tables, and nothing here launches anything.
 */
export const ASTRA_WORKFLOWS = ['w1w5', 'w1', 'w5', 'w5t', 'w1s', 'w5r'] as const;
export type AstraWorkflow = (typeof ASTRA_WORKFLOWS)[number];
export const WORKFLOW_LABEL: Record<AstraWorkflow, string> = { w1w5: 'Profile, then strategy (W1+W5)', w1: 'Profile (W1)', w5: 'Strategy (W5)',
  w5t: 'Shorten strategies (W5)', w1s: 'Search pass (W1)', w5r: 'Revise strategies (W5)' };
/** What a runner from before w5t can run: one that names no workflows in its poll is handed only these. */
export const FIRST_WORKFLOWS: readonly AstraWorkflow[] = ['w1w5', 'w1', 'w5'];
export type AstraStatus = 'queued' | 'claimed' | 'running' | 'done' | 'failed' | 'cancelled';
const COUNT_KEYS = ['selected', 'written', 'valid', 'failed', 'pushed', 'strategies'] as const;
/** The runner is up when it has polled within this long (it polls every minute). */
export const RUNNER_STALE_MS = 3 * 60_000;

/**
 * One step of the night plan (migration 027): a workflow, LPs per run, and optionally the vehicles to focus on (slugs or
 * names as vehicles.json on the Mac has them). With Keep busy on, the server works the steps in order through the night
 * window, keeping the queue topped up, and moves on when a step has nobody left.
 */
export interface PlanStep { workflow: AstraWorkflow; size: number; focus: string[] }
/** Most steps a plan holds, and most vehicles a step focuses on. */
export const PLAN_MAX = 20, FOCUS_MAX = 8;
/** A step is done for the night when a run of it finds nobody, or its last this many runs all wrote nothing. */
const STEP_BARREN = 3;

export interface AstraJob {
  id: string; workflow: AstraWorkflow; size: number; runNow: boolean; source: 'person' | 'auto' | 'plan'; night: string | null;
  focus: string[]; step: number | null;
  status: AstraStatus; batch: string | null; slot: string | null; model: string | null; counts: Record<string, number>;
  message: string | null; createdAt: string; claimedAt: string | null; startedAt: string | null; finishedAt: string | null;
}
export interface AstraRunner {
  paused: boolean; keepBusy: boolean; plan: PlanStep[]; autoOn: boolean; autoWorkflow: AstraWorkflow; autoBatches: number; batchSize: number;
  windowStart: number; windowEnd: number; heartbeatAt: string | null; host: string | null;
  slots: Array<{ slot: string; job: string | null }>; inWindow: boolean | null; capacityUntil: string | null; note: string | null;
  /** The commit the runner started on, and when (runners from before 026 send neither). */
  code: string | null; codeStartedAt: string | null;
}
/** Commands for the runner (migration 026): a fixed list, never a command line. */
export const ASTRA_COMMANDS = ['diagnose', 'restart', 'update'] as const;
export type AstraCommandOp = (typeof ASTRA_COMMANDS)[number];
export const COMMAND_LABEL: Record<AstraCommandOp, string> = { diagnose: 'Check', restart: 'Restart', update: 'Update' };
export interface AstraCommand {
  id: string; op: AstraCommandOp; status: 'queued' | 'sent' | 'done' | 'failed'; result: Record<string, string | number | boolean>;
  message: string | null; createdAt: string; sentAt: string | null; finishedAt: string | null;
}
/** A command the runner took but never answered: failed after this long (a Restart or Update waits for running batches, up to 3 hours each). */
const COMMAND_STALE = '4 hours';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const JOB_COLUMNS = `id::text, workflow, size, run_now, source, night::text, focus, step, status, batch, slot, model, counts, message,
  created_at, claimed_at, started_at, finished_at`;
type JobRow = { id: string; workflow: AstraWorkflow; size: number; run_now: boolean; source: 'person' | 'auto' | 'plan'; night: string | null;
  focus: string[] | null; step: number | null;
  status: AstraStatus; batch: string | null; slot: string | null; model: string | null; counts: Record<string, number> | null;
  message: string | null; created_at: Date; claimed_at: Date | null; started_at: Date | null; finished_at: Date | null };
const job = (r: JobRow): AstraJob => ({ id: r.id, workflow: r.workflow, size: r.size, runNow: r.run_now, source: r.source, night: r.night,
  focus: r.focus ?? [], step: r.step,
  status: r.status, batch: r.batch, slot: r.slot, model: r.model, counts: r.counts ?? {}, message: r.message,
  createdAt: iso(r.created_at)!, claimedAt: iso(r.claimed_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at) });

export async function readRunner(db: Queryable): Promise<AstraRunner> {
  const r = await db.one<Record<string, any>>('select * from platform.astra_runner where id = 1');
  if (!r) throw new Error('The Astra runner row is missing; migration 024 did not apply.');
  return { paused: r.paused, keepBusy: r.keep_busy ?? false, plan: readPlan(r.plan), autoOn: r.auto_on, autoWorkflow: r.auto_workflow, autoBatches: r.auto_batches, batchSize: r.batch_size,
    windowStart: r.window_start, windowEnd: r.window_end, heartbeatAt: iso(r.heartbeat_at), host: r.host,
    slots: Array.isArray(r.slots) ? r.slots : [], inWindow: r.in_window, capacityUntil: iso(r.capacity_until), note: r.note,
    code: r.code ?? null, codeStartedAt: iso(r.code_started_at) };
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

/** A plan as stored, read loosely: a step the server would not accept is dropped rather than run. */
export function readPlan(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, PLAN_MAX).flatMap((x) => {
    const workflow = ASTRA_WORKFLOWS.find((w) => w === x?.workflow);
    const size = Math.trunc(Number(x?.size));
    const focus = Array.isArray(x?.focus) ? x.focus.filter((f: unknown) => typeof f === 'string' && /^[\w .&'()-]{1,60}$/.test(f)).slice(0, FOCUS_MAX) : [];
    return workflow && size >= 1 && size <= 20 ? [{ workflow, size, focus }] : [];
  });
}

/** Parse the page's plan text: one step a line, `<workflow> <LPs per run> [vehicle, vehicle…]`; refuses a line it can't read. */
export function parsePlan(text: string): PlanStep[] {
  const steps = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (steps.length > PLAN_MAX) throw new Error(`A plan holds at most ${PLAN_MAX} steps.`);
  return steps.map((line, i) => {
    const m = /^(\S+)\s+(\d+)(?:\s+(.+))?$/.exec(line);
    const workflow = ASTRA_WORKFLOWS.find((w) => w === m?.[1]);
    const size = Number(m?.[2]);
    const focus = (m?.[3] ?? '').split(',').map((f) => f.trim()).filter(Boolean);
    if (!m || !workflow) throw new Error(`Step ${i + 1}: start with a workflow (${ASTRA_WORKFLOWS.join(', ')}).`);
    if (!(size >= 1 && size <= 20)) throw new Error(`Step ${i + 1}: LPs per run is 1 to 20.`);
    if (focus.length > FOCUS_MAX || focus.some((f) => !/^[\w .&'()-]{1,60}$/.test(f))) throw new Error(`Step ${i + 1}: up to ${FOCUS_MAX} vehicles, comma-separated.`);
    return { workflow, size, focus };
  });
}

export const planText = (plan: PlanStep[]) => plan.map((s) => [s.workflow, s.size, s.focus.join(', ')].filter((x) => x !== '').join(' ')).join('\n');

export async function saveSettings(db: Queryable, actor: string, s: Partial<Pick<AstraRunner, 'paused' | 'keepBusy' | 'plan' | 'autoOn' | 'autoWorkflow' | 'autoBatches' | 'batchSize' | 'windowStart' | 'windowEnd'>>): Promise<void> {
  const cols: Record<string, unknown> = { paused: s.paused, keep_busy: s.keepBusy, plan: s.plan === undefined ? undefined : JSON.stringify(readPlan(s.plan)),
    auto_on: s.autoOn, auto_workflow: s.autoWorkflow, auto_batches: s.autoBatches, batch_size: s.batchSize, window_start: s.windowStart, window_end: s.windowEnd };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (s.autoWorkflow !== undefined && !ASTRA_WORKFLOWS.includes(s.autoWorkflow)) throw new Error('Pick a workflow.');
  const params = set.map(([, v]) => v);
  await db.query(`update platform.astra_runner set ${set.map(([k], i) => `${k} = $${i + 1}`).join(', ')}${set.length ? ', ' : ''}
    updated_by = $${params.length + 1}, updated_at = clock_timestamp() where id = 1`, [...params, actor]);
}

export interface Poll {
  host: string; inWindow: boolean; night: string; free: number; held: string[]; workflows?: readonly AstraWorkflow[];
  /** Runner features beyond the first: `focus` = it can cut a batch for named vehicles. */
  features?: readonly string[];
  commands?: readonly AstraCommandOp[]; code?: string | null; codeStartedAt?: string | null;
  slots: Array<{ slot: string; job: string | null }>; capacityUntil: string | null; note: string | null;
}
export interface PollAnswer {
  paused: boolean; batchSize: number; window: [number, number]; jobs: Array<Pick<AstraJob, 'id' | 'workflow' | 'size' | 'focus'>>; cancel: string[];
  commands: Array<Pick<AstraCommand, 'id' | 'op'>>;
}

/**
 * The runner's poll, every minute: record its heartbeat and slots; on the first poll of a night window with
 * Auto on, queue that night's runs (once: the night and sequence are unique); tell it which held jobs were
 * cancelled; mark any job it no longer holds as lost; and hand it up to `free` queued jobs it may start now, of the
 * workflows it says it can run (a runner that names none is an older one: the first three only), and any queued
 * commands of the kinds it says it takes.
 */
/** A poll from a second runner while the first is alive: it would fail the first's runs as lost (red team, 17 Oct 2026). */
export class AstraRunnerBusy extends Error {}
const RUNNER_ALIVE = '3 minutes';

export async function poll(db: Db, p: Poll): Promise<PollAnswer> {
  return db.transaction(async (tx) => {
    const live = await tx.one<{ host: string }>(`select host from platform.astra_runner where id = 1 and host is not null and host <> $1
      and heartbeat_at > clock_timestamp() - interval '${RUNNER_ALIVE}' for update`, [p.host]);
    if (live) throw new AstraRunnerBusy(`Another runner (${live.host}) is polling; one runner at a time.`);
    await tx.query(`update platform.astra_runner set heartbeat_at = clock_timestamp(), host = $1, slots = $2::jsonb, in_window = $3,
      capacity_until = $4, note = $5, code = $6, code_started_at = $7 where id = 1`,
      [p.host, JSON.stringify(p.slots), p.inWindow, p.capacityUntil, p.note, p.code ?? null, p.codeStartedAt ?? null]);
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
    if (r.keepBusy && p.inWindow && !r.paused && r.plan.length) await topUp(tx, r, p);
    const cancelled = p.held.length ? (await tx.query<{ id: string }>(
      `select id::text from platform.astra_job where id::text = any($1::text[]) and status = 'cancelled'`, [p.held])).map((x) => x.id) : [];
    await tx.query(`update platform.astra_job set status = 'failed', finished_at = clock_timestamp(), updated_at = clock_timestamp(),
      message = 'The runner no longer holds this run (it restarted or lost it).' where status in ('claimed','running') and not (id::text = any($1::text[]))`, [p.held]);
    const focusing = (p.features ?? []).includes('focus');
    const jobs = r.paused || p.free <= 0 ? [] : (await tx.query<{ id: string; workflow: AstraWorkflow; size: number; focus: string[] | null }>(
      `update platform.astra_job set status = 'claimed', claimed_at = clock_timestamp(), updated_at = clock_timestamp()
       where id in (select id from platform.astra_job where status = 'queued' and (run_now or $1) and workflow = any($3::text[])
         and ($4 or coalesce(cardinality(focus), 0) = 0) order by created_at limit $2)
       returning id::text, workflow, size, focus`, [p.inWindow, Math.min(p.free, 12), [...(p.workflows ?? FIRST_WORKFLOWS)], focusing]))
      .map((j) => ({ id: j.id, workflow: j.workflow, size: j.size, focus: j.focus ?? [] }));
    await tx.query(`update platform.astra_command set status = 'failed', finished_at = clock_timestamp(), message = 'The runner took it but never answered.'
      where status = 'sent' and sent_at < clock_timestamp() - interval '${COMMAND_STALE}'`);
    const takes = (p.commands ?? []).filter((c) => ASTRA_COMMANDS.includes(c));
    const commands = takes.length ? await tx.query<{ id: string; op: AstraCommandOp }>(
      `update platform.astra_command set status = 'sent', sent_at = clock_timestamp()
       where id in (select id from platform.astra_command where status = 'queued' and op = any($1::text[]) order by created_at limit 4)
       returning id::text, op`, [takes]) : [];
    return { paused: r.paused, batchSize: r.batchSize, window: [r.windowStart, r.windowEnd], jobs, cancel: cancelled, commands };
  });
}

/**
 * Keep busy: in the night window, keep about two runs per slot queued or working, from the first plan step that still
 * has work tonight. A step is done for the night when one of its runs found nobody, or its last STEP_BARREN runs wrote
 * nothing (so a step that keeps failing stops costing runs); its leftover queued runs are cancelled. Plan runs left
 * queued from an earlier night are cancelled, so each night starts from step 1. Steps the runner can't run (a workflow it
 * doesn't name, or a focus it can't cut) are skipped.
 */
async function topUp(tx: Queryable, r: AstraRunner, p: Poll): Promise<void> {
  await tx.query(`update platform.astra_job set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp(),
    message = 'Left from an earlier night.' where source = 'plan' and status = 'queued' and night is distinct from $1::date`, [p.night]);
  const owner = await tx.one<{ updated_by: string | null }>('select updated_by::text from platform.astra_runner where id = 1');
  if (!owner?.updated_by) return;
  const tonight = await tx.query<{ step: number; status: AstraStatus; selected: number | null; written: number | null; finished_at: Date | null }>(
    `select step, status, (counts->>'selected')::int as selected, coalesce((counts->>'pushed')::int, (counts->>'valid')::int, (counts->>'written')::int) as written,
       finished_at from platform.astra_job where source = 'plan' and night = $1::date order by finished_at desc nulls last`, [p.night]);
  const runnable = (s: PlanStep) => (p.workflows ?? FIRST_WORKFLOWS).includes(s.workflow) && (!s.focus.length || (p.features ?? []).includes('focus'));
  const done = (i: number) => {
    const finished = tonight.filter((j) => j.step === i && (j.status === 'done' || j.status === 'failed'));
    return finished.some((j) => j.status === 'done' && j.selected === 0) || (finished.length >= STEP_BARREN && finished.slice(0, STEP_BARREN).every((j) => !j.written));
  };
  for (let i = 0; i < r.plan.length; i++) if (done(i)) {
    await tx.query(`update platform.astra_job set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp(),
      message = 'This plan step is done for tonight.' where source = 'plan' and status = 'queued' and night = $1::date and step = $2`, [p.night, i]);
  }
  const at = r.plan.findIndex((s, i) => runnable(s) && !done(i));
  if (at < 0) return;
  const pending = await tx.one<{ n: number }>(`select count(*)::int as n from platform.astra_job where status in ('queued','claimed','running')`);
  const want = Math.max(2, p.slots.length) * 2 - (pending?.n ?? 0);
  const step = r.plan.at(at)!;
  for (let k = 0; k < want; k++) {
    await tx.query(`insert into platform.astra_job(workflow, size, run_now, source, night, step, focus, actor) values ($1, $2, false, 'plan', $3, $4, $5, $6)`,
      [step.workflow, step.size, p.night, at, step.focus.length ? step.focus : null, owner.updated_by]);
  }
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

/** A person (or an Admin token) asks the runner for a command. One of each kind waits at a time: asking again returns it. */
export async function issueCommand(db: Queryable, actor: string, op: AstraCommandOp): Promise<{ id: string; existing: boolean }> {
  if (!ASTRA_COMMANDS.includes(op)) throw new Error('Pick Check, Restart or Update.');
  const open = await db.one<{ id: string }>(`select id::text from platform.astra_command where op = $1 and status in ('queued','sent')
    and created_at > clock_timestamp() - interval '${COMMAND_STALE}' order by created_at limit 1`, [op]);
  if (open) return { id: open.id, existing: true };
  const row = await db.one<{ id: string }>(`insert into platform.astra_command(op, actor) values ($1, $2) returning id::text`, [op, actor]);
  return { id: row!.id, existing: false };
}

const RESULT_KEYS = 16;
/** The runner answers a command it took. Its result keeps up to 16 short scalar fields; anything else is dropped. */
export async function reportCommand(db: Queryable, r: { id: string; status: 'done' | 'failed'; result?: Record<string, unknown>; message?: string }): Promise<boolean> {
  const result = Object.fromEntries(Object.entries(r.result ?? {}).filter(([k, v]) => /^[a-zA-Z]{1,24}$/.test(k)
    && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string'))
    .slice(0, RESULT_KEYS).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]));
  const rows = await db.query(`update platform.astra_command set status = $2, result = $3::jsonb, message = $4, finished_at = clock_timestamp()
    where id::text = $1 and status = 'sent' returning id`, [r.id, r.status, JSON.stringify(result), r.message?.slice(0, 300) ?? null]);
  return rows.length > 0;
}

export async function recentCommands(db: Queryable, limit = 6): Promise<AstraCommand[]> {
  const rows = await db.query<{ id: string; op: AstraCommandOp; status: AstraCommand['status']; result: AstraCommand['result'] | null; message: string | null;
    created_at: Date; sent_at: Date | null; finished_at: Date | null }>(
    `select id::text, op, status, result, message, created_at, sent_at, finished_at from platform.astra_command order by created_at desc limit $1`, [limit]);
  return rows.map((r) => ({ id: r.id, op: r.op, status: r.status, result: r.result ?? {}, message: r.message,
    createdAt: iso(r.created_at)!, sentAt: iso(r.sent_at), finishedAt: iso(r.finished_at) }));
}

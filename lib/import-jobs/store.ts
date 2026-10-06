import type { Db, Queryable } from '@/lib/db';
import { WorkflowRefusal } from '@/lib/workflows/refusal';
import type { ImportJob, ImportKind, ImportProgress } from './types';

export const IMPORT_FAILURE = 'Import stopped. Review the last committed results before retrying; completed changes are preserved.';

/** Condition names for the SQLSTATEs an import is likely to meet (PostgreSQL docs, appendix A). */
const SQLSTATE: Record<string, string> = {
  '57014': 'query_canceled (statement timeout or cancel)', '55P03': 'lock_not_available', '40P01': 'deadlock_detected',
  '40001': 'serialization_failure', '25P02': 'in_failed_sql_transaction', '25P03': 'idle_in_transaction_session_timeout',
  '23505': 'unique_violation', '23503': 'foreign_key_violation', '23502': 'not_null_violation', '23514': 'check_violation',
  '21000': 'cardinality_violation', '22P02': 'invalid_text_representation', '22003': 'numeric_value_out_of_range',
  '42P01': 'undefined_table', '42703': 'undefined_column', '42883': 'undefined_function', '54000': 'program_limit_exceeded',
  '53100': 'disk_full', '53200': 'out_of_memory', '53300': 'too_many_connections', '57P01': 'admin_shutdown',
  '08006': 'connection_failure', '08003': 'connection_does_not_exist',
};
const identifier = (v: unknown) => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_.$]{0,62}$/.test(v) ? v : undefined;

/**
 * What a failure was, without its message or parameters (30 Sep 2026: a findings import stopped at
 * "Rebuilding research ties" and neither the receipt nor the log said more). Driver and connector
 * messages can quote records, so this reads only structure: the error's class, a PostgreSQL SQLSTATE
 * with its condition name and the schema object it names, a Node system code, and the first frame of
 * this checkout's own code in the stack (a source path and line).
 */
export function describeImportError(error: unknown, root = process.cwd()): string {
  if (!(error instanceof Error)) return 'a thrown non-Error value';
  const e = error as Error & { code?: unknown; constraint?: unknown; table?: unknown; schema?: unknown };
  const parts: string[] = [];
  const code = typeof e.code === 'string' ? e.code : undefined;
  if (code && /^[0-9A-Z]{5}$/.test(code)) {
    parts.push(`${code} ${SQLSTATE[code] ?? 'database error'}`);
    const object = identifier(e.constraint) ?? [identifier(e.schema), identifier(e.table)].filter(Boolean).join('.');
    if (object) parts.push(`on ${object}`);
  } else {
    const name = identifier(e.constructor?.name) ?? identifier(e.name) ?? 'Error';
    parts.push(code && /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+)$/.test(code) ? `${name} ${code}` : name);
  }
  // The first frame inside this checkout and outside its dependencies: where our code threw or awaited.
  const base = root.replace(/\/+$/, '') + '/';
  for (const line of (e.stack ?? '').split('\n').slice(1)) {
    const at = /\(?(?:file:\/\/)?([^\s()]+?):(\d+):\d+\)?$/.exec(line.trim());
    if (!at || !at[1]!.startsWith(base)) continue;
    const path = at[1]!.slice(base.length);
    if (path.includes('node_modules/') || !/^[A-Za-z0-9_./@[\]-]+$/.test(path)) continue;
    parts.push(`at ${path}:${at[2]}`);
    break;
  }
  return parts.join(' ');
}
const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;
/** The receipt and log line for a failed job: where it stopped, what kind of error, how long in. */
export function importFailureText(phase: string, error: unknown, phaseMs: number, totalMs: number, root?: string): string {
  const where = /^[\p{L}\p{N} ,.'()&/–-]{1,80}$/u.test(phase) ? phase : 'an unnamed phase';
  return `Import stopped at ${where} (${describeImportError(error, root)}, ${seconds(phaseMs)} into the phase, ${seconds(totalMs)} in all). `
    + 'Review the last committed results before retrying; completed changes are preserved.';
}
export async function createImportJob(db: Db, kind: ImportKind, actor: string, input: Record<string, unknown> = {}): Promise<ImportJob> {
  return db.transaction(async tx => {
    const inserted = await tx.one<ImportJob>(`insert into platform.import_job(kind,actor,input) values($1,$2,$3::jsonb)
      on conflict(kind) where status in ('queued','running') do nothing returning *`, [kind, actor, JSON.stringify(input)]);
    if (inserted) return inserted;
    const active = await tx.one<ImportJob>("select * from platform.import_job where kind=$1 and status in ('queued','running')", [kind]);
    if (!active) throw new Error('Import finished while queueing. Retry.');
    const same = await tx.one('select 1 from platform.import_job where id=$1 and input=$2::jsonb',[active.id,JSON.stringify(input)]);
    if (!same) throw new Error('Another operation of this kind is running. Wait for it to finish.');
    return active;
  });
}
export async function failImportJob(db: Queryable, id: string, error = IMPORT_FAILURE): Promise<void> {
  await db.query(`update platform.import_job set status='failed',phase='Stopped',error=$2,finished_at=clock_timestamp()
    where id=$1 and status in ('queued','running')`, [id,error]);
}
/** Work owns a session advisory lock before entering here. No automatic replay of partial jobs. */
export async function executeImportJob(db: Db, id: string,
  work: (job: ImportJob, progress: ImportProgress) => Promise<Record<string, unknown>>,
  observe?: (job: ImportJob) => void): Promise<void> {
  const job = await db.one<ImportJob>(`update platform.import_job set status='running',phase='Starting',started_at=clock_timestamp(),heartbeat_at=clock_timestamp()
    where id=$1 and status='queued' returning *`, [id]);
  if (!job) return;
  observe?.(job);
  const startedAt = Date.now();
  let current = job.phase, phaseAt = startedAt;
  const progress: ImportProgress = async (phase, done=0, total=null) => {
    if (phase !== current) { current = phase; phaseAt = Date.now(); }
    observe?.({...job,phase,done,total,heartbeat_at:new Date()});
    await db.query(`update platform.import_job set phase=$2,done=$3,total=$4,heartbeat_at=clock_timestamp() where id=$1 and status='running'`,[id,phase,done,total]);
  };
  // GUESS: five seconds is frequent enough for local job liveness without crowding reads.
  let heartbeatPending = false;
  const heartbeat = setInterval(() => { if (heartbeatPending) return; heartbeatPending = true; void db.query("update platform.import_job set heartbeat_at=clock_timestamp() where id=$1 and status='running'",[id]).catch(()=>{}).finally(()=>{heartbeatPending=false;}); },5000);
  heartbeat.unref();
  try {
    const result = await work(job,progress);
    await db.query(`update platform.import_job set status='completed',phase='Completed',done=coalesce(total,done),result=$2::jsonb,
      heartbeat_at=clock_timestamp(),finished_at=clock_timestamp() where id=$1 and status='running'`,[id,JSON.stringify(result)]);
  } catch (error) {
    // Driver and connector exceptions can contain records or credentials: never their message or
    // parameters. The receipt says where and what kind (describeImportError); the server logs it.
    const refused = job.kind === 'workflow' && (error instanceof WorkflowRefusal || (error instanceof Error && error.message === 'Workflow refused: ANTHROPIC_API_KEY is not set.'));
    await failImportJob(db,id,refused ? (error as Error).message : importFailureText(current,error,Date.now()-phaseAt,Date.now()-startedAt));
  } finally { clearInterval(heartbeat); }
}

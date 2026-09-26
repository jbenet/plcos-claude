import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { mainCheckout, readLayout } from '../../config/ports';

export const MAX_LINE_BYTES = 4096;
type Counts = Record<'selected' | 'written' | 'valid' | 'failed' | 'skipped', number | null>;
type Outcome = 'unknown' | 'succeeded' | 'partial' | 'failed' | 'refused' | 'cancelled' | 'unavailable';
export interface Usage {
  input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null;
  reasoning?: number | null;
  cost: { amount: number; currency: string } | null;
  source?: 'measured' | 'estimated'; // absent only on historical lines
  method?: string;
  sessionCount?: number;
}
export interface RunLine {
  event: 'started' | 'finished';
  runId: string;
  parentRunId: string | null;
  workflow: string | null;
  operation: string;
  protocol: { version: string | null; hash: string };
  source: 'claude-code' | 'chatgpt' | 'script' | 'app';
  agent: string;
  model: string | null;
  launchFolder: string;
  workerFolder: string;
  batch: { id: string; manifest: string; hash: string; planned: number };
  startedAt: string | null;
  endedAt: string | null;
  counts: Counts;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'not-run' }>;
  usage: Usage | null;
  outcome: Outcome;
  reason: string | null;
}
export type Begin = Pick<RunLine, 'parentRunId' | 'workflow' | 'operation' | 'protocol' | 'source' | 'agent' | 'model' | 'launchFolder' | 'workerFolder' | 'batch'>;
export type Finish = Pick<RunLine, 'counts' | 'checks' | 'outcome' | 'reason'> & { usage: Usage & { source: 'measured' | 'estimated' } };
export type Context = { cwd?: string; profile?: string };

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object.');
  return v as Record<string, unknown>;
};
const string = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const nullableString = (v: unknown) => v === null || string(v);
const count = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0);
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
const date = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(v) && Number.isFinite(Date.parse(v)));
const requireValue = (ok: boolean, field: string) => { if (!ok) throw new Error(`Invalid workflow ${field}.`); };

/** Validate without printing the supplied record (which may be private). */
export function validateLine(value: unknown): asserts value is RunLine {
  const r = object(value), p = object(r.protocol), b = object(r.batch), c = object(r.counts);
  requireValue(r.event === 'started' || r.event === 'finished', 'event');
  requireValue(uuid(r.runId) && (r.parentRunId === null || uuid(r.parentRunId)), 'IDs');
  requireValue(nullableString(r.workflow) && string(r.operation) && string(r.agent)
    && nullableString(r.model) && string(r.launchFolder) && string(r.workerFolder), 'metadata');
  requireValue(typeof r.source === 'string' && ['claude-code', 'chatgpt', 'script', 'app'].includes(r.source), 'source');
  requireValue(nullableString(p.version) && hash(p.hash), 'protocol');
  requireValue(string(b.id) && string(b.manifest) && hash(b.hash) && b.planned !== null && count(b.planned), 'batch');
  requireValue(date(r.startedAt) && date(r.endedAt), 'timestamps');
  requireValue(['selected', 'written', 'valid', 'failed', 'skipped'].every((k) => count(c[k])), 'counts');
  requireValue(Array.isArray(r.checks) && r.checks.every((v) => {
    const check = object(v);
    return string(check.name) && typeof check.status === 'string' && ['pass', 'fail', 'not-run'].includes(check.status);
  }), 'checks');
  if (r.usage !== null) {
    const u = object(r.usage);
    const token = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0
      && (u.source === 'estimated' || Number.isSafeInteger(v)));
    requireValue(['input', 'output', 'cacheRead', 'cacheWrite'].every((k) => token(u[k]))
      && (u.reasoning === undefined || token(u.reasoning)), 'usage');
    requireValue(u.source === undefined || u.source === 'measured' || u.source === 'estimated', 'usage source');
    requireValue(u.method === undefined || string(u.method), 'usage method');
    requireValue(u.sessionCount === undefined || (u.sessionCount !== null && count(u.sessionCount)), 'usage session count');
    if (u.cost !== null) {
      const cost = object(u.cost);
      requireValue(typeof cost.amount === 'number' && Number.isFinite(cost.amount) && cost.amount >= 0 && string(cost.currency), 'cost');
    }
  }
  requireValue(typeof r.outcome === 'string' && ['unknown', 'succeeded', 'partial', 'failed', 'refused', 'cancelled', 'unavailable'].includes(r.outcome) && nullableString(r.reason), 'outcome');
  if (r.event === 'started') requireValue(r.endedAt === null && r.outcome === 'unknown', 'start');
  if (r.startedAt && r.endedAt) requireValue(Date.parse(String(r.endedAt)) >= Date.parse(String(r.startedAt)), 'time order');
}

export function encodeLine(line: RunLine): string {
  validateLine(line);
  const text = JSON.stringify(line) + '\n';
  requireValue(Buffer.byteLength(text, 'utf8') < MAX_LINE_BYTES, 'line size (must be under 4 KB)');
  return text;
}

const stable = (v: unknown): string => JSON.stringify(v, (_key, value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
});
function identity(r: RunLine) {
  const { event, endedAt, counts, checks, usage, outcome, reason, ...metadata } = r;
  return stable(metadata);
}
export type FoldedRun = { runId: string; start: RunLine | null; finish: RunLine | null; outcome: Outcome; conflict: boolean };
export function foldRuns(text: string): { runs: FoldedRun[]; issues: string[] } {
  const runs = new Map<string, FoldedRun>(), issues: string[] = [];
  const lines = text.split('\n');
  const tail = lines.pop();
  if (tail) issues.push('Incomplete final line; history is incomplete.');
  lines.forEach((line, i) => {
    try {
      const r: unknown = JSON.parse(line);
      validateLine(r);
      encodeLine(r);
      const run = runs.get(r.runId) ?? { runId: r.runId, start: null, finish: null, outcome: 'unknown', conflict: false };
      const field = r.event === 'started' ? 'start' : 'finish';
      const prior = run[field], other = run.start ?? run.finish;
      if ((prior && stable(prior) !== stable(r)) || (other && identity(other) !== identity(r))) {
        run.conflict = true;
        issues.push(`Conflicting records for run ${r.runId}.`);
      } else run[field] = r;
      run.outcome = run.start && run.finish && !run.conflict ? run.finish.outcome : 'unknown';
      runs.set(r.runId, run);
    } catch { issues.push(`Invalid line ${i + 1}; history is incomplete.`); }
  });
  for (const run of runs.values()) if (!run.start) issues.push(`Finish without start for run ${run.runId}.`);
  return { runs: [...runs.values()], issues };
}

async function statIfPresent(path: string) {
  try { return await lstat(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
/** Never use cwd/data/real: in dev it is a disposable preview. No configurable data-root override. */
export async function realRoot({ cwd = process.cwd(), profile = process.env.DATA_PROFILE }: Context = {}): Promise<string> {
  if (profile !== 'real') throw new Error('Workflow recording requires DATA_PROFILE=real; demo/preview is refused.');
  const checkout = await realpath(cwd);
  const main = mainCheckout(checkout);
  if (!main || !readLayout(checkout).live) throw new Error('Workflow recording requires the known live/worktree layout.');
  const expected = resolve(await realpath(main), '../plcos-data/real');
  const root = await realpath(expected);
  if (root !== expected || await statIfPresent(join(root, '.preview-copy'))
      || await realpath(join(main, 'data/real')) !== root) throw new Error('Shared real root required; preview or redirected root refused.');
  return root;
}
async function ledgerPath(context: Context): Promise<string> {
  const root = await realRoot(context), dir = join(root, 'workflows'), file = join(dir, 'runs.jsonl');
  const ds = await statIfPresent(dir), fs = await statIfPresent(file);
  if ((ds && (!ds.isDirectory() || ds.isSymbolicLink())) || (fs && (!fs.isFile() || fs.isSymbolicLink()))) {
    throw new Error('Workflow ledger must be a regular file in its own directory, not a symlink.');
  }
  return file;
}
export async function readRuns(context: Context = {}) {
  const file = await ledgerPath(context);
  try { return foldRuns(await readFile(file, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return foldRuns(''); throw e; }
}
async function append(line: RunLine, context: Context) {
  const text = encodeLine(line); // reject oversized metadata before creating anything
  const file = await ledgerPath(context);
  const existing = await readRuns(context);
  if (existing.issues.length) throw new Error('Ledger needs operator review; no append attempted.');
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, text, { encoding: 'utf8', flag: 'a' });
}
export async function beginRun(metadata: Begin, context: Context = {}): Promise<string> {
  const line: RunLine = { ...metadata, event: 'started', runId: randomUUID(), startedAt: new Date().toISOString(), endedAt: null,
    counts: { selected: metadata.batch.planned, written: null, valid: null, failed: null, skipped: null },
    checks: [], usage: null, outcome: 'unknown', reason: null };
  await append(line, context);
  return line.runId;
}
export async function finishRun(runId: string, result: Finish, context: Context & { endedAt?: string } = {}): Promise<void> {
  requireValue(Boolean(result.usage) && ['measured', 'estimated'].includes(result.usage?.source), 'usage required at finish');
  const ledger = await readRuns(context);
  const run = ledger.runs.find((r) => r.runId === runId);
  if (ledger.issues.length || !run?.start || run.conflict) throw new Error('No unambiguous start; inspect the ledger before finishing.');
  const line: RunLine = { ...run.start, counts: result.counts, checks: result.checks, usage: result.usage,
    outcome: result.outcome, reason: result.reason, event: 'finished', endedAt: run.finish?.endedAt ?? context.endedAt ?? new Date().toISOString() };
  encodeLine(line);
  if (run.finish) {
    if (stable(run.finish) !== stable(line)) throw new Error('Run already finished with different results.');
    return;
  }
  await append(line, context);
}

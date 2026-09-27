import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { foldRuns, realRoot, type FoldedRun, type RunLine } from './ledger';
import { demoLedger } from './demo';

/**
 * Developer → Workflows reads the one run ledger (docs/20-workflows.md, issues 0036 and 0100):
 * `plcos-data/real/workflows/runs.jsonl`, which every Claude, ChatGPT and script run appends to,
 * wherever it ran. Read-only. The live server reads the shared file; a preview reads its own labelled
 * copy; the demo reads invented runs. A start with no finish is "unknown", never success; unknown
 * usage is not zero.
 */

export type LedgerWhere = 'live' | 'copy' | 'demo';
export interface Ledger {
  where: LedgerWhere;
  /** What the page may say about where it read from; never an absolute path. */
  label: string;
  runs: RunView[];
  issues: string[];
  lines: number;
  lastWrite: Date | null;
  error: string | null;
  notesRoot: string | null;
}

export type Family = 'research' | 'import' | 'dev';
export const FAMILY_LABEL: Record<Family, string> = {
  research: 'Research workflows',
  import: 'Imports',
  dev: 'Dev tasks',
};

/** The workflows docs/20 names, and the ones the ledger has used since. Labels only, no data. */
export const WORKFLOW_NAMES: Record<string, string> = {
  W0: 'Research set', W1: 'Profile', W1c: 'Fact check', W1s: 'Structure', W2: 'Profile us', W2n: 'Directory',
  W3: 'Connections', W4: 'Fit and angle', W5: 'Strategy', W5c: 'Strategy critic', W6: 'Presence',
  W7: 'Materials', W8: 'Synthesis', W9: 'Triage', W11: 'Connectors', W12: 'Tags',
  WGRAPH: 'Warehouse graph', WINV: 'Warehouse inventory', WINV2: 'Warehouse directory', P4: 'Public prospect discovery',
  'W1/W3': 'Profile and connections', prospecting: 'Network prospecting', 'portfolio-research': 'Portfolio research',
  dakota: 'Dakota pull',
};

export interface RunView {
  runId: string;
  parentRunId: string | null;
  /** Normalised: W-names upper-cased, so "w1" and "W1" are one workflow. */
  workflow: string;
  name: string;
  family: Family;
  operation: string;
  version: string | null;
  source: RunLine['source'];
  agent: string;
  model: string | null;
  folder: string;
  startedAt: Date | null;
  endedAt: Date | null;
  outcome: FoldedRun['outcome'];
  finished: boolean;
  conflict: boolean;
  reason: string | null;
  planned: number;
  counts: RunLine['counts'] | null;
  checks: { pass: number; fail: number; notRun: number; list: RunLine['checks'] };
  usage: { source: 'measured' | 'estimated' | 'unknown'; input: number; output: number; cacheRead: number; cost: number | null; method: string | null } | null;
  batchId: string;
}

const folderName = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

function workflowKey(raw: string | null, operation: string): string {
  if (!raw) return /issue|implement|perf|routes|tables|code|backfill/i.test(operation) ? 'DEV' : 'UNNAMED';
  // "w1" and "W1" are one workflow; the method suffix stays lower case, as docs/19 writes it (W1c, W5c).
  if (/^w\d+[a-z]?(\/w\d+[a-z]?)?$/i.test(raw)) return raw.replace(/w(\d+)([a-z]?)/gi, (_, d: string, x: string) => `W${d}${x.toLowerCase()}`);
  if (/^(w[a-z]+\d*|p\d+)$/i.test(raw)) return raw.toUpperCase();
  return /^(prospecting|portfolio-research|dakota)$/i.test(raw) ? raw.toLowerCase() : raw;
}

function family(key: string, source: RunLine['source'], operation: string): Family {
  if (key === 'dakota' && source === 'script' && !/build|code/i.test(operation)) return 'import';
  if ((key in WORKFLOW_NAMES && key !== 'dakota') || key === 'UNNAMED') return 'research';
  return 'dev';
}

export function viewRun(r: FoldedRun): RunView | null {
  const line = r.start ?? r.finish;
  if (!line) return null;
  const key = workflowKey(line.workflow, line.operation);
  const f = r.finish;
  const u = f?.usage ?? null;
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    runId: r.runId, parentRunId: line.parentRunId, workflow: key,
    name: WORKFLOW_NAMES[key] ?? (key === 'DEV' ? 'Dev task' : key === 'UNNAMED' ? 'Unnamed' : key),
    family: family(key, line.source, line.operation), operation: line.operation,
    version: line.protocol.version, source: line.source, agent: line.agent, model: line.model,
    folder: folderName(line.workerFolder || line.launchFolder),
    startedAt: line.startedAt ? new Date(line.startedAt) : null,
    endedAt: f?.endedAt ? new Date(f.endedAt) : null,
    outcome: r.outcome, finished: Boolean(f), conflict: r.conflict, reason: f?.reason ?? null,
    planned: line.batch.planned, counts: f?.counts ?? null,
    checks: {
      pass: f?.checks.filter((c) => c.status === 'pass').length ?? 0,
      fail: f?.checks.filter((c) => c.status === 'fail').length ?? 0,
      notRun: f?.checks.filter((c) => c.status === 'not-run').length ?? 0,
      list: f?.checks ?? [],
    },
    usage: u ? {
      source: u.source ?? 'unknown', input: n(u.input) + n(u.cacheWrite), output: n(u.output), cacheRead: n(u.cacheRead),
      cost: u.cost ? u.cost.amount : null, method: u.method ?? null,
    } : null,
    batchId: line.batch.id,
  };
}

const at = (r: RunView) => (r.startedAt ?? r.endedAt)?.getTime() ?? 0;

async function readIfPresent(path: string): Promise<{ text: string; mtime: Date } | null> {
  try {
    const [text, st] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { text, mtime: st.mtime };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

function build(where: LedgerWhere, label: string, text: string, lastWrite: Date | null, notesRoot: string | null): Ledger {
  const folded = foldRuns(text);
  const runs = folded.runs.map(viewRun).filter((r): r is RunView => r !== null).sort((a, b) => at(b) - at(a));
  return { where, label, runs, issues: folded.issues, lines: text ? text.split('\n').length - 1 : 0, lastWrite, error: null, notesRoot };
}

export async function loadLedger(): Promise<Ledger> {
  const empty = (where: LedgerWhere, label: string, error: string): Ledger =>
    ({ where, label, runs: [], issues: [], lines: 0, lastWrite: null, error, notesRoot: null });
  if (config.data.profile === 'demo') {
    return build('demo', 'invented runs (fixtures)', demoLedger(), null, join(process.cwd(), 'fixtures', 'workflows', 'log'));
  }
  if (config.data.copyTakenAt) {
    const root = join(process.cwd(), config.data.root);
    try {
      const file = await readIfPresent(join(root, 'workflows', 'runs.jsonl'));
      return file
        ? build('copy', 'the preview’s copy of workflows/runs.jsonl', file.text, file.mtime, join(root, 'enrich', 'log'))
        : empty('copy', 'the preview’s copy', 'This copy holds no workflows/runs.jsonl.');
    } catch {
      return empty('copy', 'the preview’s copy', 'The copy’s ledger could not be read.');
    }
  }
  try {
    const root = await realRoot();
    const file = await readIfPresent(join(root, 'workflows', 'runs.jsonl'));
    return file
      ? build('live', 'plcos-data/real/workflows/runs.jsonl', file.text, file.mtime, join(root, 'enrich', 'log'))
      : empty('live', 'plcos-data/real/workflows/runs.jsonl', 'No run has been recorded yet: the ledger file does not exist.');
  } catch (e) {
    return empty('live', 'plcos-data/real/workflows/runs.jsonl', e instanceof Error ? e.message : 'The ledger could not be read.');
  }
}

/* ——— Measures ——— */

export interface WorkflowStat {
  workflow: string;
  name: string;
  family: Family;
  runs: number;
  top: number;
  outcomes: Record<FoldedRun['outcome'], number>;
  last: Date | null;
  first: Date | null;
  written: number;
  selected: number;
  checksPass: number;
  checksAll: number;
  tokens: { estimated: number; measured: number; runsWithUsage: number };
  versions: Array<{ version: string; runs: number; first: Date | null; last: Date | null; outcomes: Record<FoldedRun['outcome'], number> }>;
  agents: string[];
}

export const OUTCOMES: FoldedRun['outcome'][] = ['succeeded', 'partial', 'failed', 'refused', 'cancelled', 'unavailable', 'unknown'];
const zeroOutcomes = () => Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<FoldedRun['outcome'], number>;

export function workflowStats(runs: RunView[]): WorkflowStat[] {
  const by = new Map<string, WorkflowStat>();
  for (const r of runs) {
    const s = by.get(r.workflow) ?? {
      workflow: r.workflow, name: r.name, family: r.family, runs: 0, top: 0, outcomes: zeroOutcomes(), last: null, first: null,
      written: 0, selected: 0, checksPass: 0, checksAll: 0, tokens: { estimated: 0, measured: 0, runsWithUsage: 0 }, versions: [], agents: [],
    };
    s.runs += 1;
    if (!r.parentRunId) s.top += 1;
    s.outcomes[r.outcome] += 1;
    const t = r.startedAt ?? r.endedAt;
    if (t && (!s.last || t > s.last)) s.last = t;
    if (t && (!s.first || t < s.first)) s.first = t;
    s.written += r.counts?.written ?? 0;
    s.selected += r.counts?.selected ?? 0;
    s.checksPass += r.checks.pass;
    s.checksAll += r.checks.pass + r.checks.fail + r.checks.notRun;
    if (r.usage && r.usage.source !== 'unknown' && (r.usage.input || r.usage.output)) {
      s.tokens.runsWithUsage += 1;
      s.tokens[r.usage.source] += r.usage.input + r.usage.output;
    }
    const v = r.version ?? 'unversioned';
    let ver = s.versions.find((x) => x.version === v);
    if (!ver) { ver = { version: v, runs: 0, first: null, last: null, outcomes: zeroOutcomes() }; s.versions.push(ver); }
    ver.runs += 1;
    ver.outcomes[r.outcome] += 1;
    if (t && (!ver.first || t < ver.first)) ver.first = t;
    if (t && (!ver.last || t > ver.last)) ver.last = t;
    if (!s.agents.includes(r.agent)) s.agents.push(r.agent);
    by.set(r.workflow, s);
  }
  for (const s of by.values()) s.versions.sort((a, b) => (a.first?.getTime() ?? 0) - (b.first?.getTime() ?? 0));
  return [...by.values()].sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
}

export interface Bucket { start: Date; end: Date; outcomes: Record<FoldedRun['outcome'], number>; tokens: number }

/** Runs over time, in at most `max` buckets of 1, 3, 6 or 12 hours, or whole days. */
export function timeline(runs: RunView[], max = 42): { buckets: Bucket[]; hours: number } {
  const times = runs.map((r) => r.startedAt?.getTime()).filter((t): t is number => typeof t === 'number');
  if (!times.length) return { buckets: [], hours: 0 };
  const lo = Math.min(...times), hi = Math.max(...times);
  const hours = [1, 2, 3, 6, 12, 24, 48, 168].find((h) => (hi - lo) / (h * 3600e3) < max) ?? 168;
  const size = hours * 3600e3;
  // Local-day aligned for whole days; hour-aligned otherwise.
  const start = new Date(lo);
  if (hours >= 24) start.setHours(0, 0, 0, 0); else start.setMinutes(0, 0, 0);
  const s0 = start.getTime() - (hours < 24 ? (start.getHours() % hours) * 3600e3 : 0);
  const n = Math.floor((hi - s0) / size) + 1;
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => ({
    start: new Date(s0 + i * size), end: new Date(s0 + (i + 1) * size), outcomes: zeroOutcomes(), tokens: 0,
  }));
  for (const r of runs) {
    const t = r.startedAt?.getTime();
    if (t === undefined) continue;
    const b = buckets[Math.floor((t - s0) / size)];
    if (!b) continue;
    b.outcomes[r.outcome] += 1;
    if (r.usage && r.usage.source !== 'unknown') b.tokens += r.usage.input + r.usage.output;
  }
  return { buckets, hours };
}

/* ——— Iteration notes: enrich/log/<date>/*.md ——— */

export interface Note { date: string; file: string; title: string; runId: string | null; lede: string | null }
export const NOTE_DATE = /^\d{4}-\d\d-\d\d$/;
export const NOTE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

async function head(path: string, bytes = 3072): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/** The first heading, the run ID a note names, and its hypothesis or first sentence. */
export function noteSummary(text: string): { title: string | null; runId: string | null; lede: string | null } {
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const runId = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(text)?.[1] ?? null;
  const hyp = /^(?:\*\*)?(?:Hypothesis|Question|Goal|Aim)(?:\*\*)?:\s*(.+)$/im.exec(text)?.[1];
  const para = text.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !/^Run:|^Runs?\b.*`/.test(p));
  const raw = (hyp ?? para ?? '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  const sentence = /^(.{20,}?[.!?])(\s|$)/.exec(raw)?.[1] ?? raw;
  const lede = sentence ? (sentence.length > 240 ? `${sentence.slice(0, 237).trim()}…` : sentence) : null;
  return { title, runId, lede };
}

export async function listNotes(root: string | null, limit = 400): Promise<{ dates: Array<{ date: string; notes: Note[] }>; error: string | null }> {
  if (!root) return { dates: [], error: null };
  try {
    const dates = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && NOTE_DATE.test(d.name)).map((d) => d.name).sort().reverse();
    const out: Array<{ date: string; notes: Note[] }> = [];
    let total = 0;
    for (const date of dates) {
      const files = (await readdir(join(root, date), { withFileTypes: true }))
        .filter((f) => f.isFile() && NOTE_FILE.test(f.name)).map((f) => f.name)
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      const notes = await Promise.all(files.slice(0, Math.max(0, limit - total)).map(async (file) => {
        const s = noteSummary(await head(join(root, date, file)));
        return { date, file, title: s.title ?? file.replace(/\.md$/, ''), runId: s.runId, lede: s.lede };
      }));
      total += notes.length;
      if (notes.length) out.push({ date, notes });
      if (total >= limit) break;
    }
    return { dates: out, error: null };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { dates: [], error: null };
    return { dates: [], error: 'The iteration notes could not be read.' };
  }
}

/** One note's text, only by a validated date and file name inside the notes root. */
export async function readNote(root: string | null, date: string, file: string): Promise<string | null> {
  if (!root || !NOTE_DATE.test(date) || !NOTE_FILE.test(file)) return null;
  try {
    const path = join(root, date, file);
    const st = await stat(path);
    if (!st.isFile() || st.size > 512 * 1024) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export const fmtTokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n));

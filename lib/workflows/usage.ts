/** Local usage metadata only. Message content is skipped without decoding it. */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { finishRun, readRuns, type Context, type Finish, type FoldedRun, type Usage } from './ledger';

const keys = ['input', 'cachedInput', 'output', 'reasoning', 'cacheWrite'] as const;
type Tokens = Record<typeof keys[number], number>;
export type Estimate = Record<typeof keys[number], number | null> & {
  runId: string; source: 'measured' | 'estimated'; method: string; sessions: string[];
  diagnostics: string[];
};
export type Window = { runId: string; source: string; folders: string[]; start: number; end: number };
type Sample = { start: number; end: number; tokens: Tokens };
type Observation = { at: number; tokens: Tokens; message: string };
type Session = { id: string; source: string; folders: Set<string>; samples: Sample[];
  started: number; raw: Observation[]; diagnostics: Set<string> };
export type SessionRoots = { codex: string; claude: string };
const zero = (): Tokens => ({ input: 0, cachedInput: 0, output: 0, reasoning: 0, cacheWrite: 0 });
const METHOD = 'session-window-v2: cumulative deltas prorated by time; equal shares during concurrency; worker cwd+provider match';

// Allowlist paths, rather than JSON.parse(line): no prompt, instruction, message body,
// tool arguments or tool output is decoded, retained or printed.
const paths = [
  'type', 'timestamp', 'cwd', 'sessionId', 'requestId',
  'payload.type', 'payload.id', 'payload.session_id', 'payload.cwd', 'payload.timestamp',
  'payload.originator', 'payload.source', 'payload.source.subagent.thread_spawn.parent_thread_id',
  'payload.info.total_token_usage.input_tokens', 'payload.info.total_token_usage.cached_input_tokens',
  'payload.info.total_token_usage.cache_write_input_tokens', 'payload.info.total_token_usage.output_tokens',
  'payload.info.total_token_usage.reasoning_output_tokens',
  'message.id', 'message.usage.input_tokens', 'message.usage.output_tokens',
  'message.usage.cache_read_input_tokens', 'message.usage.cache_creation_input_tokens',
  'message.usage.output_tokens_details.reasoning_tokens',
];
const selected = new Set(paths), parents = new Set(paths.flatMap(p => p.split('.').slice(0, -1).map((_, i) => p.split('.').slice(0, i + 1).join('.'))));
export function usageFields(text: string): Record<string, unknown> {
  let i = 0;
  const out: Record<string, unknown> = {};
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const quoted = () => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') i++;
      else if (c === '"') return text.slice(start, i);
    }
    throw new Error('Invalid session JSON.');
  };
  // Skip containers with an iterative scanner; strings inside are never decoded.
  const skip = () => {
    if (text[i] === '"') { quoted(); return; }
    if (text[i] === '{' || text[i] === '[') {
      let depth = 0;
      do {
        const c = text[i];
        if (c === '"') quoted();
        else { i++; if (c === '{' || c === '[') depth++; if (c === '}' || c === ']') depth--; }
      } while (depth && i < text.length);
      if (depth) throw new Error('Invalid session JSON.');
    } else while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
  };
  const object = (prefix: string) => {
    if (text[i++] !== '{') throw new Error('Invalid session JSON.');
    space();
    if (text[i] === '}') { i++; return; }
    while (i < text.length) {
      if (text[i] !== '"') throw new Error('Invalid session JSON.');
      const key = JSON.parse(quoted()) as string, path = prefix ? `${prefix}.${key}` : key;
      space();
      if (text[i++] !== ':') throw new Error('Invalid session JSON.');
      space();
      if (parents.has(path) && text[i] === '{') object(path);
      else {
        const start = i;
        skip();
        if (selected.has(path) && !['{', '['].includes(text[start])) out[path] = JSON.parse(text.slice(start, i));
      }
      space();
      if (text[i] === '}') { i++; return; }
      if (text[i++] !== ',') throw new Error('Invalid session JSON.');
      space();
    }
    throw new Error('Invalid session JSON.');
  };
  space(); object(''); space();
  if (i !== text.length) throw new Error('Invalid session JSON.');
  return out;
}
const num = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
const time = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN;

async function files(root: string, since: number): Promise<string[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error('Cannot read session directory.'); }
  const result: string[] = [];
  for (const e of entries) {
    const path = join(root, e.name);
    if (e.isDirectory()) result.push(...await files(path, since));
    else if (e.isFile() && e.name.endsWith('.jsonl') && (await stat(path)).mtimeMs >= since) result.push(path);
  }
  return result.sort();
}

/** Read a bounded snapshot: an active writer need not close its log before finish. */
async function* snapshotLines(file: string): AsyncGenerator<{ text: string; tail: boolean }> {
  const size = (await stat(file)).size;
  if (!size) return;
  const stream = createReadStream(file, { encoding: 'utf8', start: 0, end: size - 1 });
  let pending = '';
  try {
    for await (const chunk of stream) {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        yield { text: pending.slice(0, end), tail: false };
        pending = pending.slice(end + 1);
      }
    }
    if (pending.trim()) yield { text: pending, tail: true };
  } finally { stream.destroy(); }
}

async function readSessions(roots: SessionRoots, windows: Window[]): Promise<{ sessions: Session[]; diagnostics: string[] }> {
  const sessions = new Map<string, Session>(), diagnostics = new Set<string>();
  const since = Math.min(...windows.map(w => w.start)), until = Math.max(...windows.map(w => w.end));
  for (const source of ['chatgpt', 'claude-code'].filter(source => windows.some(w => w.source === source))) {
    const root = source === 'chatgpt' ? roots.codex : roots.claude;
    let paths: string[];
    try { paths = await files(root, since); }
    catch { diagnostics.add('session directory unreadable'); continue; }
    for (const file of paths) {
      const raw: Observation[] = [], warnings = new Set<string>();
      let id = '', cwd = '', started = NaN;
      try {
        for await (const line of snapshotLines(file)) {
          if (!line.text.trim()) continue;
          let f: Record<string, unknown>;
          try { f = usageFields(line.text); }
          catch {
            warnings.add(line.tail ? 'incomplete final record ignored' : 'malformed records skipped');
            continue; // Never let an unrelated corrupt file discard healthy counters.
          }
          // Forked exec logs replay parent metadata after their own header. The
          // first header owns this file; later inherited headers cannot replace it.
          if (source === 'chatgpt' && f.type === 'session_meta' && !id) {
            id = String(f['payload.id'] ?? f['payload.session_id'] ?? '');
            cwd = String(f['payload.cwd'] ?? '');
            started = time(f['payload.timestamp'] ?? f.timestamp);
            // Headless children can inherit the parent's id AND creation timestamp.
            // Their rollout filename identifies the independent counter stream.
            if (f['payload.source.subagent.thread_spawn.parent_thread_id']) {
              const child = basename(file).match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1];
              id = child ?? basename(file, '.jsonl');
              started = time(f.timestamp);
            }
          }
          if (source === 'claude-code') {
            id = String(f.sessionId ?? id);
            cwd = String(f.cwd ?? cwd);
          }
          const at = time(f.timestamp);
          if (!Number.isFinite(at) || (source === 'claude-code' && at > until)) continue;
          if (source === 'chatgpt' && f['payload.type'] === 'token_count' && typeof f['payload.info.total_token_usage.input_tokens'] === 'number') {
            const p = 'payload.info.total_token_usage.';
            raw.push({ at, message: '', tokens: { input: num(f[p + 'input_tokens']), cachedInput: num(f[p + 'cached_input_tokens']),
              output: num(f[p + 'output_tokens']), reasoning: num(f[p + 'reasoning_output_tokens']), cacheWrite: num(f[p + 'cache_write_input_tokens']) } });
          } else if (source === 'claude-code' && f.type === 'assistant' && typeof f['message.usage.input_tokens'] === 'number') {
            const p = 'message.usage.';
            const cachedInput = num(f[p + 'cache_read_input_tokens']), cacheWrite = num(f[p + 'cache_creation_input_tokens']);
            raw.push({ at, message: String(f['message.id'] ?? f.requestId ?? at), tokens: {
              input: num(f[p + 'input_tokens']) + cachedInput + cacheWrite, cachedInput, cacheWrite,
              output: num(f[p + 'output_tokens']), reasoning: num(f[p + 'output_tokens_details.reasoning_tokens']),
            } });
          }
        }
      } catch { warnings.add('session file unreadable; observed counters only'); }
      for (const warning of warnings) diagnostics.add(warning);
      if (!id || !cwd) continue;
      const key = `${source}:${id}${source === 'claude-code' ? ':' + basename(file, '.jsonl') : ''}`;
      const session = sessions.get(key) ?? { id: key, source, folders: new Set<string>(), samples: [],
        started, raw: [], diagnostics: new Set<string>() };
      session.folders.add(resolve(cwd));
      session.raw.push(...raw);
      for (const warning of warnings) session.diagnostics.add(warning);
      sessions.set(key, session);
    }
  }
  for (const session of sessions.values()) {
    // Merge resumed copies BEFORE differencing: partial copies otherwise double count.
    const raw = [...new Map(session.raw.map(r => [JSON.stringify(r), r])).values()].sort((a, b) => a.at - b.at);
    if (session.source === 'chatgpt') {
      let prior = zero(), previousAt = Number.isFinite(session.started) ? session.started : raw[0]?.at;
      for (const r of raw) {
        const delta = zero();
        const reset = r.tokens.input < prior.input || r.tokens.output < prior.output;
        for (const k of keys) delta[k] = Math.max(0, r.tokens[k] - (reset ? 0 : prior[k]));
        // Zero is observed usage, distinct from missing token reports.
        session.samples.push({ start: Math.min(previousAt, r.at), end: r.at, tokens: delta });
        previousAt = r.at;
        prior = r.tokens;
      }
    } else {
      const messages = new Map<string, Observation>();
      for (const r of raw) {
        const prev = messages.get(r.message);
        if (prev) for (const k of keys) r.tokens[k] = Math.max(r.tokens[k], prev.tokens[k]);
        messages.set(r.message, r);
      }
      for (const r of messages.values()) session.samples.push({ start: r.at, end: r.at, tokens: r.tokens });
    }
  }
  return { sessions: [...sessions.values()], diagnostics: [...diagnostics].sort() };
}

export function runWindows(runs: FoldedRun[], now?: string): Window[] {
  return runs.flatMap(r => {
    const end = r.finish?.endedAt ?? now;
    if (r.conflict || !r.start?.startedAt || !end) return [];
    return [{ runId: r.runId, source: r.start.source, folders: [resolve(r.start.workerFolder)],
      start: Date.parse(r.start.startedAt), end: Date.parse(end) }];
  });
}

export async function estimateUsage(windows: Window[], roots: SessionRoots = {
  codex: join(homedir(), '.codex/sessions'), claude: join(homedir(), '.claude/projects'),
}): Promise<Estimate[]> {
  const totals = new Map(windows.map(w => [w.runId, { ...zero(), sessions: new Set<string>(), exact: true,
    diagnostics: new Set<string>() }]));
  const scan = windows.length ? await readSessions(roots, windows) : { sessions: [], diagnostics: [] };
  for (const s of scan.sessions) {
    const candidates = windows.filter(w => w.source === s.source && w.folders.some(f => s.folders.has(f)));
    const lastReportedAt = s.raw.reduce((last, r) => Math.max(last, r.at), -Infinity);
    const seen = new Set<string>();
    for (const sample of s.samples) {
      const signature = JSON.stringify(sample);
      if (seen.has(signature)) continue; // resumed copies of a session
      seen.add(signature);
      const point = sample.start === sample.end;
      const overlapping = candidates.filter(w => point ? w.start <= sample.end && sample.end < w.end : w.start < sample.end && sample.start < w.end);
      const cuts = point ? [sample.end, sample.end] : [...new Set([sample.start, sample.end,
        ...overlapping.flatMap(w => [Math.max(sample.start, w.start), Math.min(sample.end, w.end)])])].sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        const a = cuts[i - 1], b = cuts[i];
        const active = overlapping.filter(w => w.start <= a && (point ? w.end > a : w.end >= b));
        const share = (point ? 1 : (b - a) / (sample.end - sample.start)) / active.length;
        for (const w of active) {
          const t = totals.get(w.runId)!;
          for (const k of keys) t[k] += sample.tokens[k] * share;
          t.sessions.add(s.id);
          if ((share !== 1 && keys.some(k => sample.tokens[k] > 0)) || s.diagnostics.size || s.source !== 'chatgpt') t.exact = false;
          for (const warning of s.diagnostics) t.diagnostics.add(warning);
          if (s.source === 'chatgpt' && lastReportedAt < w.end) {
            t.exact = false; t.diagnostics.add('snapshot ends before run finish; in-flight usage may not yet be reported');
          }
        }
      }
    }
  }
  return windows.map(w => {
    const t = totals.get(w.runId)!;
    const measured = t.sessions.size === 1 && t.exact;
    return { runId: w.runId, source: measured ? 'measured' : 'estimated',
      method: t.sessions.size ? (measured ? 'session-counters-v2: complete unshared counter intervals; worker cwd+provider match' : METHOD)
        : 'unavailable: no readable matching session usage in window',
      diagnostics: t.sessions.size ? [...t.diagnostics].sort() : scan.diagnostics,
      sessions: [...t.sessions].sort(), ...Object.fromEntries(keys.map(k => [k, t.sessions.size ? t[k] : null])) } as Estimate;
  });
}

/** Snapshot the end once so estimation and the durable finish describe exactly one window. */
export async function finishWithUsage(runId: string, result: Omit<Finish, 'usage'> & { usage?: Usage | null }, context: Context = {}, roots?: SessionRoots) {
  const ledger = await readRuns(context), run = ledger.runs.find(r => r.runId === runId);
  if (ledger.issues.length || !run?.start || run.conflict) throw new Error('No unambiguous start; inspect the ledger before finishing.');
  const endedAt = run.finish?.endedAt ?? new Date().toISOString();
  let usage = result.usage;
  if (!usage) {
    // Reuse the recorded estimate on retries; later sessions must not change it.
    usage = run.finish?.usage;
    if (!usage) {
      const estimate = (await estimateUsage(runWindows(ledger.runs, endedAt), roots)).find(e => e.runId === runId);
      if (!estimate) throw new Error('Cannot estimate usage without a run window.');
      usage = { input: estimate.input, output: estimate.output, cacheRead: estimate.cachedInput, cacheWrite: estimate.cacheWrite,
        reasoning: estimate.reasoning, cost: null, source: estimate.source,
        method: [estimate.method, ...estimate.diagnostics].join('; '), sessionCount: estimate.sessions.length, sessions: estimate.sessions };
    }
  } else usage = { ...usage, source: usage.source ?? 'measured' };
  await finishRun(runId, { ...result, usage: { ...usage, source: usage.source ?? 'measured' } }, { ...context, endedAt });
}

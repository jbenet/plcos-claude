/** Local usage metadata only. Message content is skipped without decoding it. */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { finishRun, readRuns, type Context, type Finish, type FoldedRun, type Usage } from './ledger';

const keys = ['input', 'cachedInput', 'output', 'reasoning', 'cacheWrite'] as const;
type Tokens = Record<typeof keys[number], number>;
export type Estimate = Record<typeof keys[number], number | null> & {
  runId: string; source: 'estimated'; method: string; sessions: string[];
};
export type Window = { runId: string; source: string; folders: string[]; start: number; end: number };
type Sample = { start: number; end: number; tokens: Tokens };
type Session = { id: string; source: string; folders: Set<string>; samples: Sample[] };
export type SessionRoots = { codex: string; claude: string };
const zero = (): Tokens => ({ input: 0, cachedInput: 0, output: 0, reasoning: 0, cacheWrite: 0 });
const METHOD = 'session-window-v1: cumulative deltas prorated by time; equal shares during concurrency; cwd+provider match';

// Allowlist paths, rather than JSON.parse(line): no prompt, instruction, message body,
// tool arguments or tool output is decoded, retained or printed.
const paths = [
  'type', 'timestamp', 'cwd', 'sessionId', 'requestId',
  'payload.type', 'payload.id', 'payload.session_id', 'payload.cwd', 'payload.timestamp',
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
        if (selected.has(path)) out[path] = JSON.parse(text.slice(start, i));
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

async function readSessions(roots: SessionRoots, since: number, until: number): Promise<Session[]> {
  const sessions = new Map<string, Session>();
  for (const source of ['chatgpt', 'claude-code']) {
    const root = source === 'chatgpt' ? roots.codex : roots.claude;
    for (const file of await files(root, since)) {
      // Codex date folders describe the session start, so retain earlier (resumed) files.
      const raw: Array<{ at: number; tokens: Tokens; message: string }> = [];
      let id = '', cwd = '', started = NaN;
      const stream = createReadStream(file, { encoding: 'utf8' });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          let f: Record<string, unknown>;
          try { f = usageFields(line); }
          catch { throw new Error('Malformed session JSON; usage estimate refused (no content displayed).'); }
          if (source === 'chatgpt' && f.type === 'session_meta') {
            id = String(f['payload.id'] ?? f['payload.session_id'] ?? '');
            cwd = String(f['payload.cwd'] ?? '');
            started = time(f['payload.timestamp'] ?? f.timestamp);
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
              // Normalize to Codex semantics: input includes cache reads and writes.
              input: num(f[p + 'input_tokens']) + cachedInput + cacheWrite, cachedInput, cacheWrite,
              output: num(f[p + 'output_tokens']), reasoning: num(f[p + 'output_tokens_details.reasoning_tokens']),
            } });
          }
        }
      } finally { lines.close(); stream.destroy(); }
      if (!id || !cwd || !raw.length) continue;
      // Claude subagents share the parent's sessionId, but have independent usage streams.
      const key = `${source}:${id}${source === 'claude-code' ? ':' + basename(file, '.jsonl') : ''}`;
      const session = sessions.get(key) ?? { id: key, source, folders: new Set<string>(), samples: [] };
      session.folders.add(resolve(cwd));
      raw.sort((a, b) => a.at - b.at);
      if (source === 'chatgpt') {
        let prior = zero(), previousAt = Number.isFinite(started) ? started : raw[0].at;
        for (const r of raw) {
          const delta = zero();
          // A counter reset begins a new accounting segment, never negative usage.
          const reset = r.tokens.input < prior.input || r.tokens.output < prior.output;
          for (const k of keys) delta[k] = Math.max(0, r.tokens[k] - (reset ? 0 : prior[k]));
          if (keys.some(k => delta[k] > 0)) {
            session.samples.push({ start: Math.min(previousAt, r.at), end: r.at, tokens: delta });
          }
          // Even an unchanged report confirms no new usage through this timestamp.
          previousAt = r.at;
          prior = r.tokens;
        }
      } else {
        // Streaming/repeated assistant records can repeat a message's usage. Take the
        // maximum reported counters once, at the last update for that message.
        const messages = new Map<string, typeof raw[number]>();
        for (const r of raw) {
          const prev = messages.get(r.message);
          if (prev) for (const k of keys) r.tokens[k] = Math.max(r.tokens[k], prev.tokens[k]);
          messages.set(r.message, r);
        }
        for (const r of messages.values()) session.samples.push({ start: r.at, end: r.at, tokens: r.tokens });
      }
      sessions.set(key, session);
    }
  }
  return [...sessions.values()];
}

export function runWindows(runs: FoldedRun[], now?: string): Window[] {
  return runs.flatMap(r => {
    const end = r.finish?.endedAt ?? now;
    if (r.conflict || !r.start?.startedAt || !end) return [];
    return [{ runId: r.runId, source: r.start.source, folders: [r.start.workerFolder, r.start.launchFolder].map(f => resolve(f)),
      start: Date.parse(r.start.startedAt), end: Date.parse(end) }];
  });
}

export async function estimateUsage(windows: Window[], roots: SessionRoots = {
  codex: join(homedir(), '.codex/sessions'), claude: join(homedir(), '.claude/projects'),
}): Promise<Estimate[]> {
  const totals = new Map(windows.map(w => [w.runId, { ...zero(), sessions: new Set<string>() }]));
  if (windows.length) for (const s of await readSessions(roots, Math.min(...windows.map(w => w.start)), Math.max(...windows.map(w => w.end)))) {
    const candidates = windows.filter(w => w.source === s.source && w.folders.some(f => s.folders.has(f)));
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
        }
      }
    }
  }
  return windows.map(w => {
    const t = totals.get(w.runId)!;
    return { runId: w.runId, source: 'estimated', method: t.sessions.size ? METHOD : 'unavailable: no matching session usage in window',
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
        reasoning: estimate.reasoning, cost: null, source: 'estimated', method: estimate.method, sessionCount: estimate.sessions.length };
    }
  } else usage = { ...usage, source: usage.source ?? 'measured' };
  await finishRun(runId, { ...result, usage: { ...usage, source: usage.source ?? 'measured' } }, { ...context, endedAt });
}

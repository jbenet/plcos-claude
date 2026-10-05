import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { config } from '@/config/deployment';
import { BLOCKED_DOMAINS, check } from '@/lib/enrich/schema';
import { checkStrategy } from '@/lib/enrich/strategy';
import { factReviewProblems } from '@/lib/enrich/fact-review';
import { beginRun, finishRun, type Usage } from './ledger';
import { anthropicKey } from './key';

const MAX_TURNS = 8; // GUESS: bounded server-tool continuations per batch.
const MAX_TOKENS = 32000; // GUESS: total generated tokens per batch, across continuations.
const protocols = { w1: 'w1-profile', w1c: 'w1c-fact-check', w5: 'w5-strategy' } as const;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** One human-started job. The provider can research, but cannot read or write local files. */
export async function runWorkflow(input: Record<string, unknown>, root: string = config.data.root): Promise<Record<string, unknown>> {
  const key = anthropicKey();
  if (!key) throw new Error('Workflow refused: no Anthropic key (Settings → Connections, or ANTHROPIC_API_KEY).');
  const protocol = input.protocol as keyof typeof protocols;
  if (!Object.hasOwn(protocols, protocol) || typeof input.batch !== 'string') throw new Error('Expected protocol w1, w1c or w5 and a batch path.');
  const dir = await realpath(join(root, 'enrich')), batches = await realpath(join(dir, 'batches'));
  const batch = await realpath(resolve(input.batch));
  if (!batches.startsWith(dir + sep) || !batch.startsWith(batches + sep)) throw new Error('Batch must be under enrich/batches.');
  const text = await readFile(batch, 'utf8');
  const rows = text.split('\n').filter(s => s.trim()).map(s => { try { return JSON.parse(s); } catch { return { key: s.trim() }; } });
  const keys: string[] = rows.map(r => r.key);
  if (!keys.length || keys.some(k => typeof k !== 'string' || !/^[\w-]+$/.test(k))) throw new Error('Batch needs keyed JSONL rows or one key per line.');
  const attached: Record<string, unknown> = {};
  // Frozen local inputs accompany key-only batches; no model-selected local paths.
  for (const k of keys) for (const folder of protocol === 'w5' ? ['raw', 'strategy'] : ['raw']) {
    const file = join(dir, folder, `${k}.json`);
    try { if (!(await realpath(file)).startsWith(dir + sep)) throw new Error('Input escapes enrich.'); attached[`${folder}/${k}.json`] = JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || protocol === 'w1c') throw e; }
  }
  for (const file of protocol === 'w5' ? ['candidates.jsonl', 'connections.jsonl', 'triage.jsonl', 'us/team.json', 'us/voice.json', 'us/network.json', 'presence/site.json'] : ['us/network.json']) {
    try {
      if (!(await realpath(join(dir, file))).startsWith(dir + sep)) throw new Error('Input escapes enrich.');
      const value = await readFile(join(dir, file), 'utf8');
      attached[file] = file.endsWith('.jsonl') ? value.split('\n').filter(Boolean).map(s => JSON.parse(s)).filter(r => keys.includes(r.key)) : JSON.parse(value);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const doc = await readFile(`docs/workflows/${protocols[protocol]}.md`, 'utf8');
  const rules = await readFile('docs/agent-rules/real-data.md', 'utf8') + (protocol === 'w5'
    ? await readFile('docs/agent-rules/domain.md', 'utf8') + await readFile('lib/enrich/capacity.ts', 'utf8') + await readFile('docs/email-guidelines.md', 'utf8')
    : protocol === 'w1c' ? (await readFile('docs/workflows/w1-profile.md', 'utf8')).split('## Facts')[1]!.split('## Capacity')[0] : '');
  const schema = await readFile(protocol === 'w5' ? 'lib/enrich/strategy.ts' : 'lib/enrich/schema.ts', 'utf8');
  const review = `fact-review-${Date.now()}.jsonl`;
  const system = `${doc}\n\nAPI execution: local files below are supplied as inputs; no filesystem tools exist. Emit no text until the final answer. Return only JSON {"files":[{"path":"raw/<key>.json","content":{...}}]}. Paths are relative to enrich. Use strategy/<key>.json or strategy/<vehicle-slug>/<key>.json for W5. For W1c return corrected findings and ${review} with content an array of review rows. Do not execute local commands; the host records the run and validates output. If evidence is missing, preserve uncertainty.\nSchema and validation rules:\n${schema}\n${rules}\nCapacity rules: ${JSON.stringify(config.capacity)}`;
  const user = `${text}\n\nLocal inputs:\n${JSON.stringify(attached)}`;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5', context = { root };
  const run = await beginRun({ parentRunId: null, workflow: protocol === 'w1c' ? 'W1c' : protocol.toUpperCase(), operation: 'api',
    protocol: { version: null, hash: hash(system) }, source: 'app', agent: 'Anthropic Messages API', model,
    launchFolder: process.cwd(), workerFolder: process.cwd(), batch: { id: basename(batch), manifest: `enrich/batches/${basename(batch)}`, hash: hash(user), planned: keys.length } }, context);
  const usage: Usage & { source: 'measured' } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured' };
  const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: user }];
  let output = '', written = 0, valid = false;
  try {
    for (let turn = 0; turn < MAX_TURNS && usage.output! < MAX_TOKENS; turn++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, system, messages, max_tokens: MAX_TOKENS - usage.output!,
          ...(protocol === 'w5' ? {} : { tools: [
            { type: 'web_search_20250305', name: 'web_search', blocked_domains: [...BLOCKED_DOMAINS, 'linkedin.com'] },
            { type: 'web_fetch_20250910', name: 'web_fetch', blocked_domains: [...BLOCKED_DOMAINS, 'linkedin.com'] },
          ] }) }) });
      if (!response.ok) throw new Error(`Anthropic request failed (${response.status}).`);
      const result = await response.json();
      const u = result.usage;
      usage.input! += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.output! += u.output_tokens; usage.cacheRead! += u.cache_read_input_tokens ?? 0; usage.cacheWrite! += u.cache_creation_input_tokens ?? 0;
      output += result.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
      if (result.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: result.content }); continue; }
      if (result.stop_reason !== 'end_turn') throw new Error('Workflow stopped before completing its output.');
      const files = JSON.parse(output).files as Array<{ path: string; content: unknown }>;
      if (!Array.isArray(files) || !files.length) throw new Error('No output files.');
      // Validate every file before publishing any; rejects never enter the import directories.
      for (const f of files) {
        const match = /^(raw|strategy)\/(?:([\w-]+)\/)?([\w-]+)\.json$/.exec(f.path);
        if (protocol === 'w1c' && f.path === review) {
          if (!Array.isArray(f.content) || f.content.length !== keys.length || new Set(f.content.map(r => r.key)).size !== keys.length) throw new Error('Incomplete fact review.');
          for (const r of f.content) {
            if (!keys.includes(r?.key) || factReviewProblems(r, attached[`raw/${r.key}.json`] as { facts: unknown[] }).length) throw new Error('Invalid fact review.');
          }
          continue;
        }
        if (!match || !keys.includes(match[3]!) || match[1] !== (protocol === 'w5' ? 'strategy' : 'raw') || (match[1] === 'raw' && match[2])) throw new Error('Output path outside this batch.');
        if ((protocol === 'w5' ? checkStrategy : check)(f.content, match[3]).length) throw new Error('Output failed the importer validator.');
        if (match[2] && (f.content as { ask: { vehicle: string } }).ask.vehicle !== match[2]) throw new Error('Strategy vehicle mismatch.');
      }
      if (keys.some(k => !files.some(f => f.path.endsWith(`/${k}.json`))) || (protocol === 'w1c' && !files.some(f => f.path === review))) throw new Error('Incomplete batch output.');
      if (new Set(files.map(f => f.path)).size !== files.length) throw new Error('Duplicate output paths.');
      for (const f of files) {
        const path = join(dir, f.path);
        await mkdir(dirname(path), { recursive: true });
        if (!(await realpath(dirname(path))).startsWith(dir + sep) && dirname(path) !== dir) throw new Error('Output directory escapes enrich.');
        // Atomic replacement also refuses following a pre-existing file symlink.
        const temporary = `${path}.${run}.tmp`;
        await writeFile(temporary, f.path === review ? (f.content as unknown[]).map(r => JSON.stringify(r)).join('\n') + '\n' : JSON.stringify(f.content, null, 2), { flag: 'wx' });
        await rename(temporary, path);
        written++;
      }
      valid = true;
      return { runId: run, written, message: 'Validated files ready for the existing import buttons.' };
    }
    throw new Error('Workflow reached its turn or token limit.');
  } catch {
    await mkdir(join(dir, 'rejects'), { recursive: true });
    if (!(await realpath(join(dir, 'rejects'))).startsWith(dir + sep)) throw new Error('Rejects directory escapes enrich.');
    await writeFile(join(dir, 'rejects', `${run}.txt`), output, { flag: 'wx' });
    throw new Error('Workflow failed; output saved in enrich/rejects. Nothing invalid was imported.');
  } finally {
    await finishRun(run, { counts: { selected: keys.length, written, valid: valid ? written : 0, failed: valid ? 0 : 1, skipped: null },
      checks: [{ name: 'importer validation', status: valid ? 'pass' : 'fail' }], usage, outcome: valid ? 'succeeded' : 'failed', reason: valid ? null : 'API, output validation or execution limit failed; inspect rejects.' }, context);
  }
}

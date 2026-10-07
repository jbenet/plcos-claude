import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { BLOCKED_DOMAINS, check, type Finding } from '@/lib/enrich/schema';
import { createEnvelope, EnvelopeViolation } from '@/modules/agents';
import { appendAudit } from '@/modules/platform';
import { PageReader, quoteOnPage, type CitedPage, type PageDeps } from './cited-pages';
import { anthropicKey, cloudWorkflowsOn } from './key';
import { beginRun, finishRun, type Usage } from './ledger';
import { WorkflowRefusal } from './refusal';

/**
 * W1, profile an LP from public pages, run by the app itself (docs/28-cloud-workflows.md §6.3). An import
 * job of kind `workflow` with `protocol: 'w1-cloud'`, behind Cloud workflows like the fact check.
 *
 * What the model is given about an LP is cut to what a search may carry (docs/agent-rules/real-data.md): the
 * batch row's name, organization, title, location and work domains, and the links Affinity holds. Never a
 * status, an amount, a note or a list name, because the batch row's other fields are dropped before the
 * prompt is built. Two tools:
 *
 * - `web_search`, Anthropic's, with brokers and LinkedIn blocked. Its queries run on Anthropic's side, so the
 *   server checks each one as it comes back: one naming a vehicle of ours, an amount or the pipeline stops
 *   that LP's research and fails its finding (input minimisation is the prevention; this is the alarm).
 * - `fetch_page`, the server's own (lib/workflows/cited-pages.ts): public addresses only, LinkedIn never,
 *   brokers never, SEC paced and addressed as the rules say, no identity of ours in a request.
 *
 * The finding that comes back is held to W1 mechanically before it is written: the server writes
 * `researched` and `queries` from what actually ran; a fact whose page was not read in this run, or whose
 * quote is not on its page, moves to `profile.cautions` as unconfirmed; the importer's validator (`check`)
 * decides the rest. A finding on file is kept under enrich/inbox/<run>/replaced/ before it is replaced.
 */

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const KEY = /^[\w:-]+$/; // an LP key; a prospect-made one may carry ":" (cloud-sourced:<name>--<org>)
export const W1_COMMANDS = ['web-search', 'fetch-page', 'anthropic-messages'] as const;
const BATCH_FIELDS = ['key', 'name', 'type', 'org', 'role', 'location', 'domains'] as const;
const ENRICHED_FIELDS = ['title', 'location', 'links'] as const;

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string };
export interface ToolResponse { stop_reason: string; content: Block[]; usage: Record<string, number | undefined> }
export type CallTools = (key: string, body: Record<string, unknown>) => Promise<ToolResponse>;
export interface W1Deps { pages?: PageDeps; callModel?: CallTools; enabled?: boolean; key?: string | null; now?: () => number }

export async function anthropicWithTools(key: string, body: Record<string, unknown>): Promise<ToolResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(300_000),
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Anthropic request failed (${response.status}).`);
  return await response.json() as ToolResponse;
}

/** Only what a search may carry about an LP: the rest of the batch row never reaches the prompt. */
export function minimalRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BATCH_FIELDS) if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
  const e = row.enriched as Record<string, unknown> | undefined;
  if (e && typeof e === 'object') {
    const kept: Record<string, unknown> = {};
    for (const k of ENRICHED_FIELDS) if (e[k] !== undefined && e[k] !== null) kept[k] = e[k];
    if (Object.keys(kept).length) out.enriched = kept;
  }
  return out;
}

/** Why a query the model ran breaks the search rules, or null. `ours` are our vehicles' names and slugs. */
export function queryRefusal(q: string, ours: string[]): string | null {
  const t = q.toLowerCase();
  if (/[$€£]\s?\d|\b\d+(\.\d+)?\s?(m|mm|k|million|billion|bn)\b/.test(t)) return 'carries an amount';
  if (/\b(pipeline|prospect|our lp|lp list|capital os|plc raise|commitment to plc|soft circle)\b/.test(t)) return 'names our pipeline';
  for (const v of ours) if (v.length > 3 && t.includes(v.toLowerCase())) return 'names a vehicle of ours';
  return null;
}

export const urlKey = (u: string) => { try { const x = new URL(u); x.hash = ''; return x.toString().replace(/\/$/, ''); } catch { return u; } };

export async function w1SystemPrompt(cwd = process.cwd()): Promise<{ text: string; version: string }> {
  const w1 = await readFile(join(cwd, 'docs/workflows/w1-profile.md'), 'utf8');
  const schema = await readFile(join(cwd, 'lib/enrich/schema.ts'), 'utf8');
  const version = /version: "(\d+\.\d+)"/.exec(w1)?.[1];
  if (!version) throw new Error('The W1 protocol has no version line; nothing was run.');
  const text = [
    'You research one LP from public pages under W1, the protocol below, and write their finding.',
    'Tools: web_search, and fetch_page to read a page. A fact may cite only a page you read with fetch_page in this conversation; the host checks this and moves any other to cautions.',
    'Ignore the protocol\'s file, git, checker and sub-agent steps: the host records the run, writes the file and runs the checks. Do not set researched or queries; the host writes them from what ran.',
    'A query carries only the LP\'s name, organization, title, location and topic words. Never an amount, never the name of any fund or vehicle you were not told is theirs, never words about a pipeline or a list.',
    'When done, answer with JSON only, no prose and no code fence: {"finding": <the Finding>}.',
    '', w1.trim(), '', 'lib/enrich/schema.ts:', schema,
  ].join('\n');
  return { text, version };
}

export interface W1Result { runId: string; lps: number; written: number; failed: number; skipped: number; replaced: number; demotedFacts: number;
  searches: number; fetches: number; queryRefusals: number; outcome: string; reason: string | null }

export async function runCloudProfile(input: Record<string, unknown>, actor: string, root: string = config.data.root, deps: W1Deps = {}): Promise<W1Result> {
  const c = config.cloudWorkflows.w1, now = deps.now ?? Date.now;
  if (!(deps.enabled ?? cloudWorkflowsOn())) throw new WorkflowRefusal('Cloud workflows are off. An Admin turns them on in Settings → Connections; nothing was run.');
  const key = deps.key !== undefined ? deps.key : anthropicKey();
  if (!key) throw new WorkflowRefusal('Workflow refused: no Anthropic key (Settings → Connections, or ANTHROPIC_API_KEY).');
  if (typeof input.batch !== 'string' || !input.batch.trim()) throw new WorkflowRefusal('Give a batch file under enrich/batches.');
  const dir = await realpath(join(root, 'enrich')), batches = await realpath(join(dir, 'batches'));
  let batch: string;
  try { batch = await realpath(resolve(dir, 'batches', input.batch.trim())); } catch { throw new WorkflowRefusal('The batch file is not on the server.'); }
  if (!batches.startsWith(dir + sep) || !batch.startsWith(batches + sep)) throw new WorkflowRefusal('Batch must be under enrich/batches.');
  const batchText = await readFile(batch, 'utf8');
  let rows: Array<Record<string, unknown>>;
  try { rows = batchText.split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s) as Record<string, unknown>); }
  catch { throw new WorkflowRefusal('A W1 batch is JSONL, one LP a line with key and name.'); }
  if (!rows.length || rows.some((r) => typeof r.key !== 'string' || !KEY.test(r.key) || typeof r.name !== 'string' || !r.name.trim())) throw new WorkflowRefusal('Every batch line needs a key and a name.');
  if (new Set(rows.map((r) => r.key)).size !== rows.length) throw new WorkflowRefusal('A key appears twice in the batch.');
  if (rows.length > c.maxLps) throw new WorkflowRefusal(`The batch has ${rows.length} LPs; a cloud run takes at most ${c.maxLps}. Cut it in parts.`);

  const onFile = new Map<string, Finding>();
  for (const r of rows) {
    const file = join(dir, 'raw', `${r.key}.json`);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text !== null) {
      if (!(await realpath(file)).startsWith(dir + sep)) throw new WorkflowRefusal('A finding escapes enrich.');
      onFile.set(r.key as string, JSON.parse(text) as Finding);
    }
  }
  const network = await readFile(join(dir, 'us', 'network.json'), 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
  const { text: system, version } = await w1SystemPrompt();
  const db = await getDb();
  const ours = (await db.query<{ name: string; slug: string }>('select name, slug from platform.vehicle')).flatMap((v) => [v.name, v.slug.replace(/-/g, ' ')]);
  const inputHash = sha(batchText + '\n' + JSON.stringify([...onFile.entries()]) + '\n' + JSON.stringify(network));
  const configHash = sha(JSON.stringify(config.cloudWorkflows));
  const deadline = new Date(now() + c.maxSeconds * 1000);

  let envelopeId: string;
  try {
    envelopeId = await createEnvelope(actor, {
      task: `W1 profiles in the cloud: research ${rows.length} LPs from public pages`,
      scope: 'enrich/raw for the batch\'s keys (written; a finding on file kept under enrich/inbox first)',
      allowedEvidence: ['public web pages read by fetch_page (server-checked)', 'web search results'], allowedCommands: [...W1_COMMANDS],
      budget: { tokens: c.maxTokens, seconds: c.maxSeconds }, deadline,
      outputSchema: 'Finding, lib/enrich/schema.ts', escalationOwnerId: actor,
      acceptanceCriteria: ['passes check()', 'every fact cites a page read in this run', 'quotes on their pages', 'no query names an amount, a vehicle or the pipeline'],
    });
  } catch (e) {
    if (e instanceof EnvelopeViolation) throw new WorkflowRefusal(`Refused by the agent rules: ${e.message}`);
    throw e;
  }
  const agentRun = (await db.query<{ run_id: string }>(
    `insert into agents.run (envelope_id, status, config_hash, config_snapshot, input_hash, prompt_hash, agent_kind, rationale)
     values ($1, 'unavailable', $2, $3, $4, $5, 'cloud-w1', 'running') returning run_id::text`,
    [envelopeId, configHash, JSON.stringify(config.cloudWorkflows), inputHash, sha(system)]))[0]!.run_id;
  const toolCalls: Array<[string, boolean, string | null]> = [];
  const record = (tool: string, refusal: string | null) => { toolCalls.push([tool, refusal === null, refusal]); return refusal; };

  const model = c.model, ledger = { root };
  const runId = await beginRun({ parentRunId: null, workflow: 'W1', operation: 'cloud',
    protocol: { version, hash: sha(system) }, source: 'app', agent: 'Capital OS cloud W1 (Anthropic Messages API: web_search; server fetch_page)', model,
    launchFolder: `import job, envelope ${envelopeId}`, workerFolder: process.cwd(),
    batch: { id: basename(batch), manifest: `enrich/batches/${basename(batch)}`, hash: inputHash, planned: rows.length } }, ledger);

  const usage: Usage & { source: 'measured' } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured', method: 'Anthropic usage fields, summed per call' };
  const reader = new PageReader(deps.pages);
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: c.maxSearchesPerLp, blocked_domains: [...BLOCKED_DOMAINS, 'linkedin.com'] },
    { name: 'fetch_page', description: 'Read one public web page by URL. Returns its text (scripts removed; image names and link targets listed at the end), or why it could not be read. LinkedIn and contact-data brokers are never read.',
      input_schema: { type: 'object', properties: { url: { type: 'string', description: 'The full http(s) URL' } }, required: ['url'] } },
  ];
  let written = 0, failed = 0, skipped = 0, replaced = 0, demoted = 0, searches = 0, fetches = 0, queryRefusals = 0, stopReason: string | null = null;
  let crashed = false, result: W1Result | undefined;
  try {
    for (const row of rows) {
      const k = row.key as string;
      if (stopReason) { skipped++; continue; }
      const turn = await researchLoop({ key, model, system, tools, maxTurns: c.maxTurnsPerLp, maxFetches: c.maxFetchesPerLp, maxOutputTokens: c.maxOutputTokensPerTurn,
        tokenBudget: c.maxTokens, deadline, now, usage, record, reader, ours, callModel: deps.callModel,
        user: JSON.stringify({ lp: minimalRow(row), findingOnFile: onFile.get(k) ?? null, nearUs: network, today: new Date(now()).toISOString().slice(0, 10) }) });
      const { read, queries, final, refusedQuery } = turn;
      searches += turn.searches; fetches += turn.fetches;
      if (turn.stop) stopReason = turn.stop;
      if (refusedQuery) queryRefusals++;
      if (refusedQuery || final === null) { failed++; continue; }

      // Held to W1 before it is written.
      let finding: Finding;
      try { finding = (JSON.parse(final.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as { finding: Finding }).finding; } catch { failed++; continue; }
      if (!finding || typeof finding !== 'object') { failed++; continue; }
      finding.key = k; finding.name = row.name as string;
      finding.researched = { at: new Date(now()).toISOString().slice(0, 10), by: 'claude (cloud)', workflow: 'W1', version, method: queries.length ? 'search' : 'pages' };
      finding.queries = queries.map((q) => ({ q })) as Finding['queries'];
      const kept: Finding['facts'] = [], cautions: string[] = [];
      for (const f of Array.isArray(finding.facts) ? finding.facts : []) {
        const page = f?.source?.url ? read.get(urlKey(f.source.url)) : undefined;
        const why = !page ? 'its page was not read in this run' : f.quote && !page.sec && !quoteOnPage(f.quote, page.text) ? 'its quote is not on its page word for word' : null;
        if (why) { cautions.push(`Unconfirmed (${why}): ${f?.field ?? 'fact'}: ${String(f?.value ?? '').slice(0, 200)}`); demoted++; continue; }
        kept.push(f);
      }
      finding.facts = kept;
      if (cautions.length) finding.profile = { ...(finding.profile ?? { summary: '', investorType: 'unknown' as never }), cautions: [...(finding.profile?.cautions ?? []), ...cautions] };
      if (check(finding, k).length) {
        await mkdir(join(dir, 'rejects'), { recursive: true });
        await writeFile(join(dir, 'rejects', `${runId}-${k}.json`), JSON.stringify(finding, null, 2), { flag: 'wx', mode: 0o600 });
        failed++; continue;
      }
      const target = join(dir, 'raw', `${k}.json`);
      await mkdir(dirname(target), { recursive: true });
      if (!(await realpath(dirname(target))).startsWith(dir + sep)) throw new Error('A path escapes enrich.');
      if (onFile.has(k)) {
        const keptCopy = join(dir, 'inbox', runId, 'replaced', 'raw', `${k}.json`);
        await mkdir(dirname(keptCopy), { recursive: true });
        await copyFile(target, keptCopy);
        replaced++;
      }
      const temporary = `${target}.${runId}.tmp`;
      await writeFile(temporary, JSON.stringify(finding, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
      written++;
    }
  } catch (e) {
    crashed = true;
    throw e;
  } finally {
    const outcome = crashed ? 'failed' : written === rows.length ? 'succeeded' : written > 0 ? 'partial' : 'failed';
    const reason = outcome === 'succeeded' ? null : crashed ? 'the run stopped with an error; see the server log'
      : [stopReason, failed ? `${failed} LPs' findings failed (no answer, a refused query or the validator; see enrich/rejects)` : null].filter(Boolean).join('; ') || 'no finding was written';
    for (const [tool, allowed, refusal] of toolCalls) await db.query('insert into agents.tool_call (run_id, tool, allowed, refusal) values ($1,$2,$3,$4)', [agentRun, tool, allowed, refusal]);
    await db.query(`update agents.run set status = $2::agents.run_status, output = $3, rationale = $4, finished_at = now() where run_id = $1`,
      [agentRun, written ? 'proposed' : 'unavailable', JSON.stringify({ written, failed, skipped, replaced, demoted, searches, fetches, queryRefusals, ledgerRun: runId }), reason]);
    await appendAudit({ actorId: actor, action: 'workflow.cloud_run', subjectType: 'agent_run', subjectId: agentRun,
      detail: { workflow: 'W1', ledgerRun: runId, lps: rows.length, written, failed, skipped, replaced, demotedFacts: demoted, searches, fetches, queryRefusals,
        tokens: { input: usage.input, output: usage.output }, outcome } }, db);
    await finishRun(runId, {
      counts: { selected: rows.length, written, valid: written, failed, skipped },
      checks: [{ name: 'importer validator (check)', status: written ? 'pass' : 'not-run' }, { name: 'facts cite pages read in this run', status: 'pass' },
        { name: 'queries carry no amount, vehicle or pipeline', status: queryRefusals ? 'fail' : 'pass' }],
      usage, outcome, reason }, ledger);
    result = { runId, lps: rows.length, written, failed, skipped, replaced, demotedFacts: demoted, searches, fetches, queryRefusals, outcome, reason };
  }
  return result!;
}

export interface LoopResult { final: string | null; queries: string[]; read: Map<string, CitedPage>; refusedQuery: string | null; searches: number; fetches: number; stop: string | null }

/**
 * One research conversation with web search and the server's fetch_page (W1 per LP, sourcing per run):
 * every query checked as it comes back (one that breaks the rules ends the conversation), every page read
 * through the server's reader within its budget, every call and read checked against the deadline and
 * recorded. Usage is added to `usage` as it is measured.
 */
export async function researchLoop(o: {
  key: string; model: string; system: string; user: string; tools: unknown[]; maxTurns: number; maxFetches: number; maxOutputTokens: number;
  tokenBudget: number; deadline: Date; now: () => number; usage: Usage; record: (tool: string, refusal: string | null) => string | null;
  reader: PageReader; ours: string[]; callModel?: CallTools;
}): Promise<LoopResult> {
  const read = new Map<string, CitedPage>(), queries: string[] = [];
  let fetches = 0, refusedQuery: string | null = null, final: string | null = null, stop: string | null = null;
  const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: o.user }];
  for (let turn = 0; turn < o.maxTurns; turn++) {
    if ((o.usage.input ?? 0) + (o.usage.output ?? 0) >= o.tokenBudget) { stop = 'token budget reached'; break; }
    if (o.record('anthropic-messages', o.now() > o.deadline.getTime() ? 'past the run\'s deadline' : null)) { stop = 'deadline reached'; break; }
    let r: ToolResponse;
    try {
      r = await (o.callModel ?? anthropicWithTools)(o.key, { model: o.model, max_tokens: o.maxOutputTokens, tools: o.tools, messages,
        system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }] });
    } catch { break; }
    const u = r.usage ?? {};
    o.usage.input! += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); o.usage.output! += u.output_tokens ?? 0;
    o.usage.cacheRead! += u.cache_read_input_tokens ?? 0; o.usage.cacheWrite! += u.cache_creation_input_tokens ?? 0;
    for (const b of r.content) if (b.type === 'server_tool_use' && b.name === 'web_search') {
      const q = typeof b.input?.query === 'string' ? b.input.query : '';
      queries.push(q);
      const why = queryRefusal(q, o.ours);
      o.record('web-search', why);
      if (why) refusedQuery = why;
    }
    if (refusedQuery) break;
    if (r.stop_reason === 'end_turn') { final = r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''); break; }
    messages.push({ role: 'assistant', content: r.content });
    if (r.stop_reason === 'pause_turn') continue;
    if (r.stop_reason !== 'tool_use') break;
    const results: unknown[] = [];
    for (const b of r.content) if (b.type === 'tool_use') {
      const url = typeof b.input?.url === 'string' ? b.input.url : '';
      let host = 'unparsable address';
      try { host = new URL(url).hostname; } catch { /* recorded as unparsable */ }
      const refusal = b.name !== 'fetch_page' ? 'not a tool this run has'
        : fetches >= o.maxFetches ? 'the page budget is spent' : o.now() > o.deadline.getTime() ? 'past the run\'s deadline' : null;
      o.record(`fetch-page ${host}`, refusal);
      if (refusal) { results.push({ type: 'tool_result', tool_use_id: b.id, content: `Not read: ${refusal}.`, is_error: true }); continue; }
      fetches++;
      const page = await o.reader.read(url);
      if (page.state === 'read') read.set(urlKey(url), page);
      results.push({ type: 'tool_result', tool_use_id: b.id, content: page.state === 'read'
        ? page.text.slice(0, config.cloudWorkflows.pages.maxChars) + (page.truncated ? '\n[cut: the page is longer]' : '')
        : `Not read: ${page.why}.`, ...(page.state === 'read' ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { final, queries, read, refusedQuery, searches: queries.length, fetches, stop };
}

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { checkStrategy, gates, moneyKey, type Strategy } from '@/lib/enrich/strategy';
import { createEnvelope, EnvelopeViolation } from '@/modules/agents';
import { appendAudit } from '@/modules/platform';
import { anthropicWithTools, type CallTools, type ToolResponse } from './cloud-w1';
import { anthropicKey, cloudWorkflowsOn } from './key';
import { beginRun, finishRun, type Usage } from './ledger';
import { WorkflowRefusal } from './refusal';

/**
 * W5, an LP's strategy, run by the app itself (docs/28-cloud-workflows.md §6.4). An import job of kind
 * `workflow` with `protocol: 'w5-cloud'`, behind Cloud workflows like the others.
 *
 * W5 reads no web: the server gathers each LP's inputs as the protocol names them (its finding, its
 * candidates, connections and triage rows, its strategies and its batch colleagues', and our side) and the
 * model, with no tools, writes the strategy. Before anything is written the server holds it to W5:
 *
 * - `made` is the server's: today, `claude (cloud)`, the protocol's version, and the pins computed from the
 *   files (the finding's `researched.at`, the close track, the best tier among the LP's paths, and a lead's
 *   `made.at` read from its file). The model never writes its own provenance.
 * - The file layout is the importer's: a vehicle folder must be a known slug equal to `ask.vehicle`; a
 *   top-level file names exactly one vehicle; one file per LP and vehicle across both layouts, and the
 *   top-level file keeps its vehicle (a second vehicle goes in its folder).
 * - `checkStrategy` decides the rest; a refused strategy goes to `enrich/rejects/`. The checker's evidence
 *   gates are counted as warnings for a person, as `enrich-check` does.
 *
 * A strategy on file is kept under enrich/inbox/<run>/replaced/ before it is replaced. Nothing is imported:
 * Import findings picks the files up, and accepting a suggestion stays a person's act.
 */

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const KEY = /^[\w:-]+$/; // an LP key; a prospect-made one may carry ":" (cloud-sourced:<name>--<org>)
export const W5_COMMANDS = ['anthropic-messages'] as const;
const TIERS = ['A', 'B', 'C', 'D'] as const;
type Tier = (typeof TIERS)[number];

export interface W5Deps { callModel?: CallTools; enabled?: boolean; key?: string | null; now?: () => number }

/** The rules the model writes by, as the protocol's read set names them. */
export async function w5SystemPrompt(cwd = process.cwd()): Promise<{ text: string; version: string }> {
  const read = (p: string) => readFile(join(cwd, p), 'utf8');
  const w5 = await read('docs/workflows/w5-strategy.md');
  const version = /version: "(\d+\.\d+)"/.exec(w5)?.[1];
  if (!version) throw new Error('The W5 protocol has no version line; nothing was run.');
  // The sub-agent's running steps and bookkeeping don't apply here: the host records the run and checks.
  const protocol = w5.slice(0, w5.indexOf('## Running W5 as a sub-agent')) + w5.slice(w5.indexOf('## The check'));
  const text = [
    'You write one LP\'s strategy under W5, the protocol below. You are given every input the protocol names, as JSON; you have no tools and read nothing else.',
    'The host writes `made` (date, author, version and pins) itself: give `made.inputs.lead` only for a firm-level strategy, as {"key": the lead\'s key}.',
    'Write a strategy for each vehicle the LP has an open pursuit for where one is due, as the protocol says; keep the existing file\'s vehicle at the top level.',
    'Answer with JSON only, no prose and no code fence: {"strategies": [{"folder": null or "<vehicle-slug>", "strategy": <Strategy>}], "learnings": ["<one line, no names>"]}.',
    '', protocol.trim(),
    '', '# docs/agent-rules/real-data.md', await read('docs/agent-rules/real-data.md'),
    '', '# docs/agent-rules/domain.md', await read('docs/agent-rules/domain.md'),
    '', '# docs/email-guidelines.md', await read('docs/email-guidelines.md'),
    '', '# lib/enrich/strategy.ts', await read('lib/enrich/strategy.ts'),
    '', '# lib/enrich/capacity.ts', await read('lib/enrich/capacity.ts'),
    '', '# config/deployment.ts, the capacity block', JSON.stringify(config.capacity),
  ].join('\n');
  return { text, version };
}

const jsonl = async (file: string): Promise<Array<Record<string, unknown>>> =>
  readFile(file, 'utf8').then((t) => t.split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s) as Record<string, unknown>), () => []);
const json = async (file: string): Promise<unknown> => readFile(file, 'utf8').then((t) => JSON.parse(t) as unknown, () => null);

/** Every strategy on file for a key: the top-level file and one per vehicle folder. */
async function strategiesOnFile(dir: string, k: string): Promise<Map<string, Strategy>> {
  const out = new Map<string, Strategy>();
  const top = await json(join(dir, 'strategy', `${k}.json`));
  if (top) out.set('', top as Strategy);
  for (const e of await readdir(join(dir, 'strategy'), { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !KEY.test(e.name)) continue;
    const s = await json(join(dir, 'strategy', e.name, `${k}.json`));
    if (s) out.set(e.name, s as Strategy);
  }
  return out;
}

export interface W5Result { runId: string; lps: number; written: number; refused: number; failed: number; skipped: number; replaced: number; gated: number;
  lists: Record<string, number>; outcome: string; reason: string | null }

export async function runCloudStrategy(input: Record<string, unknown>, actor: string, root: string = config.data.root, deps: W5Deps = {}): Promise<W5Result> {
  const c = config.cloudWorkflows.w5, now = deps.now ?? Date.now;
  if (!(deps.enabled ?? cloudWorkflowsOn())) throw new WorkflowRefusal('Cloud workflows are off. An Admin turns them on in Settings → Connections; nothing was run.');
  const key = deps.key !== undefined ? deps.key : anthropicKey();
  if (!key) throw new WorkflowRefusal('Workflow refused: no Anthropic key (Settings → Connections, or ANTHROPIC_API_KEY).');
  if (typeof input.batch !== 'string' || !input.batch.trim()) throw new WorkflowRefusal('Give a batch file under enrich/batches.');
  const dir = await realpath(join(root, 'enrich')), batches = await realpath(join(dir, 'batches'));
  let batch: string;
  try { batch = await realpath(resolve(dir, 'batches', input.batch.trim())); } catch { throw new WorkflowRefusal('The batch file is not on the server.'); }
  if (!batches.startsWith(dir + sep) || !batch.startsWith(batches + sep)) throw new WorkflowRefusal('Batch must be under enrich/batches.');
  const batchText = await readFile(batch, 'utf8');
  const keys = [...new Set(batchText.split('\n').filter((s) => s.trim()).map((s) => { try { return (JSON.parse(s) as { key?: unknown }).key; } catch { return s.trim(); } }))];
  if (!keys.length || keys.some((k) => typeof k !== 'string' || !KEY.test(k))) throw new WorkflowRefusal('The batch needs keyed JSONL rows or one key per line.');
  if (keys.length > c.maxLps) throw new WorkflowRefusal(`The batch has ${keys.length} LPs; a cloud run takes at most ${c.maxLps}. Cut it in parts, a firm kept whole.`);
  const batchKeys = keys as string[];

  // Inputs, all read before anything is recorded or sent; the batch's rows only.
  const want = new Set(batchKeys);
  const candidates = new Map((await jsonl(join(dir, 'candidates.jsonl'))).filter((r) => want.has(r.key as string)).map((r) => [r.key as string, r]));
  if (!candidates.size) throw new WorkflowRefusal('None of the batch\'s LPs is in candidates.jsonl on the server; run the research export first. Nothing was run.');
  const paths = (await jsonl(join(dir, 'connections.jsonl'))).filter((r) => want.has(r.lp as string));
  const triage = new Map((await jsonl(join(dir, 'triage.jsonl'))).filter((r) => want.has(r.key as string)).map((r) => [r.key as string, r]));
  const findings = new Map<string, Record<string, unknown> | null>();
  const onFile = new Map<string, Map<string, Strategy>>();
  for (const k of batchKeys) {
    const file = join(dir, 'raw', `${k}.json`);
    const real = await realpath(file).catch(() => null);
    if (real && !real.startsWith(dir + sep)) throw new WorkflowRefusal('A finding escapes enrich.');
    findings.set(k, real ? JSON.parse(await readFile(real, 'utf8')) as Record<string, unknown> : null);
    onFile.set(k, await strategiesOnFile(dir, k));
  }
  const ourSide = {
    team: await json(join(dir, 'us', 'team.json')) ?? await json(join(dir, 'team.json')),
    voice: await json(join(dir, 'us', 'voice.json')), network: await json(join(dir, 'us', 'network.json')), site: await json(join(dir, 'presence', 'site.json')),
  };
  const db = await getDb();
  const vehicles = await db.query<{ slug: string; name: string }>('select slug, name from platform.vehicle order by slug');
  const { text: system, version } = await w5SystemPrompt();
  const shared = JSON.stringify({ ourSide, vehicles });
  const inputHash = sha([batchText, JSON.stringify([...candidates]), JSON.stringify(paths), JSON.stringify([...triage]), JSON.stringify([...findings]),
    JSON.stringify([...onFile].map(([k, m]) => [k, [...m]])), shared].join('\n'));
  const configHash = sha(JSON.stringify(config.cloudWorkflows));
  const deadline = new Date(now() + c.maxSeconds * 1000);

  let envelopeId: string;
  try {
    envelopeId = await createEnvelope(actor, {
      task: `W5 strategies in the cloud: write ${batchKeys.length} LPs' strategies from our records and the research`,
      scope: 'enrich/strategy for the batch\'s keys (written; a strategy on file kept under enrich/inbox first)',
      allowedEvidence: ['enrich files for the batch\'s keys: finding, candidates, connections, triage, strategies', 'our side: team, voice, network, site'],
      allowedCommands: [...W5_COMMANDS],
      budget: { tokens: c.maxTokens, seconds: c.maxSeconds }, deadline,
      outputSchema: 'Strategy, lib/enrich/strategy.ts', escalationOwnerId: actor,
      acceptanceCriteria: ['passes checkStrategy()', 'pins computed from the files', 'one file per LP and vehicle', 'a proposal: nothing imported or sent'],
    });
  } catch (e) {
    if (e instanceof EnvelopeViolation) throw new WorkflowRefusal(`Refused by the agent rules: ${e.message}`);
    throw e;
  }
  const agentRun = (await db.query<{ run_id: string }>(
    `insert into agents.run (envelope_id, status, config_hash, config_snapshot, input_hash, prompt_hash, agent_kind, rationale)
     values ($1, 'unavailable', $2, $3, $4, $5, 'cloud-w5', 'running') returning run_id::text`,
    [envelopeId, configHash, JSON.stringify(config.cloudWorkflows), inputHash, sha(system)]))[0]!.run_id;
  const toolCalls: Array<[string, boolean, string | null]> = [];

  const model = c.model, ledger = { root };
  const runId = await beginRun({ parentRunId: null, workflow: 'W5', operation: 'cloud',
    protocol: { version, hash: sha(system) }, source: 'app', agent: 'Capital OS cloud W5 (Anthropic Messages API, no tools)', model,
    launchFolder: `import job, envelope ${envelopeId}`, workerFolder: process.cwd(),
    batch: { id: basename(batch), manifest: `enrich/batches/${basename(batch)}`, hash: inputHash, planned: batchKeys.length } }, ledger);

  const usage: Usage & { source: 'measured' } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured', method: 'Anthropic usage fields, summed per call' };
  const today = new Date(now()).toISOString().slice(0, 10);
  const lists: Record<string, number> = {};
  let written = 0, refused = 0, failed = 0, skipped = 0, replaced = 0, gated = 0, stopReason: string | null = null;
  let crashed = false, result: W5Result | undefined;
  const reject = async (k: string, what: unknown, problems: string[]) => {
    await mkdir(join(dir, 'rejects'), { recursive: true });
    await writeFile(join(dir, 'rejects', `${runId}-${k}-${refused}.json`), JSON.stringify({ problems, strategy: what }, null, 2), { flag: 'wx', mode: 0o600 });
    refused++;
  };
  try {
    for (const k of batchKeys) {
      if (stopReason) { skipped++; continue; }
      if ((usage.input ?? 0) + (usage.output ?? 0) >= c.maxTokens) { stopReason = 'token budget reached'; skipped++; continue; }
      const late = now() > deadline.getTime() ? 'past the run\'s deadline' : null;
      toolCalls.push(['anthropic-messages', late === null, late]);
      if (late) { stopReason = 'deadline reached'; skipped++; continue; }
      const mine = onFile.get(k)!;
      const colleagues = batchKeys.filter((x) => x !== k).map((x) => ({ key: x, name: candidates.get(x)?.name ?? null,
        strategies: Object.fromEntries([...onFile.get(x)!].map(([folder, s]) => [folder || 'top-level', s])) }));
      const user = JSON.stringify({ today, key: k, finding: findings.get(k), candidate: candidates.get(k) ?? null,
        paths: paths.filter((p) => p.lp === k), triage: triage.get(k) ?? null,
        strategiesOnFile: Object.fromEntries([...mine].map(([folder, s]) => [folder || 'top-level', s])), batchColleagues: colleagues });
      let r: ToolResponse;
      try {
        r = await (deps.callModel ?? anthropicWithTools)(key, { model, max_tokens: c.maxOutputTokensPerLp, messages: [{ role: 'user', content: user }],
          system: [{ type: 'text', text: system }, { type: 'text', text: `Our side and our vehicles, shared by every LP in this run:\n${shared}`, cache_control: { type: 'ephemeral' } }] });
      } catch { failed++; continue; }
      const u = r.usage ?? {};
      usage.input! += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); usage.output! += u.output_tokens ?? 0;
      usage.cacheRead! += u.cache_read_input_tokens ?? 0; usage.cacheWrite! += u.cache_creation_input_tokens ?? 0;
      if (r.stop_reason !== 'end_turn') { failed++; continue; }
      let answer: { strategies?: Array<{ folder?: unknown; strategy?: Strategy }> };
      try { answer = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
      catch { failed++; continue; }
      if (!Array.isArray(answer?.strategies) || !answer.strategies.length) { failed++; continue; }

      // Held to W5 and the importer's layout before anything is written.
      const cand = candidates.get(k) as Parameters<typeof gates>[1] & { money?: Parameters<typeof moneyKey>[0] } | undefined;
      const finding = findings.get(k) as { researched?: { at?: string } } | null;
      const best = paths.filter((p) => p.lp === k).map((p) => p.tier as Tier).filter((t) => TIERS.includes(t)).sort()[0] ?? null;
      const vehicleOf = (named: string) => vehicles.filter((v) => [v.name.toLowerCase(), v.slug.toLowerCase()].includes(named.trim().toLowerCase()));
      const seen = new Set<string>();
      const ready: Array<{ folder: string; s: Strategy }> = [];
      for (const item of answer.strategies) {
        const folder = item?.folder === null || item?.folder === undefined || item.folder === '' ? '' : String(item.folder);
        const s = item?.strategy;
        const problems: string[] = [];
        if (!s || typeof s !== 'object') { await reject(k, s ?? null, ['not an object']); continue; }
        s.key = k;
        const asked = typeof s.ask?.vehicle === 'string' ? s.ask.vehicle : '';
        const vehicle = folder ? vehicles.find((v) => v.slug === folder) : vehicleOf(asked).length === 1 ? vehicleOf(asked)[0] : undefined;
        if (folder && !vehicle) problems.push(`unknown vehicle folder "${folder}"`);
        if (folder && asked !== folder) problems.push('a vehicle folder must equal ask.vehicle');
        if (!folder && !vehicle) problems.push('ask.vehicle must identify exactly one known vehicle');
        if (vehicle) {
          if (seen.has(vehicle.slug)) problems.push('two strategies for one vehicle');
          seen.add(vehicle.slug);
          // One file per LP and vehicle across both layouts; the top-level file keeps its vehicle.
          const top = mine.get('');
          const topVehicle = top && typeof top.ask?.vehicle === 'string' ? vehicleOf(top.ask.vehicle)[0]?.slug : undefined;
          if (folder && topVehicle === vehicle.slug) problems.push('the top-level strategy already holds this vehicle; write it there');
          if (!folder && top && topVehicle && topVehicle !== vehicle.slug) problems.push('the top-level strategy keeps its vehicle; a second vehicle goes in its folder');
          if (!folder && mine.has(vehicle.slug)) problems.push('this vehicle already has a folder strategy; write it there');
        }
        const leadKey = typeof s.made?.inputs?.lead?.key === 'string' ? s.made.inputs.lead.key : null;
        const lead = leadKey && KEY.test(leadKey) && leadKey !== k
          ? (onFile.get(leadKey) ?? await strategiesOnFile(dir, leadKey)).get(folder) ?? null : null;
        s.made = { at: today, by: 'claude (cloud)', workflow: 'W5', version,
          inputs: { finding: typeof finding?.researched?.at === 'string' ? finding.researched.at : null, money: moneyKey(cand?.money ?? null), bestPath: best,
            ...(lead?.made?.at ? { lead: { key: leadKey!, at: lead.made.at } } : {}) } };
        problems.push(...checkStrategy(s, k));
        if (problems.length) { await reject(k, s, problems); continue; }
        ready.push({ folder, s });
      }
      if (!ready.length) { failed++; continue; }
      for (const { folder, s } of ready) {
        const rel = folder ? join('strategy', folder, `${k}.json`) : join('strategy', `${k}.json`);
        const target = join(dir, rel);
        await mkdir(dirname(target), { recursive: true });
        if (!(await realpath(dirname(target))).startsWith(dir + sep)) throw new Error('A path escapes enrich.');
        if (mine.has(folder)) {
          const kept = join(dir, 'inbox', runId, 'replaced', rel);
          await mkdir(dirname(kept), { recursive: true });
          await copyFile(target, kept);
          replaced++;
        }
        const temporary = `${target}.${runId}.tmp`;
        await writeFile(temporary, JSON.stringify(s, null, 2), { flag: 'wx', mode: 0o600 });
        await rename(temporary, target);
        written++;
        lists[s.list] = (lists[s.list] ?? 0) + 1;
        if (gates(s, cand, findings.get(k) as Parameters<typeof gates>[2], best, new Date(now())).length) gated++;
      }
    }
  } catch (e) {
    crashed = true;
    throw e;
  } finally {
    const done = batchKeys.length - failed - skipped;
    const outcome = crashed ? 'failed' : written && !failed && !skipped && !refused ? 'succeeded' : written ? 'partial' : 'failed';
    const reason = outcome === 'succeeded' ? null : crashed ? 'the run stopped with an error; see the server log'
      : [stopReason, failed ? `${failed} LPs got no strategy that passed (no answer or every one refused)` : null, refused ? `${refused} strategies refused; see enrich/rejects` : null].filter(Boolean).join('; ') || 'no strategy was written';
    for (const [tool, allowed, why] of toolCalls) await db.query('insert into agents.tool_call (run_id, tool, allowed, refusal) values ($1,$2,$3,$4)', [agentRun, tool, allowed, why]);
    await db.query(`update agents.run set status = $2::agents.run_status, output = $3, rationale = $4, finished_at = now() where run_id = $1`,
      [agentRun, written ? 'proposed' : 'unavailable', JSON.stringify({ written, refused, failed, skipped, replaced, gated, lists, ledgerRun: runId }), reason]);
    await appendAudit({ actorId: actor, action: 'workflow.cloud_run', subjectType: 'agent_run', subjectId: agentRun,
      detail: { workflow: 'W5', ledgerRun: runId, lps: batchKeys.length, written, refused, failed, skipped, replaced, gated, lists,
        tokens: { input: usage.input, output: usage.output }, outcome } }, db);
    await finishRun(runId, {
      counts: { selected: batchKeys.length, written, valid: written, failed: failed + refused, skipped },
      checks: [{ name: 'importer validator (checkStrategy)', status: written ? 'pass' : 'not-run' }, { name: 'pins computed by the server', status: done ? 'pass' : 'not-run' },
        { name: 'every strategy held to the layout and the validator', status: refused ? 'fail' : written ? 'pass' : 'not-run' }, { name: 'evidence gates (warnings for a person)', status: gated ? 'fail' : written ? 'pass' : 'not-run' }],
      usage, outcome, reason }, ledger);
    result = { runId, lps: batchKeys.length, written, refused, failed, skipped, replaced, gated, lists, outcome, reason };
  }
  return result!;
}

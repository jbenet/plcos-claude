import { createHash } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { BLOCKED_DOMAINS } from '@/lib/enrich/schema';
import { prospectProblems, type Prospect } from '@/lib/enrich/prospect-rows';
import { placeNew } from '@/lib/sync/push';
import { createEnvelope, EnvelopeViolation } from '@/modules/agents';
import { appendAudit } from '@/modules/platform';
import { PageReader, type PageDeps } from './cited-pages';
import { researchLoop, urlKey, type CallTools } from './cloud-w1';
import { anthropicKey, cloudWorkflowsOn } from './key';
import { beginRun, finishRun, type Usage } from './ledger';
import { WorkflowRefusal } from './refusal';

/**
 * Prospect sourcing for a vehicle, run by the app itself (docs/28-cloud-workflows.md §6.2). An import job of
 * kind `workflow` with `protocol: 'sourcing-cloud'`, behind Cloud workflows like the others.
 *
 * The model is given the vehicle's name and kind and the brief an Admin typed: never a record of ours, so it
 * cannot put an LP of ours or the pipeline into a search. It searches with Anthropic's web_search (each query
 * checked as it comes back, as W1's are) and reads with the server's fetch_page. The rows that come back are
 * held to the prospects import (docs/prospects-import.md) before anything is written:
 *
 * - the server sets vehicle, status `new`, entity type, a stable `personKey` from the name and organization,
 *   `capacity.guess: true` and `route: null` (the model knows none of our paths);
 * - a row keeps only the sources read in this run, and is refused without one; a row needs a country;
 * - LinkedIn and email domains never go in a row;
 * - `prospectProblems`, the importer's own row check, decides the rest.
 *
 * The file lands new in enrich/prospects/ (never over one). Nothing is imported: an Admin runs Add prospects,
 * which reads it after its settle wait, and a prospect row is a pipeline plan, never consent or contact.
 */

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const SOURCING_COMMANDS = ['web-search', 'fetch-page', 'anthropic-messages'] as const;
const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface SourcingDeps { pages?: PageDeps; callModel?: CallTools; enabled?: boolean; key?: string | null; now?: () => number }

export function sourcingSystemPrompt(): string {
  return [
    'You find prospective LPs for one investment vehicle: people with the means and the interest to commit to it, from public web pages.',
    'You are given the vehicle\'s name and kind and a brief. You know nothing of the firm\'s own investors and must not guess at them.',
    'Searches carry names, organizations, titles, locations and topic words only: never an amount, never the vehicle\'s name, never words like pipeline, prospect or LP list.',
    'Read a page with fetch_page before you rely on it; a search snippet alone is not a source. LinkedIn and contact-data brokers are never read.',
    'Prefer people with evidence of their own investing (angel or LP activity, a family office, a foundation they direct) and of interest in the vehicle\'s field.',
    'Leave out religion, health, politics, home addresses, emails and phone numbers.',
    'Answer with JSON only, no prose and no code fence: {"prospects": [{"name": string, "org": string|null, "country": string, "reason": "<one or two sentences: why they fit, from the pages>",',
    '"strategic": boolean, "capacity": {"band": "<e.g. $250K–500K, or unknown>", "basis": "<what on the pages supports it>"}, "sources": ["<URLs you read>"], "personalUrls": ["<their own public pages>"]}]}.',
  ].join('\n');
}

export interface SourcingResult { runId: string; vehicle: string; proposed: number; written: number; refused: number; searches: number; fetches: number;
  queryRefusals: number; file: string | null; outcome: string; reason: string | null }

export async function runCloudSourcing(input: Record<string, unknown>, actor: string, root: string = config.data.root, deps: SourcingDeps = {}): Promise<SourcingResult> {
  const c = config.cloudWorkflows.sourcing, now = deps.now ?? Date.now;
  if (!(deps.enabled ?? cloudWorkflowsOn())) throw new WorkflowRefusal('Cloud workflows are off. An Admin turns them on in Settings → Connections; nothing was run.');
  const key = deps.key !== undefined ? deps.key : anthropicKey();
  if (!key) throw new WorkflowRefusal('Workflow refused: no Anthropic key (Settings → Connections, or ANTHROPIC_API_KEY).');
  const brief = typeof input.brief === 'string' ? input.brief.trim() : '';
  if (brief.length < 20 || brief.length > c.maxBriefChars) throw new WorkflowRefusal(`Write a brief of what to look for, 20 to ${c.maxBriefChars} characters.`);
  const want = Math.min(Math.max(1, Number(input.count) || c.maxProspects), c.maxProspects);
  const db = await getDb();
  const vehicles = await db.query<{ slug: string; name: string; kind: string }>('select slug, name, kind::text as kind from platform.vehicle');
  const vehicle = vehicles.find((v) => v.slug === input.vehicle);
  if (!vehicle) throw new WorkflowRefusal('Pick a known vehicle; nothing was run.');
  // Grants outreach needs a funder's invitation (invariant 12): sourcing funders is a person's work.
  if (vehicle.kind === 'grant_rail') throw new WorkflowRefusal('Grant rails are not sourced in the cloud: grants outreach starts from a funder\'s invitation.');
  const ours = vehicles.flatMap((v) => [v.name, v.slug.replace(/-/g, ' ')]);
  const dir = await realpath(join(root, 'enrich'));
  const system = sourcingSystemPrompt();
  const user = JSON.stringify({ vehicle: { name: vehicle.name, kind: vehicle.kind }, brief, want, today: new Date(now()).toISOString().slice(0, 10) });
  const inputHash = sha(user), configHash = sha(JSON.stringify(config.cloudWorkflows));
  const deadline = new Date(now() + c.maxSeconds * 1000);

  let envelopeId: string;
  try {
    envelopeId = await createEnvelope(actor, {
      task: `Prospect sourcing in the cloud: up to ${want} prospects for one vehicle from public pages`,
      scope: 'enrich/prospects (one new file; nothing imported)',
      allowedEvidence: ['public web pages read by fetch_page (server-checked)', 'web search results'], allowedCommands: [...SOURCING_COMMANDS],
      budget: { tokens: c.maxTokens, seconds: c.maxSeconds }, deadline,
      outputSchema: 'prospect row, lib/enrich/prospect-rows.ts', escalationOwnerId: actor,
      acceptanceCriteria: ['passes prospectProblems()', 'every row cites a page read in this run', 'no query names an amount, a vehicle or the pipeline'],
    });
  } catch (e) {
    if (e instanceof EnvelopeViolation) throw new WorkflowRefusal(`Refused by the agent rules: ${e.message}`);
    throw e;
  }
  const agentRun = (await db.query<{ run_id: string }>(
    `insert into agents.run (envelope_id, status, config_hash, config_snapshot, input_hash, prompt_hash, agent_kind, rationale)
     values ($1, 'unavailable', $2, $3, $4, $5, 'cloud-sourcing', 'running') returning run_id::text`,
    [envelopeId, configHash, JSON.stringify(config.cloudWorkflows), inputHash, sha(system)]))[0]!.run_id;
  const toolCalls: Array<[string, boolean, string | null]> = [];
  const record = (tool: string, refusal: string | null) => { toolCalls.push([tool, refusal === null, refusal]); return refusal; };

  const model = c.model, ledger = { root };
  const runId = await beginRun({ parentRunId: null, workflow: 'sourcing', operation: 'cloud',
    protocol: { version: null, hash: sha(system) }, source: 'app', agent: 'Capital OS cloud sourcing (Anthropic Messages API: web_search; server fetch_page)', model,
    launchFolder: `import job, envelope ${envelopeId}`, workerFolder: process.cwd(),
    batch: { id: `sourcing-${vehicle.slug}`, manifest: `brief for ${vehicle.slug}`, hash: inputHash, planned: want } }, ledger);

  const usage: Usage & { source: 'measured' } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured', method: 'Anthropic usage fields, summed per call' };
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: c.maxSearches, blocked_domains: [...BLOCKED_DOMAINS, 'linkedin.com'] },
    { name: 'fetch_page', description: 'Read one public web page by URL. Returns its text (scripts removed; image names and link targets listed at the end), or why it could not be read. LinkedIn and contact-data brokers are never read.',
      input_schema: { type: 'object', properties: { url: { type: 'string', description: 'The full http(s) URL' } }, required: ['url'] } },
  ];
  let proposed = 0, written = 0, refused = 0, searches = 0, fetches = 0, queryRefusals = 0, file: string | null = null, stopReason: string | null = null;
  let crashed = false, result: SourcingResult | undefined;
  try {
    const loop = await researchLoop({ key, model, system, user, tools, maxTurns: c.maxTurns, maxFetches: c.maxFetches, maxOutputTokens: c.maxOutputTokensPerTurn,
      tokenBudget: c.maxTokens, deadline, now, usage, record, reader: new PageReader(deps.pages), ours, callModel: deps.callModel });
    searches = loop.searches; fetches = loop.fetches; stopReason = loop.stop;
    if (loop.refusedQuery) { queryRefusals = 1; stopReason = `a search ${loop.refusedQuery}; nothing kept`; }
    let answer: { prospects?: Array<Record<string, any>> } | null = null;
    if (!loop.refusedQuery && loop.final !== null) {
      try { answer = JSON.parse(loop.final.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { stopReason = 'the answer was not JSON'; }
    }
    const rows: Prospect[] = [], rejects: unknown[] = [], seen = new Set<string>();
    const linkedIn = (u: string) => { try { return /(^|\.)linkedin\.com$/i.test(new URL(u).hostname); } catch { return true; } };
    for (const x of Array.isArray(answer?.prospects) ? answer!.prospects!.slice(0, want) : []) {
      proposed++;
      const name = typeof x?.name === 'string' ? x.name.trim() : '';
      const org = typeof x?.org === 'string' && x.org.trim() ? x.org.trim() : null;
      const sources = (Array.isArray(x?.sources) ? x.sources : []).filter((u: unknown): u is string => typeof u === 'string' && loop.read.has(urlKey(u)) && !linkedIn(u));
      const personalUrls = (Array.isArray(x?.personalUrls) ? x.personalUrls : []).filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u) && !linkedIn(u));
      const personKey = `cloud-sourced:${slug(name)}${org ? `--${slug(org)}` : ''}`;
      const row = { personKey, entityType: 'person' as const, name, org, vehicle: vehicle.slug, status: 'new' as const,
        country: typeof x?.country === 'string' ? x.country.trim() : '',
        capacity: { band: typeof x?.capacity?.band === 'string' && x.capacity.band.trim() ? x.capacity.band.trim() : 'unknown',
          basis: typeof x?.capacity?.basis === 'string' && x.capacity.basis.trim() ? x.capacity.basis.trim().slice(0, 500) : 'Nothing on the pages read.', guess: true },
        reason: typeof x?.reason === 'string' ? x.reason.trim().slice(0, 500) : '', strategic: x?.strategic === true, route: null, sources,
        ...(personalUrls.length ? { personalUrls } : {}) };
      const problems = [...prospectProblems(row), ...(sources.length ? [] : ['no source read in this run']), ...(row.country ? [] : ['no country']),
        ...(seen.has(personKey) ? ['the same person twice'] : [])];
      seen.add(personKey);
      if (problems.length || !slug(name)) { rejects.push({ problems, row }); refused++; continue; }
      rows.push(row as Prospect);
    }
    if (rejects.length) {
      await mkdir(join(dir, 'rejects'), { recursive: true });
      await writeFile(join(dir, 'rejects', `${runId}-sourcing.json`), JSON.stringify(rejects, null, 2), { flag: 'wx', mode: 0o600 });
    }
    if (rows.length) {
      file = `prospects/${new Date(now()).toISOString().slice(0, 10)}-cloud-${runId.slice(0, 8).toLowerCase()}-${vehicle.slug}.jsonl`;
      await placeNew(dir, file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', runId);
      written = rows.length;
    }
  } catch (e) {
    crashed = true;
    throw e;
  } finally {
    const outcome = crashed ? 'failed' : written && !refused && !stopReason ? 'succeeded' : written ? 'partial' : 'failed';
    const reason = outcome === 'succeeded' ? null : crashed ? 'the run stopped with an error; see the server log'
      : [stopReason, refused ? `${refused} rows refused; see enrich/rejects` : null].filter(Boolean).join('; ') || 'no prospect came back';
    for (const [tool, allowed, why] of toolCalls) await db.query('insert into agents.tool_call (run_id, tool, allowed, refusal) values ($1,$2,$3,$4)', [agentRun, tool, allowed, why]);
    await db.query(`update agents.run set status = $2::agents.run_status, output = $3, rationale = $4, finished_at = now() where run_id = $1`,
      [agentRun, written ? 'proposed' : 'unavailable', JSON.stringify({ vehicle: vehicle.slug, proposed, written, refused, searches, fetches, queryRefusals, file, ledgerRun: runId }), reason]);
    await appendAudit({ actorId: actor, action: 'workflow.cloud_run', subjectType: 'agent_run', subjectId: agentRun,
      detail: { workflow: 'sourcing', ledgerRun: runId, vehicle: vehicle.slug, proposed, written, refused, searches, fetches, queryRefusals,
        tokens: { input: usage.input, output: usage.output }, outcome } }, db);
    await finishRun(runId, {
      counts: { selected: want, written, valid: written, failed: refused, skipped: null },
      checks: [{ name: 'importer row check (prospectProblems)', status: written ? 'pass' : 'not-run' }, { name: 'rows cite pages read in this run', status: 'pass' },
        { name: 'queries carry no amount, vehicle or pipeline', status: queryRefusals ? 'fail' : 'pass' }],
      usage, outcome, reason }, ledger);
    result = { runId, vehicle: vehicle.slug, proposed, written, refused, searches, fetches, queryRefusals, file, outcome, reason };
  }
  return result!;
}

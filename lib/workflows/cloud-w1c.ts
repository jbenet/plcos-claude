import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { factReviewProblems, FACT_GRADES } from '@/lib/enrich/fact-review';
import type { Finding } from '@/lib/enrich/schema';
import { placeNew } from '@/lib/sync/push';
import { createEnvelope, EnvelopeViolation } from '@/modules/agents';
import { appendAudit } from '@/modules/platform';
import { correctionProblems, correctionSystemPrompt, withCorrection } from './cloud-w1c-correct';
import { PageReader, quoteOnPage, type CitedPage, type PageDeps } from './cited-pages';
import { cloudWorkflowsOn, anthropicKey } from './key';
import { beginRun, finishRun, type Usage } from './ledger';
import { WorkflowRefusal } from './refusal';

/**
 * W1c, the fact check, run by the app itself (docs/28-cloud-workflows.md, slice 1). One import job of kind
 * `workflow` with `protocol: 'w1c-cloud'`, started by a person from Developer → Enrichment; off unless an
 * Admin has turned on "Cloud workflows". It grades; it corrects nothing (W1c's second step stays with a
 * person or the Mac's fact-checker until it has its own slice).
 *
 * 1. Refuses unless cloud workflows are on, the Anthropic key is set, the batch is under enrich/batches,
 *    every finding it names is on the server, it is within the run's budget and the review file is new.
 * 2. Opens a work envelope (modules/agents): the cited URLs are its only evidence, `fetch-cited-page` and
 *    `anthropic-messages` its only commands, its budget and deadline from config. A frozen circuit breaker
 *    refuses it. Every page read and model call is checked against it and recorded as a tool call.
 * 3. Pins the run in the ledger (lib/workflows/ledger.ts) before any work: protocol hash (the rules and
 *    the prompt as sent), config hash, input hash (the batch and the findings as read).
 * 4. Reads every cited page once (lib/workflows/cited-pages.ts), then comes back once to a site that refused.
 * 5. Asks the model to grade each finding against its pages, with no tools: it can read nothing else.
 * 6. Holds the answer to the rules mechanically: a fact whose page wasn't read is `unavailable` whatever the
 *    model said; a `supported` fact whose quote is not on its page word for word is `partly`; counts are
 *    recomputed from the grades; each row passes the same validator the push uses (lib/enrich/fact-review.ts).
 * 7. Writes the review file new (never over one), audits counts only, and finishes the ledger run with
 *    measured usage. A budget or deadline reached stops the run with what it has: outcome `partial`.
 */

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const REVIEW_NAME = /^fact-review-\d{2}[a-z]\.jsonl$/;
const KEY = /^[\w:-]+$/; // an LP key; a prospect-made one may carry ":" (cloud-sourced:<name>--<org>)
export const W1C_COMMANDS = ['fetch-cited-page', 'anthropic-messages'] as const;

export interface ModelRequest { model: string; system: string; user: string; maxTokens: number }
export interface ModelReply { text: string; stop: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number } }
export interface CloudDeps {
  pages?: PageDeps;
  callModel?: (key: string, req: ModelRequest) => Promise<ModelReply>;
  /** Properties only: the setting and the key are read from the app otherwise. */
  enabled?: boolean;
  key?: string | null;
  now?: () => number;
}

/** The Messages API, no tools: the model sees only what this run gives it. */
export async function anthropicMessages(key: string, req: ModelRequest): Promise<ModelReply> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: req.model, system: req.system, max_tokens: req.maxTokens, messages: [{ role: 'user', content: req.user }] }),
  });
  if (!response.ok) throw new Error(`Anthropic request failed (${response.status}).`);
  const r = await response.json() as { stop_reason: string; content: Array<{ type: string; text?: string }>; usage: Record<string, number | undefined> };
  return { text: r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''), stop: r.stop_reason,
    usage: { input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0 } };
}

/** The rules the model grades by: W1c's grading and identity sections, and W1's standard for a fact. */
export async function w1cSystemPrompt(cwd = process.cwd()): Promise<string> {
  const w1c = await readFile(join(cwd, 'docs/workflows/w1c-fact-check.md'), 'utf8');
  const w1 = await readFile(join(cwd, 'docs/workflows/w1-profile.md'), 'utf8');
  const grading = w1c.slice(w1c.indexOf('## Grading'), w1c.indexOf('## Correcting the findings'));
  const facts = w1.slice(w1.indexOf('## Facts'), w1.indexOf('## Capacity'));
  if (grading.length < 100 || facts.length < 100) throw new Error('The W1c or W1 rules could not be found; nothing was run.');
  return [
    'You grade one research finding\'s facts against the pages they cite, under the rules below (W1c, the fact check).',
    'The pages were fetched for you; their text is all you may use. You have no tools and must not use anything you know from elsewhere.',
    'A page marked unavailable was not read: grade its facts "unavailable" and say why from its note.',
    'Notes say what differs, in a sentence. Leave out religion, health, politics and addresses; write "[health detail]" if it matters.',
    `Answer with JSON only, no prose and no code fence: {"key": string, "identity": "holds"|"doubt"|"wrong", "identityNote": string, "facts": [{"i": number, "grade": ${FACT_GRADES.map((g) => `"${g}"`).join('|')}, "note": string}]}, one entry per fact, in order, i from 0.`,
    '', grading.trim(), '', facts.trim(),
  ].join('\n');
}

const usageZero = (): Usage & { source: 'measured' } => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured', method: 'Anthropic usage fields, summed per call' });

export interface CloudResult { runId: string; review: string | null; findings: number; graded: number; failed: number; skipped: number;
  corrected: number; correctionsRefused: number;
  grades: Record<string, number>; pages: { cited: number; read: number; unavailable: number; requests: number }; outcome: string; reason: string | null }

export async function runCloudFactCheck(input: Record<string, unknown>, actor: string, root: string = config.data.root, deps: CloudDeps = {}): Promise<CloudResult> {
  const c = config.cloudWorkflows.w1c, now = deps.now ?? Date.now;
  if (!(deps.enabled ?? cloudWorkflowsOn())) throw new WorkflowRefusal('Cloud workflows are off. An Admin turns them on in Settings → Connections; nothing was run.');
  const key = deps.key !== undefined ? deps.key : anthropicKey();
  if (!key) throw new WorkflowRefusal('Workflow refused: no Anthropic key (Settings → Connections, or ANTHROPIC_API_KEY).');
  const review = typeof input.review === 'string' ? input.review.trim() : '';
  if (!REVIEW_NAME.test(review)) throw new WorkflowRefusal('Name the review file as fact-review-<round><part>.jsonl, e.g. fact-review-07a.jsonl.');
  if (typeof input.batch !== 'string' || !input.batch.trim()) throw new WorkflowRefusal('Give a batch file under enrich/batches.');

  // 1. Inputs, all read before anything is recorded or sent.
  const dir = await realpath(join(root, 'enrich')), batches = await realpath(join(dir, 'batches'));
  const batch = await realpath(resolve(dir, 'batches', input.batch.trim()));
  if (!batches.startsWith(dir + sep) || !batch.startsWith(batches + sep)) throw new WorkflowRefusal('Batch must be under enrich/batches.');
  const batchText = await readFile(batch, 'utf8');
  const keys = [...new Set(batchText.split('\n').filter((s) => s.trim()).map((s) => { try { return (JSON.parse(s) as { key?: unknown }).key; } catch { return s.trim(); } }))];
  if (!keys.length || keys.some((k) => typeof k !== 'string' || !KEY.test(k))) throw new WorkflowRefusal('The batch needs keyed JSONL rows or one key per line.');
  if (keys.length > c.maxFindings) throw new WorkflowRefusal(`The batch has ${keys.length} findings; a cloud run takes at most ${c.maxFindings}. Cut it in parts.`);
  const findings = new Map<string, Finding>();
  for (const k of keys as string[]) {
    const file = join(dir, 'raw', `${k}.json`);
    let real: string;
    try { real = await realpath(file); } catch { throw new WorkflowRefusal('A finding the batch names is not on the server; push its W1 first. Nothing was run.'); }
    if (!real.startsWith(dir + sep)) throw new Error('A finding escapes enrich.');
    const f = JSON.parse(await readFile(real, 'utf8')) as Finding;
    if (!Array.isArray(f.facts)) throw new WorkflowRefusal('A finding the batch names has no facts list; nothing was run.');
    findings.set(k, f);
  }
  if (await readFile(join(dir, review)).then(() => true, () => false)) throw new WorkflowRefusal(`${review} is already on the server; name this round's file anew.`);
  const cited = [...new Set([...findings.values()].flatMap((f) => f.facts.map((x) => x?.source?.url).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))))];
  const system = await w1cSystemPrompt();
  const correct = input.correct === true;
  const correctionSystem = correct ? await correctionSystemPrompt() : null;
  const inputHash = sha(batchText + '\n' + JSON.stringify([...findings.entries()]));
  const configHash = sha(JSON.stringify(config.cloudWorkflows));

  // 2. The envelope: evidence is exactly the cited pages; delegation and a frozen breaker are refused there.
  const db = await getDb();
  const deadline = new Date(now() + c.maxSeconds * 1000);
  let envelopeId: string;
  try {
    envelopeId = await createEnvelope(actor, {
      task: `W1c fact check in the cloud: grade ${keys.length} findings against their cited pages`,
      scope: `enrich/raw for the batch's keys (read${correct ? '; corrected findings written back, originals kept under enrich/inbox' : ''}); enrich/${review} (write, new)`,
      allowedEvidence: cited, allowedCommands: [...W1C_COMMANDS],
      budget: { tokens: c.maxTokens, seconds: c.maxSeconds }, deadline,
      outputSchema: 'fact-review row, lib/enrich/fact-review.ts', escalationOwnerId: actor,
      acceptanceCriteria: ['every fact has one grade', 'counts match the grades', 'an unread page grades unavailable', 'only cited pages read'],
    });
  } catch (e) {
    if (e instanceof EnvelopeViolation) throw new WorkflowRefusal(`Refused by the agent rules: ${e.message}`);
    throw e;
  }
  const agentRun = (await db.query<{ run_id: string }>(
    `insert into agents.run (envelope_id, status, config_hash, config_snapshot, input_hash, prompt_hash, agent_kind, rationale)
     values ($1, 'unavailable', $2, $3, $4, $5, 'cloud-w1c', 'running') returning run_id::text`,
    [envelopeId, configHash, JSON.stringify(config.cloudWorkflows), inputHash, sha(system)]))[0]!.run_id;
  const evidence = new Set(cited);
  const toolCalls: Array<[string, boolean, string | null]> = [];
  const policy = (tool: (typeof W1C_COMMANDS)[number], url?: string): string | null => {
    const refusal = !W1C_COMMANDS.includes(tool) ? `"${tool}" is not in this run's envelope`
      : url !== undefined && !evidence.has(url) ? 'not a page the findings cite'
      : now() > deadline.getTime() ? 'past the run\'s deadline' : null;
    // A host, never a full URL: the address of a page can carry a name.
    let host = 'unparsable address';
    try { if (url) host = new URL(url).hostname; } catch { /* recorded as unparsable */ }
    toolCalls.push([url ? `${tool} ${host}` : tool, refusal === null, refusal]);
    return refusal;
  };

  // 3. Pinned in the ledger before any page is read or any call is made.
  const model = c.model;
  const ledger = { root };
  const runId = await beginRun({ parentRunId: null, workflow: 'W1c', operation: 'cloud',
    protocol: { version: null, hash: sha(system + (correctionSystem ?? '')) }, source: 'app', agent: 'Capital OS cloud W1c (Anthropic Messages API, no tools)', model,
    launchFolder: `import job, envelope ${envelopeId}`, workerFolder: process.cwd(),
    batch: { id: basename(batch), manifest: `enrich/batches/${basename(batch)}`, hash: inputHash, planned: keys.length } }, ledger);

  const usage = usageZero();
  const grades: Record<string, number> = Object.fromEntries(FACT_GRADES.map((g) => [g, 0]));
  const rows: string[] = [];
  const corrections = new Map<string, Finding>();
  let correctionsRefused = 0;
  let graded = 0, failed = 0, skipped = 0, stopReason: string | null = null, written: string | null = null;
  const reader = new PageReader(deps.pages);
  const pages = new Map<string, CitedPage>();
  let crashed = false, result: CloudResult | undefined;
  try {
    // 4. Each cited page once; a site that refused is tried once more at the end.
    for (const url of cited) {
      if (policy('fetch-cited-page', url)) { stopReason = 'deadline reached while reading pages'; break; }
      pages.set(url, await reader.read(url));
    }
    for (const [url, page] of pages) if (page.state === 'host-stopped' && !stopReason) {
      if (policy('fetch-cited-page', url)) { stopReason = 'deadline reached while reading pages'; break; }
      pages.set(url, await reader.read(url, true));
    }

    // 5–6. One call a finding; the answer held to the rules before it is kept.
    for (const k of keys as string[]) {
      const f = findings.get(k)!;
      if (stopReason) { skipped++; continue; }
      const used = (usage.input ?? 0) + (usage.output ?? 0);
      if (used >= c.maxTokens) { stopReason = 'token budget reached'; skipped++; continue; }
      if (policy('anthropic-messages')) { stopReason = 'deadline reached'; skipped++; continue; }
      const factPages = f.facts.map((x) => pages.get(x?.source?.url ?? ''));
      const given = Object.fromEntries([...new Set(f.facts.map((x) => x?.source?.url).filter((u): u is string => Boolean(u)))].map((u) => {
        const p = pages.get(u);
        return [u, p?.state === 'read' ? { state: 'read', text: p.text.slice(0, config.cloudWorkflows.pages.maxChars), cut: p.truncated } : { state: 'unavailable', note: p?.why ?? 'not read' }];
      }));
      const user = JSON.stringify({ key: f.key, name: f.name, identity: { basis: f.identity?.basis, canonical: f.identity?.canonical ?? null },
        facts: f.facts.map((x, i) => ({ i, field: x.field, value: x.value, detail: x.detail ?? null, quote: x.quote ?? null, scope: x.scope ?? 'person', source: x.source?.url ?? null })),
        pages: given });
      let reply: ModelReply;
      try { reply = await (deps.callModel ?? anthropicMessages)(key, { model, system, user, maxTokens: c.maxOutputTokensPerFinding }); }
      catch { failed++; continue; }
      usage.input! += reply.usage.input + reply.usage.cacheRead + reply.usage.cacheWrite; usage.output! += reply.usage.output;
      usage.cacheRead! += reply.usage.cacheRead; usage.cacheWrite! += reply.usage.cacheWrite;
      let row: { key: string; identity: string; identityNote: string; facts: Array<{ i: number; grade: string; note: string }>; counts?: Record<string, number> };
      try { row = JSON.parse(reply.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { failed++; continue; }
      if (reply.stop !== 'end_turn' || !row || row.key !== k || !Array.isArray(row.facts) || row.facts.length !== f.facts.length) { failed++; continue; }
      row.facts = row.facts.map((g, i) => {
        const page = factPages[i], fact = f.facts[i]!;
        if (!page || page.state !== 'read') return { i, grade: 'unavailable', note: page?.why ? `Not read: ${page.why}.` : 'No cited page to read.' };
        if (g?.grade === 'supported' && fact.quote && !page.sec && !quoteOnPage(fact.quote, page.text)) {
          return { i, grade: 'partly', note: `${typeof g.note === 'string' ? g.note + ' ' : ''}The quote is not on the page word for word (mechanical check).`.trim() };
        }
        return { i, grade: g?.grade, note: typeof g?.note === 'string' ? g.note.slice(0, 500) : '' };
      });
      const count = (g: string) => row.facts.filter((x) => x.grade === g).length;
      row.counts = { supported: count('supported'), partly: count('partly'), notSupported: count('not supported'), someoneElse: count('someone else'), unavailable: count('unavailable') };
      const clean = { key: k, identity: row.identity, identityNote: typeof row.identityNote === 'string' ? row.identityNote.slice(0, 500) : row.identityNote, facts: row.facts, counts: row.counts };
      if (factReviewProblems(clean, f).length) { failed++; continue; }
      for (const x of row.facts) grades[x.grade] = (grades[x.grade] ?? 0) + 1;
      rows.push(JSON.stringify(clean));
      graded++;

      // The second step, only when the launch asks for it and only where a grade calls for it.
      if (!correctionSystem || !row.facts.some((x) => ['partly', 'not supported', 'someone else'].includes(x.grade))) continue;
      if ((usage.input ?? 0) + (usage.output ?? 0) >= c.maxTokens) { stopReason = 'token budget reached'; continue; }
      if (policy('anthropic-messages')) { stopReason = 'deadline reached'; continue; }
      let fix: ModelReply;
      try {
        fix = await (deps.callModel ?? anthropicMessages)(key, { model, system: correctionSystem, maxTokens: c.maxOutputTokensPerCorrection,
          user: JSON.stringify({ finding: f, grades: clean, pages: given }) });
      } catch { correctionsRefused++; continue; }
      usage.input! += fix.usage.input + fix.usage.cacheRead + fix.usage.cacheWrite; usage.output! += fix.usage.output;
      usage.cacheRead! += fix.usage.cacheRead; usage.cacheWrite! += fix.usage.cacheWrite;
      let proposal: { finding?: Finding; what?: unknown };
      try { proposal = JSON.parse(fix.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { correctionsRefused++; continue; }
      if (fix.stop !== 'end_turn' || typeof proposal?.what !== 'string' || !proposal.what.trim()
        || correctionProblems(f, proposal.finding, row.facts, pages).length) { correctionsRefused++; continue; }
      corrections.set(k, withCorrection(f, proposal.finding!, proposal.what.trim(), new Date(now()).toISOString().slice(0, 10)));
    }

    // 7. The review file, new, with the rows that passed.
    if (rows.length) { await placeNew(dir, review, rows.join('\n') + '\n', runId); written = review; }
    // Corrected findings replace their originals, each kept first under enrich/inbox/<run>/replaced/, as a push does.
    for (const [k, fixed] of corrections) {
      const target = join(dir, 'raw', `${k}.json`), kept = join(dir, 'inbox', runId, 'replaced', 'raw', `${k}.json`);
      await mkdir(dirname(kept), { recursive: true });
      if (!(await realpath(dirname(kept))).startsWith(dir + sep) || !(await realpath(target)).startsWith(dir + sep)) throw new Error('A path escapes enrich.');
      await copyFile(target, kept);
      const temporary = `${target}.${runId}.tmp`;
      await writeFile(temporary, JSON.stringify(fixed, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    }
  } catch (e) {
    crashed = true;
    throw e;
  } finally {
    // Recorded whatever happened: a crash after rows were graded but before the file was written keeps nothing.
    if (crashed && !written) graded = 0;
    const outcome = crashed ? 'failed' : graded === keys.length ? 'succeeded' : graded > 0 ? 'partial' : 'failed';
    const reason = outcome === 'succeeded' ? null : crashed ? 'the run stopped with an error; see the server log' : [stopReason, failed ? `${failed} findings' answers failed the checks` : null].filter(Boolean).join('; ') || 'no finding was graded';
    const read = [...pages.values()].filter((p) => p.state === 'read').length;
    for (const [tool, allowed, refusal] of toolCalls) await db.query('insert into agents.tool_call (run_id, tool, allowed, refusal) values ($1,$2,$3,$4)', [agentRun, tool, allowed, refusal]);
    await db.query(`update agents.run set status = $2::agents.run_status, output = $3, rationale = $4, finished_at = now() where run_id = $1`,
      [agentRun, graded ? 'proposed' : 'unavailable', JSON.stringify({ review: written, graded, failed, skipped, grades, corrected: written ? corrections.size : 0, correctionsRefused, ledgerRun: runId }), reason]);
    await appendAudit({ actorId: actor, action: 'workflow.cloud_run', subjectType: 'agent_run', subjectId: agentRun,
      detail: { workflow: 'W1c', ledgerRun: runId, review: written, findings: keys.length, graded, failed, skipped, grades, corrected: written ? corrections.size : 0, correctionsRefused,
        pages: { cited: cited.length, read, requests: reader.requests }, tokens: { input: usage.input, output: usage.output }, outcome } }, db);
    await finishRun(runId, {
      counts: { selected: keys.length, written: graded, valid: graded, failed, skipped },
      checks: [{ name: 'fact-review validator', status: graded ? 'pass' : 'not-run' }, { name: 'only cited pages read', status: 'pass' },
        { name: 'quotes checked against their pages', status: read ? 'pass' : 'not-run' },
        { name: 'corrections held to the protocol', status: correct ? 'pass' : 'not-run' }],
      usage, outcome, reason }, ledger);
    result = { runId, review: written, findings: keys.length, graded, failed, skipped, grades, corrected: written ? corrections.size : 0, correctionsRefused,
      pages: { cited: cited.length, read, unavailable: cited.length - read, requests: reader.requests }, outcome, reason };
  }
  return result!;
}

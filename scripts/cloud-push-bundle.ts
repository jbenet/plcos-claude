/**
 * The push body for scripts/cloud-push.sh (docs/deploy/railway.md §7), checked here on the Mac before
 * anything leaves it: the importer's validators and the Dakota refusal (lib/sync/bundle.ts), the same
 * checks the server runs again.
 *
 *   node --import tsx scripts/cloud-push-bundle.ts [--check] [--workflow W1|W1c|W5] [--run <mac run id>]
 *     [--source claude-code|chatgpt|script] [--agent <name>] [--model <id>] <file>...
 *
 * Each <file> is an output where its workflow wrote it — …/enrich/raw/<key>.json,
 * …/enrich/strategy/[<vehicle>/]<key>.json, …/enrich/fact-review-<NN><part>.jsonl — or one bundle
 * ({ workflow, files }) made earlier. The workflow is read from the paths unless given. With --check it
 * prints counts and problems only; without, it prints the body on stdout, and nothing at all if a check fails.
 * Problems name files and fields, never their content.
 */
import { readFile, realpath } from 'node:fs/promises';
import { checkBundle, RAW, REVIEW, STRATEGY, type PushBundle, type PushWorkflow } from '../lib/sync/bundle';
import { config } from '../config/deployment';

async function main() {
  const args = process.argv.slice(2);
  const opt: Record<string, string> = {};
  const files: string[] = [];
  let checkOnly = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--check') checkOnly = true;
    else if (['--workflow', '--run', '--source', '--agent', '--model'].includes(a)) opt[a.slice(2)] = args[++i] ?? '';
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else files.push(a);
  }
  if (!files.length) throw new Error('give the output files to push');
  let bundle: Partial<PushBundle>;
  const first = files.length === 1 && files[0]!.endsWith('.json') ? JSON.parse(await readFile(files[0]!, 'utf8')) as Partial<PushBundle> : null;
  if (first && Array.isArray(first.files) && typeof first.workflow === 'string') bundle = first;
  else {
    const out: PushBundle['files'] = [];
    for (const f of files) {
      const real = await realpath(f);
      const at = real.lastIndexOf('/enrich/');
      if (at < 0) throw new Error(`${f}: not under an enrich/ folder; push files where their workflow wrote them`);
      const path = real.slice(at + '/enrich/'.length);
      if (!RAW.test(path) && !STRATEGY.test(path) && !REVIEW.test(path)) throw new Error(`${f}: not a research output (raw/<key>.json, strategy/[<vehicle>/]<key>.json or fact-review-<NN>.jsonl)`);
      const text = await readFile(real, 'utf8');
      let content: unknown;
      try { content = REVIEW.test(path) ? text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : JSON.parse(text); }
      catch { throw new Error(`${f}: does not parse`); }
      out.push({ path, content });
    }
    const kinds = new Set(out.map((f) => (REVIEW.test(f.path) ? 'review' : RAW.test(f.path) ? 'raw' : 'strategy')));
    const inferred: PushWorkflow | null = kinds.has('review') ? (kinds.has('strategy') ? null : 'W1c') : kinds.size === 1 ? (kinds.has('raw') ? 'W1' : 'W5') : null;
    const workflow = (opt.workflow || inferred) as PushWorkflow | null;
    if (!workflow) throw new Error('these files mix workflows; push findings, reviews and strategies separately, or give --workflow');
    bundle = { workflow, files: out };
  }
  if (opt.run || opt.source || opt.agent || opt.model) {
    bundle.run = { ...(bundle.run ?? {}), ...(opt.run ? { id: opt.run } : {}), ...(opt.source ? { source: opt.source } : {}),
      ...(opt.agent ? { agent: opt.agent } : {}), ...(opt.model ? { model: opt.model } : {}) };
  }
  const { bundle: ok, rejections } = checkBundle(bundle, config.sync.maxPushFiles);
  if (!ok) {
    console.error(`cloud-push: refused here; nothing was sent. ${rejections.length} problem${rejections.length === 1 ? '' : 's'}:`);
    for (const r of rejections) console.error(`  ${r.path ?? 'the push'}: ${r.problems.join('; ')}`);
    process.exit(1);
  }
  const body = JSON.stringify(ok);
  if (Buffer.byteLength(body) > config.sync.maxPushBytes) {
    console.error(`cloud-push: the push is ${Buffer.byteLength(body)} bytes, over the server's ${config.sync.maxPushBytes}; push the batch in parts.`);
    process.exit(1);
  }
  if (checkOnly) console.error(`cloud-push: ${ok.files.length} file${ok.files.length === 1 ? '' : 's'}, ${ok.workflow}, checked here: valid, no Dakota claims.`);
  else process.stdout.write(body);
}

main().catch((e: unknown) => {
  // A parse error can echo file content: say only which step failed.
  console.error(`cloud-push: ${e instanceof SyntaxError ? 'a file does not parse' : e instanceof Error ? e.message : 'failed'}`);
  process.exit(1);
});

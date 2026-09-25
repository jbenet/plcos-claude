/**
 * W12's output, checked and merged (N81, docs/19).
 *
 *   DATA_PROFILE=real npx tsx scripts/event-tag-merge.ts --check t01   one batch's tags against its records
 *   DATA_PROFILE=real npx tsx scripts/event-tag-merge.ts               every batch's tags into event-tags.jsonc
 *
 * A tag needs a record in its batch, "raise" or "other", only the batch's vehicles, no vehicle with
 * "other", and a short basis with no health detail — the same check translation makes when it loads
 * the file (lib/connectors/affinity/event-tags.ts), run early so an agent can fix its own. The
 * merge writes <data>/event-tags.jsonc, which the next translation lays over the rules. Counts only,
 * and refs, which name no one.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { checkLine, type TagLine } from '../lib/connectors/affinity/event-tags';
import type { TagBatch } from './event-tag-batch';

interface Out { batch?: string; by?: string; at?: string; tags?: Record<string, TagLine> }

const root = join(process.cwd(), config.data.root, 'tags');
const MAX_BASIS = 220;

async function load(name: string): Promise<{ batch: TagBatch; out: Out | null }> {
  const batch = JSON.parse(await readFile(join(root, 'batches', `${name}.json`), 'utf8')) as TagBatch;
  const out = await readFile(join(root, 'out', `${name}.json`), 'utf8').then((t) => JSON.parse(t) as Out).catch(() => null);
  return { batch, out };
}

function check(batch: TagBatch, out: Out | null): { problems: string[]; counts: Record<string, number> } {
  const problems: string[] = [];
  const counts: Record<string, number> = { records: batch.records.length, tagged: 0, vehicle: 0, inferred: 0, continues: 0, unclear: 0, other: 0 };
  if (!out?.tags) return { problems: ['no output file, or no "tags" in it'], counts };
  const slugs = new Set(batch.vehicles.map((v) => v.slug));
  const refs = new Set(batch.records.map((r) => r.ref));
  for (const [ref, line] of Object.entries(out.tags)) {
    if (!refs.has(ref)) { problems.push(`${ref}: not a record in this batch`); continue; }
    const c = checkLine(ref, line, slugs);
    if (typeof c === 'string') { problems.push(`${ref}: ${c}`); continue; }
    if (!c.basis) problems.push(`${ref}: no basis`);
    else if (c.basis.length > MAX_BASIS) problems.push(`${ref}: basis over ${MAX_BASIS} characters`);
    counts.tagged++;
    if (c.about === 'other') counts.other++;
    else if (!c.vehicles.length) counts.unclear++;
    else {
      counts.vehicle++;
      if (/^inferred\b/i.test(c.basis ?? '')) counts.inferred++;
      if (/^continues\b/i.test(c.basis ?? '')) counts.continues++;
    }
  }
  const missing = [...refs].filter((r) => !out.tags![r]);
  if (missing.length) problems.push(`${missing.length} records with no tag: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
  return { problems, counts };
}

async function main() {
  const i = process.argv.indexOf('--check');
  if (i >= 0) {
    const name = process.argv[i + 1];
    if (!name) throw new Error('Which batch? --check t01');
    const { batch, out } = await load(name);
    const { problems, counts } = check(batch, out);
    console.log(`${name}: ${JSON.stringify(counts)}`);
    for (const p of problems.slice(0, 40)) console.log(`  problem: ${p}`);
    if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
    process.exit(problems.length ? 1 : 0);
  }

  // The first pass's batches (tNN), then any second look (eNN and the like), whose tags win.
  const names = (await readdir(join(root, 'batches'))).filter((f) => /^[a-z]\d+\.json$/.test(f)).map((f) => f.slice(0, -5))
    .sort((a, b) => Number(a[0] !== 't') - Number(b[0] !== 't') || a.localeCompare(b));
  const tags: Record<string, TagLine> = {};
  const total: Record<string, number> = {};
  const bad: string[] = [];
  for (const name of names) {
    const { batch, out } = await load(name);
    const { problems, counts } = check(batch, out);
    for (const [k, v] of Object.entries(counts)) total[k] = (total[k] ?? 0) + v;
    if (problems.length) bad.push(`${name} (${problems.length})`);
    const slugs = new Set(batch.vehicles.map((v) => v.slug));
    for (const [ref, line] of Object.entries(out?.tags ?? {})) {
      const c = checkLine(ref, line, slugs);
      if (typeof c !== 'string' && batch.records.some((r) => r.ref === ref) && c.basis && c.basis.length <= MAX_BASIS) tags[ref] = c;
    }
  }
  const at = new Date().toISOString();
  const body = [
    '// Claude\'s reading of what each event is about (W12, docs/19; N81). Written by',
    '// scripts/event-tag-merge.ts from the batches under tags/out/. Translation lays these over the',
    '// rules; a person\'s tag on the LP\'s page stands over them. A basis that begins "Inferred:" is a',
    '// guess from the LP\'s one list, made on Juan\'s standing instruction to decide in bulk: search for',
    '// the word to find and correct them all.',
    JSON.stringify({ by: 'claude (W12 sub-agents)', at, tags }, null, 1),
    '',
  ].join('\n');
  await writeFile(join(process.cwd(), config.data.root, 'event-tags.jsonc'), body);
  console.log(`${Object.keys(tags).length} tags written to ${config.data.root}/event-tags.jsonc · ${JSON.stringify(total)}${bad.length ? ` · batches with problems: ${bad.join(', ')}` : ''}`);
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });

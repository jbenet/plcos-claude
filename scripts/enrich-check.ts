/**
 * Check every finding under data/<profile>/enrich/raw/ against lib/enrich/schema.ts (N64), and
 * print counts and problems — names never, so the output can be pasted anywhere.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-check.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { check, type Finding } from '../lib/enrich/schema';
import { checkStrategy, isStale, nextTooLong, type Strategy } from '../lib/enrich/strategy';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich', 'raw');
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const tally: Record<string, number> = {}, method: Record<string, number> = {};
  const found = new Map<string, Finding>();
  let facts = 0, sourced = 0, bad = 0, conns = 0;
  const kinds: Record<string, number> = {}, conf: Record<string, number> = {}, types: Record<string, number> = {};
  for (const f of files) {
    let x: Finding;
    try { x = JSON.parse(await readFile(join(dir, f), 'utf8')) as Finding; } catch (e) { console.log(`  ${f.slice(0, 8)}: not JSON`); bad++; continue; }
    const problems = check(x, f.replace(/\.json$/, ''));
    if (problems.length) { bad++; console.log(`  ${f.slice(0, 8)}: ${problems.join('; ')}`); }
    tally[x.identity?.match ?? '?'] = (tally[x.identity?.match ?? '?'] ?? 0) + 1;
    const m = x.researched?.method ?? 'search';
    method[m] = (method[m] ?? 0) + 1;
    found.set(x.key, x);
    facts += x.facts?.length ?? 0;
    conns += x.connections?.length ?? 0;
    for (const fa of x.facts ?? []) {
      kinds[fa.field] = (kinds[fa.field] ?? 0) + 1;
      conf[fa.confidence] = (conf[fa.confidence] ?? 0) + 1;
      if (fa.quote) sourced++;
    }
    const t = x.profile?.investorType ?? 'none';
    types[t] = (types[t] ?? 0) + 1;
  }
  console.log(`${files.length} findings · ${bad} with problems · identity ${JSON.stringify(tally)} · method ${JSON.stringify(method)}`);
  console.log(`${facts} facts (${sourced} quoted) · ${conns} connections · confidence ${JSON.stringify(conf)}`);
  console.log(`fields ${JSON.stringify(kinds)}`);
  console.log(`investor types ${JSON.stringify(types)}`);
  // W5: the strategies, if any.
  const sdir = join(process.cwd(), config.data.root, 'enrich', 'strategy');
  const sfiles = (await readdir(sdir).catch(() => [])).filter((f) => f.endsWith('.json'));
  let sbad = 0, stale = 0, long = 0;
  const MONEY_SHAPES = ['fund commitment', 'SPV', 're-up or upsize'];
  const moneyAsk = new Map<string, string>();
  const lists: Record<string, number> = {}, shapes: Record<string, number> = {};
  for (const f of sfiles) {
    let x: unknown;
    try { x = JSON.parse(await readFile(join(sdir, f), 'utf8')); } catch { console.log(`  strategy ${f.slice(0, 8)}: not JSON`); sbad++; continue; }
    const problems = checkStrategy(x, f.replace(/\.json$/, ''));
    if (problems.length) { sbad++; console.log(`  strategy ${f.slice(0, 8)}: ${problems.join('; ')}`); }
    const s = x as { list?: string; ask?: { shape?: string } };
    if ((x as Strategy).made && isStale(x as Strategy, found.get(f.replace(/\.json$/, '')))) stale++;
    if ((x as Strategy).next?.what && nextTooLong(x as Strategy)) long++;
    if (MONEY_SHAPES.includes((x as Strategy).ask?.shape ?? '')) moneyAsk.set(f.replace(/\.json$/, ''), (x as Strategy).ask.shape);
    lists[s.list ?? '?'] = (lists[s.list ?? '?'] ?? 0) + 1;
    shapes[s.ask?.shape ?? '?'] = (shapes[s.ask?.shape ?? '?'] ?? 0) + 1;
  }
  // Asks drift across batches (W5, iteration 3): a firm whose money is asked for twice. Colleagues by
  // work domain; a `firm-level ask` or anything that isn't money doesn't count.
  const cands = (await readFile(join(process.cwd(), config.data.root, 'enrich', 'candidates.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { key: string; domains: string[] });
  const asksAt = new Map<string, number>();
  for (const c of cands) {
    const shape = moneyAsk.get(c.key);
    if (!shape) continue;
    for (const d of c.domains.filter((x) => !/^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|mac|aol|proton|protonmail|live|msn)\./.test(x))) asksAt.set(d, (asksAt.get(d) ?? 0) + 1);
  }
  const doubled = [...asksAt.values()].filter((n) => n > 1).length;
  if (sfiles.length) console.log(`${sfiles.length} strategies · ${sbad} with problems · ${stale} older than their LP's finding · ${long} with a next step the import cuts at 400 characters · ${doubled} firms asked for money twice · lists ${JSON.stringify(lists)} · asks ${JSON.stringify(shapes)}`);
  if (bad || sbad) process.exitCode = 1;
}
main();

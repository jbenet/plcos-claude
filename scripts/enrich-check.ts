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
import { checkStrategy } from '../lib/enrich/strategy';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich', 'raw');
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const tally: Record<string, number> = {};
  let facts = 0, sourced = 0, bad = 0, conns = 0;
  const kinds: Record<string, number> = {}, conf: Record<string, number> = {}, types: Record<string, number> = {};
  for (const f of files) {
    let x: Finding;
    try { x = JSON.parse(await readFile(join(dir, f), 'utf8')) as Finding; } catch (e) { console.log(`  ${f.slice(0, 8)}: not JSON`); bad++; continue; }
    const problems = check(x, f.replace(/\.json$/, ''));
    if (problems.length) { bad++; console.log(`  ${f.slice(0, 8)}: ${problems.join('; ')}`); }
    tally[x.identity?.match ?? '?'] = (tally[x.identity?.match ?? '?'] ?? 0) + 1;
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
  console.log(`${files.length} findings · ${bad} with problems · identity ${JSON.stringify(tally)}`);
  console.log(`${facts} facts (${sourced} quoted) · ${conns} connections · confidence ${JSON.stringify(conf)}`);
  console.log(`fields ${JSON.stringify(kinds)}`);
  console.log(`investor types ${JSON.stringify(types)}`);
  // W5: the strategies, if any.
  const sdir = join(process.cwd(), config.data.root, 'enrich', 'strategy');
  const sfiles = (await readdir(sdir).catch(() => [])).filter((f) => f.endsWith('.json'));
  let sbad = 0;
  const lists: Record<string, number> = {}, shapes: Record<string, number> = {};
  for (const f of sfiles) {
    let x: unknown;
    try { x = JSON.parse(await readFile(join(sdir, f), 'utf8')); } catch { console.log(`  strategy ${f.slice(0, 8)}: not JSON`); sbad++; continue; }
    const problems = checkStrategy(x, f.replace(/\.json$/, ''));
    if (problems.length) { sbad++; console.log(`  strategy ${f.slice(0, 8)}: ${problems.join('; ')}`); }
    const s = x as { list?: string; ask?: { shape?: string } };
    lists[s.list ?? '?'] = (lists[s.list ?? '?'] ?? 0) + 1;
    shapes[s.ask?.shape ?? '?'] = (shapes[s.ask?.shape ?? '?'] ?? 0) + 1;
  }
  if (sfiles.length) console.log(`${sfiles.length} strategies · ${sbad} with problems · lists ${JSON.stringify(lists)} · asks ${JSON.stringify(shapes)}`);
  if (bad || sbad) process.exitCode = 1;
}
main();

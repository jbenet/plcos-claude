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
import { checkStrategy, gates, isStale, nextOverLimit, nextTooLong, type Strategy } from '../lib/enrich/strategy';
import type { Path } from '../lib/enrich/connect';

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich', 'raw');
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const tally: Record<string, number> = {}, method: Record<string, number> = {};
  const found = new Map<string, Finding>();
  const special: string[] = [];
  const SPECIAL = /\b(church|synagogue|mosque|parish|diocese|congregation|religious|faith[- ]based|evangelical|catholic|jewish|muslim|christian|hindu|buddhist|republican party|democratic party|political action committee|super pac|campaign donor|donated to .{0,30}campaign)\b/i;
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
    const words = [...(x.facts ?? []).map((fa) => `${fa.value} ${fa.quote ?? ''}`), x.profile?.summary ?? '', ...(x.profile?.interests ?? [])].join(' ');
    if (SPECIAL.test(words)) special.push(x.key);
    const t = x.profile?.investorType ?? 'none';
    types[t] = (types[t] ?? 0) + 1;
  }
  console.log(`${files.length} findings · ${bad} with problems · identity ${JSON.stringify(tally)} · method ${JSON.stringify(method)}`);
  // 1.16: nothing in a special category. A word here isn't always one (an organization's name can
  // carry it), so these are for a person to review, not refused.
  if (special.length) console.log(`  review under 1.16 — a religious or political term in ${special.length} findings: ${special.map((k) => k.slice(0, 8)).join(', ')}`);
  console.log(`${facts} facts (${sourced} quoted) · ${conns} connections · confidence ${JSON.stringify(conf)}`);
  console.log(`fields ${JSON.stringify(kinds)}`);
  console.log(`investor types ${JSON.stringify(types)}`);
  // W5: the strategies, if any.
  const sdir = join(process.cwd(), config.data.root, 'enrich', 'strategy');
  const sfiles = (await readdir(sdir).catch(() => [])).filter((f) => f.endsWith('.json'));
  let sbad = 0, stale = 0, long = 0, over = 0;
  const gateCount: Record<string, number> = {};
  const candsByKey = new Map((await readFile(join(process.cwd(), config.data.root, 'enrich', 'candidates.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { key: string; domains: string[]; contact: { lastFromThem: string | null; meetings: number; groupMeetings: number }; money: { track: string; state: string; amount: number } | null }).map((c) => [c.key, c]));
  const best = new Map<string, 'A' | 'B' | 'C' | 'D'>();
  for (const l of (await readFile(join(process.cwd(), config.data.root, 'enrich', 'connections.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
    const p = JSON.parse(l) as Path;
    const cur = best.get(p.lp);
    if (!cur || p.tier < cur) best.set(p.lp, p.tier);
  }
  const MONEY_SHAPES = ['fund commitment', 'SPV', 're-up or upsize'];
  const moneyAsk = new Map<string, string>();
  const lists: Record<string, number> = {}, shapes: Record<string, number> = {};
  for (const f of sfiles) {
    let x: unknown;
    try { x = JSON.parse(await readFile(join(sdir, f), 'utf8')); } catch { console.log(`  strategy ${f.slice(0, 8)}: not JSON`); sbad++; continue; }
    const problems = checkStrategy(x, f.replace(/\.json$/, ''));
    if (problems.length) { sbad++; console.log(`  strategy ${f.slice(0, 8)}: ${problems.join('; ')}`); }
    const s = x as { list?: string; ask?: { shape?: string } };
    const key = f.replace(/\.json$/, '');
    const cand = candsByKey.get(key);
    if ((x as Strategy).made && isStale(x as Strategy, found.get(key), cand ? cand.money : undefined, best.get(key) ?? null)) stale++;
    if ((x as Strategy).next?.what && nextTooLong(x as Strategy)) long++;
    if ((x as Strategy).next?.what && nextOverLimit(x as Strategy)) over++;
    if ((x as Strategy).scores) for (const g of gates(x as Strategy, cand, found.get(key), best.get(key) ?? null)) gateCount[g] = (gateCount[g] ?? 0) + 1;
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
  if (sfiles.length) console.log(`${sfiles.length} strategies · ${sbad} with problems · ${stale} older than their LP's finding · ${long} with a next step the import cuts at 400 characters (${over} over v1.5's 300) · ${doubled} firms asked for money twice · gates ${JSON.stringify(gateCount)} · lists ${JSON.stringify(lists)} · asks ${JSON.stringify(shapes)}`);
  if (bad || sbad) process.exitCode = 1;
}
main();

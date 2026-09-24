/**
 * Check every finding under data/<profile>/enrich/raw/ against lib/enrich/schema.ts (N64), and
 * print counts and problems — names never, so the output can be pasted anywhere.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-check.ts
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
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
    const words = [...(x.facts ?? []).map((fa) => `${fa.value} ${fa.quote ?? ''}`), x.profile?.summary ?? '', ...(x.profile?.interests ?? []),
      ...(x.profile?.cautions ?? []), x.coverage?.note ?? '', ...(x.coverage?.notFound ?? [])].join(' ');
    // A person's name is not a category (N70): a surname "Church", a first name "Christian".
    if (SPECIAL.test(words.replace(/\b[A-Z][a-z]+ Church\b|\bChristian [A-Z][a-z]+\b/g, ''))) special.push(x.key);
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
  let sbad = 0, stale = 0, long = 0, over = 0, namesOthers = 0, staleTies = 0;
  // Another LP named in a strategy (v12, refined in N70): one careless step from telling one LP
  // about another. Fine when the files join them — a path either way, or one firm (a work domain,
  // an organization, or one lead) — or when the text only guards the other's privacy. The rest are
  // counted, and apart from them the ones cited as a W3 row or a connector-plan pairing, which the
  // current files no longer carry (W3's later fixes removed the tie). Full names, two words or more.
  const allCands = (await readFile(join(process.cwd(), config.data.root, 'enrich', 'candidates.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { key: string; name: string; org: string | null; domains: string[] });
  const allNames = allCands.filter((c) => c.name.trim().split(/\s+/).length >= 2 && c.name.length >= 7);
  const keyByName = new Map(allCands.map((c) => [c.name, c.key]));
  const nameByKey = new Map(allCands.map((c) => [c.key, c.name]));
  const PERSONAL = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|mac|aol|proton|protonmail|live|msn)\./;
  const firmOf = (c: { org: string | null; domains: string[] } | undefined) =>
    new Set([...(c?.domains ?? []).filter((d) => !PERSONAL.test(d)), (c?.org ?? '').toLowerCase().trim()].filter(Boolean));
  const firms = new Map(allCands.map((c) => [c.key, firmOf(c)]));
  const pathNames = new Map<string, Set<string>>();
  const near = (a: string, b: string) => pathNames.set(a, new Set([...(pathNames.get(a) ?? []), b]));
  for (const l of (await readFile(join(process.cwd(), config.data.root, 'enrich', 'connections.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
    const p = JSON.parse(l) as Path;
    // A row can file its person under a descriptive name, "X (adviser to Y)" (v14b): match on X too.
    const base = p.other.name.replace(/\s*\([^)]*\)\s*$/, '');
    near(p.lp, p.other.name);
    near(p.lp, base);
    const back = keyByName.get(p.other.name) ?? keyByName.get(base), mine = nameByKey.get(p.lp);
    if (back && mine) near(back, mine);
  }
  const leads = new Map<string, string>();
  const GUARDS = /never (disclosed|reaches|mentioned)|nothing (of|about) [^.]{0,40}(reaches|to )|not in front of|neither one['’]s|no amount/i;
  const CITES_W3 = /\bW3\b|\b[CD] rows?\b|\([CD],|connector plan|\bpaths? run/i;
  const outside: Array<{ key: string; text: string; st: Strategy }> = [];
  const staleTieKeys: string[] = [], gatedKeys: string[] = [];
  const leadPins: Array<{ key: string; lead: { key: string; at: string } }> = [];
  const unpinned: string[] = [];
  const madeAt = new Map<string, string>();
  const gateCount: Record<string, number> = {};
  const candsByKey = new Map((await readFile(join(process.cwd(), config.data.root, 'enrich', 'candidates.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { key: string; domains: string[]; location: string | null; contact: { lastFromThem: string | null; meetings: number; groupMeetings: number }; money: { track: string; state: string; amount: number } | null }).map((c) => [c.key, c]));
  const best = new Map<string, 'A' | 'B' | 'C' | 'D'>();
  for (const l of (await readFile(join(process.cwd(), config.data.root, 'enrich', 'connections.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
    const p = JSON.parse(l) as Path;
    const cur = best.get(p.lp);
    if (!cur || p.tier < cur) best.set(p.lp, p.tier);
  }
  const MONEY_SHAPES = ['fund commitment', 'SPV', 're-up or upsize'];
  const namedOutside = () => {
    for (const { key, text, st } of outside) {
      const own = pathNames.get(key) ?? new Set<string>();
      const mine = firms.get(key) ?? new Set<string>();
      let named = false, cited = false;
      for (const c of allNames) {
        if (c.key === key || !text.includes(c.name) || own.has(c.name) || (st.route?.via ?? '').includes(c.name)) continue;
        if ([...(firms.get(c.key) ?? [])].some((f) => mine.has(f)) || (leads.get(c.key) ?? c.key) === (leads.get(key) ?? key)) continue;
        const at = text.indexOf(c.name);
        const around = text.slice(Math.max(0, at - 160), at + c.name.length + 120);
        if (GUARDS.test(around)) continue;
        named = true;
        if (CITES_W3.test(around) && !/W3 has no path|W3's file doesn['’]t carry|no path between/i.test(around)) cited = true;
      }
      if (named) namesOthers++;
      if (cited) { staleTies++; staleTieKeys.push(key); }
    }
  };
  const moneyAsk = new Map<string, string>();
  const lists: Record<string, number> = {}, shapes: Record<string, number> = {};
  for (const f of sfiles) {
    let x: unknown;
    try { x = JSON.parse(await readFile(join(sdir, f), 'utf8')); } catch { console.log(`  strategy ${f.slice(0, 8)}: not JSON`); sbad++; continue; }
    const problems = checkStrategy(x, f.replace(/\.json$/, ''));
    if (problems.length) { sbad++; console.log(`  strategy ${f.slice(0, 8)}: ${problems.join('; ')}`); }
    const s = x as { list?: string; ask?: { shape?: string } };
    if ((x as Strategy).made?.at) madeAt.set(f.replace(/\.json$/, ''), (x as Strategy).made.at);
    const key = f.replace(/\.json$/, '');
    const cand = candsByKey.get(key);
    if ((x as Strategy).made && isStale(x as Strategy, found.get(key), cand ? cand.money : undefined, best.get(key) ?? null)) stale++;
    // A firm-level strategy repeats its lead's ask and dates (s13): stale once the lead is rewritten.
    const lead = (x as Strategy).made?.inputs?.lead;
    if (lead) leadPins.push({ key, lead });
    else if ((x as Strategy).ask?.shape === 'firm-level ask') unpinned.push(key);
    if ((x as Strategy).next?.what && nextTooLong(x as Strategy)) long++;
    if ((x as Strategy).next?.what && nextOverLimit(x as Strategy)) over++;
    {
      const st = x as Strategy;
      leads.set(key, st.made?.inputs?.lead?.key ?? key);
      outside.push({ key, st, text: [st.angle, st.next?.what, st.route?.why, ...(st.risks ?? []), ...(st.openQuestions ?? [])].filter(Boolean).join(' ') });
    }
    if ((x as Strategy).scores) {
      const gs = gates(x as Strategy, cand, found.get(key), best.get(key) ?? null);
      for (const g of gs) gateCount[g] = (gateCount[g] ?? 0) + 1;
      if (gs.length) gatedKeys.push(key);
    }
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
  namedOutside();
  const movedLeads = leadPins.filter((x) => madeAt.get(x.lead.key) && madeAt.get(x.lead.key) !== x.lead.at);
  const leadMoved = movedLeads.length;
  // `--stale-ties`, `--gated`, `--lead-moved` and `--unpinned`, each with a file, write those keys,
  // one a line, for a revision batch.
  for (const [flag, keys] of [['--stale-ties', staleTieKeys], ['--gated', gatedKeys], ['--lead-moved', movedLeads.map((x) => x.key)], ['--unpinned', unpinned]] as const) {
    const at = process.argv.indexOf(flag);
    if (at > 0 && process.argv[at + 1]) await writeFile(process.argv[at + 1], keys.join('\n') + '\n');
  }
  // A lead carries its firm, so a colleague's newer finding makes the lead stale too (s24).
  const leadsBehind = new Set(leadPins.filter((x) => { const f = found.get(x.key); const at = madeAt.get(x.lead.key); return f && at && f.researched.at > at; }).map((x) => x.lead.key)).size;
  if (sfiles.length) console.log(`${sfiles.length} strategies · ${sbad} with problems · ${stale} older than their LP's finding · ${long} with a next step the import cuts at 400 characters (${over} over v1.5's 300) · ${doubled} firms asked for money twice · ${leadMoved} firm-level strategies whose lead was rewritten since (${unpinned.length} firm-level asks pin no lead) · ${leadsBehind} leads older than a colleague's finding · ${namesOthers} naming an LP the files don't join to them (${staleTies} citing a W3 tie the files no longer carry) · gates ${JSON.stringify(gateCount)} · lists ${JSON.stringify(lists)} · asks ${JSON.stringify(shapes)}`);
  if (bad || sbad) process.exitCode = 1;
}
main();

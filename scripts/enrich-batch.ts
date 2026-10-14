/**
 * Cut the next batches for a research or strategy run (docs/19, iteration 3), whole firms together.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-batch.ts w1 <prefix> [size]   who to research next
 *   DATA_PROFILE=real npx tsx scripts/enrich-batch.ts w5 <prefix> [size]   who needs a strategy
 *
 * A firm is everyone joined by a work domain, the organization on file, or the organization the
 * research found (W5 learnings: colleagues split across batches got clashing owners and asks
 * counted twice). A firm is never split, so a batch can run over its size by one firm.
 *
 *   w1   no finding yet, or a pages-only one when `--search` is given (v1.6: owed a pass with
 *        search); by status (discussing, selected, connecting), then triage lane.
 *   w5   a resolved finding with no strategy, or a strategy older than its finding; or W9's warm
 *        lane with no strategy. Within a firm, the colleague with the most contact comes first, so
 *        the lead conversation's strategy is written before the others read it.
 *        With `--keys <file>` (N81): listed LPs with strategies or eligible for new ones, one key a line, firms whole.
 *        With `--max <n>` (docs/30, the Astra runner): write only the first n batches, so the rest stay
 *        free for the next cut.
 *        With `--revise` (W5 v1.5): strategies written before version 1.3, or that the critic's
 *        gates flag, or with a next step over 300 characters — and every colleague at their firm,
 *        so a firm is rewritten together.
 *        With `--tighten` (W5 1.13, the Astra "Shorten strategies" run): strategies written before 1.13
 *        whose vehicle's pursuit is Committed, Discussing, Connecting or Selected, furthest first (Juan,
 *        11 Oct 2026: "start further down the pipeline and work way back to selected ones"), in either
 *        layout (strategy/<key>.json or strategy/<vehicle>/<key>.json), colleagues in the same firm together.
 *   With `--vehicle <slug or name,…>` (the Astra night plan, migration 027): only LPs with a pursuit in those vehicles;
 *        with `--tighten`, only those vehicles' strategies, at every stage (Juan, 12 Oct 2026: "my focus is currently on
 *        closing the PLC Neurotech Fund I and Netholabs SPV").
 *
 * Writes batches/<prefix>NN.jsonl (w1: identity lines from research-set.jsonl) or .txt (w5: keys),
 * and prints counts only.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { candidateKey } from '../lib/enrich/candidate-key';
import type { Candidate } from '../lib/enrich/candidates';
import { norm } from '../lib/enrich/connect';
import { pagesOnly, type Finding } from '../lib/enrich/schema';
import { bestTiers, contextAtFor, gates, isStale, nextOverLimit, TIGHT_FROM, versionBefore, type Strategy } from '../lib/enrich/strategy';
import type { Path } from '../lib/enrich/connect';
import type { Triage } from '../lib/enrich/triage';

/** How long a cut W5 batch holds its keys: a guess — batches have finished within the hour so far. */
const OPEN_HOURS = 3;
const FREE = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|mac|aol|proton|protonmail|live|msn)\./;
const lines = (s: string) => s.split('\n').filter(Boolean);

async function jsonDir<T extends { key: string }>(dir: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try { const x = JSON.parse(await readFile(join(dir, f), 'utf8')) as T; out.set(x.key, x); } catch { /* the checker reports it */ }
  }
  return out;
}

/** Every strategy file in either layout, read loosely: only its key, version and vehicle are needed. */
async function strategyFiles(dir: string): Promise<Array<{ key: string; version: unknown; vehicle: string; folder: string | null }>> {
  const out: Array<{ key: string; version: unknown; vehicle: string; folder: string | null }> = [];
  const read = async (file: string, folder: string | null) => {
    try {
      const x = JSON.parse(await readFile(file, 'utf8')) as Partial<Strategy>;
      if (typeof x.key === 'string') out.push({ key: x.key, version: x.made?.version, vehicle: folder ?? String(x.ask?.vehicle ?? ''), folder });
    } catch { /* the checker reports it */ }
  };
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isFile() && e.name.endsWith('.json')) await read(join(dir, e.name), null);
    else if (e.isDirectory()) for (const f of (await readdir(join(dir, e.name)).catch(() => [])).filter((x) => x.endsWith('.json'))) await read(join(dir, e.name, f), e.name);
  }
  return out;
}

/** `--tighten`: the furthest pursuit status first, back to Selected and no further. */
const TIGHTEN: Record<string, number> = { committed: 0, discussing: 1, connecting: 2, selected: 3 };

async function main() {
  // `--keys <file>`: listed LPs eligible for new/revised strategies, plus their firms' strategies.
  const keysAt = process.argv.indexOf('--keys');
  const keysFile = keysAt >= 0 ? process.argv[keysAt + 1] : null;
  const maxAt = process.argv.indexOf('--max');
  const max = maxAt >= 0 ? Number(process.argv[maxAt + 1]) : Infinity;
  const vehicleAt = process.argv.indexOf('--vehicle');
  const focusArg = vehicleAt >= 0 ? process.argv[vehicleAt + 1] ?? '' : null;
  if (!(max >= 1)) { console.error('--max takes a positive number.'); process.exit(2); }
  const [mode, prefix, sizeArg] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--keys', '--max', '--vehicle'].includes(all[i - 1]!));
  const withSearch = process.argv.includes('--search');
  const tighten = process.argv.includes('--tighten');
  const revise = !tighten && (process.argv.includes('--revise') || Boolean(keysFile));
  const only = keysFile ? new Set((await readFile(keysFile, 'utf8')).split('\n').map((k) => k.trim()).filter(Boolean)) : null;
  if ((mode !== 'w1' && mode !== 'w5') || !prefix || (tighten && (mode !== 'w5' || keysFile))) {
    console.error('usage: enrich-batch.ts w1|w5 <prefix> [size] [--search] (--tighten: w5 only, without --keys)');
    process.exit(2);
  }
  const size = Number(sizeArg ?? 15);
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const cands = lines(await readFile(join(dir, 'candidates.jsonl'), 'utf8')).map((l) => JSON.parse(l) as Candidate);
  const identity = new Map(lines(await readFile(join(dir, 'research-set.jsonl'), 'utf8')).map((l) => [JSON.parse(l).key as string, l]));
  const triage = new Map(lines(await readFile(join(dir, 'triage.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as Triage).map((t) => [t.key, t]));
  const rawFindings = await jsonDir<Finding>(join(dir, 'raw'));
  const aliases: Record<string, string> = JSON.parse(await readFile(join(dir, 'entity-keys.json'), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return '{}';
  }));
  const candidateKeys = new Set(cands.map(c => c.key));
  const findings = new Map<string, Finding>();
  let unmapped = 0;
  for (const f of rawFindings.values()) {
    const key = candidateKey(f, cands, aliases, f);
    if (!key) { unmapped++; continue; }
    // Multiple aliases may describe one candidate. Use its most recent research.
    const previous = findings.get(key);
    if (!previous || f.researched.at > previous.researched.at) findings.set(key, { ...f, key });
  }
  if (unmapped) console.log(`${unmapped} findings not mapped to candidates; refresh Export the research set to update aliases.`);
  // Strategies by the LP they resolve to, as findings are: one filed under an identity alias is that LP's (12 Oct 2026:
  // Astra W5 runs were handed LPs whose strategy sat under another key, revised the alias file, and pushed nothing).
  const strategies = new Map<string, Strategy>();
  for (const s of (await jsonDir<Strategy>(join(dir, 'strategy'))).values()) {
    const key = candidateKey(s, cands, aliases, rawFindings.get(s.key)) ?? s.key;
    const previous = strategies.get(key);
    if (!previous || s.made.at > previous.made.at) strategies.set(key, s);
  }
  /** LPs with a strategy in either layout, under any of their keys: never handed out for a new one. */
  const hasStrategy = new Set((await strategyFiles(join(dir, 'strategy'))).map((f) => candidateKey(f, cands, aliases, rawFindings.get(f.key)) ?? f.key));
  // A top-level strategy names its vehicle by name or slug; team context is matched by slug.
  const vehicles: Array<{ slug: string; name: string; kind?: string }> = JSON.parse(await readFile(join(dir, 'vehicles.json'), 'utf8').catch(() => '[]'));
  const vehicleOf = (named: string | undefined) => {
    const n = (named ?? '').trim().toLowerCase();
    return vehicles.find((v) => v.slug.toLowerCase() === n || v.name.toLowerCase() === n) ?? null;
  };
  // `--vehicle`: a pursuit or strategy counts when its vehicle is named by slug or name.
  const focus = focusArg === null ? null : new Set(focusArg.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  if (focus && !focus.size) { console.error('--vehicle takes one or more vehicle slugs or names, comma-separated.'); process.exit(2); }
  const inFocus = (named: string | undefined) => {
    if (!focus) return true;
    const v = vehicleOf(named);
    return focus.has((named ?? '').trim().toLowerCase()) || Boolean(v && (focus.has(v.slug.toLowerCase()) || focus.has(v.name.toLowerCase())));
  };
  const focused = (c: Candidate) => !focus || c.pursuits.some((p) => inFocus(p.vehicle ?? undefined));
  // Keys already in a batch file for this mode and not yet done are left to that batch; once done
  // (a finding, a strategy), they are eligible again — for a search pass, or a stale strategy.
  const batched = new Set<string>();
  /** w5: keys in a batch of either mode (new or revise) not yet written since the batch was cut (v09). */
  const openW5 = new Set<string>();
  /** w1 --search: keys in an Astra batch cut within OPEN_HOURS, by when it was cut. */
  const openW1 = new Map<string, number>();
  for (const entry of await readdir(join(dir, 'batches'), { withFileTypes: true }).catch(() => [])) {
    // Run folders (e.g. w5gap-20260927/) sit beside the batch files; only files are batches.
    if (!entry.isFile()) continue;
    const f = entry.name;
    const text = await readFile(join(dir, 'batches', f), 'utf8');
    if (mode === 'w1' && f.endsWith('.jsonl')) for (const l of lines(text)) batched.add(JSON.parse(l).key);
    if (mode === 'w5' && /^s\d+\.txt$/.test(f)) for (const k of lines(text)) batched.add(k.trim());
    // A batch is open for a few hours after it is cut, never for good (W5 after the search pass): a
    // strategy re-pinned without a new `made.at` stayed "in an open batch" long after that batch had
    // finished, and 28 stale strategies went unbatched. Batches finish within the hour.
    // The Astra runner's W5 batches (astra-<job>-NN.txt) hold their keys the same way, so two runs never share LPs.
    // A search pass's Astra batch (astra-<job>-NN.jsonl) holds its keys the same way: their pages-only findings stay
    // pages-only until the run writes, so without this two runs cut minutes apart would research the same LPs.
    if (mode === 'w1' && withSearch && /^astra-[\w-]+\.jsonl$/.test(f)) {
      const cut = (await stat(join(dir, 'batches', f))).mtime.getTime();
      if (Date.now() - cut < OPEN_HOURS * 3_600_000) for (const l of lines(text)) openW1.set(JSON.parse(l).key, Math.max(cut, openW1.get(JSON.parse(l).key) ?? 0));
    }
    if (mode === 'w5' && /^([suv]\d+|astra-[\w-]+)\.txt$/.test(f)) {
      const cut = (await stat(join(dir, 'batches', f))).mtime.getTime();
      if (Date.now() - cut < OPEN_HOURS * 3_600_000) for (const k of lines(text).map((x) => x.trim())) openW5.add(`${k} ${cut}`);
    }
  }

  // Firms: union-find over the keys that share a domain or an organization.
  const parent = new Map(cands.map((c) => [c.key, c.key]));
  const find = (k: string): string => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k)!)), parent.get(k)!));
  const byMark = new Map<string, string>();
  // Our own domains join nobody (v01): an old protocol.ai address isn't a firm the two share now.
  const ours = new Set(((JSON.parse(await readFile(join(dir, 'us', 'network.json'), 'utf8').catch(() => '{"orgs":[]}')) as { orgs: Array<{ domains?: string[] }> }).orgs).flatMap((o) => o.domains ?? []));
  for (const c of cands) {
    const f = findings.get(c.key);
    const marks = [
      ...c.domains.filter((d) => !FREE.test(d) && !ours.has(d)).map((d) => `d:${d}`),
      ...[c.org, ...(f?.identity.match === 'confirmed' || f?.identity.match === 'probable' ? (f.identity.canonical?.org ?? '').split(/\s*;\s*/) : [])]
        .filter((o): o is string => Boolean(o && norm(o).length > 2)).map((o) => `o:${norm(o)}`),
    ];
    for (const m of marks) {
      const other = byMark.get(m);
      if (other) parent.set(find(c.key), find(other)); else byMark.set(m, c.key);
    }
  }

  const STATUS: Record<string, number> = { committed: 0, discussing: 1, selected: 2, connecting: 3 };
  const LANE: Record<string, number> = { 'warm now': 0, 'research first': 1, 'long process': 2, cold: 3 };
  // The lead is who has had one-to-ones with us: a meeting on a group date is an event (v02's learning).
  const contact = (c: Candidate) => Math.max(0, c.contact.meetings - c.contact.groupMeetings) * 10 + (c.contact.lastFromThem ? 5 : 0) + (c.contact.lastTouch ? 1 : 0);
  // `--tighten`: each LP ranks by the furthest status among the vehicles whose strategy is still long.
  const tightRank = new Map<string, number>();
  if (tighten) {
    const byKey = new Map(cands.map((c) => [c.key, c]));
    // With `--vehicle`, every stage of those vehicles, the furthest first; without, back to Selected and no further.
    const rankOf = (status: string | undefined) => TIGHTEN[status ?? ''] ?? (focus ? 4 : undefined);
    for (const f of await strategyFiles(join(dir, 'strategy'))) {
      if (!versionBefore(f.version as string, TIGHT_FROM) || !inFocus(f.vehicle)) continue;
      // Resolved as the checker resolves it: a strategy filed under an alias is its LP's (12 Oct 2026: the alias-blind cut
      // left 98 older Selected and 27 older Connecting strategies untightened).
      const key = candidateKey(f, cands, aliases, rawFindings.get(f.key));
      const c = key ? byKey.get(key) : undefined;
      const v = vehicleOf(f.vehicle);
      const names = [f.vehicle, v?.name, v?.slug].filter(Boolean).map((n) => n!.trim().toLowerCase());
      const sameVehicle = (x: { vehicle?: string | null }) => {
        const n = (x.vehicle ?? '').trim().toLowerCase(), xv = vehicleOf(x.vehicle ?? undefined);
        return names.includes(n) || Boolean(xv && v && xv.slug === v.slug);
      };
      // A top-level strategy whose vehicle matches no pursuit (renamed, or named loosely) takes the LP's furthest pursuit.
      const p = c?.pursuits.find(sameVehicle)
        ?? (f.folder === null ? c?.pursuits.filter((x) => inFocus(x.vehicle ?? undefined)).sort((a, b) => (rankOf(a.status) ?? 9) - (rankOf(b.status) ?? 9)).at(0) : undefined);
      const r = rankOf(p?.status);
      if (c && r !== undefined) tightRank.set(c.key, Math.min(r, tightRank.get(c.key) ?? 9));
    }
  }
  const rank = (c: Candidate) => (tighten ? tightRank.get(c.key) ?? 9 : STATUS[c.pursuits[0]?.status ?? ''] ?? 9) * 10 + (LANE[triage.get(c.key)?.lane ?? ''] ?? 4);

  const best = new Map<string, 'A' | 'B' | 'C' | 'D'>();
  const paths = lines(await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as Path);
  for (const p of paths) {
    const cur = best.get(p.lp);
    if (!cur || p.tier < cur) best.set(p.lp, p.tier);
  }
  const pinTiers = bestTiers(paths);
  const flagged = (c: Candidate) => {
    const s = strategies.get(c.key);
    return Boolean(s && (versionBefore(s.made.version, '1.3') || nextOverLimit(s) || gates(s, c, findings.get(c.key), best.get(c.key) ?? null).length));
  };
  // Written since its batch was cut, or never batched: free. Otherwise its open batch keeps it.
  const inOpenBatch = (key: string) => [...openW5].some((x) => {
    const [k, cut] = x.split(' ');
    if (k !== key) return false;
    const s = strategies.get(key);
    return !s || new Date(s.made.at).getTime() < Number(cut);
  });
  let wanted = cands.filter((c) => {
    const f = findings.get(c.key);
    if (mode === 'w5' && inOpenBatch(c.key)) return false;
    if (!focused(c)) return false;
    if (tighten) return tightRank.has(c.key);
    if (batched.has(c.key) && (mode === 'w1' ? !f : !strategies.has(c.key))) return false;
    if (mode === 'w1') return !f || (withSearch && pagesOnly(f) && !(openW1.has(c.key) && Date.parse(f.researched.at) < openW1.get(c.key)!));
    const resolved = f && (f.identity.match === 'confirmed' || f.identity.match === 'probable');
    const s = strategies.get(c.key);
    const engaged = ['discussing', 'committed'].includes(c.pursuits[0]?.status ?? '');
    const eligible = Boolean(resolved || engaged || triage.get(c.key)?.lane === 'warm now');
    if (only) return only.has(c.key) && Boolean(s || eligible);
    if (s) return isStale(s, f, c.money, pinTiers(c.key), contextAtFor(c.context, vehicleOf(s.ask?.vehicle)?.slug), vehicleOf(s.ask?.vehicle)?.kind ?? null) || (revise && flagged(c));
    // Discussing or committed: a strategy from our records even without a resolved finding — a
    // firm's lead can be one of them (v03's learning). Not when one already exists in a vehicle folder or under an alias.
    return !revise && eligible && !hasStrategy.has(c.key);
  });
  if (revise) {
    // The whole firm comes along: its colleagues' strategies are rewritten with the lead's.
    const roots = new Set(wanted.map((c) => find(c.key)));
    const selected = new Set(wanted.map(c => c.key));
    wanted = cands.filter((c) => selected.has(c.key) || (strategies.has(c.key) && roots.has(find(c.key)) && !inOpenBatch(c.key)));
  }
  if (mode === 'w5' && only) {
    const selected = new Set(wanted.map(c => c.key));
    const omitted: Record<string, number> = { 'no finding': 0, unresolved: 0, 'not a candidate': 0, 'open batch': 0, 'already batched': 0 };
    for (const key of only) {
      if (selected.has(key)) continue;
      const reason = !candidateKeys.has(key) ? 'not a candidate' : inOpenBatch(key) ? 'open batch'
        : batched.has(key) && !strategies.has(key) ? 'already batched'
        : !findings.has(key) ? 'no finding' : 'unresolved';
      omitted[reason]++;
    }
    console.log(`--keys: ${[...only].filter(k => !selected.has(k)).length} of ${only.size} listed keys not selected (${Object.entries(omitted).map(([why, n]) => `${why}: ${n}`).join(', ')}).`);
  }
  const firms = new Map<string, Candidate[]>();
  for (const c of wanted) firms.set(find(c.key), [...(firms.get(find(c.key)) ?? []), c]);
  const ordered = [...firms.values()]
    .map((cs) => cs.sort((a, b) => contact(b) - contact(a) || rank(a) - rank(b)))
    .sort((a, b) => Math.min(...a.map(rank)) - Math.min(...b.map(rank)) || b.length - a.length);

  const batches: Candidate[][] = [];
  let cur: Candidate[] = [];
  for (const firm of ordered) {
    if (cur.length && cur.length + firm.length > size) { batches.push(cur); cur = []; }
    cur.push(...firm);
  }
  if (cur.length) batches.push(cur);
  batches.splice(max);

  await mkdir(join(dir, 'batches'), { recursive: true });
  const existing = (await readdir(join(dir, 'batches'))).filter((f) => f.startsWith(prefix)).length;
  for (const [i, b] of batches.entries()) {
    const name = `${prefix}${String(existing + i + 1).padStart(2, '0')}`;
    if (mode === 'w1') await writeFile(join(dir, 'batches', `${name}.jsonl`), b.map((c) => identity.get(c.key)!).join('\n') + '\n', 'utf8');
    else await writeFile(join(dir, 'batches', `${name}.txt`), b.map((c) => c.key).join('\n') + '\n', 'utf8');
  }
  const multi = ordered.filter((f) => f.length > 1).length;
  console.log(`${mode}${tighten ? ' --tighten' : ''}: ${wanted.length} LPs in ${ordered.length} firms (${multi} with colleagues) → ${batches.length} batches of ~${size} (${prefix}${String(existing + 1).padStart(2, '0')}…)`);
}
main();

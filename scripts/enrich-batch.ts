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
 *        With `--revise` (W5 v1.5): strategies written before version 1.3, or that the critic's
 *        gates flag, or with a next step over 300 characters — and every colleague at their firm,
 *        so a firm is rewritten together.
 *
 * Writes batches/<prefix>NN.jsonl (w1: identity lines from research-set.jsonl) or .txt (w5: keys),
 * and prints counts only.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import type { Candidate } from '../lib/enrich/candidates';
import { norm } from '../lib/enrich/connect';
import { pagesOnly, type Finding } from '../lib/enrich/schema';
import { gates, isStale, nextOverLimit, type Strategy } from '../lib/enrich/strategy';
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

async function main() {
  const [mode, prefix, sizeArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const withSearch = process.argv.includes('--search');
  const revise = process.argv.includes('--revise');
  if ((mode !== 'w1' && mode !== 'w5') || !prefix) {
    console.error('usage: enrich-batch.ts w1|w5 <prefix> [size] [--search]');
    process.exit(2);
  }
  const size = Number(sizeArg ?? 15);
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const cands = lines(await readFile(join(dir, 'candidates.jsonl'), 'utf8')).map((l) => JSON.parse(l) as Candidate);
  const identity = new Map(lines(await readFile(join(dir, 'research-set.jsonl'), 'utf8')).map((l) => [JSON.parse(l).key as string, l]));
  const triage = new Map(lines(await readFile(join(dir, 'triage.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as Triage).map((t) => [t.key, t]));
  const findings = await jsonDir<Finding>(join(dir, 'raw'));
  const strategies = await jsonDir<Strategy>(join(dir, 'strategy'));
  // Keys already in a batch file for this mode and not yet done are left to that batch; once done
  // (a finding, a strategy), they are eligible again — for a search pass, or a stale strategy.
  const batched = new Set<string>();
  /** w5: keys in a batch of either mode (new or revise) not yet written since the batch was cut (v09). */
  const openW5 = new Set<string>();
  for (const f of await readdir(join(dir, 'batches')).catch(() => [])) {
    const text = await readFile(join(dir, 'batches', f), 'utf8');
    if (mode === 'w1' && f.endsWith('.jsonl')) for (const l of lines(text)) batched.add(JSON.parse(l).key);
    if (mode === 'w5' && /^s\d+\.txt$/.test(f)) for (const k of lines(text)) batched.add(k.trim());
    // A batch is open for a few hours after it is cut, never for good (W5 after the search pass): a
    // strategy re-pinned without a new `made.at` stayed "in an open batch" long after that batch had
    // finished, and 28 stale strategies went unbatched. Batches finish within the hour.
    if (mode === 'w5' && /^[suv]\d+\.txt$/.test(f)) {
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
  const rank = (c: Candidate) => (STATUS[c.pursuits[0]?.status ?? ''] ?? 9) * 10 + (LANE[triage.get(c.key)?.lane ?? ''] ?? 4);

  const best = new Map<string, 'A' | 'B' | 'C' | 'D'>();
  for (const l of lines(await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => ''))) {
    const p = JSON.parse(l) as Path;
    const cur = best.get(p.lp);
    if (!cur || p.tier < cur) best.set(p.lp, p.tier);
  }
  const flagged = (c: Candidate) => {
    const s = strategies.get(c.key);
    return Boolean(s && (s.made.version < 1.3 || nextOverLimit(s) || gates(s, c, findings.get(c.key), best.get(c.key) ?? null).length));
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
    if (batched.has(c.key) && (mode === 'w1' ? !f : !strategies.has(c.key))) return false;
    if (mode === 'w1') return !f || (withSearch && pagesOnly(f));
    const resolved = f && (f.identity.match === 'confirmed' || f.identity.match === 'probable');
    const s = strategies.get(c.key);
    if (s) return isStale(s, f, c.money, best.get(c.key) ?? null, c.context?.[0]?.at ?? null) || (revise && flagged(c));
    // Discussing or committed: a strategy from our records even without a resolved finding — a
    // firm's lead can be one of them (v03's learning).
    const engaged = ['discussing', 'committed'].includes(c.pursuits[0]?.status ?? '');
    return !revise && Boolean(resolved || engaged || triage.get(c.key)?.lane === 'warm now');
  });
  if (revise) {
    // The whole firm comes along: its colleagues' strategies are rewritten with the lead's.
    const roots = new Set(wanted.map((c) => find(c.key)));
    wanted = cands.filter((c) => strategies.has(c.key) && roots.has(find(c.key)));
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

  await mkdir(join(dir, 'batches'), { recursive: true });
  const existing = (await readdir(join(dir, 'batches'))).filter((f) => f.startsWith(prefix)).length;
  for (const [i, b] of batches.entries()) {
    const name = `${prefix}${String(existing + i + 1).padStart(2, '0')}`;
    if (mode === 'w1') await writeFile(join(dir, 'batches', `${name}.jsonl`), b.map((c) => identity.get(c.key)!).join('\n') + '\n', 'utf8');
    else await writeFile(join(dir, 'batches', `${name}.txt`), b.map((c) => c.key).join('\n') + '\n', 'utf8');
  }
  const multi = ordered.filter((f) => f.length > 1).length;
  console.log(`${mode}: ${wanted.length} LPs in ${ordered.length} firms (${multi} with colleagues) → ${batches.length} batches of ~${size} (${prefix}${String(existing + 1).padStart(2, '0')}…)`);
}
main();

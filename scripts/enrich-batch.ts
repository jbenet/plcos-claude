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
 *
 * Writes batches/<prefix>NN.jsonl (w1: identity lines from research-set.jsonl) or .txt (w5: keys),
 * and prints counts only.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import type { Candidate } from '../lib/enrich/candidates';
import { norm } from '../lib/enrich/connect';
import { pagesOnly, type Finding } from '../lib/enrich/schema';
import { isStale, type Strategy } from '../lib/enrich/strategy';
import type { Triage } from '../lib/enrich/triage';

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
  for (const f of await readdir(join(dir, 'batches')).catch(() => [])) {
    const text = await readFile(join(dir, 'batches', f), 'utf8');
    if (mode === 'w1' && f.endsWith('.jsonl')) for (const l of lines(text)) batched.add(JSON.parse(l).key);
    if (mode === 'w5' && /^s\d+\.txt$/.test(f)) for (const k of lines(text)) batched.add(k.trim());
  }

  // Firms: union-find over the keys that share a domain or an organization.
  const parent = new Map(cands.map((c) => [c.key, c.key]));
  const find = (k: string): string => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k)!)), parent.get(k)!));
  const byMark = new Map<string, string>();
  for (const c of cands) {
    const f = findings.get(c.key);
    const marks = [
      ...c.domains.filter((d) => !FREE.test(d)).map((d) => `d:${d}`),
      ...[c.org, f?.identity.match === 'confirmed' || f?.identity.match === 'probable' ? f.identity.canonical?.org : null]
        .filter((o): o is string => Boolean(o && norm(o).length > 2)).map((o) => `o:${norm(o)}`),
    ];
    for (const m of marks) {
      const other = byMark.get(m);
      if (other) parent.set(find(c.key), find(other)); else byMark.set(m, c.key);
    }
  }

  const STATUS: Record<string, number> = { committed: 0, discussing: 1, selected: 2, connecting: 3 };
  const LANE: Record<string, number> = { 'warm now': 0, 'research first': 1, 'long process': 2, cold: 3 };
  const contact = (c: Candidate) => c.contact.meetings * 10 + (c.contact.lastFromThem ? 5 : 0) + (c.contact.lastTouch ? 1 : 0);
  const rank = (c: Candidate) => (STATUS[c.pursuits[0]?.status ?? ''] ?? 9) * 10 + (LANE[triage.get(c.key)?.lane ?? ''] ?? 4);

  const wanted = cands.filter((c) => {
    const f = findings.get(c.key);
    if (batched.has(c.key) && (mode === 'w1' ? !f : !strategies.has(c.key))) return false;
    if (mode === 'w1') return !f || (withSearch && pagesOnly(f));
    const resolved = f && (f.identity.match === 'confirmed' || f.identity.match === 'probable');
    const s = strategies.get(c.key);
    if (s) return Boolean(f && isStale(s, f));
    return Boolean(resolved || triage.get(c.key)?.lane === 'warm now');
  });
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

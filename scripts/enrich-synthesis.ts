/**
 * W8, step back (N64, docs/19): read everything the workflows wrote and write
 * data/<profile>/enrich/synthesis.md — the portfolio view: coverage, signals, this year's best
 * opportunities, connector leverage, firm clusters, themes, gaps, and our presence. The file names
 * names, so it stays under data/ (git ignores it); what this prints is counts only.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-synthesis.ts
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import type { Candidate } from '../lib/enrich/candidates';
import type { Path } from '../lib/enrich/connect';
import type { Finding } from '../lib/enrich/schema';
import type { Strategy } from '../lib/enrich/strategy';
import type { Triage } from '../lib/enrich/triage';

const lines = (s: string) => s.split('\n').filter(Boolean);
async function jsonFiles<T>(dir: string): Promise<T[]> {
  const out: T[] = [];
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try { out.push(JSON.parse(await readFile(join(dir, f), 'utf8')) as T); } catch { /* the checker reports it */ }
  }
  return out;
}
const count = <T,>(xs: T[], k: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [k(x)]: (m[k(x)] ?? 0) + 1 }), {});
const top = (m: Record<string, number>, n = 12) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const cands = lines(await readFile(join(dir, 'candidates.jsonl'), 'utf8')).map((l) => JSON.parse(l) as Candidate);
  const byKey = new Map(cands.map((c) => [c.key, c]));
  const findings = await jsonFiles<Finding>(join(dir, 'raw'));
  const strategies = await jsonFiles<Strategy>(join(dir, 'strategy'));
  const paths = lines(await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as Path);
  const triage = lines(await readFile(join(dir, 'triage.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as Triage);
  const materials = JSON.parse(await readFile(join(dir, 'presence', 'materials.json'), 'utf8').catch(() => '{}')) as { grades?: Array<{ criterion: string; grade: string; basis: string }>; suggestions?: string[] };

  const resolved = findings.filter((f) => f.identity.match === 'confirmed' || f.identity.match === 'probable');
  const neuroRe = /neuro|brain|bci|neural|biotech|health|medic|longevity|bio\b|biology|clinical|psychiatr/i;
  const neuro = resolved.filter((f) => f.facts.some((x) => x.confidence !== 'low' && neuroRe.test(`${x.field === 'interest' || x.field === 'investment' || x.field === 'statement' || x.field === 'philanthropy' || x.field === 'board' ? x.value : ''}`)) || (f.profile?.interests ?? []).some((i) => neuroRe.test(i)));
  const plTie = new Set(paths.filter((p) => p.other.type === 'ours' && p.kind !== 'met').map((p) => p.lp));
  const types = count(resolved, (f) => f.profile?.investorType ?? 'unknown');
  const interests = count(resolved.flatMap((f) => (f.profile?.interests ?? []).map((i) => i.toLowerCase().replace(/\s*\(.*\)$/, ''))), (i) => i);

  const LEVEL: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
  const BAND: Record<string, number> = { '>$25M': 5, '$5–25M': 4, '$1–5M': 3, '$250K–1M': 2, '<$250K': 1 };
  const thisYear = strategies.filter((s) => s.list === 'this year')
    .sort((a, b) => (LEVEL[b.scores.propensity.level] ?? 0) - (LEVEL[a.scores.propensity.level] ?? 0) || (BAND[b.scores.capacity.band] ?? 0) - (BAND[a.scores.capacity.band] ?? 0));
  const who = count(strategies, (s) => s.next.who.split(/[ (,—]/)[0] ?? '?');
  const shapes = count(strategies, (s) => s.ask.shape);

  // Connector leverage: committed LPs linked to the most prospects (same firm, or named in their record).
  const committed = new Set(cands.filter((c) => c.pursuits.some((p) => p.status === 'committed')).map((c) => c.key));
  const lever = count(paths.filter((p) => p.other.type === 'lp' && p.other.key && committed.has(p.other.key) && !committed.has(p.lp)), (p) => p.other.name);
  // Firm clusters: several LPs at one firm, and whether any has met us.
  const firms = new Map<string, Candidate[]>();
  for (const c of cands) if (c.org) firms.set(c.org, [...(firms.get(c.org) ?? []), c]);
  const clusters = [...firms.entries()].filter(([, cs]) => cs.length >= 2)
    .map(([org, cs]) => ({ org, n: cs.length, met: cs.filter((c) => c.contact.meetings > 0).map((c) => c.name) }))
    .sort((a, b) => b.n - a.n);

  const gaps = count(findings.flatMap((f) => (f.coverage?.notFound ?? []).filter((x) => /for a person/i.test(x)).map((x) => x.replace(/^for a person:\s*/i, '').split(/[;,]/)[0]!.trim().toLowerCase())), (x) => x);

  const md: string[] = [];
  md.push(`# Synthesis — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
  md.push('Local only: this names names. Built by scripts/enrich-synthesis.ts from the files beside it.', '');
  md.push('## Coverage', '');
  md.push(`- Research set: ${cands.length} LPs. Researched: ${findings.length} (${resolved.length} resolved; ${findings.length - resolved.length} ambiguous or not found, with no facts).`);
  md.push(`- Investor types among the resolved: ${top(types).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  md.push(`- Neuro, health or biotech signal: ${neuro.length} of ${resolved.length}. A tie to Protocol Labs or our portfolio beyond meetings: ${[...plTie].length} LPs.`);
  md.push(`- Strategies: ${strategies.length} (${count(strategies, (s) => s.list)['this year'] ?? 0} this year, ${count(strategies, (s) => s.list)['2027'] ?? 0} for 2027, ${count(strategies, (s) => s.list)['not now'] ?? 0} not now). Asks: ${top(shapes).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  md.push(`- Triage of the rest (W9): ${top(count(triage, (t) => t.lane)).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');

  md.push('## This year — the best opportunities, by readiness then capacity', '');
  for (const s of thisYear.slice(0, 25)) {
    const c = byKey.get(s.key);
    md.push(`- **${s.name}** (${c?.pursuits[0]?.status ?? '?'}, ${s.scores.capacity.band}, propensity ${s.scores.propensity.level}) — ${s.next.what} · *${s.next.who}${s.next.when ? `, ${s.next.when}` : ''}*${s.route ? ` · way in ${s.route.tier}: ${s.route.via}` : ''}`);
  }
  md.push('');
  md.push('## Who the next steps fall to', '', ...top(who).map(([k, v]) => `- ${k}: ${v}`), '');
  md.push('## Connector leverage — committed LPs next to prospects', '');
  md.push(...(top(lever).length ? top(lever).map(([k, v]) => `- ${k}: next to ${v} prospect${v === 1 ? '' : 's'} (same firm or named in their record)`) : ['- None found yet.']), '');
  md.push('## Firm clusters — several LPs at one firm', '');
  for (const c of clusters.slice(0, 20)) md.push(`- ${c.org}: ${c.n} LPs${c.met.length ? `; met us: ${c.met.join(', ')}` : '; none has met us'}`);
  md.push('');
  md.push('## What they care about — themes across the researched', '', ...top(interests, 20).map(([k, v]) => `- ${k} (${v})`), '');
  md.push('## The warm lane (W9)', '');
  for (const t of triage.filter((x) => x.lane === 'warm now')) md.push(`- **${t.name}** — ${t.reasons.slice(0, 3).join('; ')}`);
  md.push('');
  md.push('## What only a person can check', '', ...top(gaps, 10).map(([k, v]) => `- ${k} (${v})`), '');
  if (materials.grades) {
    md.push('## Our presence (W7)', '', ...materials.grades.map((g) => `- ${g.criterion}: **${g.grade}** — ${g.basis}`), '', ...(materials.suggestions ?? []).map((s, i) => `${i + 1}. ${s}`), '');
  }
  await writeFile(join(dir, 'synthesis.md'), md.join('\n') + '\n', 'utf8');
  console.log(`synthesis: ${cands.length} in the set, ${findings.length} researched (${resolved.length} resolved), ${neuro.length} neuro signals, ${plTie.size} with a PL tie, ${strategies.length} strategies (${thisYear.length} this year), ${clusters.length} firm clusters, triage ${JSON.stringify(count(triage, (t) => t.lane))}`);
}
main();

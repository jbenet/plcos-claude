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
import type { ConnectorPlan } from '../lib/enrich/connectors';

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

  const committed = new Set(cands.filter((c) => c.pursuits.some((p) => p.status === 'committed')).map((c) => c.key));
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
  md.push(`- Triage of the rest (W9): ${top(count(triage, (t) => t.lane)).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  md.push(`- How the findings were made: ${top(count(findings, (f) => f.researched?.method ?? 'search')).map(([k, v]) => `${k} ${v}`).join(', ')} (a pages-only finding is owed a pass with search).`, '');

  md.push('## This year — the best opportunities, by readiness then capacity', '');
  for (const s of thisYear.slice(0, 25)) {
    const c = byKey.get(s.key);
    md.push(`- **${s.name}** (${c?.pursuits[0]?.status ?? '?'}, ${s.scores.capacity.band}, propensity ${s.scores.propensity.level}) — ${s.next.what} · *${s.next.who}${s.next.when ? `, ${s.next.when}` : ''}*${s.route ? ` · way in ${s.route.tier}: ${s.route.via}` : ''}`);
  }
  md.push('');
  // The close gap (iteration 3): committed on the pipeline, and what the close track can show.
  // Soft and hard never blend (rule 1): each state is its own line, and nothing here is a total of
  // money across states.
  const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`);
  const onTrack = cands.filter((c) => c.pursuits.some((p) => p.status === 'committed'));
  const byState = new Map<string, Candidate[]>();
  for (const c of onTrack) {
    const k = !c.money ? 'no close track' : c.money.wired > 0 ? 'cash received' : c.money.track === 'hard' ? 'hard (countersigned)'
      : c.money.signedOn ? 'signed, recorded by us' : c.money.signedPerSource ? 'signed per a source, unverified' : 'soft, unsigned';
    byState.set(k, [...(byState.get(k) ?? []), c]);
  }
  md.push('## The close gap — committed on the pipeline, and what the close track shows', '');
  md.push('Soft is soft until signed and countersigned (rule 1). Each line is its own state; the amounts are the LPs’ own, not a total across states.', '');
  for (const [state, cs] of [...byState.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sum = cs.reduce((n, c) => n + (c.money?.amount ?? 0), 0);
    md.push(`- **${state}**: ${cs.length} LP${cs.length === 1 ? '' : 's'}${sum ? `, ${usd(sum)} in that state` : ''}`);
    for (const c of cs) md.push(`  - ${c.name}${c.money ? ` — ${usd(c.money.amount)}` : ''}${c.notes[0]?.summary ? ` · latest note (${c.notes[0].on}): ${c.notes[0].summary.slice(0, 160)}` : ''}`);
  }
  md.push('');
  // The first notes worth writing (iteration 3): Connecting or Selected, a signal of their own —
  // the person's, not their firm's — in our field, and senior. For them a first personal note has
  // an angle ready; W5's, where it has written one.
  const own = (f: Finding) => f.facts.filter((x) => x.confidence !== 'low' && x.scope !== 'firm' && ['interest', 'investment', 'statement', 'philanthropy', 'board'].includes(x.field) && neuroRe.test(x.value));
  const byStrategy = new Map(strategies.map((x) => [x.key, x]));
  const tri = new Map(triage.map((t) => [t.key, t]));
  const firstNotes = resolved
    .filter((f) => ['connecting', 'selected'].includes(byKey.get(f.key)?.pursuits[0]?.status ?? '') && own(f).length > 0)
    .map((f) => ({ f, t: tri.get(f.key), s: byStrategy.get(f.key) }))
    .sort((a, b) => Number(b.t?.senior ?? false) - Number(a.t?.senior ?? false) || (BAND[b.f.profile?.capacity?.band ?? ''] ?? 0) - (BAND[a.f.profile?.capacity?.band ?? ''] ?? 0));
  md.push('## The first notes worth writing — a signal of their own, in our field', '');
  md.push(`${firstNotes.length} Connecting or Selected LPs have a neuro, health or biotech signal of their own (not only their firm's). The check before any note still stands (their triage step).`, '');
  for (const x of firstNotes.slice(0, 30)) {
    md.push(`- **${x.f.name}**${x.t?.first ? ` (first: ${x.t.first})` : ''}${x.f.profile?.capacity?.band && x.f.profile.capacity.band !== 'unknown' ? ` · ${x.f.profile.capacity.band}, an estimate` : ''} — ${own(x.f)[0]!.value.slice(0, 150)}${x.s ? ` · angle: ${x.s.angle.slice(0, 140)}` : ''}`);
  }
  md.push('');
  md.push('## Who the next steps fall to', '', ...top(who).map(([k, v]) => `- ${k}: ${v}`), '');
  md.push('## The connector plan (W11) — who could introduce whom, this quarter', '');
  const plans = JSON.parse(await readFile(join(dir, 'connectors.json'), 'utf8').catch(() => '[]')) as ConnectorPlan[];
  if (!plans.length) md.push('- None found yet.');
  for (const pl of plans) {
    md.push(`- **${pl.connector.name}** (${pl.connector.status}${pl.connector.money ? `, ${pl.connector.money}` : ''}) — ask ${pl.when}: ${pl.prospects.filter((x) => pl.asks.includes(x.key)).map((x) => `${x.name} (tier ${x.tier}, ${x.kind.replace('_', ' ')}${x.list ? `, ${x.list}` : ''})`).join('; ')}${pl.prospects.length > pl.asks.length ? `; ${pl.prospects.length - pl.asks.length} more next quarter` : ''}${pl.toConfirm ? ` · ${pl.toConfirm} tie${pl.toConfirm === 1 ? '' : 's'} to confirm first` : ''}`);
  }
  md.push(`- Committed LPs next to any prospect: ${plans.filter((x) => x.connector.status === 'committed').length} of ${committed.size}. Their networks are mostly not in our records — the way to learn them is to ask, once they have signed (docs/06 §3.3).`, '');
  md.push('## Firm clusters — several LPs at one firm', '');
  for (const c of clusters.slice(0, 20)) md.push(`- ${c.org}: ${c.n} LPs${c.met.length ? `; met us: ${c.met.join(', ')}` : '; none has met us'}`);
  md.push('');
  md.push('## What they care about — themes across the researched', '', ...top(interests, 20).map(([k, v]) => `- ${k} (${v})`), '');
  md.push('## The warm lane (W9)', '');
  for (const t of triage.filter((x) => x.lane === 'warm now')) md.push(`- **${t.name}**${t.first ? ` (first: ${t.first})` : ''} — ${t.reasons.slice(0, 3).join('; ')}`);
  md.push('');
  // What comes before any outreach (iteration 3): a person's check, not a note.
  const firsts = count(triage.filter((t) => t.first), (t) => t.first!);
  md.push('## Before any outreach — the first steps the records point to', '');
  md.push(`- Name an owner: ${firsts['name an owner'] ?? 0} warm LPs have nobody on the team owning the pursuit.`);
  md.push(`- Check sent mail: ${firsts['check sent mail'] ?? 0} LPs have a stage on file that claims contact, with no touch on record.`);
  md.push(`- A first personal note: ${firsts['first personal note'] ?? 0} LPs last heard from us in a mailing.`, '');
  for (const t of triage.filter((x) => x.first === 'check sent mail').slice(0, 40)) md.push(`  - check: ${t.name} (${t.lane})`);
  md.push('');
  md.push('## What only a person can check', '', ...top(gaps, 10).map(([k, v]) => `- ${k} (${v})`), '');
  if (materials.grades) {
    md.push('## Our presence (W7)', '', ...materials.grades.map((g) => `- ${g.criterion}: **${g.grade}** — ${g.basis}`), '', ...(materials.suggestions ?? []).map((s, i) => `${i + 1}. ${s}`), '');
  }
  // Start here (iteration 3): the week in five lines, above everything else.
  const signable = [...byState.entries()].filter(([k]) => k === 'soft, unsigned' || k === 'signed per a source, unverified');
  const start = [
    '## Start here', '',
    `1. **Signatures.** ${signable.map(([k, cs]) => `${cs.length} committed LP${cs.length === 1 ? '' : 's'} ${k}`).join('; ') || 'none waiting'} — the quickest money toward the first close (the close gap, below).`,
    `2. **This week, the five most ready:** ${thisYear.slice(0, 5).map((x) => `${x.name} (${x.next.who.split(/[ (,—]/)[0]})`).join(', ')}.`,
    `3. **Checks before any note:** ${firsts['check sent mail'] ?? 0} to check sent mail, ${firsts['name an owner'] ?? 0} to give an owner, ${firsts['first personal note'] ?? 0} due a first personal note rather than a follow-up.`,
    `4. **Introductions:** ${plans.length} connectors next to ${new Set(plans.flatMap((x) => x.prospects.map((q) => q.key))).size} prospects; ${plans.filter((x) => x.when === 'after they sign').length} ask once their own commitment is signed.`,
    `5. **Research:** ${findings.length} of ${cands.length} read; ${findings.filter((f) => f.researched?.method === 'pages').length} from pages only and owed a search pass; ${firstNotes.length} Connecting or Selected LPs with a neuro or health signal of their own.`,
    '',
  ];
  md.splice(4, 0, ...start);
  await writeFile(join(dir, 'synthesis.md'), md.join('\n') + '\n', 'utf8');
  console.log(`synthesis: ${cands.length} in the set, ${findings.length} researched (${resolved.length} resolved), ${neuro.length} neuro signals, ${plTie.size} with a PL tie, ${strategies.length} strategies (${thisYear.length} this year), ${clusters.length} firm clusters, triage ${JSON.stringify(count(triage, (t) => t.lane))}`);
}
main();

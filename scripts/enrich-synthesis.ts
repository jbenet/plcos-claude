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
import type { Path, PlDirectoryEntry } from '../lib/enrich/connect';
import { pagesOnly, partialSearch, type Finding } from '../lib/enrich/schema';
import { placedOutsideUs, type Strategy } from '../lib/enrich/strategy';
import { NO_FUNDS, type Triage } from '../lib/enrich/triage';
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
  const yearAgoGate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const neuroRe = /neuro|brain|bci|neural|biotech|health|medic|longevity|bio\b|biology|clinical|psychiatr/i;
  const neuro = resolved.filter((f) => f.facts.some((x) => x.confidence !== 'low' && neuroRe.test(`${x.field === 'interest' || x.field === 'investment' || x.field === 'statement' || x.field === 'philanthropy' || x.field === 'board' ? x.value : ''}`)) || (f.profile?.interests ?? []).some((i) => neuroRe.test(i)));
  const plTie = new Set(paths.filter((p) => p.other.type === 'ours' && p.kind !== 'met').map((p) => p.lp));
  const types = count(resolved, (f) => f.profile?.investorType ?? 'unknown');
  const interests = count(resolved.flatMap((f) => (f.profile?.interests ?? []).map((i) => i.toLowerCase().replace(/\s*\(.*\)$/, ''))), (i) => i);

  const LEVEL: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
  const BAND: Record<string, number> = { '>$25M': 5, '$5–25M': 4, '$1–5M': 3, '$250K–1M': 2, '<$250K': 1 };
  const thisYear = strategies.filter((s) => s.list === 'this year')
    .sort((a, b) => (LEVEL[b.scores.propensity.level] ?? 0) - (LEVEL[a.scores.propensity.level] ?? 0) || (BAND[b.scores.capacity.band] ?? 0) - (BAND[a.scores.capacity.band] ?? 0));
  // Who the next steps fall to: the first person of the team named in `next.who`, by first or full
  // name — a firm's name ("its one owner") isn't a person, and an unnamed owner is counted as such.
  const team = (JSON.parse(await readFile(join(dir, 'team.json'), 'utf8').catch(() => '[]')) as Array<{ name: string }>).filter((m) => m.name?.trim());
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const firstNamed = (w: string) => {
    let best: { at: number; name: string } | null = null;
    for (const m of team) for (const n of new Set([m.name, m.name.split(/\s+/)[0]])) {
      const at = w.search(new RegExp(`\\b${esc(n)}\\b`));
      if (at >= 0 && (!best || at < best.at)) best = { at, name: m.name.split(/\s+/)[0] };
    }
    return best?.name ?? 'nobody on the team named';
  };
  const who = count(strategies, (s) => firstNamed(s.next.who));
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
  const plB = new Set(paths.filter((p) => p.other.type === 'ours' && p.kind !== 'met' && (p.tier === 'A' || p.tier === 'B')).map((p) => p.lp));
  md.push(`- Neuro, health or biotech signal: ${neuro.length} of ${resolved.length}. A tie to Protocol Labs, its network or our portfolio beyond meetings: ${[...plTie].length} LPs — ${plB.size} documented (A or B), the rest clues to check (C or D).`);
  md.push(`- Strategies: ${strategies.length} (${count(strategies, (s) => s.list)['this year'] ?? 0} this year, ${count(strategies, (s) => s.list)['2027'] ?? 0} for 2027, ${count(strategies, (s) => s.list)['not now'] ?? 0} not now). Asks: ${top(shapes).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  md.push(`- Triage of the rest (W9): ${top(count(triage.filter((t) => t.first !== 'reply we owe'), (t) => t.lane)).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  md.push(`- How the findings were made: ${top(count(findings, (f) => partialSearch(f) ? 'pages and too few searches' : f.researched?.method ?? 'search')).map(([k, v]) => `${k} ${v}`).join(', ')} (all but search are owed a pass with search).`, '');

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
  // Gates the research found (1.16, 1.17): a firm that says it doesn't invest in funds, and a GP
  // raising a fund of their own right now. Both change the ask before anyone makes it.
  // The same words triage reads (lib/enrich/triage.ts).
  // A raise open now: an offering, a Form D, a first sale, money unsold — not merely a numbered fund.
  const RAISING = /\b(form d|offering|raising|first sale|unsold|remaining to be sold|no sales? yet|still open)\b/i;
  const noFunds = resolved.filter((f) => f.facts.some((x) => NO_FUNDS.test(`${x.value} ${x.quote ?? ''}`)));
  // The newest dated word decides (v08): a fund whose close was announced after its filing is not raising.
  const CLOSED = /\b(final close|closed (its|the|a) fund|held (its|a) (first|final) close|oversubscribed|fully (subscribed|sold))\b/i;
  const closedSince = (f: Finding) => (f.profile?.signals ?? []).some((x) => x.on && x.on >= yearAgoGate && CLOSED.test(x.what)) || f.facts.some((x) => CLOSED.test(x.value) && (x.source.published ?? '') >= yearAgoGate);
  const raisingNow = resolved.filter((f) => !closedSince(f)).filter((f) => (f.profile?.signals ?? []).some((x) => x.on && x.on >= yearAgoGate && RAISING.test(x.what) && /fund/i.test(x.what))
    || f.facts.some((x) => ['fund_gp', 'news', 'capacity'].includes(x.field) && RAISING.test(`${x.value} ${x.quote ?? ''}`) && /fund/i.test(x.value) && (x.source.published ?? '') >= yearAgoGate));
  md.push('## Gates the research found — before anyone asks for a fund commitment', '');
  md.push(`- They say they don't invest in funds: ${noFunds.length ? noFunds.map((f) => f.name).join(', ') : 'none found'}. The fund gate is no; a co-investment or an SPV at most.`);
  const fof = (f: Finding) => f.profile?.investorType === 'fund_lp_program';
  const direct = raisingNow.filter((f) => !fof(f)), vintage = raisingNow.filter(fof);
  md.push(`- Raising a fund of their own right now: ${direct.length ? direct.map((f) => f.name).join(', ') : 'none found'}. Lower propensity for an LP commitment; the ask becomes introductions or co-investing.`);
  md.push(`- A fund of funds raising its next vintage — money for managers like us, in our favour: ${vintage.length ? vintage.map((f) => f.name).join(', ') : 'none found'}.`, '');

  // Founders as references (iteration 3): an LP who backed one of our portfolio companies has a
  // founder in common with us — the founder can say what we're like as investors. C: a shared
  // record, and the founder asked by a person, never routed automatically.
  const coinvest = paths.filter((p) => /portfolio\)$/.test(p.other.name) && p.kind === 'coinvestor');
  md.push('## Founders as references — LPs who backed our portfolio companies', '');
  if (!coinvest.length) md.push('- None found yet.');
  for (const p of coinvest) md.push(`- **${byKey.get(p.lp)?.name ?? p.lp}** (${byKey.get(p.lp)?.pursuits[0]?.status ?? '?'}) — ${p.other.name.replace(/ \(.*portfolio\)$/, '')}: ${p.basis.slice(0, 140)}`);
  md.push('');
  // Timing (iteration 3): dated signals from the last twelve months — an exit, a new fund, a new
  // role — which move capacity or attention, with the date the source gives.
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const timing = resolved.flatMap((f) => (f.profile?.signals ?? []).filter((x) => x.on && x.on >= yearAgo).map((x) => ({ f, x })))
    .sort((a, b) => (b.x.on ?? '').localeCompare(a.x.on ?? ''));
  md.push('## Timing — what changed for them in the last twelve months', '');
  md.push(`${timing.length} dated signals across ${new Set(timing.map((t) => t.f.key)).size} LPs, newest first.`, '');
  for (const t of timing.slice(0, 30)) md.push(`- ${t.x.on} · **${t.f.name}** (${byKey.get(t.f.key)?.pursuits[0]?.status ?? '?'}) — ${t.x.what.slice(0, 160)}`);
  md.push('');

  // Across vehicles (iteration 3): LPs on the Neurotech list whose strategies read a strong or
  // good fit for Rails, or an SPV. Coordinate, don't compete (rule 5): one owner decides which
  // conversation goes first, and the other gets a dated follow-up.
  const RAILS = /rails/i, SPV = /spv/i;
  const cross = strategies.map((x) => ({ x, rails: Object.entries(x.fit ?? {}).find(([k, v]) => RAILS.test(k) && ['strong', 'good'].includes(v.verdict)), spv: Object.entries(x.fit ?? {}).filter(([k]) => SPV.test(k)) }))
    .filter((y) => y.rails || y.spv.length);
  md.push('## Across vehicles — Rails-shaped and SPV-shaped LPs on the Neurotech list', '');
  md.push(`${cross.filter((y) => y.rails).length} read a strong or good fit for Rails; ${cross.filter((y) => y.spv.length).length} have an SPV in their strategy. Coordinate, don't compete (rule 5): one owner decides which conversation goes first, and the other gets a dated follow-up.`, '');
  for (const y of cross.slice(0, 40)) {
    md.push(`- **${y.x.name}** (${byKey.get(y.x.key)?.pursuits[0]?.status ?? '?'}, ask: ${y.x.ask.shape} on ${y.x.ask.vehicle})${y.rails ? ` — Rails ${y.rails[1].verdict}: ${y.rails[1].why.slice(0, 120)}` : ''}${y.spv.length ? ` — ${y.spv.map(([k, v]) => `${k} ${v.verdict}`).join(', ')}` : ''}`);
  }
  md.push('');

  // Conflicts (s22): a competing position in our own field is a gate, listed apart from the
  // affinity signals — a firm's brain-implant stake can be the reason not to write at all.
  const conflicts = strategies.filter((x) => Object.values(x.fit ?? {}).some((v) => (v.gates ?? []).some((g) => /conflict|compet/i.test(g.gate) && g.answer === 'yes'))
    || (x.risks ?? []).some((r) => /\bcompet(ing|itor|es)\b[^.]{0,80}\b(portfolio|position|stake|fund)\b/i.test(r)));
  md.push('## Conflicts — a competing position in our field', '');
  if (!conflicts.length) md.push('- None found.');
  for (const x of conflicts) md.push(`- **${x.name}** — ${(x.risks ?? []).find((r) => /compet/i.test(r))?.slice(0, 160) ?? 'a conflict gate in the fit'}`);
  md.push('');

  // W2n: our own network (iteration 3). People in PL's directory under their own name, and firms
  // that are network teams — the "near us" check the pages-only research couldn't run.
  const dirEntries = lines(await readFile(join(dir, 'us', 'pl-directory.jsonl'), 'utf8').catch(() => '')).map((l) => JSON.parse(l) as PlDirectoryEntry);
  const inDirectory = dirEntries.filter((e) => e.members.some((m) => m.match === 'confirmed'));
  const firmIsTeam = dirEntries.filter((e) => e.firmTeams.length > 0);
  md.push('## Our own network — Protocol Labs’ directory (W2n)', '');
  md.push(`${inDirectory.length} LPs are in PL's directory under their own name, matching our record of them; ${dirEntries.filter((e) => e.members.some((m) => m.match === 'name only')).length} more under the name alone (to confirm); ${firmIsTeam.length} work at a firm that is a network team.`, '');
  for (const e of inDirectory) {
    const m = e.members.find((x) => x.match === 'confirmed')!;
    const main = m.roles.find((r) => r.main) ?? m.roles[0];
    const status = byKey.get(e.key)?.pursuits[0]?.status ?? '?';
    const ip = m.investorProfile;
    md.push(`- **${e.name}** (${status}) — ${main?.role ? `${main.role}, ` : ''}${main?.team ?? 'member'}${m.since ? `, since ${m.since.slice(0, 4)}` : ''}${m.investor ? ' · marked an investor' : ''}${ip?.typicalCheck ? ` · typical check ${ip.typicalCheck}` : ''}${ip?.fundTypes?.length ? ` · backs ${ip.fundTypes.join(', ')}` : ''}${m.events.some((x) => x.speaker) ? ' · has spoken at PL events' : ''}`);
  }
  if (firmIsTeam.length) {
    md.push('', 'Firms that are network teams:', '');
    const byTeam = new Map<string, string[]>();
    for (const e of firmIsTeam) for (const t of e.firmTeams) byTeam.set(`${t.name} (${t.isFund ? 'fund' : 'team'}${t.sources.length ? `; ${t.sources.join(', ')}` : ''})`, [...(byTeam.get(`${t.name} (${t.isFund ? 'fund' : 'team'}${t.sources.length ? `; ${t.sources.join(', ')}` : ''})`) ?? []), e.name]);
    for (const [t, names] of [...byTeam.entries()].sort((a, b) => b[1].length - a[1].length)) md.push(`- ${t}: ${names.join(', ')}`);
  }
  md.push('');
  // We owe them a reply (s13): Discussing or Committed, and the last word on record is theirs — a
  // message, not a meeting — with nothing from us since. Triage covers only the cold; this is the warm.
  const owe = cands.filter((c) => ['discussing', 'committed'].includes(c.pursuits[0]?.status ?? '')
    && c.contact.lastFromThem && !c.contact.awaitingSince && Boolean(c.contact.lastTouchChannel) && c.contact.lastTouchChannel !== 'meeting' && c.contact.lastTouchChannel !== 'call')
    .map((c) => ({ c, days: Math.round((Date.now() - new Date(c.contact.lastFromThem!).getTime()) / 86_400_000) }))
    .sort((a, b) => b.days - a.days);
  md.push('## We owe them a reply — the last word on record is theirs', '');
  md.push(`${owe.length} Discussing or Committed LPs wrote last and have had nothing from us since. Check sent mail first — a reply may have gone from an inbox Affinity doesn't see.`, '');
  for (const { c, days } of owe) md.push(`- **${c.name}** (${c.pursuits[0]?.status}) — they wrote ${days} days ago (${c.contact.lastFromThem}); owner: ${c.pursuits[0]?.owner || 'nobody on the team'}`);
  md.push('');

  // Lapsing soon (v08): a this-year strategy resting on a word from them passes 90 days on a date.
  const now = Date.now();
  const lapsing = strategies.filter((x) => x.list === 'this year').map((x) => ({ x, c: byKey.get(x.key) }))
    .filter(({ c }) => c?.contact.lastFromThem && !c.money)
    .map(({ x, c }) => ({ x, lapses: new Date(new Date(c!.contact.lastFromThem!).getTime() + 90 * 86_400_000) }))
    .filter(({ lapses }) => lapses.getTime() - now < 21 * 86_400_000)
    .sort((a, b) => a.lapses.getTime() - b.lapses.getTime());
  md.push('## Lapsing soon — this-year evidence that passes 90 days in the next three weeks', '');
  if (!lapsing.length) md.push('- None.');
  for (const { x, lapses } of lapsing) md.push(`- **${x.name}** — their last word turns 90 days old on ${lapses.toISOString().slice(0, 10)}; after that, 2027 unless they answer. Next: ${x.next.what.slice(0, 140)}`);
  md.push('');
  md.push('## Who the next steps fall to', '', ...top(who).map(([k, v]) => `- ${k}: ${v}`), '');
  // An owner rule, for the team to decide (W5 v1.1): what the strategies proposed, by kind of LP.
  const TYPE_WORDS: Record<string, string> = { fund_gp: 'fund GPs', fund_lp_program: 'fund-of-funds programs', fo_principal: 'family-office principals', fo_staff: 'family-office staff',
    angel: 'angels', operator: 'operators and founders', foundation: 'foundations', institutional: 'institutions', corporate: 'corporates', advisor: 'advisers', unknown: 'not yet known' };
  const findingOf = new Map(findings.map((f) => [f.key, f]));
  const byType = new Map<string, Record<string, number>>();
  for (const x of strategies) {
    const t = findingOf.get(x.key)?.profile?.investorType ?? 'unknown';
    const w = x.next.who.split(/[ (,—]/)[0] ?? '?';
    const m = byType.get(t) ?? {};
    m[w] = (m[w] ?? 0) + 1;
    byType.set(t, m);
  }
  const juan = strategies.filter((x) => /^Juan\b/.test(x.next.who)).length;
  md.push('## An owner rule — what the strategies proposed, for the team to decide', '');
  md.push(`Juan is proposed for ${juan} of ${strategies.length} next steps. By kind of LP:`, '');
  for (const [t, m] of [...byType.entries()].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0))) {
    md.push(`- ${TYPE_WORDS[t] ?? t}: ${Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  md.push('', 'A rule these imply, as a starting point: the committed and the largest to Juan; crypto-native GPs and angels to whoever holds the crypto relationships; scientists and neuro specialists to the neuroscientist; institutions and funds of funds to one person who carries the committee process. The team decides; nothing here assigns anyone.', '');
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
    `3. **Replies we owe, and checks before any note:** ${owe.length} warm LPs wrote last and wait on us; ${firsts['check sent mail'] ?? 0} to check sent mail, ${firsts['name an owner'] ?? 0} to give an owner, ${firsts['first personal note'] ?? 0} due a first personal note rather than a follow-up.`,
    `4. **Introductions:** ${plans.length} connectors next to ${new Set(plans.flatMap((x) => x.prospects.map((q) => q.key))).size} prospects; ${plans.filter((x) => x.when === 'after they sign').length} ask once their own commitment is signed.`,
    `5. **Research:** ${findings.length} of ${cands.length} read; ${findings.filter(pagesOnly).length} owed a search pass (${findings.filter((f) => pagesOnly(f) && !partialSearch(f)).length} from pages alone, ${findings.filter(partialSearch).length} with too few searches to follow the protocol); ${firstNotes.length} Connecting or Selected LPs with a neuro or health signal of their own.`,
    '',
  ];
  // One question to counsel unblocks every LP outside the US (s24): count them where the record or
  // the research says where they are.
  // IN_US and outsideUs live with the gate that uses them (lib/enrich/strategy.ts).
  const placedOutside = cands.filter((c) => placedOutsideUs([findings.find((f) => f.key === c.key)?.identity.canonical?.location, c.location]));
  start.splice(start.length - 1, 0, `6. **One question to counsel:** ${placedOutside.length} LPs are placed outside the US — what may a first note to them say about a US 506(c) fund, and how is a non-US investor admitted? One answer unblocks all of them.`);
  md.splice(4, 0, ...start);
  await writeFile(join(dir, 'synthesis.md'), md.join('\n') + '\n', 'utf8');
  console.log(`synthesis: ${cands.length} in the set, ${findings.length} researched (${resolved.length} resolved), ${neuro.length} neuro signals, ${plTie.size} with a PL tie, ${strategies.length} strategies (${thisYear.length} this year), ${clusters.length} firm clusters, triage ${JSON.stringify(count(triage, (t) => t.lane))}`);
}
main();

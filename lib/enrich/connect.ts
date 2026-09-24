import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate } from './candidates';
import type { Finding } from './schema';

/**
 * W3, find connections (N64, docs/19): who of us, or of our LPs, is near whom. Deterministic and
 * run again whenever a finding lands — it reads only files: the candidates (our own records), the
 * findings (public sources), and our side (`us/`). Every path it writes carries its tier and the
 * evidence behind it (rule 6): A needs our own record of an interaction; B a documented
 * association; C a shared affiliation with no evidence the two ever spoke; D proximity. C and D
 * never route without a person (CLAUDE.md, rule 6) — these are candidates for one to look at.
 */

export type Tier = 'A' | 'B' | 'C' | 'D';

export interface Path {
  lp: string;
  /** Who or what they are near: a team member, one of our organizations, a backer of ours, another LP. */
  other: { type: 'team' | 'ours' | 'backer' | 'lp'; name: string; key?: string; handle?: string };
  kind: 'met' | 'colleague' | 'coinvestor' | 'portfolio' | 'alumni' | 'board' | 'same_firm' | 'other';
  tier: Tier;
  basis: string;
  source?: string | null;
}

interface Org { name: string; aliases: string[]; domains?: string[]; what?: string; source?: string }
/** One LP's line in us/pl-directory.jsonl (scripts/enrich-pl-directory.ts). */
export interface PlDirectoryEntry {
  key: string; name: string;
  members: Array<{
    match: 'confirmed' | 'name only'; why: string; investor: boolean; since: string | null;
    roles: Array<{ team: string | null; role: string | null; main: boolean }>;
    investorProfile: { focus: string[]; stages: string[]; fundTypes: string[]; typicalCheck: number | string | null; viaFund: boolean | null; type: string | null } | null;
    events: Array<{ name: string; on: string | null; speaker: boolean; host: boolean }>;
  }>;
  firmTeams: Array<{ name: string; isFund: boolean; focus: string[]; via: 'domain' | 'organization'; sources: string[]; technologies: string[] }>;
}
interface Network { orgs: Org[]; backers: Org[]; backer_people: Array<{ name: string; what: string; source: string }>; portfolio?: Array<Org & { vehicle: string }> }
interface TeamMember { handle: string; name: string; roles: Array<{ org: string }>; prior: Array<{ org: string; role?: string }>; education: Array<{ org: string }> }

const STOP = /\b(llc|l\.l\.c\.|inc|incorporated|co|company|corp|corporation|ltd|limited|lp|l\.p\.|plc|gmbh|ag|sa|the)\b/g;
/** A firm's name reduced to what identifies it: "Harbor Street Ventures, LLC" → "harbor street ventures". */
export const norm = (s: string) => s.toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9&+ ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

/** Names so common that sharing them says nothing: not a tie at all. */
const TOO_COMMON = new Set(['google', 'amazon', 'microsoft', 'meta', 'facebook', 'apple', 'mckinsey', 'goldman sachs', 'morgan stanley', 'jp morgan', 'jpmorgan', 'self employed', 'stealth', 'independent']);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(text: string, alias: string): boolean {
  const a = alias.toLowerCase();
  if (a.length < 3) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escape(a)}([^a-z0-9]|$)`, 'i');
  return re.test(text);
}

/**
 * Named, and not in a denial: "its portfolio has no Protocol Labs or Filecoin company" names both
 * and ties to neither (W5 learning, iteration 3). A negation earlier in the same sentence rules
 * the mention out.
 */
export function affirms(text: string, alias: string): boolean {
  if (!mentions(text, alias)) return false;
  const a = escape(alias);
  // A denial before the name ("no Protocol Labs company") or after it, in the same clause
  // ("Protocol Labs and Filecoin are not among them") rules the mention out (W5, iteration 3).
  const before = new RegExp(`\\b(no|not|none|never|without|neither|nor)\\b[^.;]*?${a}`, 'i');
  const after = new RegExp(`${a}[^.;]*?\\b((is|are|was|were|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\\s+not|not\\s+(among|listed|included|in|part|one)|absent|excluded|missing)\\b`, 'i');
  return text.split(/(?<=[.;!?])\s+/).some((sentence) => mentions(sentence, alias) && !before.test(sentence) && !after.test(sentence));
}

/** A fact's words cut for a path's basis at a sentence or clause end, never mid-sentence. */
export function clip(text: string, max = 200): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

export async function findPaths(dir: string): Promise<{ paths: Path[]; lps: number; researched: number }> {
  const candidates = (await readFile(join(dir, 'candidates.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Candidate);
  const findings = new Map<string, Finding>();
  for (const f of (await readdir(join(dir, 'raw')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try { const x = JSON.parse(await readFile(join(dir, 'raw', f), 'utf8')) as Finding; findings.set(x.key, x); } catch { /* the checker reports it */ }
  }
  const net = JSON.parse(await readFile(join(dir, 'us', 'network.json'), 'utf8').catch(() => '{"orgs":[],"backers":[],"backer_people":[]}')) as Network;
  const team = (JSON.parse(await readFile(join(dir, 'us', 'team.json'), 'utf8').catch(() => '{"team":[]}')) as { team: TeamMember[] }).team;

  const paths: Path[] = [];
  const add = (p: Path) => {
    if (!paths.some((q) => q.lp === p.lp && q.other.name === p.other.name && q.kind === p.kind)) paths.push(p);
  };

  // Where each LP works, and every sentence the research wrote about them.
  const orgsOf = (c: Candidate, f?: Finding) => {
    const out = new Set<string>();
    for (const o of [c.org, f?.identity?.canonical?.org, ...(c.enriched['Organizations'] ?? '').split(/;\s*/)]) if (o) out.add(o);
    return [...out].filter((o) => norm(o) && !TOO_COMMON.has(norm(o)));
  };
  const textOf = (f?: Finding) => (f ? f.facts.filter((x) => x.confidence !== 'low').map((x) => `${x.value}`).join(' \n ') : '');
  /** Where they worked: jobs, boards and affiliations only — a school named in an education fact is not an employer. */
  const jobsOf = (f?: Finding) => (f ? f.facts.filter((x) => x.confidence !== 'low' && ['role', 'prior_role', 'affiliation', 'board'].includes(x.field)).map((x) => `${x.value}`).join(' \n ') : '');

  for (const c of candidates) {
    const f = findings.get(c.key);
    const unsure = f && (f.identity.match === 'ambiguous' || f.identity.match === 'not_found');
    const text = unsure ? '' : textOf(f);
    const jobs = unsure ? '' : jobsOf(f);
    const orgs = orgsOf(c, unsure ? undefined : f);

    // Our own record of an interaction: meetings held with them, and who owns the pursuit.
    for (const p of c.pursuits) {
      if (c.contact.meetings > 0 && p.owner && p.owner !== 'Not on the team') {
        // B, not A: the meetings are recorded, but who from our side was in them is not — the
        // owner is who the team assigned, and the likeliest to have been there.
        add({ lp: c.key, other: { type: 'team', name: p.owner }, kind: 'met', tier: 'B', basis: `${c.contact.meetings} ${c.contact.meetings === 1 ? 'meeting' : 'meetings'} on record; ${p.owner} owns the pursuit`, source: 'our records' });
      } else if (c.contact.meetings > 0) {
        add({ lp: c.key, other: { type: 'ours', name: 'PL Capital' }, kind: 'met', tier: 'B', basis: `${c.contact.meetings} ${c.contact.meetings === 1 ? 'meeting' : 'meetings'} on record; who from our side isn't recorded`, source: 'our records' });
      }
    }

    // B: an address at one of our domains — they were inside the network.
    for (const o of net.orgs) {
      const d = c.domains.find((x) => o.domains?.includes(x));
      if (d) add({ lp: c.key, other: { type: 'ours', name: o.name }, kind: 'colleague', tier: 'B', basis: `Our records hold an email address for them at ${d}`, source: 'our records' });
      for (const a of o.aliases) {
        if (text && affirms(text, a)) {
          const fact = f!.facts.find((x) => x.confidence !== 'low' && affirms(x.value, a));
          add({ lp: c.key, other: { type: 'ours', name: o.name }, kind: fact?.field === 'investment' ? 'coinvestor' : fact?.field === 'board' ? 'board' : 'other', tier: 'C', basis: `Public source mentions ${a}: “${clip(fact?.value ?? '')}”`, source: fact?.source.url ?? null });
          break;
        }
      }
    }

    // C: their firm backed Protocol Labs or Filecoin. The firm's tie, not yet theirs.
    for (const b of net.backers) {
      const byDomain = c.domains.find((x) => b.domains?.includes(x));
      const byOrg = orgs.find((o) => b.aliases.some((a) => norm(o) === norm(a)));
      if (byDomain || byOrg) add({ lp: c.key, other: { type: 'backer', name: b.name }, kind: 'coinvestor', tier: 'C', basis: `Works at ${b.name} (${byDomain ? `address at ${byDomain}` : `organization on file`}), which ${b.what?.toLowerCase() ?? 'backed Protocol Labs'}`, source: b.source ?? null });
    }
    for (const bp of net.backer_people) {
      if (text && mentions(text, bp.name)) add({ lp: c.key, other: { type: 'backer', name: bp.name }, kind: 'other', tier: 'D', basis: `Public source mentions ${bp.name} (${bp.what.toLowerCase()})`, source: bp.source });
    }

    // C: they invested in, work at or sit on the board of one of our portfolio companies — a
    // co-investor or colleague of ours in the same company, and a sign they know the field.
    for (const pc of net.portfolio ?? []) {
      const hit = text ? f!.facts.find((x) => x.confidence !== 'low' && pc.aliases.some((a) => affirms(x.value, a))) : undefined;
      const atOrg = orgs.find((o) => pc.aliases.some((a) => norm(o) === norm(a)));
      if (hit || atOrg) {
        add({ lp: c.key, other: { type: 'ours', name: `${pc.name} (${pc.vehicle} portfolio)` }, kind: atOrg ? 'colleague' : hit!.field === 'board' ? 'board' : 'coinvestor', tier: 'C',
          basis: atOrg ? `Works at ${pc.name}, a ${pc.vehicle} portfolio company` : `Public source: “${clip(hit!.value)}”`, source: hit?.source.url ?? pc.source ?? null });
      }
    }

    // C/D: a place a team member also worked or studied. Same employer is C; the same school is D.
    for (const t of team) {
      for (const r of [...t.roles, ...t.prior]) {
        const o = norm(r.org);
        if (!o || TOO_COMMON.has(o) || ['protocol labs', 'pl capital', 'protocol labs protocol vc'].includes(o)) continue;
        if (orgs.some((x) => norm(x) === o) || (jobs && r.org.length > 4 && affirms(jobs, r.org))) {
          add({ lp: c.key, other: { type: 'team', name: t.name, handle: t.handle }, kind: 'colleague', tier: 'C', basis: `Both have worked at ${r.org}`, source: null });
        }
      }
      for (const e of t.education) {
        if (text && f!.facts.some((x) => x.field === 'education' && mentions(x.value, e.org.replace(/ University$/, '')))) {
          add({ lp: c.key, other: { type: 'team', name: t.name, handle: t.handle }, kind: 'alumni', tier: 'D', basis: `Both studied at ${e.org}`, source: null });
        }
      }
    }
  }

  // The ties the research itself recorded, on their tier — a firm's tie is C at most for the person.
  for (const f of findings.values()) {
    if (f.identity.match === 'ambiguous' || f.identity.match === 'not_found') continue;
    for (const c of f.connections ?? []) {
      const tier = c.scope === 'firm' && c.tier === 'B' ? 'C' : c.tier;
      add({ lp: f.key, other: { type: /protocol labs|filecoin|ipfs|pl capital|protocol vc/i.test(c.to) ? 'ours' : 'backer', name: c.to },
        kind: c.kind === 'portfolio' ? 'portfolio' : c.kind === 'board' ? 'board' : c.kind === 'coinvestor' ? 'coinvestor' : c.kind === 'colleague' ? 'colleague' : c.kind === 'alumni' ? 'alumni' : 'other',
        tier, basis: `${c.basis}${c.scope === 'firm' ? ' (the firm’s tie)' : ''}`, source: c.source ?? null });
    }
  }

  // A firm's documented tie reaches everyone at the firm (iteration 3): a colleague's finding
  // records the firm's seed check in Protocol Labs, and the staff whose own identity didn't resolve
  // work there by our records — their address at its domain. The firm's tie, C at most.
  const FREE_MAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|mac|aol|proton|protonmail|live|msn)\./;
  const atDomain = new Map<string, Candidate[]>();
  for (const c of candidates) for (const d of c.domains) if (!FREE_MAIL.test(d)) atDomain.set(d, [...(atDomain.get(d) ?? []), c]);
  const byKeyAll = new Map(candidates.map((c) => [c.key, c]));
  for (const f of findings.values()) {
    if (f.identity.match === 'ambiguous' || f.identity.match === 'not_found') continue;
    const from = byKeyAll.get(f.key);
    if (!from) continue;
    for (const conn of (f.connections ?? []).filter((x) => x.scope === 'firm')) {
      const ours = /protocol labs|filecoin|ipfs|pl capital|protocol vc/i.test(conn.to);
      for (const d of from.domains) {
        for (const c of atDomain.get(d) ?? []) {
          if (c.key === f.key) continue;
          add({ lp: c.key, other: { type: ours ? 'ours' : 'backer', name: conn.to }, kind: conn.kind === 'coinvestor' ? 'coinvestor' : conn.kind === 'portfolio' ? 'portfolio' : 'other',
            tier: conn.tier === 'D' ? 'D' : 'C', basis: `${conn.basis} (the firm’s tie, recorded in a colleague’s finding; they work there by our records, at ${d})`, source: conn.source ?? null });
        }
      }
    }
  }

  // Colleagues inside the research set: people at the same firm. If one of them has met us, the
  // others are one conversation away.
  // By organization name and by work domain: two people at one domain are colleagues even when
  // the list spells their firm differently (W5 learning).
  const byFirm = new Map<string, Candidate[]>();
  const FREE = /^(gmail|yahoo|hotmail|outlook|icloud|me|mac|aol|proton|protonmail)\./;
  for (const c of candidates) {
    const keys = new Set<string>();
    const o = c.org ? norm(c.org) : null;
    if (o && !TOO_COMMON.has(o)) keys.add(`org:${o}`);
    for (const d of c.domains) if (!FREE.test(d)) keys.add(`domain:${d}`);
    for (const k of keys) byFirm.set(k, [...(byFirm.get(k) ?? []), c]);
  }
  for (const group of byFirm.values()) {
    if (group.length < 2) continue;
    for (const a of group) for (const b of group) {
      if (a.key === b.key) continue;
      const met = b.contact.meetings > 0;
      add({ lp: a.key, other: { type: 'lp', name: b.name, key: b.key }, kind: 'same_firm', tier: met ? 'B' : 'C', basis: `Both at ${a.org ?? b.org ?? 'the same firm'}${met ? `; ${b.name} has met us (${b.contact.meetings})` : ''}`, source: 'our records' });
    }
  }

  for (const p of sharedRecords(candidates, findings)) add(p);

  // W2n, Protocol Labs' own directory (iteration 3): an entry under their name that matches our
  // record of them is PL's own record that they are in the network — B; under their name alone, C
  // until a person confirms it. Speaking at a PL event is C, attending one D (amendment 1.4). Their
  // firm listed as a network team is the firm's tie, C.
  const directory = (await readFile(join(dir, 'us', 'pl-directory.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as PlDirectoryEntry);
  const DIRECTORY = 'https://os.pl.xyz';
  for (const e of directory) {
    for (const m of e.members) {
      const main = m.roles.find((r) => r.main) ?? m.roles[0];
      const where = main?.team ? `${main.role ? `${main.role}, ` : ''}${main.team}` : 'a member';
      const since = m.since ? `, in the network since ${m.since.slice(0, 4)}` : '';
      if (m.match === 'confirmed') {
        add({ lp: e.key, other: { type: 'ours', name: 'Protocol Labs network' }, kind: 'colleague', tier: 'B', basis: `In Protocol Labs’ directory: ${where}${since} (matched on ${m.why})`, source: DIRECTORY });
        const spoke = m.events.filter((x) => x.speaker || x.host);
        if (spoke.length) add({ lp: e.key, other: { type: 'ours', name: 'Protocol Labs events' }, kind: 'other', tier: 'C', basis: `${spoke[0]!.host ? 'Hosted' : 'Spoke'} at ${spoke[0]!.name}${spoke.length > 1 ? ` and ${spoke.length - 1} more PL events` : ''}`, source: DIRECTORY });
        else if (m.events.length) add({ lp: e.key, other: { type: 'ours', name: 'Protocol Labs events' }, kind: 'other', tier: 'D', basis: `Attended ${m.events[0]!.name}${m.events.length > 1 ? ` and ${m.events.length - 1} more PL events` : ''}`, source: DIRECTORY });
      } else {
        add({ lp: e.key, other: { type: 'ours', name: 'Protocol Labs network' }, kind: 'other', tier: 'C', basis: `Someone of that name is in Protocol Labs’ directory (${where}): confirm it is them`, source: DIRECTORY });
      }
    }
    for (const t of e.firmTeams) {
      add({ lp: e.key, other: { type: 'ours', name: `${t.name} (PL network ${t.isFund ? 'fund' : 'team'})` }, kind: 'other', tier: 'C',
        basis: `Their firm is in the Protocol Labs network directory as a ${t.isFund ? 'fund' : 'team'}${t.sources.length ? ` (${t.sources.join(', ')})` : ''}, matched on their ${t.via === 'domain' ? 'work domain' : 'organization'} — the firm’s tie`, source: DIRECTORY });
    }
  }

  // Existing LPs as connectors (docs/06 §3.3): a committed LP who shares a firm or appears in a
  // prospect's public record.
  const committed = candidates.filter((c) => c.pursuits.some((p) => p.status === 'committed'));
  for (const c of candidates) {
    if (c.pursuits.some((p) => p.status === 'committed')) continue;
    const f = findings.get(c.key);
    const text = f && f.identity.match !== 'ambiguous' && f.identity.match !== 'not_found' ? textOf(f) : '';
    for (const k of committed) {
      if (text && k.name.length > 6 && mentions(text, k.name)) {
        add({ lp: c.key, other: { type: 'lp', name: k.name, key: k.key }, kind: 'other', tier: 'C', basis: `A public source about them names ${k.name}, who has committed`, source: null });
      }
    }
  }

  return { paths, lps: candidates.length, researched: findings.size };
}

/**
 * One company however a page writes it (iteration 3): "X.AI" and "X AI", "SoilCo" and "Soil Co",
 * "Paradromics, Inc." and "Paradromics" — legal suffixes dropped, then every space and mark.
 */
export const entityKey = (s: string) => s.toLowerCase().replace(/[’'`]/g, '')
  .replace(/[,.]?\s*\b(llc|l\.l\.c\.|inc|incorporated|corp|corporation|ltd|limited|lp|l\.p\.|plc|gmbh|ag|s\.a\.)\.?\s*$/i, '')
  .replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');

/** Words that name a kind of organization, not one: sharing only these says nothing. */
const GENERIC = /^(capital|ventures?|partners|fund|funds|labs?|group|holdings|investments?|management|advisors|foundation|trust|family office|angel|seed|series [a-e]|university|college|board|company|startup|startups|the fund|protocol labs|pl capital)$/;
/** Fields whose words name a company, a fund or a board they were part of. */
const RECORD_FIELDS = new Set(['investment', 'board', 'fund_lp', 'fund_gp', 'exit', 'prior_role', 'role', 'affiliation']);
const RECORD_KEYS = ['company', 'companies', 'fund', 'organization', 'org', 'acquirer', 'firm'];

/**
 * C: two LPs in one record — both invested in a company, sat on its board, backed the same fund, or
 * one invested where the other works (W3, iteration 3). The entities come from the findings' own
 * structured parts (`detail.company` and the like), the firms on file and our portfolio, and are
 * then looked for in every fact's words. A shared record is no evidence the two ever spoke, so it is
 * C and needs a person before it routes (rule 6); two people who only worked at one company, at
 * times nobody has compared, are D. An entity in the records of more than eight LPs is a hub, not a
 * tie, and is dropped; so are the LPs' own current firms (same_firm covers those). A one-word name
 * ("Science", "Kernel") is too easily a word or another company, so it counts only where a record
 * names it in its structured parts, never matched in a sentence. Several names in one part are
 * joined with "; " (W1s); a comma or an "and" belongs to a name ("…, LLC", "Bill and Melinda …").
 */
export function sharedRecords(candidates: Candidate[], findings: Map<string, Finding>): Path[] {
  const resolved = candidates.filter((c) => {
    const f = findings.get(c.key);
    return f && (f.identity.match === 'confirmed' || f.identity.match === 'probable');
  });
  const names = new Map<string, string>();
  const addName = (s: unknown) => {
    if (typeof s !== 'string') return;
    for (const part of s.split(/\s*;\s*/)) {
      const n = entityKey(part);
      const words = norm(part);
      // Three letters only as an acronym written in capitals — a firm whose real name is short (c06).
      const long = n.length >= 4 || (n.length === 3 && /^[A-Z0-9&]{3}$/.test(part.trim()));
      if (long && !GENERIC.test(words) && !TOO_COMMON.has(words) && !/^\d/.test(n) && words.split(' ').length <= 5 && !names.has(n)) names.set(n, part.trim());
    }
  };
  for (const c of resolved) {
    for (const x of findings.get(c.key)!.facts) {
      if (x.confidence === 'low' || !RECORD_FIELDS.has(x.field)) continue;
      for (const k of RECORD_KEYS) addName(x.detail?.[k]);
    }
  }
  for (const c of candidates) addName(c.org);

  // Who mentions what, and how: an investment, a board seat, a fund, a job.
  type Hit = { key: string; field: string; value: string; url: string };
  const hits = new Map<string, Hit[]>();
  for (const c of resolved) {
    const f = findings.get(c.key)!;
    const own = new Set([c.org, f.identity.canonical?.org].filter(Boolean).map((o) => entityKey(o!)));
    const seen = new Set<string>();
    for (const x of f.facts) {
      if (x.confidence === 'low' || !RECORD_FIELDS.has(x.field) || x.scope === 'firm') continue;
      const structured = new Set(RECORD_KEYS.flatMap((k) => (typeof x.detail?.[k] === 'string' ? String(x.detail[k]).split(/\s*;\s*/).map(entityKey) : [])));
      for (const [n, shown] of names) {
        if (own.has(n) || seen.has(n)) continue;
        const inWords = /\s/.test(shown.trim()) && mentions(x.value, shown);
        if (!structured.has(n) && !inWords) continue;
        seen.add(n);
        hits.set(n, [...(hits.get(n) ?? []), { key: c.key, field: x.field, value: x.value, url: x.source.url }]);
      }
    }
  }

  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const how = (h: Hit) => (h.field === 'investment' || h.field === 'exit' ? 'invested in' : h.field === 'board' ? 'sat on the board of' : h.field === 'fund_lp' ? 'backed' : h.field === 'fund_gp' ? 'runs or ran' : 'worked at');
  const out: Path[] = [];
  for (const [n, hs] of hits) {
    const lps = [...new Set(hs.map((h) => h.key))];
    if (lps.length < 2 || lps.length > 8) continue;
    const shown = names.get(n)!;
    for (const a of hs) for (const b of hs) {
      if (a.key === b.key) continue;
      const ca = byKey.get(a.key)!, cb = byKey.get(b.key)!;
      if (ca.org && cb.org && norm(ca.org) === norm(cb.org)) continue;
      const kind: Path['kind'] = a.field === 'board' && b.field === 'board' ? 'board' : (a.field === 'investment' || a.field === 'exit') && (b.field === 'investment' || b.field === 'exit') ? 'coinvestor' : 'other';
      const job = (h: Hit) => h.field === 'role' || h.field === 'prior_role' || h.field === 'affiliation';
      out.push({ lp: a.key, other: { type: 'lp', name: cb.name, key: cb.key }, kind, tier: job(a) && job(b) ? 'D' : 'C',
        basis: how(a) === how(b) ? `Both ${how(a)} ${shown}` : `They ${how(a)} ${shown}; ${cb.name} ${how(b)} it`, source: a.url });
    }
  }
  return out;
}

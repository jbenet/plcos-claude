import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate } from './candidates';
import type { Finding } from './schema';
import type { WarehousePerson, WarehouseTie, WarehouseMatch } from './warehouse-graph';
import { config } from '@/config/deployment';
import { tieWarmth, type TieDetails, type Warmth } from '@/modules/network';

/**
 * W3, find connections (N64, docs/19): who of us, or of our LPs, is near whom. Deterministic and
 * run again whenever a finding lands — it reads only files: the candidates (our own records), the
 * findings (public sources), and our side (`us/`). Every path it writes carries its tier and the
 * evidence behind it (rule 6): A needs our own record of an interaction; B a documented
 * association; C a shared affiliation with no evidence the two ever spoke; D proximity. C and D
 * never route without a person (CLAUDE.md, rule 6) — these are candidates for one to look at.
 */

export interface ConnectionPerson { key: string; name: string; source: string }

export type Tier = 'A' | 'B' | 'C' | 'D';

export interface Path {
  lp: string;
  /** Sourced person outside the active LP research set; import resolves before building edges. */
  lpPerson?: ConnectionPerson;
  /** Who or what they are near: a team member, one of our organizations, a backer of ours, another LP. */
  other: { type: 'team' | 'ours' | 'backer' | 'lp'; name: string; key?: string; handle?: string; person?: ConnectionPerson };
  kind: 'met' | 'corresponded' | 'colleague' | 'advisor' | 'coinvestor' | 'portfolio' | 'alumni' | 'board' | 'same_firm' | 'other';
  tier: Tier;
  basis: string;
  source?: string | null;
  tie?: TieDetails;
  warmth?: Warmth;
  reviewedBy?: string;
  reviewedAt?: string;
  /** Ordered pairwise evidence; never collapse two hops into a direct relationship. */
  warehouse?: { match: WarehouseMatch; people: WarehousePerson[]; ties: WarehouseTie[] };
}

export interface Org { name: string; aliases: string[]; domains?: string[]; what?: string; source?: string }
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
export interface Network { orgs: Org[]; backers: Org[]; backer_people: Array<{ name: string; what: string; source: string }>; portfolio?: Array<Org & { vehicle: string }> }
export interface TeamRole { org: string; role?: string; since?: string | number; until?: string | number; source?: string }
export interface TeamMember { handle: string; name: string; roles: TeamRole[]; prior: TeamRole[]; education: Array<{ org: string }> }

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
  // A company named after it is another company: "IPFS Labs Inc" is not IPFS (v05).
  const lookalike = new RegExp(`${a}\\s+(Labs?|Inc\\.?|Corp\\.?|LLC|Ltd\\.?|Technologies|Systems|Holdings|Capital|Ventures|Partners|Group)\\b`);
  if (!/\s(Labs?|Foundation|Inc|Corp|LLC|Ltd|Technologies|Systems|Holdings|Capital|Ventures|Partners|Group)$/i.test(alias)
    && text.split(/(?<=[.;!?])\s+/).every((sentence) => !mentions(sentence, alias) || lookalike.test(sentence))) return false;
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
  const directory = (await readFile(join(dir, 'us', 'pl-directory.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as PlDirectoryEntry);
  const warehouse = await readWarehouseGraph(dir);
  return connectionPaths(candidates, findings, net, team, directory, new Date(), warehouse);
}

/** W3's pure join, also used by invented property fixtures. No files or database writes. */
export function connectionPaths(candidates: Candidate[], findings: Map<string, Finding>, net: Network,
  team: TeamMember[], directory: PlDirectoryEntry[] = [], at = new Date(), warehouse?: WarehouseGraph): { paths: Path[]; lps: number; researched: number } {

  // A connector need not be raising. The sourced personal backer roster is a separate
  // universe from active LPs; leaving it out made documented co-founder ties dead ends.
  const connectors = net.backer_people.filter((p) => /^https?:\/\//.test(p.source)
    && !candidates.some((c) => norm(c.name) === norm(p.name))
    && !team.some((t) => norm(t.name) === norm(p.name))
    && net.backer_people.filter((q) => norm(q.name) === norm(p.name)).length === 1)
    .map((p): Candidate => ({ key: connectionPersonKey(p.name, p.source), name: p.name, type: 'person', org: null, role: null,
      location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
      contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null,
        lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, meetingDates: [], recent: [], outreachShared: 0 } }));
  const people = [...candidates, ...connectors];
  const descriptors = new Map(connectors.map((c) => [c.key, { key: c.key, name: c.name,
    source: net.backer_people.find((p) => norm(p.name) === norm(c.name))!.source }]));
  const paths: Path[] = [];
  const pathKeys = new Set<string>();
  const add = (p: Path) => {
    if (descriptors.has(p.lp)) p.lpPerson = descriptors.get(p.lp);
    if (p.other.key && descriptors.has(p.other.key)) p.other = { ...p.other, person: descriptors.get(p.other.key) };
    // Keep distinct supporting records; a weak affiliation must not discard a warm personal tie.
    const key = JSON.stringify([p.lp, p.other.name, p.kind, p.basis, p.warehouse?.ties.map((t) => t.key)]);
    if (!pathKeys.has(key)) { pathKeys.add(key); paths.push(p); }
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

    for (const p of ourSidePaths(c, unsure ? undefined : f, net, team, at)) add(p);

    // Our own record of an interaction: meetings held with them, and who owns the pursuit.
    for (const p of c.pursuits) {
      if (c.contact.meetings > 0 && p.owner && p.owner !== 'Not on the team') {
        // The owner was assigned to the pursuit; participation still needs a person to confirm.
        add({ lp: c.key, other: { type: 'team', name: p.owner }, kind: 'met', tier: 'C', tie: { kind: 'proximity' }, basis: `${c.contact.meetings} ${c.contact.meetings === 1 ? 'meeting' : 'meetings'} on record; ${p.owner} owns the pursuit, but participation needs confirmation`, source: 'our records' });
      } else if (c.contact.meetings > 0) {
        add({ lp: c.key, other: { type: 'ours', name: 'PL Capital' }, kind: 'met', tier: 'B', basis: `${c.contact.meetings} ${c.contact.meetings === 1 ? 'meeting' : 'meetings'} on record; who from our side isn't recorded`, source: 'our records' });
      }
    }

    // C: the team marks them a close contact — relationship strength, a tier-C edge that never says
    // whose contact they are (CLAUDE.md). A path of its own, so triage, the pins and the routes
    // agree (v06); a person names who holds it before it routes anything.
    if (/close/i.test(c.enriched['Relationship Tier'] ?? '')) {
      add({ lp: c.key, other: { type: 'ours', name: 'Someone on the team (unrecorded)' }, kind: 'other', tier: 'C',
        basis: 'The team marks them a close contact; whose contact isn’t recorded', source: 'our records' });
    }

    // They wrote to us, but an unknown recipient cannot establish a personal hop through the owner.
    // A meeting counts as "from them" too, so only when no meeting is on record.
    if (c.contact.meetings === 0 && c.contact.lastFromThem) {
      const owner = c.pursuits[0]?.owner;
      add({ lp: c.key, other: owner && owner !== 'Not on the team' ? { type: 'team', name: owner } : { type: 'ours', name: 'PL Capital' }, kind: 'corresponded', tier: 'C', tie: { kind: 'proximity' },
        basis: `They wrote to us on ${c.contact.lastFromThem}; who from our side received it isn't recorded${owner && owner !== 'Not on the team' ? `, and ${owner} owns the pursuit` : ''}`, source: 'our records' });
    }

    // An address at our domain establishes affiliation, not interaction or overlapping service.
    // Keep it as C/proximity; ourSidePaths separately handles evidenced personal ties.
    for (const o of net.orgs) {
      const d = c.domains.find((x) => o.domains?.includes(x));
      if (d) add({ lp: c.key, other: { type: 'ours', name: o.name }, kind: 'colleague', tier: 'C', tie: { kind: 'proximity' }, basis: `Our records hold an email address for them at ${d}; dates and personal ties need confirmation`, source: 'our records' });
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
      // A founder or an executive of one of our portfolio companies: we are their investors — a
      // documented relationship, B, and a reference before any ask (1.21). Anyone else there, C.
      const LEADS = /\b(co-?founder|founder|ceo|chief executive|president|cto|chief technology|coo|managing director)\b/i;
      const leadFact = text ? f!.facts.find((x) => x.confidence !== 'low' && (x.field === 'role' || x.field === 'prior_role') && LEADS.test(x.value) && pc.aliases.some((a) => affirms(x.value, a))) : undefined;
      const title = `${c.role ?? ''} ${c.enriched['Current Job Title'] ?? ''} ${unsure ? '' : f?.identity.canonical?.role ?? ''}`;
      const leads = Boolean(leadFact || (atOrg && LEADS.test(title)));
      if (hit || atOrg) {
        add({ lp: c.key, other: { type: 'ours', name: `${pc.name} (${pc.vehicle} portfolio)` }, kind: atOrg || leadFact ? 'colleague' : hit!.field === 'board' ? 'board' : 'coinvestor', tier: leads ? 'B' : 'C',
          basis: leads ? `A founder or executive of ${pc.name}, a ${pc.vehicle} portfolio company: we are their investors` : atOrg ? `Works at ${pc.name}, a ${pc.vehicle} portfolio company` : `Public source: “${clip(hit!.value)}”`,
          source: leadFact?.source.url ?? hit?.source.url ?? pc.source ?? null });
      }
    }

    // C/D: a place a team member also worked or studied. Same employer is C; the same school is D.
    for (const t of team) {
      for (const r of [...t.roles, ...t.prior]) {
        const o = norm(r.org);
        if (!o || TOO_COMMON.has(o)) continue;
        if (orgs.some((x) => norm(x) === o) || (jobs && r.org.length > 4 && affirms(jobs, r.org))) {
          // Going through an accelerator is being in a batch, not working there (s08): D, as alumni.
          const accelerator = /y combinator|\byc\b|techstars|500 startups|on deck|entrepreneur first|antler|accelerator/i.test(r.org);
          add(accelerator
            ? { lp: c.key, other: { type: 'team', name: t.name, handle: t.handle }, kind: 'alumni', tier: 'D', basis: `Both went through ${r.org}, in different batches most likely`, source: null }
            : { lp: c.key, other: { type: 'team', name: t.name, handle: t.handle }, kind: 'colleague', tier: 'C', tie: { kind: 'proximity' }, basis: `Both have worked at ${r.org}; collaboration and dates need confirmation`, source: r.source ?? null });
        }
      }
      for (const e of t.education) {
        if (text && f!.facts.some((x) => x.field === 'education' && mentions(x.value, e.org.replace(/ University$/, '')))) {
          add({ lp: c.key, other: { type: 'team', name: t.name, handle: t.handle }, kind: 'alumni', tier: 'D', basis: `Both studied at ${e.org}`, source: null });
        }
      }
    }
  }

  for (const c of connectors) for (const p of ourSidePaths(c, undefined, net, team, at)) add(p);

  // The ties the research itself recorded, on their tier — a firm's tie is C at most for the person.
  for (const f of findings.values()) {
    if (f.identity.match === 'ambiguous' || f.identity.match === 'not_found') continue;
    for (const c of f.connections ?? []) {
      const tier = c.tier === 'B' && (c.scope === 'firm' || !c.source) ? 'C' : c.tier;
      const resolved = c.scope !== 'firm' ? (c.toHandle && team.some((t) => t.handle === c.toHandle)
        ? { type: 'team' as const, name: team.find((t) => t.handle === c.toHandle)!.name, handle: c.toHandle }
        : resolvePerson(c.to, people, team)) : null;
      add({ lp: f.key, other: resolved ?? { type: /protocol labs|filecoin|ipfs|pl capital|protocol vc/i.test(c.to) ? 'ours' : 'backer', name: c.to },
        kind: c.kind === 'portfolio' ? 'portfolio' : c.kind === 'board' ? 'board' : c.kind === 'advisor' ? 'advisor' : c.kind === 'coinvestor' ? 'coinvestor' : c.kind === 'colleague' ? 'colleague' : c.kind === 'alumni' ? 'alumni' : 'other',
        tie: c.scope === 'firm' ? { kind: 'proximity' } : c.tie
          ?? (/\bco[ -]?founded\b|\bco[ -]?founders\b/i.test(c.basis) && resolved ? { kind: 'cofounder' } : undefined),
        reviewedBy: c.reviewedBy, reviewedAt: c.reviewedAt,
        tier, basis: `${c.basis}${c.scope === 'firm' ? ' (the firm’s tie)' : ''}`, source: c.source ?? null });
    }
  }

  // A firm's documented tie reaches everyone at the firm (iteration 3): a colleague's finding
  // records the firm's seed check in Protocol Labs, and the staff whose own identity didn't resolve
  // work there by our records — their address at its domain. The firm's tie, C at most.
  const FREE_MAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|mac|aol|proton|protonmail|live|msn)\./;
  const atDomain = new Map<string, Candidate[]>();
  const OUR_DOMAINS = new Set(net.orgs.flatMap((o) => o.domains ?? []));
  for (const c of candidates) for (const d of c.domains) if (!FREE_MAIL.test(d) && !OUR_DOMAINS.has(d)) atDomain.set(d, [...(atDomain.get(d) ?? []), c]);
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
  // An address at one of our own domains is an affiliation clue (a C path above), not evidence
  // that they work together now: it joins nobody as colleagues (v01's learning).
  const OURS = new Set(net.orgs.flatMap((o) => o.domains ?? []));
  for (const c of candidates) {
    const keys = new Set<string>();
    // Someone the research found has moved on (their own site names another employer) is grouped
    // with their new firm, not the old one our records still show (W5 revise, iteration 3).
    const f = findings.get(c.key);
    const now = f && (f.identity.match === 'confirmed' || f.identity.match === 'probable') ? f.identity.canonical?.org : null;
    const moved = Boolean(now && c.org && !sameFirm(now, c.org));
    const o = moved ? norm(now!) : c.org ? norm(c.org) : null;
    if (o && !TOO_COMMON.has(o)) keys.add(`org:${o}`);
    if (!moved) for (const d of c.domains) if (!FREE.test(d) && !OURS.has(d)) keys.add(`domain:${d}`);
    for (const k of keys) byFirm.set(k, [...(byFirm.get(k) ?? []), c]);
  }
  for (const group of byFirm.values()) {
    if (group.length < 2) continue;
    for (const a of group) for (const b of group) {
      if (a.key === b.key) continue;
      const met = b.contact.meetings > 0;
      add({ lp: a.key, other: { type: 'lp', name: b.name, key: b.key }, kind: 'same_firm', tier: 'C', tie: { kind: 'proximity' }, basis: `Both at ${a.org ?? b.org ?? 'the same firm'}${met ? `; ${b.name} has met us (${b.contact.meetings}), which does not establish this colleague tie` : ''}`, source: 'our records' });
    }
  }

  for (const p of sharedRecords(candidates, findings)) add(p);

  // W2n, Protocol Labs' own directory (iteration 3): an entry under their name that matches our
  // record of them is PL's own record that they are in the network — B; under their name alone, C
  // until a person confirms it. Speaking at a PL event is C, attending one D (amendment 1.4). Their
  // firm listed as a network team is the firm's tie, C.
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

  if (warehouse) for (const p of warehousePaths(candidates, team, warehouse, at)) add(p);

  return { paths: paths.map((p) => {
    const tie = p.tie ?? ((p.tier === 'C' || p.tier === 'D') ? { kind: 'proximity' as const } : undefined);
    return { ...p, tie, warmth: tieWarmth(p.kind, tie, at) };
  }).sort((a, b) => a.tier.localeCompare(b.tier) || b.warmth.score - a.warmth.score || a.lp.localeCompare(b.lp) || a.other.name.localeCompare(b.other.name)),
  lps: candidates.length, researched: findings.size };
}

/** Stable source identity, never a random new person on every W3 pass. */
export function connectionPersonKey(name: string, source: string): string {
  const h = createHash('sha256').update(`w3-person:${norm(name)}:${source}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface WarehouseGraph { people: WarehousePerson[]; ties: WarehouseTie[]; matches: WarehouseMatch[] }

/** An absent graph is optional; a partial or mixed-generation graph must never create routes. */
export async function readWarehouseGraph(dir: string): Promise<WarehouseGraph> {
  const names = ['people.jsonl', 'ties.jsonl', 'matches.jsonl'] as const;
  const read = async (name: string): Promise<string | null> => readFile(join(dir, 'warehouse', name), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const [people, ties, matches, manifest] = await Promise.all([...names, 'graph-manifest.json'].map(read));
  const contents = [people, ties, matches];
  if (contents.every((s) => s === null) && manifest === null) return { people: [], ties: [], matches: [] };
  if (contents.some((s) => s == null) || manifest == null) throw new Error('Warehouse graph is incomplete: all three files and graph-manifest.json are required');
  const parse = (s: string): unknown => {
    try { return JSON.parse(s); } catch { throw new Error('Warehouse graph contains invalid JSON'); }
  };
  const parsedManifest = parse(manifest) as { files?: Record<string, unknown> } | null;
  for (const [i, name] of names.entries()) {
    const expected = parsedManifest?.files?.[name];
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
      || createHash('sha256').update(contents[i]!).digest('hex') !== expected) {
      throw new Error(`Warehouse graph hash mismatch: ${name}; finish extraction before W3`);
    }
  }
  const rows = <T>(s: string) => s.split('\n').filter(Boolean).map((line) => parse(line) as T);
  return { people: rows<WarehousePerson>(people!), ties: rows<WarehouseTie>(ties!), matches: rows<WarehouseMatch>(matches!) };
}

export function warehousePathKind(kind: WarehouseTie['kind']): Path['kind'] {
  return kind === 'joint_investment' || kind === 'frequent_coinvestment' ? 'coinvestor'
    : kind === 'worked_together' || kind === 'cofounder' ? 'colleague'
      : kind === 'repeated_contact' ? 'corresponded' : kind === 'acquaintance' ? 'met' : 'other';
}

/** The two joins are indexed; ambiguous endpoints never become identity merges or routes. */
export function warehousePaths(candidates: Candidate[], team: TeamMember[], graph: WarehouseGraph, at = new Date()): Path[] {
  const people = new Map(graph.people.map((p) => [p.key, p]));
  const adjacency = new Map<string, WarehouseTie[]>();
  const pairs = new Set<string>();
  const pair = (a: string, b: string) => JSON.stringify([a, b].sort());
  const origins = new Map<string, TeamMember>();
  // The extraction carries exact team keys, so it also works before a local us/team.json exists.
  for (const p of graph.people) if (p.teamKey) {
    const t = team.find((t) => t.handle === p.teamKey) ?? { handle: p.teamKey, name: p.name, roles: [], prior: [], education: [] };
    origins.set(p.key, t);
  }
  const put = (tie: WarehouseTie) => {
    if (tie.from === tie.to || !people.has(tie.from) || !people.has(tie.to)) return;
    pairs.add(pair(tie.from, tie.to));
    for (const key of [tie.from, tie.to]) {
      const incident = adjacency.get(key);
      if (incident) incident.push(tie); else adjacency.set(key, [tie]);
    }
  };
  graph.ties.forEach(put);
  // The user's one-hop rule establishes access to founders and team, not a recorded interaction.
  for (const p of graph.people) if (p.oneHop && !origins.has(p.key)) for (const key of origins.keys()) {
    if (pairs.has(pair(key, p.key))) continue;
    put({ key: `policy:${key}:${p.key}`, from: key, to: p.key, kind: 'proximity', tier: 'C',
      firstSeen: null, lastSeen: null, source: 'warehouse one-hop access rule; personal tie requires confirmation', rowIds: [p.key], count: 1 });
  }
  const matches = new Map<string, WarehouseMatch[]>();
  for (const m of graph.matches) matches.set(m.lpKey, [...(matches.get(m.lpKey) ?? []), m]);
  const personMatches = new Map<string, Set<string>>();
  for (const m of graph.matches) if (m.status === 'confident') {
    const lps = personMatches.get(m.personKey) ?? new Set<string>();
    lps.add(m.lpKey);
    personMatches.set(m.personKey, lps);
  }
  const out: Path[] = [];
  const endpoint = (t: WarehouseTie, key: string) => t.from === key ? t.to : t.from;
  for (const c of candidates) {
    if (c.type !== 'person' || c.restrictions?.some((r) => r.scope === 'blanket')) continue;
    const alternatives = (matches.get(c.key) ?? []).filter((m) => m.status === 'confident');
    if (alternatives.length !== 1) continue;
    const match = alternatives[0]!;
    if (personMatches.get(match.personKey)!.size !== 1) continue;
    const target = people.get(match.personKey);
    if (!target) continue;
    const emit = (keys: string[], ties: WarehouseTie[]) => {
      if (keys.some((key) => (personMatches.get(key)?.size ?? 0) > 1)) return;
      const origin = origins.get(keys[0]!);
      if (!origin || keys.slice(0, -1).some((k) => c.restrictions?.some((r) => r.scope === 'connector' && r.connector === people.get(k)?.name))) return;
      const tier = ties.reduce<Tier>((a, t) => t.tier > a ? t.tier : a, 'A');
      const score = (t: WarehouseTie) => tieWarmth(warehousePathKind(t.kind), { kind: t.kind, lastInteraction: t.lastSeen }, at).score;
      const weakest = ties.reduce((a, t) => score(t) < score(a) ? t : a);
      const routePeople = keys.map((k) => people.get(k)!);
      out.push({ lp: c.key, other: { type: 'team', name: origin.name, handle: origin.handle },
        kind: warehousePathKind(weakest.kind), tier, tie: { kind: weakest.kind, lastInteraction: weakest.lastSeen },
        basis: `${routePeople.map((p) => p.name).join(' → ')}; ${ties.map((t) => `${t.kind.replaceAll('_', ' ')} (${t.tier}, ${t.count} records)`).join('; ')}${tier === 'C' || tier === 'D' ? '; a person must confirm the weak ties before routing' : ''}`,
        source: [...new Set(ties.map((t) => t.source))].join('; '), warehouse: { match, people: routePeople, ties } });
    };
    for (const last of adjacency.get(target.key) ?? []) {
      const via = endpoint(last, target.key);
      if (origins.has(via)) emit([via, target.key], [last]);
      else for (const first of adjacency.get(via) ?? []) {
        const start = endpoint(first, via);
        if (start !== target.key && origins.has(start)) emit([start, via, target.key], [first, last]);
      }
    }
  }
  return out;
}

/** Resolve a named personal relationship against the frozen roster, never fuzzy or firm names. */
export function resolvePerson(name: string, candidates: Candidate[], team: TeamMember[]): Path['other'] | null {
  // A trailing parenthesis describes a known person; never resolve names inside a firm label.
  const key = norm(name.replace(/\s*\([^()]*\)\s*$/, ''));
  if (!key.includes(' ')) return null;
  const matches: Path['other'][] = [
    ...team.filter((t) => norm(t.name) === key).map((t) => ({ type: 'team' as const, name: t.name, handle: t.handle })),
    ...candidates.filter((c) => c.type === 'person' && norm(c.name) === key).map((c) => ({ type: 'lp' as const, name: c.name, key: c.key })),
  ];
  return matches.length === 1 ? matches[0]! : null;
}

/** Conservative interval endpoints: a year-only start/end cannot manufacture overlap. */
function periodDate(value: unknown, end: boolean): string | null {
  const s = String(value ?? '');
  if (/^\d{4}$/.test(s)) return `${s}-${end ? '01-01' : '12-31'}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s))) return s;
  return null;
}

/** Our records attach a tie to its actual holder; neither ownership nor PL membership does. */
function ourSidePaths(c: Candidate, f: Finding | undefined, net: Network, team: TeamMember[], at: Date): Path[] {
  if (c.type !== 'person') return [];
  const out: Path[] = [];
  const other = (t: TeamMember): Path['other'] => ({ type: 'team', name: t.name, handle: t.handle });
  for (const t of team) {
    const contacts = (c.contact.recent ?? []).filter((r) => r.with.some((name) => norm(name) === norm(t.name))
      && r.on <= at.toISOString().slice(0, 10)
      && (((r.channel === 'meeting' || r.channel === 'call') && !(c.contact.meetingDates ?? []).some((d) => d.on === r.on && d.group))
        || ((r.channel === 'email' || r.channel === 'message') && r.direction === 'theirs')));
    const dates = [...new Set(contacts.map((r) => r.on))].sort();
    if (dates.length) out.push({ lp: c.key, other: other(t), kind: 'met', tier: 'B', source: 'our records',
      basis: `Named in ${dates.length} dated direct interaction${dates.length === 1 ? '' : 's'} with ${t.name}`,
      tie: { kind: dates.length >= config.routeWarmth.repeatedContacts ? 'repeated_contact' : 'acquaintance', lastInteraction: dates.at(-1) } });
  }
  for (const org of net.orgs) {
    const aliases = [org.name, ...org.aliases];
    const isOrg = (s: unknown) => typeof s === 'string' && aliases.some((a) => norm(a) === norm(s));
    const ours = isOrg(c.org) || (c.enriched['Organizations'] ?? '').split(/;\s*/).some(isOrg)
      || c.domains.some((d) => org.domains?.includes(d));
    const investors = net.backer_people.filter((b) => norm(b.name) === norm(c.name) && b.source
      && aliases.some((a) => affirms(b.what, a)) && /\b(angel|investor|backed|seed)\b/i.test(b.what));
    const angel = f?.facts.find((x) => x.confidence !== 'low' && x.scope !== 'firm' && x.field === 'investment'
      && isOrg(x.detail?.company) && /\bangel\b/i.test(x.value) && aliases.some((a) => affirms(x.value, a)));
    const investorSource = investors.length === 1 ? investors[0]!.source : angel?.source.url;
    if (investorSource) {
      for (const t of team) {
        // The founder is obtained from the team file, never a special case for an LP or person.
        const founder = [...t.roles, ...t.prior].find((r) => isOrg(r.org) && /\b(co-?founder|founder)\b/i.test(r.role ?? '') && r.source);
        if (founder) out.push({ lp: c.key, other: other(t), kind: 'portfolio', tier: 'B',
          basis: `A personal angel/backer of ${org.name}; ${t.name} is its documented founder. Direct investor–founder tie; willingness is not recorded.`,
          source: investorSource, tie: { kind: 'acquaintance' } });
      }
    }
    // Long service counts only with an own-record employment anchor AND dated overlap.
    // Public affiliation by itself remains C in the ordinary shared-employer join.
    if (!ours || !f) continue;
    for (const job of f.facts.filter((x) => x.confidence !== 'low' && x.scope !== 'firm'
      && ['role', 'prior_role'].includes(x.field) && isOrg(x.detail?.company))) {
      const start = periodDate(job.detail?.since ?? job.detail?.from ?? job.detail?.joined, false);
      const end = periodDate(job.detail?.until ?? job.detail?.to ?? job.detail?.left, true)
        ?? (job.field === 'role' ? periodDate(job.detail?.as_of, true) : null);
      if (!start || !end || !job.source.url || start >= end) continue;
      for (const t of team) for (const role of [...t.roles, ...t.prior]) {
        if (!isOrg(role.org) || !role.source) continue;
        const ts = periodDate(role.since, false);
        const te = periodDate(role.until, true) ?? (t.roles.includes(role) ? at.toISOString().slice(0, 10) : null);
        if (!ts || !te) continue;
        const from = [start, ts].sort().at(-1)!;
        const to = [end, te, at.toISOString().slice(0, 10)].sort()[0]!;
        const minimum = new Date(from);
        minimum.setUTCMonth(minimum.getUTCMonth() + config.routeWarmth.colleagueOverlapMonths);
        if (Date.parse(to) < minimum.getTime()) continue;
        out.push({ lp: c.key, other: other(t), kind: 'colleague', tier: 'B', source: job.source.url,
          basis: `Our employment record and dated roles place them with ${t.name} at ${org.name}, ${from} to ${to}. Long-service colleague rule; not intro consent. Team role: ${role.source}`,
          tie: { kind: 'worked_together', lastInteraction: to } });
      }
    }
  }
  return out;
}

/**
 * One company however a page writes it (iteration 3): "X.AI" and "X AI", "SoilCo" and "Soil Co",
 * "Paradromics, Inc." and "Paradromics" — legal suffixes dropped, then every space and mark.
 */
export const entityKey = (s: string) => s.toLowerCase().replace(/[’'`]/g, '')
  .replace(/[,.]?\s*\b(llc|l\.l\.c\.|inc|incorporated|corp|corporation|ltd|limited|lp|l\.p\.|plc|gmbh|ag|s\.a\.)\.?\s*$/i, '')
  .replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');

/**
 * Two ways of writing one firm: "Harbor" and "Harbor Capital", "Birch Labs" and "Birch Labs crypto" —
 * one name inside the other, or the same first word that isn't a generic one.
 */
export function sameFirm(a: string, b: string): boolean {
  const ka = entityKey(a), kb = entityKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const first = (x: string) => norm(x).split(' ').find((w) => w.length > 2 && !GENERIC.test(w)) ?? '';
  return first(a) !== '' && first(a) === first(b);
}

/** Words that name a kind of organization, not one: sharing only these says nothing. */
const GENERIC = /^(capital|ventures?|partners|fund|funds|labs?|group|holdings|investments?|management|advisors|foundation|trust|family office|angel|seed|series [a-e]|university|college|board|company|startup|startups|the fund|protocol labs|pl capital)$/;
/** Fields whose words name a company, a fund or a board they were part of. */
const RECORD_FIELDS = new Set(['investment', 'board', 'fund_lp', 'fund_gp', 'exit', 'prior_role', 'role', 'affiliation']);
/** The keys that name what a fact is about. An exit's acquirer is not one: buying the company isn't investing beside them (v01). */
const RECORD_KEYS = ['company', 'companies', 'fund', 'organization', 'org', 'firm'];

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

  // Who mentions what, and how: an investment, a board seat, a fund, a job. A firm's own facts
  // count only for a fund it backs (1.20): a fund of funds' manager, joined to whoever runs it.
  type Hit = { key: string; field: string; value: string; url: string; firm: boolean };
  const hits = new Map<string, Hit[]>();
  for (const c of resolved) {
    const f = findings.get(c.key)!;
    const own = new Set([c.org, f.identity.canonical?.org].filter(Boolean).map((o) => entityKey(o!)));
    const seen = new Set<string>();
    for (const x of f.facts) {
      const firm = x.scope === 'firm';
      if (x.confidence === 'low' || !RECORD_FIELDS.has(x.field) || (firm && x.field !== 'fund_lp')) continue;
      const structured = new Set(RECORD_KEYS.flatMap((k) => (typeof x.detail?.[k] === 'string' ? String(x.detail[k]).split(/\s*;\s*/).map(entityKey) : [])));
      for (const [n, shown] of names) {
        if (own.has(n) || seen.has(n)) continue;
        // The structured company only (v08): "raised from investors including X" names X in a
        // sentence without the LP having worked there or invested beside it.
        if (!structured.has(n)) continue;
        seen.add(n);
        hits.set(n, [...(hits.get(n) ?? []), { key: c.key, field: x.field, value: x.value, url: x.source.url, firm }]);
      }
    }
  }

  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const how = (h: Hit) => (h.field === 'investment' ? 'invested in' : h.field === 'exit' ? 'exited' : h.field === 'board' ? 'sat on the board of' : h.field === 'fund_lp' ? 'backed' : h.field === 'fund_gp' ? 'runs or ran' : 'worked at');
  const out: Path[] = [];
  for (const [n, hs] of hits) {
    const lps = [...new Set(hs.map((h) => h.key))];
    if (lps.length < 2 || lps.length > 8) continue;
    const shown = names.get(n)!;
    // A job, not a place someone went through (W5 after the search pass): an accelerator's alumni don't
    // run or work at it, and "their firm backs X, which B runs" made a shared accelerator a C tie.
    const ALUMNI = /\b(alum(?:na|nus|ni|nae)?|batch|cohort|went through|participated|graduated?|fellows?(?:hip)?|demo day)\b/i;
    const job = (h: Hit) => (h.field === 'role' || h.field === 'prior_role' || h.field === 'affiliation' || h.field === 'fund_gp') && !ALUMNI.test(h.value);
    // A one-word name joins only like with like (s23): two investments in "Nimbus", two seats on its
    // board — not a former employer and a fund that happen to share the word.
    const oneWord = !/\s/.test(shown.trim());
    for (const a of hs) for (const b of hs) {
      if (a.key === b.key) continue;
      if (oneWord && a.field !== b.field) continue;
      const ca = byKey.get(a.key)!, cb = byKey.get(b.key)!;
      if (ca.org && cb.org && norm(ca.org) === norm(cb.org)) continue;
      // A firm that backs a fund, and someone who runs or works at it: the firm is that fund's LP.
      // C — the firm's tie, with no evidence the two people ever spoke. Firm facts join nothing else.
      if (a.firm || b.firm) {
        if (a.firm === b.firm) continue;
        const backer = a.firm ? a : b, runner = a.firm ? b : a;
        if (!job(runner)) continue;
        const cr = byKey.get(runner.key)!, cbk = byKey.get(backer.key)!;
        out.push(a.firm
          ? { lp: a.key, other: { type: 'lp', name: cr.name, key: cr.key }, kind: 'other', tier: 'C', basis: `Their firm backs ${shown}, which ${cr.name} runs or works at — the firm's tie`, source: a.url }
          : { lp: a.key, other: { type: 'lp', name: cbk.name, key: cbk.key }, kind: 'other', tier: 'C', basis: `${cbk.name}'s firm backs ${shown}, where they work — the firm's tie`, source: b.url });
        continue;
      }
      const kind: Path['kind'] = a.field === 'board' && b.field === 'board' ? 'board' : (a.field === 'investment' || a.field === 'exit') && (b.field === 'investment' || b.field === 'exit') ? 'coinvestor' : 'other';
      const worked = (h: Hit) => h.field === 'role' || h.field === 'prior_role' || h.field === 'affiliation';
      out.push({ lp: a.key, other: { type: 'lp', name: cb.name, key: cb.key }, kind, tier: worked(a) && worked(b) ? 'D' : 'C',
        basis: how(a) === how(b) ? `Both ${how(a)} ${shown}` : `They ${how(a)} ${shown}; ${cb.name} ${how(b)} it`, source: a.url });
    }
  }
  return out;
}

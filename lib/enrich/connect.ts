import { portfolioPaths, readConnectionPortfolio } from './portfolio-paths';
import type { PortfolioInput } from './portfolio';
import { edgeGrade } from '@/modules/network/warmth';
import type { EdgeKind } from '@/modules/network';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate } from './candidates';
import type { EmailEvidence } from './email-evidence';
import type { Finding } from './schema';
import type { WarehousePerson, WarehouseTie, WarehouseMatch } from './warehouse-graph';
import { plNetworkPaths, materializeResearchNodes } from './pl-network';
import { config } from '@/config/deployment';
import { candidateKey } from './candidate-key';
import { isEntityKey } from './connection-check';
import { tieWarmth, investmentTie, type TieDetails, type Warmth } from '@/modules/network';

/**
 * W3, find connections (N64, docs/19): who of us, or of our LPs, is near whom. Deterministic and
 * run again whenever a finding lands — it reads only files: the candidates (our own records), the
 * findings (public sources), and our side (`us/`). Every path it writes carries its tier and the
 * evidence behind it (rule 6): A needs our own record of an interaction; B a documented
 * association; C a shared affiliation with no evidence the two ever spoke; D proximity. C and D
 * route with labelled uncertainty (AGENTS.md, rule 6); only actions require approval.
 */

export interface ConnectionPerson { key: string; name: string; source: string; entityType?: 'person' | 'org' }

export type Tier = 'A' | 'B' | 'C' | 'D';

export interface Path {
  lp: string;
  /** LP-unit display projection. The relationship endpoint remains this contact, not the firm. */
  viaContact?: { key: string; name: string; role: string };
  /** Sourced person outside the active LP research set; import resolves before building edges. */
  lpPerson?: ConnectionPerson;
  /** Who or what they are near: a team member, one of our organizations, a backer of ours, another LP. */
  other: { type: 'team' | 'ours' | 'backer' | 'lp'; name: string; key?: string; handle?: string; entityType?: 'person' | 'org'; person?: ConnectionPerson };
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
export interface TeamMember { handle: string; name: string; roles: TeamRole[]; prior: TeamRole[]; education: Array<{ org: string }>; sources?: string[]; bio?: string;
  affiliations?: TeamRole[]; boards?: TeamRole[]; employers?: TeamRole[]; cofounded?: TeamRole[]; investments?: TeamRole[] }

const STOP = /\b(llc|l\.l\.c\.|inc|incorporated|co|company|corp|corporation|ltd|limited|lp|l\.p\.|plc|gmbh|ag|sa|the)\b/g;
/** A firm's name reduced to what identifies it: "Harbor Street Ventures, LLC" → "harbor street ventures". */
export const norm = (s: string) => s.toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9&+ ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

/** Names so common that sharing them says nothing: not a tie at all. */
const TOO_COMMON = new Set(['google', 'amazon', 'microsoft', 'meta', 'facebook', 'apple', 'mckinsey', 'goldman sachs', 'morgan stanley', 'jp morgan', 'jpmorgan', 'self employed', 'stealth', 'independent']);
/**
 * Not a firm but a placeholder for none (7 Oct 2026: individuals sourced on 27 Sep carry "Personal", which gave each
 * about 28 "same firm" ties to unrelated LPs; "Personal investing" and "Personal capital / …" too). Read on the normalized
 * name, so "(individual) Jane" is "individual jane".
 */
const PLACEHOLDER_ORG = /^personal\b|^(?:self|self employed|independent|individual|individual investor|private|private investor|angel|angel investor|retired|none|n a|na|unknown|tbd)$|^individual\b/;

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

/** W3's output: the rows for connections.jsonl, and apart from them the rows no LP key resolves. */
export interface ConnectionResult {
  paths: Path[]; lps: number; lpKeys: string[]; researched: number;
  /** Rows filed under a key that is neither an LP's, a contact's nor an entity's: kept apart, never imported. */
  unresolved: Path[];
  /** Findings filed under another key (a research alias, a merged identity) moved to their LP's key. */
  rekeyed: number;
}

export async function findPaths(dir: string): Promise<ConnectionResult> {
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
  // The export's alias map, the same one the checker reads (lib/enrich/candidate-key.ts).
  const aliases = JSON.parse(await readFile(join(dir, 'entity-keys.json'), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return '{}';
  })) as Record<string, string>;
  return connectionPaths(candidates, findings, net, team, directory, new Date(), warehouse, await readConnectionPortfolio(dir), aliases);
}

/**
 * File each finding under its LP's key with the checker's resolver (candidateKey), against W3's
 * endpoints: the LP units and the people who speak for them. A research key, or a person's key after
 * a merge, otherwise leaves its ties on a row no LP owns. Where two findings land on one LP, the one
 * already under its key stays its profile (else the newest), and every finding's own recorded ties
 * still count. A finding no key or unique name resolves keeps its key: under an entity UUID its rows
 * stay as a connector outside the LP set (the network build reads them); under any other key W3 sets
 * them apart, since neither the checker nor the import can use them.
 */
export function resolveFindingKeys(findings: Map<string, Finding>, endpoints: ReadonlyArray<{ key: string; name: string }>,
  aliases: Readonly<Record<string, string>> = {}): { byKey: Map<string, Finding>; all: Finding[]; rekeyed: number; unresolved: number } {
  const byKey = new Map<string, Finding>();
  const all: Finding[] = [];
  let rekeyed = 0, unresolved = 0;
  for (const f of findings.values()) {
    const key = candidateKey(f, endpoints, aliases, f);
    if (!key) unresolved++;
    else if (key !== f.key) rekeyed++;
    const filed = key && key !== f.key ? { ...f, key } : f;
    all.push(filed);
    // The finding already under the LP's key keeps the profile, so no LP loses the paths it had;
    // among aliases alone, the newest.
    const previous = byKey.get(filed.key);
    const own = (x: Finding) => findings.get(x.key) === x;
    if (!previous || (!own(previous) && (own(filed) || filed.researched.at > previous.researched.at))) byKey.set(filed.key, filed);
  }
  return { byKey, all, rekeyed, unresolved };
}

/** An LP unit, a contact of one, a sourced connector person, or another entity outside the LP set. */
const ownedBy = (p: Path, endpoints: ReadonlyMap<string, unknown>) => endpoints.has(p.lp) || Boolean(p.lpPerson) || isEntityKey(p.lp);

/** W3's pure join, also used by invented property fixtures. No files or database writes. */
export function connectionPaths(candidates: Candidate[], findings: Map<string, Finding>, net: Network,
  team: TeamMember[], directory: PlDirectoryEntry[] = [], at = new Date(), warehouse?: WarehouseGraph, portfolio?: PortfolioInput,
  aliases: Readonly<Record<string, string>> = {}): ConnectionResult {

  const units = [...new Map(candidates.map(c => [c.key, c])).values()];
  const endpoints = new Map(units.map(c => [c.key, c]));
  for (const unit of units) if (unit.type !== 'person') for (const contact of unit.contacts ?? []) {
    if (contact.type === 'person' && !endpoints.has(contact.key)) endpoints.set(contact.key, contact);
  }
  const filed = resolveFindingKeys(findings, [...endpoints.values()], aliases);
  const all = entityConnectionPaths([...endpoints.values()], filed.byKey, net, team, directory, at, warehouse, portfolio, filed.all);
  const result = { ...all, paths: all.paths.filter(p => ownedBy(p, endpoints)) };
  const unresolved = all.paths.filter(p => !ownedBy(p, endpoints));
  const byEndpoint = new Map<string, Path[]>();
  for (const path of result.paths) byEndpoint.set(path.lp, [...(byEndpoint.get(path.lp) ?? []), path]);
  const projected: Path[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    if (unit.type === 'person' || unit.restrictions?.some(r => r.scope === 'blanket')) continue;
    for (const contact of unit.contacts ?? []) {
      if (contact.type !== 'person' || contact.restrictions?.some(r => r.scope === 'blanket')) continue;
      for (const path of byEndpoint.get(contact.key) ?? []) {
        if (path.other.key === unit.key || path.other.key === contact.key) continue;
        const names = new Set([contact.name, path.other.name, ...(path.warehouse?.people.slice(0, -1).map(p => p.name) ?? [])]);
        if ([...(unit.restrictions ?? []), ...(contact.restrictions ?? [])].some(r =>
          r.scope === 'connector' && r.connector && [...names].some(n => norm(n) === norm(r.connector!)))) continue;
        const key = JSON.stringify([unit.key, contact.key, path.other, path.kind, path.tier, path.basis, path.warehouse]);
        if (seen.has(key)) continue;
        seen.add(key);
        projected.push({ ...path, lp: unit.key, lpPerson: undefined,
          viaContact: { key: contact.key, name: contact.name, role: contact.contactRole },
          basis: `${path.basis}; via ${contact.contactRole} (${contact.name})` });
      }
    }
  }
  return { ...result, paths: [...result.paths, ...projected].sort((a, b) => a.tier.localeCompare(b.tier)
    || (b.warmth?.score ?? 0) - (a.warmth?.score ?? 0) || a.lp.localeCompare(b.lp) || a.other.name.localeCompare(b.other.name)),
    lps: units.length, lpKeys: units.map(c => c.key), researched: findings.size, unresolved, rekeyed: filed.rekeyed };
}

/** `findings` is one profile per LP; `allFindings` every finding, each filed under its LP's key. */
function entityConnectionPaths(candidates: Candidate[], findings: Map<string, Finding>, net: Network,
  team: TeamMember[], directory: PlDirectoryEntry[], at: Date, warehouse?: WarehouseGraph, portfolio?: PortfolioInput,
  allFindings: Finding[] = [...findings.values()]): { paths: Path[]; lps: number; lpKeys: string[]; researched: number } {

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
  const pathKeys = new Map<string, number>();
  const add = (p: Path) => {
    if (descriptors.has(p.lp)) p.lpPerson = descriptors.get(p.lp);
    if (p.other.key && descriptors.has(p.other.key)) p.other = { ...p.other, person: descriptors.get(p.other.key) };
    // Keep distinct supporting records; a weak affiliation must not discard a warm personal tie.
    const key = JSON.stringify([p.lp, p.other.name, p.kind, p.basis, p.warehouse?.ties.map((t) => t.key)]);
    const seenAt = pathKeys.get(key);
    if (seenAt === undefined) { pathKeys.set(key, paths.length); paths.push(p); return; }
    // The same record twice for one LP (two findings filed under it): the better tier, and a source
    // when only one of them names it.
    const kept = paths[seenAt]!;
    const better = p.tier < kept.tier ? p : kept, other = better === p ? kept : p;
    paths[seenAt] = better.source || !other.source ? better : { ...better, source: other.source };
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
    for (const p of teamProfilePaths(c, unsure ? undefined : f, team, at)) add(p);

    // Our own record of an interaction: meetings held with them, and who owns the pursuit.
    for (const p of c.pursuits) {
      if (c.contact.meetings > 0 && p.owner && p.owner !== 'Not on the team') {
        // The owner was assigned to the pursuit; participation is uncertain.
        add({ lp: c.key, other: { type: 'team', name: p.owner }, kind: 'met', tier: 'C', tie: { kind: 'proximity' }, basis: `${c.contact.meetings} ${c.contact.meetings === 1 ? 'meeting' : 'meetings'} on record; ${p.owner} owns the pursuit, participation is not recorded`, source: 'our records' });
      } else if (c.contact.meetings > 0) {
        add({ lp: c.key, other: { type: 'ours', name: 'PL Capital' }, kind: 'met', tier: 'B', basis: `${c.contact.meetings} ${c.contact.meetings === 1 ? 'meeting' : 'meetings'} on record; who from our side isn't recorded`, source: 'our records' });
      }
    }

    // C: the team marks them a close contact — relationship strength, a tier-C edge that never says
    // whose contact they are (CLAUDE.md). A path of its own, so triage, the pins and the routes
    // agree (v06); an unnamed holder routes from PL with that uncertainty recorded.
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
      if (d) add({ lp: c.key, other: { type: 'ours', name: o.name }, kind: 'colleague', tier: 'C', tie: { kind: 'proximity' }, basis: `Our records hold an email address for them at ${d}; dates and personal interaction are not recorded`, source: 'our records' });
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
          // Going through an accelerator is being in a batch, not working there (s08): D, as alumni. A team member who
          // worked there (a partner, say; issue 0144) shares an employer like any other: C.
          const accelerator = /y combinator|\byc\b|techstars|500 startups|on deck|entrepreneur first|antler|accelerator/i.test(r.org)
            && !/\b(partner|director|employee|staff|principal|associate|head|manager|chief|president)\b/i.test(r.role ?? '');
          add(accelerator
            ? { lp: c.key, other: { type: 'team', name: t.name, handle: t.handle }, kind: 'alumni', tier: 'D', basis: `Both went through ${r.org}, in different batches most likely`, source: null }
            : { lp: c.key, other: { type: 'team', name: t.name, handle: t.handle }, kind: 'colleague', tier: 'C', tie: { kind: 'proximity' }, basis: `Both have worked at ${r.org}; collaboration and dates are not recorded`, source: r.source ?? null });
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
  for (const f of allFindings) {
    if (f.identity.match === 'ambiguous' || f.identity.match === 'not_found') continue;
    for (const c of f.connections ?? []) {
      const tier = c.tier === 'B' && c.scope === 'firm' ? 'C' : c.tier;
      const resolved = c.toType !== 'org' && c.scope !== 'firm' ? (c.toHandle && team.some((t) => t.handle === c.toHandle)
        ? { type: 'team' as const, name: team.find((t) => t.handle === c.toHandle)!.name, handle: c.toHandle }
        : resolvePerson(c.to, people, team)) : null;
      const direct = resolved?.type === 'team' && Boolean(c.source)
        && (c.kind === 'podcast_guest' || /\b(?:one[- ]to[- ]one|1[: -]1|direct conversation|interviewed)\b/i.test(c.basis))
        && !/\b(?:not|never|no|panel|coattendance|co-attendance)\b/i.test(c.basis);
      add({ lp: f.key, other: { ...(resolved ?? { type: /protocol labs|filecoin|ipfs|pl capital|protocol vc/i.test(c.to) ? 'ours' as const : 'backer' as const, name: c.to }), ...(c.toType ? { entityType: c.toType } : {}) },
        kind: c.kind === 'portfolio' ? 'portfolio' : c.kind === 'board' ? 'board' : c.kind === 'advisor' ? 'advisor' : c.kind === 'coinvestor' ? 'coinvestor' : c.kind === 'colleague' ? 'colleague' : c.kind === 'alumni' ? 'alumni' : 'other',
        tie: c.scope === 'firm' ? { kind: 'proximity' } : direct ? { ...c.tie, kind: 'acquaintance', directInteraction: true } : c.tie
          ?? (/\bco[ -]?founded\b|\bco[ -]?founders\b/i.test(c.basis) && resolved ? { kind: 'cofounder' } : undefined),
        reviewedBy: c.reviewedBy, reviewedAt: c.reviewedAt,
        tier: direct && tier > 'B' ? 'B' : tier, basis: `${c.basis}${c.scope === 'firm' ? ' (the firm’s tie)' : ''}`, source: c.source ?? 'research:W3 (source not recorded)' });
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
  for (const f of allFindings) {
    if (f.identity.match === 'ambiguous' || f.identity.match === 'not_found') continue;
    const from = byKeyAll.get(f.key);
    if (!from) continue;
    for (const conn of (f.connections ?? []).filter((x) => x.scope === 'firm')) {
      const ours = /protocol labs|filecoin|ipfs|pl capital|protocol vc/i.test(conn.to);
      for (const d of from.domains) {
        for (const c of atDomain.get(d) ?? []) {
          if (c.key === f.key) continue;
          add({ lp: c.key, other: { type: ours ? 'ours' : 'backer', name: conn.to, ...(conn.toType ? { entityType: conn.toType } : {}) }, kind: conn.kind === 'coinvestor' ? 'coinvestor' : conn.kind === 'portfolio' ? 'portfolio' : 'other',
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
    if (o && !TOO_COMMON.has(o) && !PLACEHOLDER_ORG.test(o)) keys.add(`org:${o}`);
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
  // with uncertain identity. Speaking at a PL event is C, attending one D (amendment 1.4). Their
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
        add({ lp: e.key, other: { type: 'ours', name: 'Protocol Labs network' }, kind: 'other', tier: 'C', basis: `Someone of that name is in Protocol Labs’ directory (${where}): identity match uncertain`, source: DIRECTORY });
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

  const withPortfolio = portfolio ? portfolioPaths(paths, candidates, findings, portfolio) : paths;
  return { paths: materializeResearchNodes(plNetworkPaths(withPortfolio, candidates, findings, net, team, directory), candidates, net, team).map((p) => {
    let tie = p.tie ?? ((p.tier === 'C' || p.tier === 'D') ? { kind: 'proximity' as const }
      : /\bco[ -]?founded\b|\bco[ -]?founders\b|\bfounded\b.+\bwith\b/i.test(p.basis) ? { kind: 'cofounder' as const } : undefined);
    const sourceTie = p.other.type === 'team' || p.other.person?.name === 'PL';
    if (p.other.type === 'team' && p.tier <= 'B' && investmentTie({ evidence: [{ note: p.basis, source: p.source ?? undefined, tie }] })) {
      tie = { ...tie, kind: 'investor_founder', withUs: 'investor' };
    }
    // A pipeline status alone is not investor evidence. Preserve personal versus firm scope.
    const candidate = candidates.find((c) => c.key === p.lp);
    const member = directory.find((e) => e.key === p.lp)?.members.find((m) => m.match === 'confirmed'
      && m.roles.some((r) => /\b(?:co-?founder|founder)\b/i.test(r.role ?? '')));
    if (sourceTie && tie && candidate?.type === 'person') {
      if (candidate.money?.track === 'hard' && candidate.money.amount > 0) tie = { ...tie, withUs: 'investor' };
      else if (member && tie.withUs !== 'investor') tie = { ...tie, withUs: 'pl_founder' };
    }
    return { ...p, tier: p.tier > 'B' ? p.tier : edgeGrade({ kind: p.kind as EdgeKind, evidence: [{ note: p.basis, source: p.source ?? undefined, tie }] }, at), tie, warmth: tieWarmth(p.kind, tie, at) };
  }).sort((a, b) => a.tier.localeCompare(b.tier) || b.warmth.score - a.warmth.score || a.lp.localeCompare(b.lp) || a.other.name.localeCompare(b.other.name)),
  lps: candidates.length, lpKeys: candidates.map((c) => c.key), researched: findings.size };
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
  const members = team.filter((t) => norm(t.name) === key);
  // The same roster person appearing in the LP input is still a source, not a second connector.
  if (members.length === 1) return { type: 'team', name: members[0]!.name, handle: members[0]!.handle };
  const matches: Path['other'][] = [
    ...members.map((t) => ({ type: 'team' as const, name: t.name, handle: t.handle })),
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

/** Team profile evidence uses the same resolved findings and structured entity keys as W3. */
function teamProfilePaths(c: Candidate, f: Finding | undefined, team: TeamMember[], at: Date): Path[] {
  const out: Path[] = [];
  if (c.restrictions?.some(r => r.scope === 'blanket')) return out;
  const today = at.toISOString().slice(0, 10);
  const fields = new Set([...RECORD_FIELDS, 'philanthropy']);
  const facts = f?.facts.filter(x => x.confidence !== 'low' && x.source.url && fields.has(x.field)) ?? [];
  const names = (x: NonNullable<Finding['facts'][number]['detail']>) => RECORD_KEYS.flatMap(k =>
    typeof x[k] === 'string' ? String(x[k]).split(/\s*;\s*/) : []);
  // Own-record identities still work without public research. Ambiguous research is never used.
  const orgs = [...new Set([c.type === 'org' ? c.name : null, c.org, f?.identity.canonical?.org,
    ...facts.flatMap(x => names(x.detail ?? {}))].filter((s): s is string => Boolean(s)))];
  const usable = (org: string) => entityKey(org).length >= 3 && !GENERIC.test(norm(org)) && !TOO_COMMON.has(norm(org));
  for (const t of team) {
    if (c.restrictions?.some(r => r.scope === 'connector' && r.connector && norm(r.connector) === norm(t.name))) continue;
    const emit = (org: string, role: TeamRole | undefined, category: string) => {
      const matched = facts.filter(x => names(x.detail ?? {}).some(n => entityKey(n) === entityKey(org)));
      let overlap: string | undefined;
      // A shared organisation alone cannot establish working together. Require sourced work
      // roles on both sides and a conservatively dated overlap, including past partnerships.
      if (role?.source && ['work', 'affiliation'].includes(category) && c.type === 'person'
        && /\b(partner|founder|employee|engineer|director|president|chief|manager|analyst|associate|officer)\b/i.test(role.role ?? '')) {
        const start = periodDate(role.since, false), end = periodDate(role.until, true)
          ?? (t.roles.includes(role) ? today : null);
        for (const x of matched) {
          if (x.scope === 'firm' || !['role', 'prior_role', 'fund_gp'].includes(x.field)) continue;
          const xs = periodDate(x.detail?.since ?? x.detail?.from ?? x.detail?.joined, false);
          const xe = periodDate(x.detail?.until ?? x.detail?.to ?? x.detail?.left, true)
            ?? (x.field === 'role' ? periodDate(x.detail?.as_of, true) : null);
          if (!start || !end || !xs || !xe) continue;
          const from = [start, xs].sort().at(-1)!;
          const to = [end, xe, today].sort()[0]!;
          const minimum = new Date(from);
          minimum.setUTCMonth(minimum.getUTCMonth() + config.routeWarmth.colleagueOverlapMonths);
          if (Date.parse(to) >= minimum.getTime()) overlap = `${from} to ${to}`;
        }
      }
      const sources = [...new Set([role?.source, ...(t.sources ?? []), ...matched.map(x => x.source.url)].filter(Boolean))];
      out.push({ lp: c.key, other: { type: 'team', name: t.name, handle: t.handle },
        kind: category === 'board' ? 'board' : category === 'investment' ? 'coinvestor' : category === 'work' ? 'colleague' : 'other',
        tier: overlap ? 'B' : 'C', tie: { kind: overlap ? 'worked_together' : 'proximity' },
        basis: `${t.name}: ${role?.role ?? category} at ${org}${role?.since || role?.until ? ` (${role.since ?? '?'}–${role.until ?? '?'})` : ''}; ${overlap
          ? `documented working overlap ${overlap}` : category === 'from bio' ? 'from bio; exact organisation-name mention only'
            : 'shared organisation; direct working overlap is not established'}${matched.some(x => x.scope === 'firm') ? '; includes firm-level evidence' : ''}${matched.length ? `; LP evidence: ${clip(matched.map(x => x.value).join('; '))}` : ''}. No willingness or consent recorded.`,
        source: sources.join('; ') || 'us/team.json',
      });
    };
    const entries: Array<[TeamRole, string]> = [
      ...[...t.roles, ...t.prior, ...(t.employers ?? []), ...(t.cofounded ?? [])].map(r => [r, 'work'] as [TeamRole, string]),
      ...(t.affiliations ?? []).map(r => [r, 'affiliation'] as [TeamRole, string]),
      ...(t.boards ?? []).map(r => [r, 'board'] as [TeamRole, string]),
      ...(t.investments ?? []).map(r => [r, 'investment'] as [TeamRole, string]),
    ];
    for (const [role, category] of entries) if (usable(role.org)
      && orgs.some(org => entityKey(org) === entityKey(role.org))) emit(role.org, role, category);
    // Literal, bounded organisation names only: no fuzzy aliases or person-name joins in prose.
    if (t.bio) for (const org of orgs) if (usable(org) && affirms(t.bio, org)
      && !new RegExp(`${escape(org)}\\s+(?:Trust|Institute|Council|Foundation|Labs?|Inc|Corp|LLC|Ltd|Technologies|Systems|Holdings|Capital|Ventures|Partners|Group)\\b`, 'i').test(t.bio)) emit(org, undefined, 'from bio');
  }
  return out;
}

/** Our records attach a tie to its actual holder; neither ownership nor PL membership does. */
function ourSidePaths(c: Candidate, f: Finding | undefined, net: Network, team: TeamMember[], at: Date): Path[] {
  const out: Path[] = [];
  const other = (t: TeamMember): Path['other'] => ({ type: 'team', name: t.name, handle: t.handle });
  const records: Array<Candidate['contact']['recent'][number] & { group?: boolean; email?: EmailEvidence }> = c.contact.records ?? c.contact.recent ?? [];
  const history = records.map(r => {
    const email = r.email;
    return { ...r, with: email?.team?.length ? email.team : r.with, direction: email?.direction ?? r.direction };
  });
  const cutoff = new Date(at.getTime() - 180 * 86400000).toISOString().slice(0, 10);
  const recentPersonal = history.filter(r => r.channel === 'email' && 'email' in r && r.email?.oneToOne && !r.email.bulk
    && r.on >= cutoff && r.on <= at.toISOString().slice(0, 10) && team.some(t => r.with.some(n => norm(n) === norm(t.name))));
  const twoWay = recentPersonal.some(r => ['sent', 'ours'].includes(r.direction ?? ''))
    && recentPersonal.some(r => ['received', 'theirs'].includes(r.direction ?? ''));
  for (const t of team) {
    const contacts: Array<Candidate['contact']['recent'][number] & { group?: boolean; email?: EmailEvidence }> = history.filter((r) => r.with.some((name) => norm(name) === norm(t.name))
      && r.on <= at.toISOString().slice(0, 10)
      && ['meeting', 'call', 'email', 'message'].includes(r.channel));
    const direct = contacts.filter(r => r.channel !== 'email' && (r.group !== undefined ? !r.group
      : !(c.contact.meetingDates ?? []).some(d => d.on === r.on && d.group)));
    const emails = contacts.filter(r => r.channel === 'email');
    const personal = emails.filter(r => 'email' in r && r.email?.oneToOne && !r.email.bulk);
    const sent = personal.filter(r => ['ours', 'sent'].includes(r.direction ?? ''));
    const received = personal.filter(r => ['theirs', 'received'].includes(r.direction ?? ''));
    const bulkOnly = contacts.length > 0 && contacts.every(r => r.channel === 'email' && 'email' in r && r.email?.bulk);
    const pairedSent = twoWay ? sent.filter(r => r.on >= cutoff) : [];
    const warm = [...direct, ...received, ...pairedSent];
    const tier: Tier = warm.length ? 'B' : bulkOnly ? 'D' : 'C';
    const why = direct.length ? 'direct meeting/call/message with both present'
      : twoWay && personal.some(r => r.on >= cutoff) ? 'two-way one-to-one email within 180 days (across the named team)'
      : received.length ? 'inbound-only one-to-one email; waiting on us'
      : bulkOnly ? 'bulk/mass mailing only; no personal tie established'
      : sent.length ? 'we wrote, no reply (one-to-one email)'
      : emails.length ? 'email direction or one-to-one participants unverified'
      : 'group attendance, personal interaction uncertain';
    const dates = [...new Set(contacts.map(r => r.on))].sort();
    if (dates.length) out.push({ lp: c.key, other: other(t), kind: contacts.some(r => ['meeting', 'call'].includes(r.channel)) ? 'met' : 'corresponded', tier, source: 'our records',
      basis: `Named in ${dates.length} dated interaction${dates.length === 1 ? '' : 's'} with ${t.name}; ${why}`,
      tie: { kind: warm.length ? (warm.length >= config.routeWarmth.repeatedContacts ? 'repeated_contact' : 'acquaintance') : 'proximity',
        directInteraction: warm.length > 0, lastInteraction: warm.length ? warm.map(r => r.on).sort().at(-1) : dates.at(-1) } });
  }
  if (c.type !== 'person') return out;
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
          source: investorSource, tie: { kind: 'investor_founder', withUs: 'investor' } });
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
 * C and routes with labelled uncertainty (rule 6); two people who only worked at one company, at
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

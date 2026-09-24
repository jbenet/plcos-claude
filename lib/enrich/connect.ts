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
interface Network { orgs: Org[]; backers: Org[]; backer_people: Array<{ name: string; what: string; source: string }>; portfolio?: Array<Org & { vehicle: string }> }
interface TeamMember { handle: string; name: string; roles: Array<{ org: string }>; prior: Array<{ org: string; role?: string }>; education: Array<{ org: string }> }

const STOP = /\b(llc|l\.l\.c\.|inc|incorporated|co|company|corp|corporation|ltd|limited|lp|l\.p\.|plc|gmbh|ag|sa|the)\b/g;
/** A firm's name reduced to what identifies it: "Harbor Street Ventures, LLC" → "harbor street ventures". */
export const norm = (s: string) => s.toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9&+ ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

/** Names so common that sharing them says nothing: not a tie at all. */
const TOO_COMMON = new Set(['google', 'amazon', 'microsoft', 'meta', 'facebook', 'apple', 'mckinsey', 'goldman sachs', 'morgan stanley', 'jp morgan', 'jpmorgan', 'self employed', 'stealth', 'independent']);

function mentions(text: string, alias: string): boolean {
  const a = alias.toLowerCase();
  if (a.length < 3) return false;
  const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
  return re.test(text);
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

  for (const c of candidates) {
    const f = findings.get(c.key);
    const unsure = f && (f.identity.match === 'ambiguous' || f.identity.match === 'not_found');
    const text = unsure ? '' : textOf(f);
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
        if (text && mentions(text, a)) {
          const fact = f!.facts.find((x) => x.confidence !== 'low' && mentions(x.value, a));
          add({ lp: c.key, other: { type: 'ours', name: o.name }, kind: fact?.field === 'investment' ? 'coinvestor' : fact?.field === 'board' ? 'board' : 'other', tier: 'C', basis: `Public source mentions ${a}: “${(fact?.value ?? '').slice(0, 140)}”`, source: fact?.source.url ?? null });
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
      const hit = text ? f!.facts.find((x) => x.confidence !== 'low' && pc.aliases.some((a) => mentions(x.value, a))) : undefined;
      const atOrg = orgs.find((o) => pc.aliases.some((a) => norm(o) === norm(a)));
      if (hit || atOrg) {
        add({ lp: c.key, other: { type: 'ours', name: `${pc.name} (${pc.vehicle} portfolio)` }, kind: atOrg ? 'colleague' : hit!.field === 'board' ? 'board' : 'coinvestor', tier: 'C',
          basis: atOrg ? `Works at ${pc.name}, a ${pc.vehicle} portfolio company` : `Public source: “${hit!.value.slice(0, 140)}”`, source: hit?.source.url ?? pc.source ?? null });
      }
    }

    // C/D: a place a team member also worked or studied. Same employer is C; the same school is D.
    for (const t of team) {
      for (const r of [...t.roles, ...t.prior]) {
        const o = norm(r.org);
        if (!o || TOO_COMMON.has(o) || ['protocol labs', 'pl capital', 'protocol labs protocol vc'].includes(o)) continue;
        if (orgs.some((x) => norm(x) === o) || (text && r.org.length > 4 && mentions(text, r.org))) {
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

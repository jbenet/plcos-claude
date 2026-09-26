import type { Candidate } from './candidates';
import type { Finding } from './schema';
import { connectionPersonKey, norm, type ConnectionPerson, type Network, type Path, type PlDirectoryEntry, type TeamMember } from './connect';

const isPL = (s: string) => /^(?:protocol labs|pl)$/i.test(s.trim());
const plMention = (s: string) => /\bProtocol Labs\b/i.test(s) && !/\b(?:not|never|no)\b[^.;]*\bProtocol Labs\b/i.test(s);
export const PL_SOURCE = { name: 'PL', source: 'https://protocol.ai', entityType: 'org' as const };
export const plSourceNode = (): ConnectionPerson => ({ ...PL_SOURCE, key: connectionPersonKey(PL_SOURCE.name, PL_SOURCE.source) });

/** Rule 6, 26 Sep: PL affiliation is warm in its own right. Dates still describe contact
 * only when records supply them. This models a network relationship, not consent to ask.
 */
export function plNetworkPaths(paths: Path[], candidates: Candidate[], findings: Map<string, Finding>, net: Network,
  team: TeamMember[], directory: PlDirectoryEntry[]): Path[] {
  const out = [...paths];
  const hub = plSourceNode();
  const plTeam = team.filter((t) => [...t.roles, ...t.prior].some((r) => isPL(r.org)));
  const plOrgs = net.orgs.filter((o) => isPL(o.name) || o.aliases.some(isPL));
  const staff = new Map<string, string>();
  const network = new Map<string, string>();
  for (const c of candidates) {
    const f = findings.get(c.key);
    const resolved = f && !['ambiguous', 'not_found'].includes(f.identity.match) ? f : undefined;
    const own = [c.org ?? '', ...(c.enriched['Organizations'] ?? '').split(/;\s*/)].some(isPL)
      || c.domains.some((d) => plOrgs.some((o) => o.domains?.includes(d)));
    const job = resolved?.facts.find((fact) => fact.scope !== 'firm' && fact.confidence !== 'low'
      && ['role', 'prior_role', 'affiliation'].includes(fact.field)
      && (isPL(String(fact.detail?.company ?? '')) || plMention(fact.value)));
    const shared = paths.find((p) => p.lp === c.key && p.kind === 'colleague' && /^Both have worked at Protocol Labs\b/i.test(p.basis));
    if (c.type === 'person' && (own || job || shared)) staff.set(c.key, job?.source.url ?? shared?.source ?? 'our records');
    const entry = directory.find((e) => e.key === c.key);
    if (staff.has(c.key)) network.set(c.key, staff.get(c.key)!);
    else if (entry?.members.some((m) => m.match === 'confirmed') || entry?.firmTeams.length) network.set(c.key, 'https://os.pl.xyz');
  }
  // Personal backers, known portfolio relationships and our own interactions have a PL
  // endpoint even when nobody recorded which team member holds the relationship.
  for (const p of paths) {
    if (p.tier === 'B' && p.other.type === 'team'
      && plMention(p.basis) && /\b(?:angel investor|personal angel\/backer|personal backer)\b/i.test(p.basis)) network.set(p.lp, p.source ?? 'research:W3');
    if (p.other.type === 'ours' && /^(?:PL Capital|Protocol Labs(?: network)?|Someone on the team \(unrecorded\))$/.test(p.other.name)
      && (p.tier === 'A' || p.tier === 'B')) network.set(p.lp, p.source ?? 'our records');
  }
  const add = (p: Path) => {
    if (!out.some((q) => q.lp === p.lp && q.other.key === p.other.key && q.other.handle === p.other.handle && q.basis === p.basis)) out.push(p);
  };
  for (const [key, source] of network) {
    const basis = staff.has(key) ? 'pl_affiliation' as const : 'pl_network' as const;
    add({ lp: key, lpPerson: paths.find((p) => p.lp === key)?.lpPerson,
      other: { type: 'ours', name: hub.name, key: hub.key, person: hub }, kind: 'colleague', tier: 'B',
      tie: { kind: 'worked_together', basis }, source,
      basis: staff.has(key) ? 'Current or former Protocol Labs affiliation; warm by the PL network rule. Contact dates are not inferred.'
        : 'In the PL network; PL is the route source where no particular team member is recorded. Not intro consent.' });
    for (const t of plTeam) add({ lp: key, lpPerson: paths.find((p) => p.lp === key)?.lpPerson,
      other: { type: 'team', name: t.name, handle: t.handle }, kind: 'colleague', tier: 'B', tie: { kind: 'worked_together', basis }, source,
      basis: `${staff.has(key) ? 'Both are or were at Protocol Labs' : 'PL network member and PL team member'}; warm by the PL network rule. No interaction date or willingness is inferred.` });
  }
  // PL colleagues can themselves connect onwards, even when they are not app users.
  const colleagues = candidates.filter((c) => staff.has(c.key));
  for (let i = 0; i < colleagues.length; i++) for (const b of colleagues.slice(i + 1)) {
    const a = colleagues[i]!;
    add({ lp: a.key, other: { type: 'lp', name: b.name, key: b.key }, kind: 'colleague', tier: 'B',
      tie: { kind: 'worked_together', basis: 'pl_affiliation' }, source: staff.get(a.key),
      basis: `Both are or were at Protocol Labs; warm by the PL network rule. Sources: ${staff.get(a.key)}; ${staff.get(b.key)}. Dates of contact are unknown.` });
  }
  const transformed: Path[] = out.map((p) => p.kind === 'colleague' && /^Both have worked at Protocol Labs\b/i.test(p.basis)
    ? { ...p, tier: 'B', tie: { kind: 'worked_together', basis: 'pl_affiliation' }, basis: 'Both are or were at Protocol Labs; warm by the PL network rule. Dates of contact are unknown.' } : p);
  return transformed.filter((p, i) => transformed.findIndex((q) => q.lp === p.lp && q.other.key === p.other.key
    && q.other.handle === p.other.handle && q.other.name === p.other.name && q.kind === p.kind && q.tier === p.tier && q.basis === p.basis) === i);
}

/** Keep research endpoints as nodes even outside the LP roster. Organization edges retain
 * their original tier and source; being a node does not assert a personal relationship.
 */
export function materializeResearchNodes(paths: Path[], candidates: Candidate[], net: Network, team: TeamMember[]): Path[] {
  const organizations = [...net.orgs, ...net.backers, ...(net.portfolio ?? [])];
  const nodes = paths.map((p): Path => {
    if (p.other.key || p.other.handle) return p;
    const name = p.other.name.replace(/\s*\([^()]*\)\s*$/, '').trim();
    const members = team.filter((t) => norm(t.name) === norm(name));
    if (members.length === 1) return { ...p, other: { type: 'team', name: members[0]!.name, handle: members[0]!.handle } };
    const matches = candidates.filter((c) => norm(c.name) === norm(name));
    if (matches.length === 1) return { ...p, other: { ...p.other, name: matches[0]!.name, key: matches[0]!.key } };
    if (isPL(name) || /^(?:Someone on the team|PL Capital|Protocol Labs network)/i.test(p.other.name)) {
      const hub = plSourceNode();
      return { ...p, other: { type: 'ours', name: hub.name, key: hub.key, person: hub } };
    }
    const org = organizations.find((o) => norm(o.name) === norm(name) || o.aliases.some((a) => norm(a) === norm(name)));
    const backer = net.backer_people.find((b) => norm(b.name) === norm(name));
    // Node identity must not change with the page that happened to mention it.
    // The exact source remains on each edge.
    const source = backer?.source ?? org?.source ?? 'research:W3';
    const entityType = backer ? 'person' : org || p.other.type === 'ours' ? 'org'
      : /\b(capital|partners|ventures|labs|fund|foundation|university|network|inc|llc)\b/i.test(name) ? 'org' : 'person';
    const person: ConnectionPerson = { key: connectionPersonKey(name, source), name, source, entityType };
    return { ...p, other: { ...p.other, name, key: person.key, person } };
  });
  const hub = plSourceNode();
  for (const p of [...nodes]) {
    const descriptor = p.other.person;
    if (!descriptor || descriptor.key === hub.key) continue;
    const org = organizations.find((o) => norm(o.name) === norm(descriptor.name) || o.aliases.some((a) => norm(a) === norm(descriptor.name)));
    if (!org || nodes.some((q) => q.lp === descriptor.key && q.other.key === hub.key)) continue;
    nodes.push({ lp: descriptor.key, lpPerson: descriptor, other: { type: 'ours', name: hub.name, key: hub.key, person: hub },
      kind: 'portfolio', tier: 'B', source: org.source ?? 'research:W3', tie: { kind: 'worked_together', basis: 'pl_network' },
      basis: 'Organization in our sourced ecosystem roster; PL network connection, not a claim about individual interaction or intro consent.' });
  }
  return nodes;
}

/**
 * W2n, the Protocol Labs network (docs/19, iteration 3): who in the research set is in PL's own
 * directory (os.pl.xyz), and which of their firms are network teams. Read only, from the
 * directory's public API; one lookup per LP, carrying their name and nothing else, one at a time.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-pl-directory.ts
 *   DATA_PROFILE=real npx tsx scripts/enrich-pl-directory.ts --teams-only
 *
 * `--teams-only` keeps the directory entries already looked up and matches firms again, now also
 * on what the research found: each finding's organization and its own website's domain — a work
 * domain on file can redirect to a new one (1.22). No name is looked up twice.
 *
 * Writes, under data/<profile>/enrich/us/:
 *   pl-network.json      the network's teams: name, site domain, fund or not, focus areas.
 *   pl-directory.jsonl   per LP: the directory entries under their name, with their teams, roles,
 *                        investor profile (fund types, typical check), PL events, and whether the
 *                        entry matches our record of them (their firm, their domain).
 *
 * Never stored: an email address, a handle, a phone number, a photo — anything for contacting
 * someone. The directory's investor profile is kept as what they said about their investing.
 * Prints counts only.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import type { ResearchIdentity } from '../lib/enrich/candidates';
import { entityKey } from '../lib/enrich/connect';
import type { Finding } from '../lib/enrich/schema';

const API = 'https://api-directory.os.pl.xyz/v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get<T>(path: string): Promise<T | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
      if (r.ok) return (await r.json()) as T;
      if (r.status === 404) return null;
    } catch { /* retried */ }
    await sleep(1000 * (i + 1));
  }
  return null;
}
/** Sites many people and teams share: a GitHub link joins no LP to a team (s22). */
const GENERIC_DOMAINS = /^(github\.com|gitlab\.com|bitbucket\.org|medium\.com|substack\.com|linkedin\.com|twitter\.com|x\.com|notion\.site|notion\.so|linktr\.ee|youtube\.com|facebook\.com|instagram\.com|google\.com|sites\.google\.com|wordpress\.com|wixsite\.com|squarespace\.com|angel\.co|wellfound\.com|crunchbase\.com)$/;
const domainOf = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    const host = new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
    return GENERIC_DOMAINS.test(host) ? null : host;
  } catch { return null; }
};

interface TeamRow { uid: string; name: string; website?: string | null; isFund?: boolean; dateFounded?: number | null; shortDescription?: string | null }
interface TeamDetail extends TeamRow {
  membershipSources?: Array<{ title: string }>; technologies?: Array<{ title: string }>; teamFocusAreas?: Array<{ title: string }>;
  industryTags?: Array<{ title: string }>;
}
interface MemberDetail {
  uid: string; name: string; isInvestor?: boolean; plnStartDate?: string | null;
  teamMemberRoles?: Array<{ role?: string | null; mainTeam?: boolean; teamLead?: boolean; investmentTeam?: boolean; startDate?: string | null; endDate?: string | null; team?: { uid: string; name: string } }>;
  experiences?: Array<{ company?: string; companyName?: string; title?: string; start?: string; end?: string }>;
  eventGuests?: Array<{ isHost?: boolean; isSpeaker?: boolean; event?: { name?: string; startDate?: string } }>;
  investorProfile?: { investmentFocus?: string[]; investInStartupStages?: string[]; investInFundTypes?: string[]; typicalCheckSize?: number | string | null; isInvestViaFund?: boolean; type?: string | null } | null;
}

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const set = (await readFile(join(dir, 'research-set.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as ResearchIdentity);
  const teamsOnly = process.argv.includes('--teams-only');
  // What the research found about where they work: its organization and its own website.
  const research = new Map<string, { org: string | null; domains: string[] }>();
  for (const f of (await readdir(join(dir, 'raw')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try {
      const x = JSON.parse(await readFile(join(dir, 'raw', f), 'utf8')) as Finding;
      if (x.identity.match !== 'confirmed' && x.identity.match !== 'probable') continue;
      const sites = (x.identity.links ?? []).filter((l) => l.kind === 'website' || l.kind === 'bio').map((l) => domainOf(l.url)).filter((d): d is string => Boolean(d));
      research.set(x.key, { org: x.identity.canonical?.org ?? null, domains: [...new Set(sites)] });
    } catch { /* the checker reports it */ }
  }
  if (teamsOnly) {
    const net = JSON.parse(await readFile(join(dir, 'us', 'pl-network.json'), 'utf8')) as { teams: Array<{ uid: string; name: string; domain: string | null; isFund: boolean; focus: string[] }> };
    const prior = new Map((await readFile(join(dir, 'us', 'pl-directory.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { key: string; members: unknown[]; firmTeams: Array<{ name: string }> }).map((e) => [e.key, e]));
    const byKeyT = new Map(net.teams.map((t) => [entityKey(t.name), t]));
    const byDomainT = new Map(net.teams.filter((t) => t.domain).map((t) => [t.domain!, t]));
    const lines: string[] = [];
    let firms = 0, added = 0;
    for (const lp of set) {
      const fr = research.get(lp.key);
      const orgs = [lp.org, lp.enriched['Current Organization'], ...(lp.enriched['Organizations'] ?? '').split(/;\s*/), fr?.org].filter((o): o is string => Boolean(o && o.trim()));
      const doms = [...lp.domains, ...(fr?.domains ?? [])];
      // A one-word organization joins a team only when a domain agrees (s17): "Nimbus" matched a
      // marketing agency of that name. Several words, or the domain itself, are enough.
      const byName = orgs.filter((o) => /\s/.test(o.trim())).map((o) => byKeyT.get(entityKey(o)));
      const oneWord = orgs.filter((o) => !/\s/.test(o.trim())).map((o) => byKeyT.get(entityKey(o))).filter((t) => t && t.domain && doms.includes(t.domain));
      const teams = [...new Set([...byName, ...oneWord, ...doms.map((d) => byDomainT.get(d))].filter(Boolean))] as typeof net.teams;
      const firmOut = [];
      for (const t of teams.slice(0, 3)) {
        const known = (prior.get(lp.key)?.firmTeams ?? []).find((x) => x.name === t.name);
        if (known) { firmOut.push(known); continue; }
        const d = await get<TeamDetail>(`/teams/${t.uid}`);
        await sleep(150);
        added++;
        firmOut.push({ name: t.name, isFund: t.isFund, focus: t.focus, via: doms.includes(t.domain ?? '') ? 'domain' : 'organization', sources: d?.membershipSources?.map((m) => m.title) ?? [], technologies: d?.technologies?.map((x) => x.title) ?? [] });
      }
      if (firmOut.length) firms++;
      const members = prior.get(lp.key)?.members ?? [];
      if (members.length || firmOut.length) lines.push(JSON.stringify({ key: lp.key, name: lp.name, members, firmTeams: firmOut, at: new Date().toISOString() }));
    }
    await writeFile(join(dir, 'us', 'pl-directory.jsonl'), lines.join('\n') + '\n', 'utf8');
    console.log(`PL network, firms matched again: ${firms} LPs whose firm is a network team (${added} newly matched, from what the research found)`);
    return;
  }

  // The network's teams: one read of the list, and the two neuro focus areas.
  const list = await get<{ teams: TeamRow[] }>('/teams?limit=2000');
  const neuro = new Set((await get<{ teams: TeamRow[] }>('/teams?focusAreas=Neurotech&limit=500'))?.teams.map((t) => t.uid) ?? []);
  const wbe = new Set((await get<{ teams: TeamRow[] }>(`/teams?focusAreas=${encodeURIComponent('Whole Brain Emulation')}&limit=500`))?.teams.map((t) => t.uid) ?? []);
  const teams = (list?.teams ?? []).map((t) => ({
    uid: t.uid, name: t.name, domain: domainOf(t.website), isFund: Boolean(t.isFund), founded: t.dateFounded ?? null,
    about: (t.shortDescription ?? '').slice(0, 200) || null,
    focus: [...(neuro.has(t.uid) ? ['Neurotech'] : []), ...(wbe.has(t.uid) ? ['Whole Brain Emulation'] : [])],
  }));
  await writeFile(join(dir, 'us', 'pl-network.json'), JSON.stringify({
    source: 'Protocol Labs directory, os.pl.xyz (public API)', fetchedAt: new Date().toISOString(), teams,
  }, null, 1) + '\n', 'utf8');
  const byKey = new Map(teams.map((t) => [entityKey(t.name), t]));
  const byDomain = new Map(teams.filter((t) => t.domain).map((t) => [t.domain!, t]));

  // The LPs: a lookup by name for each person; the entry's detail when there is one.
  const out: string[] = [];
  let people = 0, found = 0, matched = 0, firmTeams = 0, investors = 0;
  const details = new Map<string, TeamDetail | null>();
  const teamDetail = async (uid: string) => {
    if (!details.has(uid)) { details.set(uid, await get<TeamDetail>(`/teams/${uid}`)); await sleep(150); }
    return details.get(uid)!;
  };
  for (const lp of set) {
    const orgs = [lp.org, lp.enriched['Current Organization'], ...(lp.enriched['Organizations'] ?? '').split(/;\s*/)].filter((o): o is string => Boolean(o && o.trim()));
    const orgKeys = new Set(orgs.map(entityKey).filter((k) => k.length >= 4));
    // Their firm, as a network team: by the organization on file or the work domain.
    const firm = [...new Set([...orgs.filter((o) => /\s/.test(o.trim())).map((o) => byKey.get(entityKey(o))), ...lp.domains.map((d) => byDomain.get(d))].filter(Boolean))] as typeof teams;
    const firmOut = [];
    for (const t of firm.slice(0, 3)) {
      const d = await teamDetail(t.uid);
      firmOut.push({ name: t.name, isFund: t.isFund, focus: t.focus, via: lp.domains.includes(t.domain ?? '') ? 'domain' : 'organization',
        sources: d?.membershipSources?.map((m) => m.title) ?? [], technologies: d?.technologies?.map((x) => x.title) ?? [] });
    }
    if (firmOut.length) firmTeams++;

    let members: unknown[] = [];
    if (lp.type === 'person' && lp.name.trim().split(/\s+/).length >= 2) {
      people++;
      const hits = (await get<{ members: Array<{ uid: string; name: string }> }>(`/members?name__icontains=${encodeURIComponent(lp.name.trim())}&limit=5`))?.members ?? [];
      await sleep(150);
      const exact = hits.filter((h) => h.name.trim().toLowerCase() === lp.name.trim().toLowerCase()).slice(0, 3);
      for (const h of exact) {
        const m = await get<MemberDetail>(`/members/${h.uid}`);
        await sleep(150);
        if (!m) continue;
        const roles = (m.teamMemberRoles ?? []).map((r) => ({ team: r.team?.name ?? null, role: r.role ?? null, main: Boolean(r.mainTeam), investmentTeam: Boolean(r.investmentTeam), since: r.startDate?.slice(0, 10) ?? null, until: r.endDate?.slice(0, 10) ?? null }));
        const exps = (m.experiences ?? []).map((e) => ({ company: e.company ?? e.companyName ?? null, title: e.title ?? null })).filter((e) => e.company);
        const places = [...roles.map((r) => r.team), ...exps.map((e) => e.company)].filter((x): x is string => Boolean(x)).map(entityKey);
        const teamDomains = (await Promise.all(roles.filter((r) => r.team).slice(0, 3).map(async (r) => {
          const t = teams.find((x) => x.name === r.team);
          return t?.domain ?? null;
        }))).filter(Boolean) as string[];
        const byOrg = places.some((p) => orgKeys.has(p));
        const byDom = teamDomains.some((d) => lp.domains.includes(d));
        const ip = m.investorProfile;
        members.push({
          match: byOrg || byDom ? 'confirmed' : 'name only', why: byDom ? 'a team at their work domain' : byOrg ? 'a team or company on our record of them' : 'the name alone',
          roles, experiences: exps.slice(0, 8), investor: Boolean(m.isInvestor), since: m.plnStartDate?.slice(0, 10) ?? null,
          investorProfile: ip ? { focus: ip.investmentFocus ?? [], stages: ip.investInStartupStages ?? [], fundTypes: ip.investInFundTypes ?? [], typicalCheck: ip.typicalCheckSize ?? null, viaFund: ip.isInvestViaFund ?? null, type: ip.type ?? null } : null,
          events: (m.eventGuests ?? []).map((g) => ({ name: g.event?.name ?? null, on: g.event?.startDate?.slice(0, 10) ?? null, speaker: Boolean(g.isSpeaker), host: Boolean(g.isHost) })).filter((e) => e.name).slice(0, 20),
        });
        if (byOrg || byDom) matched++;
        if (m.isInvestor) investors++;
      }
      if (exact.length) found++;
    }
    if (members.length || firmOut.length) out.push(JSON.stringify({ key: lp.key, name: lp.name, members, firmTeams: firmOut, at: new Date().toISOString() }));
  }
  await writeFile(join(dir, 'us', 'pl-directory.jsonl'), out.join('\n') + '\n', 'utf8');
  console.log(`PL network: ${teams.length} teams (${teams.filter((t) => t.isFund).length} funds, ${neuro.size} neurotech, ${wbe.size} whole-brain emulation) · ` +
    `${people} people looked up by name: ${found} with a directory entry under that name, ${matched} matching our record of them, ${investors} marked investors · ${firmTeams} LPs whose firm is a network team`);
}
main();

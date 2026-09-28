/** Invented regression cases for the W3 1.1 route rules. */
import { connectionPaths, type TeamMember, type PlDirectoryEntry } from '../lib/enrich/connect';
import type { Candidate } from '../lib/enrich/candidates';
import type { Finding, Connection } from '../lib/enrich/schema';
import { edgeGrade, edgeWarmth } from '../modules/network';

export function w3RoutesProperties(check: (name: string, ok: boolean, detail: string) => void) {
  const at = new Date('2026-09-28T00:00:00Z');
  const lp: Candidate = { key: 'invented-lp', name: 'Mira Willow', type: 'person', org: null, role: null,
    location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
    contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null,
      lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0,
      meetingDates: [], recent: [], outreachShared: 0 } };
  const team: TeamMember[] = [{ name: 'Rowan Alder', handle: 'rowan', roles: [{ org: 'Protocol Labs' }], prior: [], education: [] }];
  const net = { orgs: [], backers: [], backer_people: [] };
  const run = (c: Candidate, connections: Connection[] = [], directory: PlDirectoryEntry[] = []) => {
    const finding: Finding = { key: c.key, name: c.name, identity: { match: 'confirmed', basis: 'Invented identity' },
      researched: { at: '2026-09-28', by: 'fixture', workflow: 'W1', version: '1' }, facts: [], connections };
    return connectionPaths([c], new Map([[c.key, finding]]), net, team, directory, at).paths;
  };
  for (const channel of ['meeting', 'call', 'email', 'message']) for (const direction of ['ours', 'theirs']) {
    const candidate = structuredClone(lp);
    candidate.contact.records = [{ on: '2020-01-01', channel, direction, with: [team[0]!.name], about: [], group: false, source: 'invented-local-record' }];
    const path = run(candidate).find(p => p.other.handle === 'rowan');
    check(`W3 direct ${channel}/${direction} survives historical date and empty recent preview`, path?.tier === 'B'
      && path.tie?.directInteraction === true && path.warmth?.recency === 'historical', 'Age lowers warmth, not documented interaction evidence.');
  }
  const conn: Connection = { to: team[0]!.name, toType: 'person', scope: 'person', kind: 'podcast_guest', tier: 'B',
    basis: 'Recorded one-to-one podcast conversation with Rowan Alder.', source: 'https://example.org/invented-podcast' };
  check('W3 documented one-to-one has a B floor even when research proposed C',
    run(lp, [{ ...conn, kind: 'other', tier: 'C' }]).some(p => p.other.handle === 'rowan' && p.tier === 'B'),
    'The documented interaction determines evidence strength.');
  const podcast = run(lp, [conn]).find(p => p.other.handle === 'rowan');
  const evidence = { kind: 'other' as const, evidence: [{ note: podcast!.basis, source: podcast!.source!, tie: podcast!.tie }] };
  check('W3 sourced podcast stays B in file output and runtime graph grading', podcast?.tier === 'B'
    && edgeGrade(evidence, at) === 'B' && edgeWarmth(evidence, at).recency === 'unknown', 'No date or consent is fabricated.');
  for (const change of [{ source: null }, { scope: 'firm' as const }, { basis: 'No one-to-one conversation; shared panel only.' }, { kind: 'event_coattendee' as const, basis: 'Attended the same conference.' }]) {
    check(`W3 proximity never becomes direct contact: ${JSON.stringify(change)}`,
      run(lp, [{ ...conn, ...change }]).every(p => !p.tie?.directInteraction), 'A source, personal scope and explicit direct conversation are required.');
  }
  const group = structuredClone(lp);
  group.contact.records = [{ on: '2026-09-20', channel: 'meeting', direction: null, with: [team[0]!.name], about: [], group: true, source: 'invented-group' }];
  check('W3 group meeting retains a labelled C path', run(group).some(p => p.other.handle === 'rowan' && p.tier === 'C' && /group attendance/.test(p.basis)), 'Group presence is not a one-to-one.');
  const directory: PlDirectoryEntry[] = [{ key: lp.key, name: lp.name, members: [{ match: 'confirmed', why: 'fixture', investor: false, since: null, roles: [], investorProfile: null, events: [] }], firmTeams: [] }];
  const membership = run(lp, [conn], directory);
  check('W3 C membership names the independently evidenced holder', membership.some(p => p.other.name === 'PL'
    && p.tie?.basis === 'pl_network' && p.tier === 'C' && p.basis.includes('Rowan Alder')), 'Membership keeps C while its why names the holder; the direct path stays B.');
  check('W3 unknown membership holder is stated honestly', run(lp, [], directory).some(p => p.other.name === 'PL'
    && p.tier === 'C' && /No particular team relationship holder/.test(p.basis)), 'No holder inferred from roster membership.');
}

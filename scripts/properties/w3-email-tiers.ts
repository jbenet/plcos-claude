import { connectionPaths, type Path, type TeamMember } from '../../lib/enrich/connect';
import type { Candidate } from '../../lib/enrich/candidates';
import { emailEvidenceIndex } from '../../lib/enrich/email-evidence';

const team: TeamMember[] = [{ name: 'Rowan Alder', handle: 'rowan', roles: [], prior: [], education: [] }];
const net = { orgs: [], backers: [], backer_people: [] };
const at = new Date('2026-09-28T00:00:00Z');
type Record = NonNullable<Candidate['contact']['records']>[number];
const person = (id: number, type: string) => ({ person: { id, type } });
const mail = (direction: string, extra = {}): Record => {
  const inbound = ['theirs', 'received'].includes(direction);
  const raw = { id: 1, type: 'email', massMailing: false, from: person(inbound ? 10 : 20, inbound ? 'external' : 'internal'),
    to: [person(inbound ? 20 : 10, inbound ? 'internal' : 'external')], ...extra };
  return { on: '2020-01-01', channel: 'email', direction, about: [], with: ['Rowan Alder'], group: false,
    source: 'affinity', email: emailEvidenceIndex([raw])('interaction:email:1:person:10') };
};
const meeting: Record = { on: '2020-01-01', channel: 'meeting', direction: 'both', about: [], with: ['Rowan Alder'], group: false, source: 'fixture' };
export const emailFixture: Candidate[] = [
  [mail('ours'), mail('theirs')], [mail('sent')], [mail('received')], [meeting],
  [mail('ours', { massMailing: true })],
  [mail('ours', { toPreview: { data: [], totalCount: 50 } })],
  [mail('ours', { loggingType: 'bulk' })], [mail('ours', { subject: 'Monthly newsletter' })],
  [mail('ours', { subject: 'Investor update', toPreview: { data: [], totalCount: 25 } })],
].map((records, i) => ({ key: `invented-email-${i}`, name: `Invented Person ${i}`, type: 'person', org: null, role: null,
  location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
  contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null,
    lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0,
    meetingDates: [], recent: [], outreachShared: 0, records } }));
export const runEmailFixture = (join = connectionPaths) => join(emailFixture, new Map(), net, team, [], at).paths;
const counts = (paths: Path[]) => Object.fromEntries(['A', 'B', 'C', 'D'].map(t => [t, paths.filter(p => p.tier === t).length]));
export function w3EmailTierProperties(check: (name: string, ok: boolean, detail: string) => void) {
  const paths = runEmailFixture();
  const expected = ['B', 'C', 'B', 'B', 'D', 'D', 'D', 'D', 'D'];
  const why = ['two-way', 'we wrote, no reply', 'waiting on us', 'both present', 'bulk', 'bulk', 'bulk', 'bulk', 'bulk'];
  for (let i = 0; i < expected.length; i++) {
    const p = paths.find(p => p.lp === emailFixture[i]!.key);
    check(`W3 email fixture ${i}: ${expected[i]} ${why[i]}`, p?.tier === expected[i] && p.basis.includes(why[i]!), p?.basis ?? 'Missing path');
  }
  check('W3 invented tier counts', JSON.stringify(counts(paths)) === JSON.stringify({ A: 0, B: 3, C: 1, D: 5 }), JSON.stringify(counts(paths)));
  const run = (records: Record[]) => connectionPaths([{ ...emailFixture[0]!, contact: { ...emailFixture[0]!.contact, records } }], new Map(), net, team, [], at).paths[0];
  check('Bulk outbound does not answer personal inbound', /waiting on us/.test(run([mail('theirs'), mail('ours', { massMailing: true })])!.basis), 'Bulk cannot supply the outbound side.');
  check('Bulk inbound does not upgrade outbound', run([mail('ours'), mail('theirs', { massMailing: true })])?.tier === 'C', 'Bulk cannot supply a reply.');
  check('Missing email metadata fails closed', run([{ ...mail('ours'), email: undefined }])?.tier === 'C', 'Legacy exports require fresh metadata.');
  check('Unknown email direction fails closed', run([mail('both')])?.tier === 'C', 'Both is not an email reply.');
  check('Personal investor update is still outbound C', run([mail('ours', { subject: 'Investor update' })])?.tier === 'C', 'An update title alone does not establish a list.');
  check('CC recipient is not one-to-one', run([mail('theirs', { cc: [person(30, 'external')] })])?.tier === 'D', 'Recipients include CC.');
  check('Unrelated external sender cannot establish LP inbound', run([mail('theirs', { from: person(99, 'external') })])?.tier === 'C', 'Sender must be the LP.');
  check('Bulk does not refresh meeting warmth', run([meeting, { ...mail('ours', { massMailing: true }), on: '2026-09-27' }])?.tie?.lastInteraction === '2020-01-01', 'Only independent direct evidence sets the date.');
  const otherTeam = { ...team[0]!, name: 'Cedar Brook', handle: 'cedar' };
  const candidate = { ...emailFixture[0]!, contact: { ...emailFixture[0]!.contact,
    records: [mail('ours'), { ...mail('theirs'), with: ['Cedar Brook'] }] } };
  const separate = connectionPaths([candidate], new Map(), net, [...team, otherTeam], [], at).paths;
  check('Email directions stay with their named team participant', separate.some(p => p.other.handle === 'rowan' && p.tier === 'C')
    && separate.some(p => p.other.handle === 'cedar' && p.tier === 'B' && /waiting on us/.test(p.basis)), 'No cross-holder reply inference.');
  const firm = { ...emailFixture[1]!, key: 'invented-firm', type: 'org', name: 'Invented Firm',
    contact: { ...emailFixture[1]!.contact, records: [] }, contacts: [{ ...emailFixture[1]!, contactRole: 'principal' }] };
  const projected = connectionPaths([firm], new Map(), net, team, [], at).paths.find(p => p.lp === firm.key);
  check('Organisation projection preserves outbound C and why', projected?.tier === 'C'
    && projected.basis.includes('we wrote, no reply') && !!projected.viaContact, 'Membership cannot turn outbound mail warm.');
  check('Future replies cannot upgrade outbound', run([mail('ours'), { ...mail('theirs'), on: '2027-01-01' }])?.tier === 'C', 'Frozen evaluation date bounds evidence.');

}

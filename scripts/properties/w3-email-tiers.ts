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
  const why = ['waiting on us', 'we wrote, no reply', 'waiting on us', 'both present', 'bulk', 'bulk', 'bulk', 'bulk', 'bulk'];
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

  const roster = [{ name: 'Rowan Alder', email: 'rowan@example.test' }, { name: 'Cedar Brook', email: 'cedar@example.test' }];
  const users = [{ id: 20, primaryEmailAddress: 'rowan@example.test' }, { id: 21, primaryEmailAddress: 'cedar@example.test' }];
  const rawRecord = (direction: string, member = 20, extra = {}): Record => {
    const raw = { id: 8, type: 'email', direction,
      from: direction === 'sent' ? person(member, 'internal') : person(10, 'external'),
      toParticipantsPreview: { data: [direction === 'sent' ? person(10, 'external') : person(member, 'internal')], totalCount: 1 },
      ccParticipantsPreview: { data: [], totalCount: 0 }, ...extra };
    return { ...mail('unknown'), on: '2026-09-01', direction: null, with: ['Rowan Alder'],
      email: emailEvidenceIndex([raw], roster, users)('interaction:email:8:person:10') };
  };
  const fixed = [
    [rawRecord('received'), rawRecord('sent')],
    [rawRecord('received', 21), rawRecord('sent')],
    [rawRecord('sent')],
    [rawRecord('received', 20, { massMailing: true })],
    [rawRecord('received', 99)],
  ];
  const runCases = (before: boolean) => fixed.flatMap((records, i) => connectionPaths([{ ...emailFixture[0]!, key: `direction-${i}`,
    contact: { ...emailFixture[0]!.contact, records: before ? records.map(r => ({ ...r, email: { ...r.email!, team: undefined, direction: undefined, oneToOne: false } })) : records }
  }], new Map(), net, [...team, otherTeam], [], at).paths);
  const before = counts(runCases(true)), after = counts(runCases(false));
  check('Direction fixture before/after counts', JSON.stringify(before) === JSON.stringify({ A: 0, B: 0, C: 4, D: 1 })
    && JSON.stringify(after) === JSON.stringify({ A: 0, B: 3, C: 2, D: 1 }), JSON.stringify({ before, after }));
  check('Cross-team two-way names both holders', runCases(false).filter(p => p.lp === 'direction-1').every(p => p.tier === 'B' && /two-way/.test(p.basis))
    && runCases(false).some(p => p.lp === 'direction-1' && p.other.name === 'Cedar Brook'), 'Received by Cedar, sent by Rowan.');
  check('Preview CC totals keep mass D', run([rawRecord('received', 20, { ccParticipantsPreview: { data: [], totalCount: 10 } })])?.tier === 'D', 'Truncated previews still count.');
  check('Roster email resolves sender without internal marker', run([rawRecord('sent', 20, { from: { emailAddress: ' ROWAN@EXAMPLE.TEST ' } })])?.basis.includes('we wrote, no reply') === true, 'Exact normalized address.');
  check('Contradictory payload direction fails closed', run([rawRecord('sent', 20, { direction: 'received' })])?.tier === 'C', 'No inferred reply from contradictory metadata.');
  check('Old inbound cannot pair with new outbound across team', connectionPaths([{ ...emailFixture[0]!, contact: { ...emailFixture[0]!.contact,
    records: [{ ...rawRecord('received', 21), on: '2026-03-01' }, rawRecord('sent')] } }], new Map(), net, [...team, otherTeam], [], at).paths.some(p => p.other.handle === 'rowan' && p.tier === 'C'), '180-day window applies to both sides.');

  const ambiguous = emailEvidenceIndex([{ id: 9, type: 'email', from: person(10, 'external'),
    toParticipantsPreview: { data: [{ emailAddress: 'shared@example.test' }], totalCount: 1 } }],
    [{ name: 'Rowan Alder', email: 'shared@example.test' }, { name: 'Cedar Brook', email: 'shared@example.test' }])('interaction:email:9:person:10');
  check('Ambiguous roster address cannot establish personal inbound', ambiguous?.oneToOne === false && !ambiguous.direction, 'Shared addresses fail closed.');
  check('Email metadata exports no addresses', !JSON.stringify(rawRecord('received').email).includes('@'), 'Names and direction only.');
  const cutoffDay = new Date(at.getTime() - 180 * 86400000).toISOString().slice(0, 10);
  check('180-day cutoff is inclusive', /two-way/.test(run([{ ...rawRecord('received'), on: cutoffDay }, rawRecord('sent')])!.basis), 'Both messages inside the frozen window.');

}

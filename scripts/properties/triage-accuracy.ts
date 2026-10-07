import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check } from './harness';
import { emailEntriesByPerson, replyOwedSince } from '../../lib/enrich/reply-owed';
import { checkedStrategyFiles, nameMention } from '../../lib/enrich/strategy-check';

export async function triageAccuracyProperties(check: Check) {
  const lp = { person: { id: 17, type: 'external' } }, us = { person: { id: 2, type: 'internal' } };
  const email = { type: 'email', sentAt: '2026-09-20T12:00:00Z', from: lp, to: [us], cc: [], massMailing: false };
  const owed = (...messages: unknown[]) => replyOwedSince([{ entity: { fields: messages.map(data => ({ value: { type: 'interaction', data } })) } }], 'person:17', [], new Date('2026-09-28'));
  const indexed = emailEntriesByPerson([email, { ...email, from: us, to: [lp] }, { ...email, type: 'meeting' }]);
  check('TRIAGE email indexing retains inbound and outbound only for their participants',
    indexed.size === 1 && indexed.get('person:17')?.length === 2, 'Account-wide email indexing preserves both directions without scanning unrelated records per LP.');
  check('TRIAGE reply owed requires personal email evidence and no later outbound',
    owed(email) === email.sentAt.replace('Z', '.000Z')
    && owed({ ...email, type: 'meeting' }) === null
    && owed({ ...email, massMailing: true }) === null
    && owed({ ...email, massMailing: undefined }) === null
    && owed({ ...email, to: [us, lp] }) === null
    && owed({ ...email, to: Array(4).fill(us) }) === null
    && owed({ ...email, from: { person: { id: 18, type: 'external' } } }) === null
    && owed({ ...email, to: [] }) === null
    && owed({ ...email, toPreview: { data: [us], totalCount: 50 } }) === null
    && owed({ ...email, subject: 'Automatic reply' }) === null
    && owed(email, { ...email, sentAt: '2026-09-20T13:00:00Z', from: us, to: [lp] }) === null
    && owed(email, { ...email, sentAt: '2026-09-19T13:00:00Z', from: us, to: [lp] }) !== null,
    'Meetings, mailings, extra external recipients, oversized/incomplete recipient lists, unrelated senders and auto replies fail closed; ordering uses full timestamps.');
  check('CHECK naming uses whole names, ignores common prose and single words',
    nameMention('Ask ann reed.', 'Ann Reed') === 4 && nameMention('Ask Ann Reeds.', 'Ann Reed') === -1
    && nameMention('Joann Reed', 'Ann Reed') === -1 && nameMention('A family office', 'Family Office') === -1
    && nameMention('Ask May.', 'May') === -1 && nameMention('Ask Éva Test.', 'Éva Test') === 4,
    'Case-insensitive Unicode word boundaries retain genuine mentions without substrings or common labels.');
  const dir = await mkdtemp(join(tmpdir(), 'triage-check-'));
  try {
    const strategy = (key: string, vehicle: string) => ({ key, ask: { vehicle }, fit: { [vehicle]: {} },
      scores: Object.fromEntries(['capacity', 'affinity', 'propensity', 'timeToDecision'].map(k => [k, { basis: 'Invented evidence' }])),
      angle: 'Invented angle', next: { what: 'Review evidence', who: 'Invented Owner' }, list: '2027' });
    for (const folder of ['alpha', 'beta', 'unknown']) await mkdir(join(dir, 'strategy', folder), { recursive: true });
    for (const [file, value] of Object.entries({ 'lp.json': strategy('lp', 'Invented Alpha'),
      'alpha/lp.json': strategy('lp', 'alpha'), 'beta/lp.json': strategy('lp', 'beta'),
      'alpha/bad.json': { ...strategy('bad', 'alpha'), angle: '' },
      'alpha/mismatch.json': strategy('mismatch', 'beta'), 'beta/wrong-key.json': strategy('different', 'beta') })) {
      await writeFile(join(dir, 'strategy', file), JSON.stringify(value));
    }
    const problems: Array<{ file: string; reasons: string[] }> = [];
    const rows = await checkedStrategyFiles(dir, [{ slug: 'alpha', name: 'Invented Alpha' }, { slug: 'beta', name: 'Invented Beta' }],
      (file, reasons) => problems.push({ file, reasons }));
    check('CHECK both layouts validate equally and duplicate LP × vehicle files conflict',
      rows.length === 3 && problems.filter(p => p.reasons.includes('multiple files for the same LP and vehicle')).length === 2
      && ['unknown', 'alpha/bad.json', 'alpha/mismatch.json', 'beta/wrong-key.json'].every(f => problems.some(p => p.file === f))
      && !problems.some(p => p.file === 'beta/lp.json'),
      'Legacy display name resolves to folder slug; same LP in another vehicle remains valid; empty unknown folder, mismatched vehicle and malformed nested files are refused.');
  } finally { await rm(dir, { recursive: true, force: true }); }
  // 7 Oct 2026: an LP whose finding is filed under an alias read "researched: false" in triage.
  const aliasDir = await mkdtemp(join(tmpdir(), 'triage-alias-'));
  try {
    const { triage } = await import('../../lib/enrich/triage');
    const key = '44444444-4444-4444-8444-444444444444';
    await mkdir(join(aliasDir, 'raw'));
    await writeFile(join(aliasDir, 'entity-keys.json'), JSON.stringify({ 'invented-old-key': key }));
    await writeFile(join(aliasDir, 'raw', 'invented-old-key.json'), JSON.stringify({ key: 'invented-old-key', name: 'Invented Quill',
      identity: { match: 'confirmed', basis: 'Invented fixture' }, facts: [], researched: { at: '2026-10-01T00:00:00Z', method: 'search' } }));
    const candidate = { key, name: 'Invented Quill', type: 'person', org: null, role: null, location: null, domains: [], enriched: {},
      pursuits: [{ vehicle: 'invented', status: 'selected' }], notes: [], context: [], money: null, restrictions: [],
      contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null, lastFromThem: null,
        awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, meetingDates: [], recent: [], outreachShared: 0 } };
    const rows = await triage(aliasDir, new Date('2026-10-07T00:00:00Z'), [candidate as never]);
    check('TRIAGE a finding filed under an alias counts as research for its candidate',
      rows.length === 1 && rows[0]!.researched === true, JSON.stringify(rows.map((r) => ({ key: r.key, researched: r.researched }))));
  } finally { await rm(aliasDir, { recursive: true, force: true }); }
}

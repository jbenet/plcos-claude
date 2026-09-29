import { readFile } from 'node:fs/promises';
import { connectionPaths, type TeamMember } from '../../lib/enrich/connect';
import type { Candidate } from '../../lib/enrich/candidates';
import type { Finding, Fact } from '../../lib/enrich/schema';
import type { Check } from './harness';

export async function teamEdgesProperties(check: Check) {
  const { team } = JSON.parse(await readFile('fixtures/enrich/demo.json', 'utf8')) as { team: TeamMember[] };
  const lp: Candidate = { key: 'invented-principal', name: 'Mira Yellowhammer Teasel', type: 'person', org: null, role: null,
    location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
    contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null,
      lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0,
      meetingDates: [], recent: [], outreachShared: 0 } };
  const fact = (org: string, field: Fact['field'] = 'affiliation', detail: Fact['detail'] = {}): Fact => ({
    field, value: `Documented ${field} at ${org}`, detail: { company: org, ...detail },
    source: { url: 'https://example.org/principal', kind: 'primary' }, confidence: 'high',
  });
  const run = (facts: Fact[], match: Finding['identity']['match'] = 'confirmed', roster = team, candidate = lp) => {
    const f: Finding = { key: candidate.key, name: candidate.name, identity: { match, basis: 'Invented identity' },
      researched: { at: '2026-09-28', by: 'fixture', workflow: 'W1', version: '1' }, facts };
    return connectionPaths([candidate], new Map([[candidate.key, f]]), { orgs: [], backers: [], backer_people: [] },
      roster, [], new Date('2026-09-28')).paths.filter(p => p.basis.startsWith('Radek Wennerholm:'));
  };
  const job = fact('Yellowhammer Teasel Investment Arm, LLC', 'prior_role', { since: '2011', until: '2017' });
  check('W3 team past partnership produces B with both sources and dated overlap',
    run([job]).some(p => p.tier === 'B' && p.tie?.kind === 'worked_together' && p.basis.includes('2011-12-31')
      && p.source?.includes('radek-career') && p.source.includes('/principal')), 'Legal suffix normalization matches the structured company.');
  const variations: Fact[] = [{ ...job, detail: { company: 'Yellowhammer Teasel Investment Arm', since: '2019', until: '2022' } },
    { ...job, detail: { company: 'Yellowhammer Teasel Investment Arm' } }, { ...job, scope: 'firm' as const }];
  for (const changed of variations) {
    check(`W3 shared employer without personal dated overlap stays C ${JSON.stringify(changed.detail)}/${changed.scope}`,
      run([changed]).length > 0 && run([changed]).every(p => p.tier === 'C'), 'No overlap or firm scope cannot establish working together.');
  }
  for (const [org, field, kind] of [
    ['Sedgewater Foxglove Institute', 'affiliation', 'other'], ['Fernhollow Umberfield Research Council', 'board', 'board'],
    ['Larkspur Quartzmere Engineering', 'role', 'colleague'], ['Emberly Quillmere Science', 'philanthropy', 'colleague'],
    ['Loamrise Samphire Robotics', 'investment', 'coinvestor'],
  ] as const) {
    check(`W3 team structured field joins ${org}`, run([fact(org, field)]).some(p => p.tier === 'C' && p.kind === kind),
      'Shared affiliations, boards, employers, funded co-founded organisations and investments remain labelled clues.');
  }
  check('W3 bio exact organisation mentions stay C and say from bio',
    run([fact('Wrenfield Dunlin Research Trust')]).some(p => p.tier === 'C' && p.basis.includes('from bio')), 'A prose mention never becomes a working relationship.');
  check('W3 bio partial names and negations do not join', run([fact('Wrenfield Dunlin Research')]).length === 0
    && run([fact('Wrenfield Dunlin Research Trust')], 'confirmed', [{ ...team[0]!, bio: 'Never worked at Wrenfield Dunlin Research Trust.' }]).length === 0,
    'Neither fuzzy names nor denied affiliations establish an edge.');
  for (const match of ['ambiguous', 'not_found'] as const) check(`W3 team ignores ${match} findings`, run([job], match).length === 0, 'Existing W3 identity gate applies.');
  check('W3 team ignores low-confidence and unstructured-only claims', run([{ ...job, confidence: 'low' }]).length === 0
    && run([{ ...job, detail: {} }]).length === 0, 'A named company must be in structured evidence.');
  check('W3 team honours target and connector restrictions',
    run([job], 'confirmed', team, { ...lp, restrictions: [{ scope: 'blanket', connector: null, channel: null }] }).length === 0
    && run([job], 'confirmed', team, { ...lp, restrictions: [{ scope: 'connector', connector: 'Radek Wennerholm', channel: null }] }).length === 0,
    'The new origin cannot bypass restrictions.');
  const org = { ...lp, key: 'invented-firm', name: 'Yellowhammer Teasel Investment Arm', type: 'org' as const };
  check('W3 team resolves a named firm without inventing a principal tie', run([], 'confirmed', team, org).some(p => p.lp === org.key && p.tier === 'C'), 'Direct firm affiliation is C.');
  const unit = { ...org, name: 'Yellowhammer Teasel Family Office', contacts: [{ ...lp, contactRole: 'principal' }] };
  const f: Finding = { key: lp.key, name: lp.name, identity: { match: 'confirmed', basis: 'Invented' },
    researched: { at: '2026-09-28', by: 'fixture', workflow: 'W1', version: '1' }, facts: [job] };
  const projected = connectionPaths([unit], new Map([[lp.key, f]]), { orgs: [], backers: [], backer_people: [] }, team).paths;
  check('W3 team principal path projects onto its LP unit unchanged', projected.some(p => p.lp === unit.key && p.viaContact?.key === lp.key && p.tier === 'B'), 'Person evidence keeps its endpoint and tier.');
  check('W3 team join is deterministic', JSON.stringify(run([job])) === JSON.stringify(run([job])), 'Repeated frozen inputs produce identical paths.');
}

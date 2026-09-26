/** TOTYPE regressions use invented identities; no real files or database. */
import { backfillTargetTypes, targetName } from '../lib/enrich/connection-target';
import { connectionPaths, type Network, type TeamMember } from '../lib/enrich/connect';
import { connectionIdentityProblems } from '../lib/enrich/connection-check';
import { check as findingProblems, type Finding, type Connection } from '../lib/enrich/schema';
import type { Candidate } from '../lib/enrich/candidates';

export function connectionTargetProperties(check: (name: string, ok: boolean, detail: string) => void) {
  const target: Candidate = { key: '11111111-1111-4111-8111-111111111111', name: 'Iris Meadow', type: 'person', org: 'Silver Orchard', role: null,
    location: null, domains: ['fixture.example.org'], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
    contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null, lastFromThem: null,
      awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, meetingDates: [], recent: [], outreachShared: 0 } };
  const colleague = { ...target, key: '22222222-2222-4222-8222-222222222222', name: 'Elm Grove' };
  const net: Network = { orgs: [], backers: [], backer_people: [] };
  const team: TeamMember[] = [{ handle: 'rowan', name: 'Rowan Vale', roles: [], prior: [], education: [] }];
  const conn = (to: string, toType?: Connection['toType'], scope: Connection['scope'] = 'person'): Connection => ({ to, toType, scope,
    kind: 'board', tier: scope === 'firm' ? 'C' : 'B', basis: 'Invented documented board seat', source: 'https://example.org/board' });
  const finding = (connections: Connection[]): Finding => ({ key: target.key, name: target.name,
    researched: { at: '2026-09-26', by: 'fixture', workflow: 'W1', version: '1' }, identity: { match: 'confirmed', basis: 'Invented identity' }, facts: [], connections });
  const paths = (connections: Connection[], others: Candidate[] = []) => connectionPaths([target, colleague, ...others],
    new Map([[target.key, finding(connections)]]), net, team).paths.filter((p) => p.source === 'https://example.org/board');
  const personal = paths([conn('Quiet Acorn', 'org')]);
  check('TOTYPE personal org ties keep their tier and do not propagate to colleagues', personal.length === 1
    && personal[0]!.other.person?.entityType === 'org' && personal[0]!.tier === 'B', 'Target identity never changes tie ownership.');
  const firm = paths([conn('Quiet Acorn', 'org', 'firm')]);
  check('TOTYPE firm propagation carries explicit target type', firm.length === 2 && firm.every((p) => p.other.person?.entityType === 'org' && p.tier === 'C'), 'Both direct and propagated paths retain org typing.');
  const collision = paths([conn('Rowan Vale', 'org'), conn('Elm Grove', 'org')]);
  check('TOTYPE explicit org bypasses person and team name matches', collision.length === 2 && collision.every((p) => p.other.person?.entityType === 'org' && !p.other.handle), 'Roster matches must agree with explicit target type.');
  const person = paths([conn('Morgan Capital', 'person')]);
  check('TOTYPE explicit person beats organization words', person[0]?.other.person?.entityType === 'person', 'A surname does not override an explicit type.');
  const fallback = paths([conn('Quiet Acorn'), conn('Acorn Capital')]);
  check('TOTYPE legacy fallback remains unchanged', fallback.find((p) => p.other.name === 'Quiet Acorn')?.other.person?.entityType === 'person' && fallback.find((p) => p.other.name === 'Acorn Capital')?.other.person?.entityType === 'org', 'Untyped paths retain existing heuristic behavior.');
  const located = (f: Finding) => [{ file: 'raw/invented.json', index: 0, value: f }];
  check('TOTYPE checker ignores ownership scope for target typing', ['person', 'firm'].every((scope) =>
    !connectionIdentityProblems(located(finding([conn('Quiet Acorn', 'org', scope as Connection['scope'])])), [], ['Quiet Acorn']).length)
    && !connectionIdentityProblems(located(finding([conn('Quiet Acorn')])), [], ['Quiet Acorn']).length, 'Only explicit target types can conflict; scope is never a type assertion.');
  check('TOTYPE checker reports explicit target conflicts', connectionIdentityProblems(located(finding([conn('Quiet Acorn', 'person', 'firm')])), [], ['Quiet Acorn'])
    .some((p) => p.problems.some((s) => s.includes('toType person'))), 'Firm ownership does not hide a wrong person type.');
  const invalid = finding([conn('Quiet Acorn')]);
  (invalid.connections![0] as unknown as { toType: string }).toType = 'company';
  check('TOTYPE schema rejects unsupported target types', findingProblems(invalid).some((p) => p.includes('connection 0: toType')), 'Legacy omission remains valid, unknown values do not.');
  const source = finding([conn('Quiet Acorn'), conn('Morgan Capital'), conn('Unknown Entity'), conn('Mara Reed (Acorn Capital)'), conn('Dual Name'), conn('Acorn Foundation'), conn('Preserved Name', 'org')]);
  const orgs = new Set(['Quiet Acorn', 'Dual Name'].map(targetName));
  const people = new Set(['Morgan Capital', 'Dual Name'].map(targetName));
  const result = backfillTargetTypes(source, orgs, people);
  const stripped = structuredClone(result.value);
  for (const { index } of result.changed) delete stripped.connections![index]!.toType;
  check('TOTYPE backfill changes only target types and lists unresolved names', result.changed.length === 3 && result.unresolved.length === 3
    && result.value.connections![1]!.toType === 'person' && JSON.stringify(stripped) === JSON.stringify(source), 'Known person wins over word rules; conflicting evidence stays unset.');
  check('TOTYPE backfill is idempotent', backfillTargetTypes(result.value, orgs, people).changed.length === 0, 'Explicit values survive every rerun.');
}

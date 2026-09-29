/** Invented fixtures for 0037, 0040, 0041 and 0043. Also called by npm run props. */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { feedbackInput, saveConnectionFeedback, processConnectionFeedback, firstPersonTie, applyConnectionFeedback, type ConnectionFeedback } from '../lib/enrich/feedback';
import { CAPACITY_BANDS, capacityBandLabel, readableCapacityBand } from '../lib/capacity-bands';
import { check as checkFinding, type Finding } from '../lib/enrich/schema';
import { capacityValue } from '../lib/strategy-score';
import { bandBySize, bandByRule } from '../lib/enrich/capacity';
import { researchEndpoint, researchTie } from '../modules/network/research-path';
import { connectionPaths, type TeamMember, type Network } from '../lib/enrich/connect';
import type { Candidate } from '../lib/enrich/candidates';

export async function issues4Properties(check: (name: string, ok: boolean, detail: string) => void, db?: import('../lib/db').Queryable) {
  const lp = '00000000-0000-4000-a000-000000000001';
  const note: ConnectionFeedback = { id: '00000000-0000-4000-a000-000000000002', lp, page: '/neurotech/routes', text: 'I know them directly',
    author: { id: '00000000-0000-4000-a000-000000000003', handle: 'alder', name: 'Morgan Alder' }, at: '2026-09-26T12:00:00Z' };
  const finding: Finding = { key: lp, name: 'Avery Birch', researched: { at: '2026-09-25', by: 'fixture', workflow: 'W1', version: '1' },
    identity: { match: 'confirmed', basis: 'Invented identity.' }, facts: [] };
  const applied = applyConnectionFeedback(finding, note);
  const connection = applied.connections![0]!;
  check('0040 first-person feedback becomes a dated reviewed B tie without fabricating contact recency',
    connection.tier === 'B' && connection.reviewedBy === note.author.handle && connection.reviewedAt === note.at
    && connection.toHandle === note.author.handle && connection.tie?.lastInteraction === undefined
    && applyConnectionFeedback(applied, note) === applied && firstPersonTie('he worked at PL with us') === 'worked_together',
    'The author reviews only their own explicit statement; processing is idempotent.');
  const unsafe = ['I do not know him', 'I know him, but only by reputation', 'I think I know them', 'She said "I know him"', 'X and Y co-founded Z', 'I know them?'];
  check('0040 ambiguous, negative and third-party statements remain unreviewed feedback', unsafe.every((s) => firstPersonTie(s) === null), 'No arbitrary text is promoted into a trusted tie.');
  const input = feedbackInput({ ...note, author: { name: 'Impersonation' } });
  let invalid = 0;
  for (const value of [{ ...note, lp: '../../escape' }, { ...note, text: ' ' }, { ...note, text: 'x'.repeat(5001) }, { ...note, page: 'https://example.org' }]) {
    try { feedbackInput(value); } catch { invalid++; }
  }
  check('0040 intake bounds input and ignores client-supplied authors', !('author' in input) && invalid === 4 && feedbackInput({ ...note, page: `/neurotech/pipeline/${lp}` }).lp === lp, 'The server supplies the author and timestamp.');
  const root = await mkdtemp(join(tmpdir(), 'capital-feedback-fixture-'));
  try {
    const demo = join(root, 'demo', 'enrich'), realFixture = join(root, 'real-fixture', 'enrich');
    await mkdir(join(demo, 'raw'), { recursive: true });
    await writeFile(join(demo, 'raw', `${lp}.json`), JSON.stringify(finding));
    const saved = await Promise.all([saveConnectionFeedback(demo, note), saveConnectionFeedback(demo, note)]);
    await saveConnectionFeedback(realFixture, { ...note, text: 'Separate invented profile' });
    const thirdParty = { ...note, id: '00000000-0000-4000-a000-000000000004', text: 'This route is redundant' };
    await saveConnectionFeedback(demo, thirdParty);
    const first = await processConnectionFeedback(demo), second = await processConnectionFeedback(demo);
    const evidence = JSON.parse(await readFile(join(demo, 'raw', `${lp}.json`), 'utf8')) as Finding;
    const queue = (await readFile(join(demo, 'feedback', 'find-similar.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    check('0040 receipt retries, processing retries and profile separation preserve exactly one evidence/queue item per note',
      saved.every((x) => x.id === note.id && x.at === note.at) && first.processed === 2 && first.reviewed === 1 && first.queued === 2
      && second.processed === 0 && second.queued === 0 && evidence.connectionFeedback?.length === 2 && evidence.connections?.length === 1
      && queue.length === 2 && queue.every((x) => x.status === 'queued' && x.kind === 'find_similar')
      && (await readFile(join(realFixture, 'feedback', 'connection-feedback.jsonl'), 'utf8')).includes('Separate invented profile'),
      'All files here are invented scratch data. No workflow launches and no external system changes.');
  } finally { await rm(root, { recursive: true, force: true }); }

  const people = [{ id: 'invented-connector', name: 'Ellis Stone' }];
  const endpoint = { type: 'ours' as const, name: 'Ellis Stone (angel in a sourced roster)' };
  check('0037 old organization-style endpoints resolve unique documented people, never a firm or ambiguous namesake',
    researchEndpoint(endpoint, people) === 'invented-connector'
      && researchEndpoint({ ...endpoint, name: 'Harbor Capital (Ellis Stone)' }, people) === null
      && researchEndpoint(endpoint, [...people, { ...people[0]!, id: 'namesake' }]) === null
      && researchEndpoint({ ...endpoint, key: 'missing-explicit-key' }, people) === null,
    'An explanatory trailing suffix can be removed; no fuzzy matching or tier upgrade.');
  const team: TeamMember[] = [{ handle: 'alder', name: 'Morgan Alder', roles: [{ org: 'Harbor Labs', role: 'Founder', since: '2010', source: 'https://example.org/team' }], prior: [], education: [] }];
  const network: Network = { orgs: [{ name: 'Harbor Labs', aliases: [] }], backers: [], backer_people: [{ name: 'Ellis Stone', what: 'Angel investor in Harbor Labs', source: 'https://example.org/backers' }] };
  const candidate: Candidate = { key: lp, name: finding.name, type: 'person', org: null, role: null, location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
    contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null, lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, meetingDates: [], recent: [], outreachShared: 0 } };
  const ties = connectionPaths([candidate], new Map([[lp, { ...finding, connections: [{ to: endpoint.name, kind: 'colleague', tier: 'B', source: 'https://example.org/cofounders', basis: 'They co-founded an invented company.' }] }]]), network, team).paths;
  // 0070: explicit co-founding earns grade A; generic acquaintance no longer earns B.
  const toLP = ties.find((p) => p.lp === lp && p.tier === 'A');
  const toConnector = ties.find((p) => p.lp === toLP?.other.key && p.other.handle === 'alder' && p.tier === 'B');
  check('0037 a sourced connector outside the active LP set completes a two-hop personal route',
    Boolean(toLP?.other.person && toConnector?.lpPerson && researchTie(toLP)?.kind === 'cofounder'),
    'Sourced roster identity is carried through W3 for import; no new LP pursuit or inferred organization relationship.');

  if (db) {
    const { resolveConnectionPeople } = await import('../lib/enrich/connection-people');
    const keys = [...new Set(ties.flatMap((p) => [p.lpPerson?.key, p.other.person?.key]).filter((k): k is string => Boolean(k)))];
    try {
      const first = await resolveConnectionPeople(db, ties), second = await resolveConnectionPeople(db, ties);
      const count = await db.one<{ n: string }>("select count(*)::text as n from identity.source_record where source = 'w3_person' and source_id = any($1::text[])", [keys]);
      check('0037 sourced connector import is stable and creates no duplicate person on retry',
        JSON.stringify(first) === JSON.stringify(second) && Number(count?.n) === keys.length,
        'Source identities are mapped once before connection candidate notes are imported.');
    } finally {
      await db.query("delete from identity.source_record where source = 'w3_person' and source_id = any($1::text[])", [keys]);
      await db.query('delete from identity.possible_match where left_entity= any($1::uuid[]) or right_entity= any($1::uuid[])', [keys]);
      await db.query("delete from research.note where entity_id= any($1::uuid[]) and kind='identity_creation'", [keys]);
      await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [keys]);
    }
  }

  const { foldRoutes } = await import('../modules/network');
  const { routeNameLinks } = await import('../components/routes/RouteNames');
  const edge = (from: string, to: string, warmth: 'cofounder' | 'worked_together'): import('../modules/network').Edge => ({
    edgeId: `${from}-${to}`, fromEntity: from, toEntity: to, fromName: from, toName: to, kind: 'colleague', tier: 'B',
    strength: null, tieBand: null, evidence: [{ note: 'Invented relationship', tie: { kind: warmth, lastInteraction: '2026-09-01' } }],
    reviewedByName: null, reviewedAt: null, reviewNote: null, validFrom: new Date('2026-09-01'), validTo: null });
  const route = (edges: import('../modules/network').Edge[]): import('../modules/network').Route => ({ hops: edges.map((e) => ({ edge: e, toName: e.toName, toEntity: e.toEntity })), connectorIds: [], connectorNames: [], verdict: 'recommend', reasons: [], weakestTier: 'B', askLoad: null, influence: null });
  const onward = edge('Cedar', 'Rowan', 'worked_together');
  const direct = route([edge('Alder', 'Cedar', 'cofounder'), onward]);
  const detour = route([edge('Alder', 'Birch', 'worked_together'), edge('Birch', 'Cedar', 'worked_together'), onward]);
  const folded = foldRoutes([direct, detour], new Date('2026-09-26'));
  const link = routeNameLinks(folded[0]!, folded.filter((r) => r.foldedUnder === 0), 'Alder')[0]!;
  check('0041 strong first-hop detours fold and the intermediate name carries their hover text and entity link',
    folded.filter((r) => r.foldedUnder == null).length === 1 && folded[1]?.foldedUnder === 0
      && link.href === '/orgs/Cedar' && link.title.includes('Alder → Birch → Cedar → Rowan')
      && foldRoutes([direct, { ...detour, verdict: 'excluded' }], new Date('2026-09-26'))[1]?.foldedUnder == null,
    'The page consumes planner folds; the disclosure retains inspect links, while restricted routes remain visible.');

  const small = ['<$25K', '$25–50K', '$50–250K'];
  const scores = small.map((b) => capacityValue(b)!);
  check('0043 new bands parse and order; legacy findings still validate and display without false precision',
    [...CAPACITY_BANDS, '<$250K'].every((b) => readableCapacityBand(b) && checkFinding({ ...finding, profile: { summary: 'Invented', investorType: 'angel', capacity: { band: b, basis: 'Invented estimate' } } }).length === 0)
      && scores[0]! < scores[1]! && scores[1]! < scores[2]! && scores[2]! < capacityValue('$250K–1M')!
      && capacityValue('<$250K') === 0.25 && capacityBandLabel('<$250K').includes('legacy') && !(CAPACITY_BANDS as readonly string[]).includes('<$250K'),
    'New output vocabulary excludes the legacy band; broad old estimates remain broad.');
  check('0043 size priors include small strategic angels and legacy by-size estimates remain readable',
    bandBySize('individual', 1e6) === '<$25K' && bandBySize('individual', 3e6) === '$25–50K'
      && bandBySize('family_office', 3e6) === '<$25K' && bandBySize('family_office', 7e6) === '$25–50K'
      && bandByRule('<$250K', 'By size: net worth of $20M')?.holds === true,
    'Thresholds are explicitly guesses; no new by-size result emits the legacy band.');
}

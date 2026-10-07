/** Invented file-only regressions: exercise the checker without opening any database. */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { candidateKey, exportAliases } from '../../lib/enrich/candidate-key';
import type { Strategy } from '../../lib/enrich/strategy';
import type { Check } from './harness';

export async function aliasJoinProperties(check: Check) {
  {
    // 7 Oct 2026: LPs moved from a person to their organization kept the person's research under the person's keys.
    const lps = [
      { key: 'org-a', contacts: [{ key: 'person-a' }] },
      { key: 'org-b', contacts: [{ key: 'person-shared' }] }, { key: 'org-c', contacts: [{ key: 'person-shared' }, { key: 'person-c' }] },
      { key: 'person-c' },
    ];
    const out = Object.fromEntries(exportAliases([
      ['slug-own', 'org-a'], ['slug-a', 'person-a'], ['slug-shared', 'person-shared'], ['slug-c', 'person-c'], ['slug-gone', 'nobody'],
    ], lps));
    check('EXPORT ALIASES a person\'s research files under the one LP they speak for; a shared contact or a candidate never moves',
      out['slug-own'] === 'org-a' && out['slug-a'] === 'org-a' && out['person-a'] === 'org-a'
      && !('slug-shared' in out) && !('person-shared' in out) && out['slug-c'] === 'person-c' && !('person-c' in out) && !('slug-gone' in out),
      JSON.stringify(out));
  }
  const key = '10000000-0000-4000-8000-000000000001';
  const peer = '10000000-0000-4000-8000-000000000002';
  const firm = '10000000-0000-4000-8000-000000000003';
  const stranger = '10000000-0000-4000-8000-000000000004';
  const candidates = [
    { key, name: 'Invented River' }, { key: peer, name: 'Invented Willow' },
    { key: firm, name: 'Invented Arbor' }, { key: stranger, name: 'Invented Stranger' },
  ].map(c => ({ ...c, type: c.key === firm ? 'org' : 'person',
    org: c.key === stranger ? null : 'Invented Arbor', domains: c.key === stranger ? [] : ['arbor.example'],
    location: 'London, UK', money: null, context: [],
    contact: { lastFromThem: null, meetings: 0, groupMeetings: 0 } }));
  const alias = 'invented-research-river';
  const finding = { key: alias, name: 'Invented River', facts: [],
    researched: { at: '2026-09-26', by: 'fixture', workflow: 'W1', version: '1.0' },
    identity: { match: 'confirmed', basis: 'Invented fixture identity', canonical: { name: 'Invented River' } } };
  check('Alias resolution honors explicit IDs, exported aliases and unique finding identities',
    candidateKey({ key: alias, entityId: key }, candidates, {}) === key
    && candidateKey({ key: alias, candidateKey: key }, candidates, {}) === key
    && candidateKey({ key: alias }, candidates, { [alias]: key }) === key
    && candidateKey({ key: alias }, candidates, {}, finding) === key
    && candidateKey({ key }, candidates, {}) === key,
    'One shared resolver covers canonical and research-key files.');
  check('Alias resolution refuses unknown targets, ambiguous names and unresolved findings',
    candidateKey({ key: alias }, candidates, { [alias]: 'missing' }) === null
    && candidateKey({ key: alias }, [...candidates, { key: 'namesake', name: 'Invented River' }], {}, finding) === null
    && candidateKey({ key: alias }, candidates, {}, { ...finding, identity: { match: 'ambiguous' } }) === null,
    'No fuzzy identity matches or missing candidate rows.');
  const scratch = await mkdtemp(join(tmpdir(), 'alias-check-'));
  const dir = join(scratch, 'data/demo/enrich');
  const strategy = (k: string): Strategy => ({
    key: k, name: 'Invented River', made: { at: '2026-09-27', by: 'fixture', workflow: 'W5', version: '1.10',
      inputs: { finding: finding.researched.at, money: null, bestPath: 'C' } },
    fit: { invented: { verdict: 'possible', why: 'Invented evidence' } },
    scores: { capacity: { band: 'unknown', basis: 'No evidence' }, affinity: { level: 'low', basis: 'Invented' },
      propensity: { level: 'low', basis: 'Invented' }, timeToDecision: { band: 'weeks', basis: 'Invented' } },
    angle: 'Review Invented River with Invented Willow at Invented Arbor.',
    route: { via: 'Invented Guide', tier: 'C', why: 'Invented path' },
    next: { what: 'Review the evidence', who: 'Fixture owner', when: '2026-10-01' },
    ask: { vehicle: 'invented', shape: 'fund commitment' }, openQuestions: [], risks: [], list: 'this year', confidence: 'low',
  });
  const write = (file: string, value: unknown) => writeFile(join(dir, file), JSON.stringify(value));
  const run = async () => {
    try {
      const result = await promisify(execFile)(process.execPath,
        ['--import', import.meta.resolve('tsx'), resolve('scripts/enrich-check.ts'), '--gated', join(scratch, 'gated.txt'), '--naming', join(scratch, 'naming.txt'), '--lead-moved', join(scratch, 'lead-moved.txt')],
        { cwd: scratch, env: { ...process.env, DATA_PROFILE: 'demo', DATABASE_URL: '', TSX_TSCONFIG_PATH: resolve('tsconfig.json') } });
      return { stdout: result.stdout, code: 0 };
    } catch (error) {
      const e = error as { stdout: string; code: number };
      if (typeof e.stdout !== 'string') throw error;
      return { stdout: e.stdout, code: e.code };
    }
  };
  try {
    await mkdir(join(dir, 'raw'), { recursive: true });
    await mkdir(join(dir, 'strategy/companion'), { recursive: true });
    await writeFile(join(dir, 'candidates.jsonl'), candidates.map(c => JSON.stringify(c)).join('\n'));
    await write('vehicles.json', [{ slug: 'invented', name: 'Invented Fund' }, { slug: 'companion', name: 'Invented Companion' }]);
    await write('entity-keys.json', { [alias]: key });
    await write(`raw/${alias}.json`, finding);
    await writeFile(join(dir, 'connections.jsonl'), JSON.stringify({ lp: key, other: { name: 'Invented Guide', type: 'team' }, tier: 'C', kind: 'colleague', basis: 'Invented tie' }));
    const s = strategy(alias);
    await write(`strategy/${alias}.json`, s);
    const first = await run();
    const gated = (await readFile(join(scratch, 'gated.txt'), 'utf8')).trim();
    check('Checker joins alias strategies to W3, their firm and evidence gates', first.code === 0
      && first.stdout.includes('0 older than their LP\'s finding') && first.stdout.includes('0 naming an LP')
      && first.stdout.includes('"this year, without the evidence gate":1')
      && first.stdout.includes('"outside the US, no counsel gate":1') && gated === key,
      'A current C pin stays current, own firm/colleague names are allowed, and gates emit the canonical candidate.');
    await rm(join(dir, `strategy/${alias}.json`));
    await write(`strategy/${key}.json`, strategy(key));
    const canonical = await run();
    check('Canonical and alias strategies produce identical checker summaries', canonical.stdout === first.stdout,
      'Same inputs and same candidate checks regardless of filename.');
    // 7 Oct 2026: a lead stamped about 45 minutes after it was written hid staleness.
    await write(`strategy/${key}.json`, { ...strategy(key), made: { ...strategy(key).made, at: new Date(Date.now() + 86_400_000).toISOString() } });
    const future = await run();
    check('A strategy stamped later than it was written is counted', first.stdout.includes('0 stamped later than they were written')
      && future.stdout.includes('1 stamped later than they were written'), 'A future made.at hides staleness and moves lead pins.');
    await rm(join(dir, `strategy/${key}.json`));
    await write('entity-keys.json', {});
    await write(`strategy/${alias}.json`, { ...s, candidateKey: key,
      angle: `${s.angle} Review Invented Stranger.`, route: { ...s.route, tier: 'B' } });
    const negative = await run();
    check('Alias resolution preserves real stale pins, unrelated naming and route gates',
      negative.stdout.includes('1 naming an LP') && negative.stdout.includes('"route better than the best path on file":1')
      && (await readFile(join(scratch, 'naming.txt'), 'utf8')).trim() === key,
      'Resolving identity does not relax candidate-dependent checks.');
    await write(`strategy/${alias}.json`, { ...s, entityId: key, made: { ...s.made, inputs: { ...s.made.inputs!, bestPath: 'B' } } });
    const stale = await run();
    check('Alias strategies with changed best-tier pins remain stale', stale.stdout.includes('1 older than their LP\'s finding'), 'B pinned against current C.');
    await write(`strategy/${alias}.json`, { ...s, entityId: key });
    await write(`raw/${peer}.json`, { ...finding, key: peer, name: 'Invented Willow',
      researched: { ...finding.researched, at: '2026-09-28' },
      identity: { match: 'confirmed', basis: 'Invented colleague' } });
    const colleague = { ...strategy(peer), name: 'Invented Willow', route: null,
      made: { ...s.made, inputs: { finding: '2026-09-28', money: null, bestPath: null,
        lead: { key: alias, at: '2026-09-26' } } }, ask: { vehicle: 'invented', shape: 'firm-level ask' } };
    await write(`strategy/${peer}.json`, colleague);
    const leads = await run();
    check('Alias lead pins join rewritten leads and newer colleague findings',
      leads.stdout.includes('1 firm-level strategies whose lead was rewritten since')
      && leads.stdout.includes("1 leads older than a colleague's finding"),
      'A lead filed under its own explicit entity ID resolves even without an exported alias.');
    // 7 Oct 2026: a lead with no strategy of its own (often no candidate line either) is listed for re-pinning, not healthy.
    await write(`strategy/${peer}.json`, { ...colleague, made: { ...colleague.made, inputs: { ...colleague.made.inputs, lead: { key: 'invented-nobody', at: '2026-09-26' } } } });
    const orphan = await run();
    check('A firm-level strategy whose lead has no strategy is counted and listed for re-pinning',
      leads.stdout.includes('0 whose lead has no strategy') && orphan.stdout.includes('1 whose lead has no strategy')
      && (await readFile(join(scratch, 'lead-moved.txt'), 'utf8').catch(() => '')).trim() === peer,
      orphan.stdout.split('\n').find((l) => l.includes('firm-level')) ?? 'no summary line');
    await write(`strategy/${peer}.json`, { ...colleague, ask: { vehicle: 'invented', shape: 'fund commitment' } });
    const money = await run();
    check('Money asks under aliases count against the canonical firm', money.stdout.includes('1 firms asked for money twice'),
      'The alias and its colleague cannot hide overlapping asks.');
    await rm(join(dir, `strategy/${peer}.json`));
    await write(`strategy/companion/${alias}.json`, { ...s, entityId: key, ask: { vehicle: 'companion', shape: 'advice' } });
    const companion = await run();
    check('Companion-vehicle strategies use the same alias join', companion.code === 0
      && companion.stdout.includes('2 strategies') && companion.stdout.includes('0 older than their LP\'s finding')
      && companion.stdout.includes('"this year, without the evidence gate":2'),
      'Both layouts use the candidate evidence without mixing their vehicle keys.');
    await write(`strategy/${key}.json`, strategy(key));
    const duplicate = await run();
    check('Aliases cannot create a second strategy for the same candidate and vehicle', duplicate.code === 1
      && duplicate.stdout.includes('multiple files for the same LP and vehicle (resolved aliases)'),
      'Both conflicting files are refused, while a companion vehicle remains separate.');
    await rm(join(dir, `strategy/${key}.json`));
    await write('strategy/unmapped.json', { ...strategy('unmapped'), name: 'Invented Unknown' });
    const unknown = await run();
    check('Unresolvable aliases are reported on their own failing line', unknown.code === 1
      && unknown.stdout.includes('strategy unmapped.json: unresolvable alias; no candidate in the research export'),
      'An unmapped file cannot silently escape the evidence gates.');
  } finally { await rm(scratch, { recursive: true, force: true }); }
  {
    // 7 Oct 2026: a refresh under the canonical key dropped the older alias finding's angel checks.
    const { mergeFindings } = await import('../../lib/enrich/merge-findings');
    const fact = (value: unknown, url = 'https://example.org/a') => ({ field: 'investments', value, source: { url, kind: 'news' }, confidence: 'high' }) as never;
    const finding = (k: string, at: string, facts: never[], connections: never[] = []) => ({ key: k, name: 'Invented River', researched: { at, by: 'props', workflow: 'W1', version: '1.50' }, facts, connections }) as never;
    const newest = finding(key, '2026-10-06T00:00:00Z', [fact('Advisor at Invented Labs')]);
    const older = finding('alias-river', '2026-09-20T00:00:00Z', [fact('advisor at  Invented Labs'), fact('Angel check in Invented Bio, 2024'), fact(5, 'https://example.org/b')],
      [{ to: 'Protocol Labs', kind: 'portfolio', basis: 'invented', tier: 'C' }] as never);
    const out = mergeFindings(newest, [older], '2026-10-07T12:00:00Z', 'props');
    const m = out.merged as unknown as { facts: Array<{ value: unknown }>; connections: unknown[]; researched: { at: string; corrected: Array<{ what: string }> } };
    const same = mergeFindings(newest, [newest], '2026-10-07T12:00:00Z', 'props');
    const w1c = (f: unknown) => ({ ...(f as object), researched: { ...(f as { researched: object }).researched, corrected: [{ at: '2026-10-05T00:00:00Z', by: 'claude (sub-agent), W1c', what: 'narrowed a location' }] } }) as never;
    const cutTarget = mergeFindings(w1c(newest), [older], '2026-10-07T12:00:00Z', 'props').facts;
    const checkedSource = mergeFindings(w1c(newest), [w1c(older)], '2026-10-07T12:00:00Z', 'props').facts;
    const by = (f: unknown, who: string) => ({ ...(f as object), researched: { ...(f as { researched: object }).researched, corrected: [{ at: '2026-10-07T10:00:00Z', by: who, what: 'dropped a holding' }] } }) as never;
    const w1qTarget = mergeFindings(by(newest, 'claude (sub-agent), W1q revision'), [older], '2026-10-07T12:00:00Z', 'props').facts;
    const mergedOnce = mergeFindings(by(newest, 'rule (scripts/enrich-merge-findings.ts)'), [older], '2026-10-07T12:00:00Z', 'props').facts;
    const revisedSibling = mergeFindings(newest, [older, by(finding('firm', '2026-10-01T00:00:00Z', [fact('Advisor at Invented Labs')]), 'claude (sub-agent), W1c')], '2026-10-07T12:00:00Z', 'props').facts;
    check('An older finding\'s facts and connections the newest lacks are merged in, once, with a dated correction; the newest stays the record; a fact-checked or W1-revised finding takes nothing by rule; an earlier merge doesn\'t count as a revision; an LP with any revised finding takes no merge',
      out.facts === 2 && out.connections === 1 && m.facts.length === 3 && m.researched.at === '2026-10-06T00:00:00Z'
      && m.researched.corrected.length === 1 && /merged 2 facts and 1 connection from the older finding alias-river/.test(m.researched.corrected[0]!.what)
      && same.facts === 0 && same.merged === newest && cutTarget === 0 && checkedSource === 0 && w1qTarget === 0 && mergedOnce === 2 && revisedSibling === 0,
      `added ${out.facts} facts, ${out.connections} connections; ${m.facts.length} facts; correction ${m.researched.corrected?.[0]?.what}`);
  }
}

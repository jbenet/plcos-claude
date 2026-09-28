/** Invented portfolio snapshots only; no database or real profile reads. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { portfolioPaths, readConnectionPortfolio } from '../lib/enrich/portfolio-paths';
import { pathProblems } from '../lib/enrich/connection-check';
import type { Candidate } from '../lib/enrich/candidates';
import { connectionPaths, findPaths, type Path } from '../lib/enrich/connect';
import type { PortfolioInput, PortfolioSource } from '../lib/enrich/portfolio';
import type { Finding } from '../lib/enrich/schema';

export async function w3PortfolioProperties(check: (name: string, ok: boolean, detail: string) => void) {
  const source: PortfolioSource = { file: 'invented-portfolio.pdf', page: 2, as_of: '2026-09-20', confidence: 0.9, last_verified_by: 'fixture' };
  const input: PortfolioInput = { version: 1, as_of: source.as_of, coverage: [], rows: [{ id: 'invented-company', vehicle: 'neurotech',
    company: { name: 'Invented Cedar Systems' }, founders: [{ name: 'Invented Ellis Vale', source }], source }] };
  const candidate: Candidate = { key: '11111111-2222-4333-8444-555555555555', name: 'Invented Ellis Vale', type: 'person', org: 'Invented Cedar Systems', role: 'Founder',
    location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
    contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null, lastFromThem: null,
      awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, meetingDates: [], recent: [], outreachShared: 0 } };
  const direct = portfolioPaths([], [candidate], new Map(), input);
  check('W3 portfolio founder LP receives a sourced investor-founder path', direct.length === 1 && direct[0]!.lp === candidate.key
    && direct[0]!.tier === 'B' && direct[0]!.tie?.kind === 'investor_founder' && direct[0]!.tie?.withUs === 'pl_founder'
    && direct[0]!.source?.includes('last_verified_by=fixture') === true, 'Name and recorded company resolve the founder; the full source tuple survives.');
  const onward: Path = { lp: '22222222-2222-4333-8444-555555555555', other: { type: 'backer', name: candidate.name, entityType: 'person' },
    kind: 'board', tier: 'B', source: 'https://example.org/invented-board', basis: 'Served on the Invented Cedar Systems board with Invented Ellis Vale.' };
  const connector = portfolioPaths([onward], [], new Map(), input);
  check('W3 non-LP portfolio founder completes the evidenced two-hop path', connector[0]!.other.key === connector[1]!.lp
    && connector[0]!.other.person?.key === connector[1]!.lpPerson?.key
    && connector[0]!.source === onward.source && connector[0]!.tier === onward.tier,
    'PL reaches the founder; the distinct research record proves the onward relationship.');
  const negative = portfolioPaths([{ ...onward, basis: 'Someone with this name is on a board.' }], [], new Map(), input);
  check('W3 portfolio name-only endpoint is never merged', !negative[0]!.other.key, 'A company is required on the relationship evidence.');
  check('W3 portfolio onward relationship requires a source', !portfolioPaths([{ ...onward, source: null }], [], new Map(), input)[0]!.other.key,
    'A name and company in unsourced text cannot establish an onward tie.');
  const wrong = portfolioPaths([onward], [{ ...candidate, org: 'Invented Different Systems' }], new Map(), input);
  const ambiguous = portfolioPaths([], [candidate, { ...candidate, key: 'invented-namesake' }], new Map(), input);
  const finding: Finding = { key: candidate.key, name: candidate.name, researched: { at: source.as_of, by: 'fixture', workflow: 'W1', version: '1' },
    identity: { match: 'ambiguous', basis: 'Invented namesakes' }, facts: [] };
  const uncertain = portfolioPaths([], [candidate], new Map([[candidate.key, finding]]), input);
  const former: Finding = { ...finding, identity: { match: 'confirmed', basis: 'Invented identity' }, facts: [{
    field: 'prior_role', value: 'Founded Invented Cedar Systems before joining a fund.', confidence: 'high',
    detail: { company: 'Invented Cedar Systems' }, source: { kind: 'primary', url: 'https://example.org/invented-founder' },
  }] };
  check('W3 former founders retain portfolio paths after changing firms', portfolioPaths([], [{ ...candidate, org: 'Invented Different Systems' }],
    new Map([[candidate.key, former]]), input).some(p => p.lp === candidate.key), 'A sourced former founder role corroborates the identity.');
  check('W3 portfolio conflicting and ambiguous identities stay distinct', !wrong[0]!.other.key
    && ambiguous.every(p => ![candidate.key, 'invented-namesake'].includes(p.lp)) && uncertain.every(p => p.lp !== candidate.key),
    'A sourced founder node remains available without conflating a namesake LP.');
  check('W3 portfolio exclusions and warehouse claims produce no founder routes', ['research_scope_only', 'warehouse_claimed_portfolio', 'warehouse_founder']
    .every(portfolio_status => portfolioPaths([], [candidate], new Map(), { ...input, rows: [{ ...input.rows[0]!, portfolio_status }] }).length === 0)
    && portfolioPaths([], [candidate], new Map(), { ...input, excluded: [{ id: input.rows[0]!.id }] }).length === 0,
    'Only the authoritative included portfolio rows grant this relationship.');
  check('W3 includes SPV portfolio rows and stable founder identities', portfolioPaths([], [], new Map(), { ...input, rows: [], spv_rows: input.rows })[0]!.lp === connector[1]!.lp,
    'Repeated runs and fund/SPV row placement keep the same source identity.');
  const network = { orgs: [], backers: [], backer_people: [] };
  const e2e = connectionPaths([candidate], new Map(), network, [], [], new Date('2026-09-28'), undefined, input);
  const target = { ...candidate, key: onward.lp, name: 'Invented Other LP', org: null };
  const targetFinding: Finding = { ...finding, key: target.key, name: target.name, identity: { match: 'confirmed', basis: 'Invented identity' },
    connections: [{ to: founderName(input), toType: 'person', kind: 'board', tier: 'B', source: onward.source, basis: onward.basis }] };
  const twoHop = connectionPaths([target], new Map([[target.key, targetFinding]]), network, [], [], new Date('2026-09-28'), undefined, input);
  check('W3 portfolio output passes the actual importer identity validator',
    [...e2e.paths, ...twoHop.paths].every(p => pathProblems(p).length === 0),
    'Stable connector identity sources match their UUIDs; edge provenance remains complete.');
  const firstHop = twoHop.paths.find(p => p.lpPerson?.name === candidate.name);
  check('W3 full join preserves direct and non-LP founder routes without inflating LP totals', e2e.paths.some(p => p.lp === candidate.key && p.kind === 'portfolio' && p.tier === 'B')
    && Boolean(firstHop && twoHop.paths.some(p => p.lp === target.key && p.other.key === firstHop.lp)) && twoHop.lps === 1,
    'Portfolio paths survive materialization and grading; the connector remains outside the LP denominator.');
  const scratch = await mkdtemp(join(tmpdir(), 'w3-portfolio-invented-'));
  try {
    const enrich = join(scratch, 'enrich');
    await mkdir(enrich);
    assert.equal(await readConnectionPortfolio(enrich), undefined);
    await mkdir(join(scratch, 'portfolio'));
    const file = join(scratch, 'portfolio', 'portfolio.json');
    await writeFile(file, JSON.stringify(input));
    assert.deepEqual(await readConnectionPortfolio(enrich), input);
    await writeFile(join(enrich, 'candidates.jsonl'), JSON.stringify(candidate) + '\n');
    assert.ok((await findPaths(enrich)).paths.some(p => p.lp === candidate.key && p.kind === 'portfolio' && p.tier === 'B'));
    await writeFile(file, '{');
    await assert.rejects(readConnectionPortfolio(enrich), /not valid JSON/);
    await writeFile(file, JSON.stringify({ ...input, rows: [{ ...input.rows[0]!, source: {} }] }));
    await assert.rejects(readConnectionPortfolio(enrich), /failed validation/);
    check('W3 loads the profile sibling portfolio and rejects malformed input', true, 'Only a missing file is optional; invalid provenance cannot silently remove routes.');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

const founderName = (input: PortfolioInput) => input.rows[0]!.founders[0]!.name;

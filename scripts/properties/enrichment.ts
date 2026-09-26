import type { Check } from './harness';
import { join } from 'node:path';
import type { AffinityContext } from './affinity-fixtures';

export async function enrichmentProperties(ctx: AffinityContext & { n: (sql: string, params?: unknown[]) => Promise<number>; st: typeof import('../../modules/strategy'); juan: string }) {
  const { check, adb, attempt, n, st, juan } = ctx;
  const { mkdir: mk, writeFile: wf2, readFile: rf, rm: rmr } = await import('node:fs/promises');
  const scratch = join(process.cwd(), 'data', 'demo', 'props-enrich');
  await rmr(scratch, { recursive: true, force: true });
  process.env.ENRICH_DIR = scratch;
  const cand = await import('../../lib/enrich/candidates');
  const imp = await import('../../lib/enrich/import');
  const exported = await cand.exportResearchSet();
  const identity = (await rf(join(scratch, 'research-set.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const leaks = identity.filter((x) => 'pursuits' in x || 'contact' in x || 'notes' in x || Object.keys((x.enriched ?? {}) as object).some((k) => !['Current Organization', 'Current Job Title', 'Organizations', 'Job Titles', 'Industry', 'Location', 'LinkedIn URL'].includes(k)));
  const pick = identity[0] as { key: string; name: string };
  await mk(join(scratch, 'raw'), { recursive: true });
  await mk(join(scratch, 'strategy'), { recursive: true });
  const finding = (extra: Record<string, unknown> = {}) => ({
    key: pick.key, name: pick.name, researched: { at: '2026-09-20T10:00:00Z', by: 'claude (sub-agent)', workflow: 'W1', version: 5 },
    identity: { match: 'confirmed', basis: 'Invented for the harness.' },
    facts: [{ field: 'role', value: 'Principal of an invented office.', source: { url: 'https://example.org/about', kind: 'primary' }, confidence: 'high' },
            { field: 'interest', value: 'Says neurotech matters.', source: { url: 'https://example.org/podcast', kind: 'podcast', published: '2026-05-01' }, confidence: 'medium' }],
    profile: { summary: 'Invented.', investorType: 'fo_principal' }, ...extra,
  });
  await wf2(join(scratch, 'raw', `${pick.key}.json`), JSON.stringify(finding()));
  // W9's line for them: mapped in as a note, replaced (never piled up) by the next import.
  await wf2(join(scratch, 'triage.jsonl'), JSON.stringify({ key: pick.key, name: pick.name, lane: 'cold', reasons: ['The stage on file says “Contacted”, but no touch is on record: check sent mail before writing'], senior: true, researched: true, waitedDays: null, first: 'check sent mail' }) + '\n');
  // Refused: facts for an identity that is not resolved, and a phone number in a fact.
  const other = identity[1] as { key: string; name: string };
  await wf2(join(scratch, 'raw', `${other.key}.json`), JSON.stringify({ ...finding(), key: other.key, identity: { match: 'ambiguous', basis: 'Two people share the name.' } }));
  const first = await imp.importFindings(juan);
  const claimsNow = () => n(`select count(*)::text as n from research.claim where entity_id = $1 and source like 'pub:%'`, [pick.key]);
  const c1 = await claimsNow();
  const unverified = await n(`select count(*)::text as n from research.claim c join research.source_doc d on d.doc_id = c.source where c.entity_id = $1 and c.source like 'pub:%' and c.last_verified_by is null and c.as_of is not null`, [pick.key]);
  const again = await imp.importFindings(juan);
  const c2 = await claimsNow();
  const triageNotes = await n(`select count(*)::text as n from research.note where entity_id = $1 and kind = 'triage' and body like 'Before any outreach: check sent mail%'`, [pick.key]);
  await adb.query(`update research.claim set last_verified_by = $2, last_verified_at = now() where entity_id = $1 and field = 'public.role'`, [pick.key, juan]);
  await wf2(join(scratch, 'raw', `${pick.key}.json`), JSON.stringify(finding({ facts: [{ field: 'interest', value: 'Says neurotech matters.', source: { url: 'https://example.org/podcast', kind: 'podcast' }, confidence: 'medium' }] })));
  await imp.importFindings(juan);
  const keptVerified = await n(`select count(*)::text as n from research.claim where entity_id = $1 and field = 'public.role' and last_verified_by is not null`, [pick.key]);
  const phone = (await import('../../lib/enrich/schema')).check({ ...finding(), facts: [{ field: 'news', value: 'Call +1 (415) 555-0134', source: { url: 'https://example.org/x', kind: 'press' }, confidence: 'low' }] });
  const proseEmail = (await import('../../lib/enrich/schema')).check({ ...finding(), profile: { summary: 'Invented.', investorType: 'fo_principal', cautions: ['The office answers at desk@example.org'] } });
  const street = (await import('../../lib/enrich/schema')).check({ ...finding(), facts: [{ field: 'role', value: 'Principal; the office sits at 400 Harbor Street, Suite 12.', source: { url: 'https://example.org/x', kind: 'primary' }, confidence: 'high' }] });
  const firmName = (await import('../../lib/enrich/schema')).check({ ...finding(), facts: [{ field: 'prior_role', value: 'Went public in 2014.', detail: { company: 'Sixth Street Partners' }, source: { url: 'https://example.org/x', kind: 'primary' }, confidence: 'high' }] });

  // A strategy: proposed; the same file again adds nothing; a new file withdraws the open one; accepting moves only the next step.
  const strategy = (next: string) => ({
    key: pick.key, name: pick.name, made: { at: '2026-09-20T11:00:00Z', by: 'claude (sub-agent)', workflow: 'W5', version: 1 },
    fit: { 'PLC Neurotech I': { verdict: 'good', why: 'Invented.' } },
    scores: { capacity: { band: '$1–5M', basis: 'Invented.' }, affinity: { level: 'medium', basis: 'Invented.' }, propensity: { level: 'medium', basis: 'Invented.' }, timeToDecision: { band: 'weeks', basis: 'Invented.' } },
    angle: 'Invented.', route: null, next: { what: next, who: 'Juan', when: 'this week' }, ask: { vehicle: 'PLC Neurotech I', shape: 'fund commitment' },
    openQuestions: [], risks: [], list: 'this year', confidence: 'medium',
  });
  await wf2(join(scratch, 'strategy', `${pick.key}.json`), JSON.stringify(strategy('Ask for twenty minutes')));
  await imp.importFindings(juan);
  await imp.importFindings(juan);
  const proposedOnce = await n(`select count(*)::text as n from strategy.suggestion s join strategy.pursuit p on p.pursuit_id = s.pursuit_id where p.entity_id = $1 and s.status = 'proposed'`, [pick.key]);
  await wf2(join(scratch, 'strategy', `${pick.key}.json`), JSON.stringify(strategy('Offer a portfolio briefing')));
  await imp.importFindings(juan);
  const rows = await adb.query<{ status: string; body: string; id: string; pursuit_id: string }>(
    `select s.status, s.body, s.suggestion_id::text as id, s.pursuit_id::text from strategy.suggestion s join strategy.pursuit p on p.pursuit_id = s.pursuit_id where p.entity_id = $1 order by s.created_at`, [pick.key]);
  const before = await adb.one<{ status: string; rungs: string }>(`select p.status::text, (select count(*)::text from strategy.ladder_event l where l.pursuit_id = p.pursuit_id) as rungs from strategy.pursuit p where p.pursuit_id = $1`, [rows[rows.length - 1]!.pursuit_id]);
  await st.decideSuggestion(juan, rows[rows.length - 1]!.id, 'accept', null);
  const after = await adb.one<{ status: string; next_step: string | null; rungs: string }>(`select p.status::text, p.next_step, (select count(*)::text from strategy.ladder_event l where l.pursuit_id = p.pursuit_id) as rungs from strategy.pursuit p where p.pursuit_id = $1`, [rows[rows.length - 1]!.pursuit_id]);
  const twice = await attempt(() => st.decideSuggestion(juan, rows[rows.length - 1]!.id, 'accept', null));
  delete process.env.ENRICH_DIR;
  await rmr(scratch, { recursive: true, force: true });
  check(
    'Enrichment: the research file carries identity only; findings map in unverified, once; a verified claim survives; bad files are refused; a strategy is decided by a person and moves only the next step',
    exported.candidates > 0 && leaks.length === 0 && first.mapped === 1 && first.rejected === 1 && c1 === 2 && unverified === 2 && again.mapped === 1 && c2 === 2 && triageNotes === 1 &&
      keptVerified === 1 && phone.length > 0 && proseEmail.length > 0 && street.length > 0 && firmName.length === 0 && proposedOnce === 1 && rows.length === 2 && rows[0]!.status === 'withdrawn' && rows[1]!.status === 'proposed' &&
      after?.next_step === 'Offer a portfolio briefing — Juan, this week' && after.status === before?.status && after.rungs === before?.rungs && twice instanceof st.SuggestionRefused,
    `${exported.candidates} in the research set, ${leaks.length} lines carrying more than identity; first import mapped ${first.mapped}, refused ${first.rejected}; claims ${c1} (unverified with a date: ${unverified}); imported again, still ${c2}; triage notes after two imports: ${triageNotes}; ` +
      `a verified claim kept after its fact left the file: ${keptVerified}; a phone number refused: ${phone.length > 0}; an address in a caution refused: ${proseEmail.length > 0}; a street address refused: ${street.length > 0}; a firm called Sixth Street accepted: ${firmName.length === 0}; one proposal after importing twice: ${proposedOnce}; after a new file: ${rows.map((r) => r.status).join(' → ')}; ` +
      `accepted: next step "${after?.next_step}", status ${before?.status} → ${after?.status}, rungs ${before?.rungs} → ${after?.rungs}; accepting again refused: ${twice instanceof st.SuggestionRefused}`,
  );
}

export async function connectionProperties(check: Check) {
  const cn = await import('../../lib/enrich/connect');
  const sg = await import('../../lib/enrich/strategy');
  const denial = cn.affirms('Its portfolio has no Protocol Labs or Filecoin company.', 'Filecoin');
  const later = cn.affirms('No Protocol Labs company here. It backed Filecoin in 2017.', 'Filecoin');
  const person = (key: string, org: string) => ({
    key, name: `Person ${key}`, type: 'person', org, role: null, location: null, domains: [], enriched: {},
    pursuits: [{ pursuitId: key, vehicle: 'PLC Neurotech I', status: 'connecting', rung: null, owner: 'Juan', stageSaid: null, nextStep: null }],
    contact: { meetings: 0, lastTouch: null, lastFromThem: null, awaitingSince: null, read: null, groupMeetings: 0, outreachShared: 0 }, money: null, notes: [],
  });
  const fact = (field: string, value: string, company?: string) => ({ field, value, detail: company ? { company } : undefined, source: { url: 'https://example.org/x', kind: 'primary' }, confidence: 'high' });
  const found = (key: string, facts: unknown[]) => [key, { key, name: `Person ${key}`, researched: { at: '2026-09-20T10:00:00Z', by: 'test', workflow: 'W1', version: '1.6' }, identity: { match: 'confirmed', basis: 'Invented.' }, facts }] as const;
  const people = [person('a', 'Alder Capital'), person('b', 'Birch Partners'), person('c', 'Cedar Fund'), person('d', 'Dune Office'), person('e', 'Elm Group'),
    person('f', 'Fir Allocators'), person('g', 'Gale Ventures')];
  const findings = new Map([
    found('a', [fact('investment', 'Seed investor in Harbor Robotics', 'Harbor Robotics'), fact('prior_role', 'Engineer at Northwind Analytics', 'Northwind Analytics'), fact('education', 'Studied computer science')]),
    found('b', [fact('investment', 'Backed Harbor Robotics in its seed round', 'Harbor Robotics')]),
    found('c', [fact('prior_role', 'Product lead at Northwind Analytics', 'Northwind Analytics')]),
    found('d', [fact('board', 'Board member of Science', 'Science')]),
    found('e', [fact('role', 'Partner; computer science by training')]),
    // A fund of funds that backs a manager (firm scope), and the manager's GP (1.20).
    found('f', [{ ...fact('fund_lp', 'Its program backs Harbor Seed Fund III', undefined), detail: { fund: 'Harbor Seed Fund III' }, scope: 'firm' }]),
    found('g', [{ ...fact('fund_gp', 'General partner of Harbor Seed Fund III', undefined), detail: { fund: 'Harbor Seed Fund III' } }]),
  ]);
  const shared = cn.sharedRecords(people as never, findings as never);
  const ab = shared.find((p) => p.lp === 'a' && p.other.key === 'b');
  const ac = shared.find((p) => p.lp === 'a' && p.other.key === 'c');
  const oneWord = shared.filter((p) => (p.lp === 'd' && p.other.key === 'e') || (p.lp === 'e' && p.other.key === 'd')).length;
  const fof = shared.find((p) => p.lp === 'g' && p.other.key === 'f');
  const made = (inputs?: { finding: string | null }) => ({ made: { at: '2026-09-21T09:00:00Z', by: 'test', workflow: 'W5' as const, version: 1.2, inputs } });
  const staleNewer = sg.isStale(made({ finding: '2026-09-19T10:00:00Z' }), { researched: { at: '2026-09-20T10:00:00Z' } });
  const freshPinned = sg.isStale(made({ finding: '2026-09-20T10:00:00Z' }), { researched: { at: '2026-09-20T10:00:00Z' } });
  const staleUnpinned = sg.isStale({ made: { ...made().made, at: '2026-09-19T00:00:00Z' } }, { researched: { at: '2026-09-20T10:00:00Z' } });
  check(
    'Connections without the web: a denial is no tie; a shared company record is C and a shared employer D; a one-word name in a sentence is no tie; a fund of funds sits next to the GP of a fund it backs; a strategy older than its finding is stale',
    !denial && later && ab?.tier === 'C' && ab.kind === 'coinvestor' && ac?.tier === 'D' && oneWord === 0 && fof?.tier === 'C' && /backs/.test(fof.basis) && staleNewer && !freshPinned && staleUnpinned,
    `denial read as a tie: ${denial}; the next sentence's tie: ${later}; both invested: ${ab?.tier ?? 'none'} ${ab?.kind ?? ''}; both worked at one company: ${ac?.tier ?? 'none'}; ` +
      `paths through "Science" in a sentence: ${oneWord}; a fund of funds next to the GP of a fund it backs: ${fof?.tier ?? 'none'}; stale when the finding is newer: ${staleNewer}; pinned and current: ${freshPinned}; unpinned and older: ${staleUnpinned}`,
  );
}

export async function triageProperties(check: Check) {
  const { NO_FUNDS } = await import('../../lib/enrich/triage');
  const closes = ['The office does not invest in private equity, venture capital or real estate funds.', "We don't do venture."];
  const open = ['It does not invest directly in venture companies; it backs about twenty venture managers.', 'Invests in venture funds and co-investments.'];
  const wrongClosed = closes.filter((t) => !NO_FUNDS.test(t)).length;
  const wrongOpen = open.filter((t) => NO_FUNDS.test(t)).length;
  check('A firm that says it doesn’t invest in funds closes a fund ask; one that only doesn’t invest directly does not',
    wrongClosed === 0 && wrongOpen === 0, `exclusions missed: ${wrongClosed} of ${closes.length}; backers of managers misread as closed: ${wrongOpen} of ${open.length}`);
}

export async function searchProperties(check: Check) {
  const { pagesOnly, partialSearch } = await import('../../lib/enrich/schema');
  const none = { researched: { method: 'pages' }, coverage: { searched: ['the firm’s team page (read)', 'SEC adviser search'] } };
  const few = { researched: { method: 'pages' }, coverage: { searched: ['web search (2 queries)', 'the firm’s site (read)'] } };
  const denied = { researched: { method: 'pages' }, coverage: { searched: ['no web search: the budget was spent'] } };
  const full = { researched: { method: 'search' }, coverage: { searched: ['web search (6 queries)'] } };
  check('A finding that ran a few web searches is owed the pass but not said to have run none; site searches and a full pass are neither',
    pagesOnly(few) && partialSearch(few) && pagesOnly(none) && !partialSearch(none) && !partialSearch(denied) && !pagesOnly(full) && !partialSearch(full),
    `too few read as a few: ${partialSearch(few)}; site searches read as a web search: ${partialSearch(none)}; "no web search" read as one: ${partialSearch(denied)}; a full pass owed one: ${pagesOnly(full) || partialSearch(full)}`);
}

export async function connectorPlanProperties(check: Check) {
  const { mkdtemp, writeFile: wf3, rm: rm3, mkdir: mk3 } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const cp = await import('../../lib/enrich/connectors');
  const { config } = await import('../../config/deployment');
  const scratch = await mkdtemp(join(tmpdir(), 'props-w11-'));
  await mk3(join(scratch, 'strategy'), { recursive: true });
  const lp = (key: string, status: string, extra: Record<string, unknown> = {}) => ({
    key, name: `LP ${key}`, type: 'person', org: null, role: null, location: null, domains: [], enriched: {},
    pursuits: [{ pursuitId: key, vehicle: 'PLC Neurotech I', status, rung: null, owner: 'Juan', stageSaid: null, nextStep: null }],
    contact: { meetings: 0, lastTouch: null, lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, outreachShared: 0 },
    money: null, notes: [], restrictions: [], ...extra,
  });
  const people = [
    lp('k', 'committed', { money: { amount: 1_000_000, track: 'soft', state: 'soft', signedOn: null, signedPerSource: false, wired: 0 } }),
    lp('p1', 'selected'), lp('p2', 'connecting'), lp('p3', 'connecting'), lp('p4', 'connecting'),
    lp('met', 'discussing', { contact: { meetings: 2, lastTouch: '2026-09-01', lastFromThem: '2026-09-01', awaitingSince: null, read: null, lastTouchChannel: 'meeting', groupMeetings: 0, outreachShared: 0 } }),
    lp('dnc', 'connecting', { restrictions: [{ scope: 'blanket', connector: null, channel: null }] }),
  ];
  const tie = (lpKey: string) => ({ lp: lpKey, other: { type: 'lp', name: 'LP k', key: 'k' }, kind: 'coinvestor', tier: 'C', basis: 'Both invested in Harbor Robotics', source: 'https://example.org' });
  await wf3(join(scratch, 'candidates.jsonl'), people.map((x) => JSON.stringify(x)).join('\n') + '\n');
  await wf3(join(scratch, 'connections.jsonl'), ['p1', 'p2', 'p3', 'p4', 'met', 'dnc'].map((k) => JSON.stringify(tie(k))).join('\n') + '\n');
  const plans = await cp.connectorPlans(scratch);
  await rm3(scratch, { recursive: true, force: true });
  const plan = plans.find((x) => x.connector.key === 'k');
  const named = new Set(plan?.prospects.map((x) => x.key) ?? []);
  check(
    'The connector plan leaves out a restricted prospect and one who has met us, asks a soft connector after signing, and stops at the guard’s limit',
    Boolean(plan) && !named.has('dnc') && !named.has('met') && named.size === 4 && plan!.asks.length === config.guard.asksPerConnectorPerQuarter && plan!.when === 'after they sign' && plan!.toConfirm === plan!.asks.length,
    `prospects: ${[...named].join(', ')}; restricted named: ${named.has('dnc')}; met named: ${named.has('met')}; asks ${plan?.asks.length} (limit ${config.guard.asksPerConnectorPerQuarter}); when: ${plan?.when}; ties to confirm: ${plan?.toConfirm}`,
  );
}

export async function brokerProperties(check: Check) {
  {
    // W1 1.29: a broker is matched on its whole domain, hyphens ignored — the old pattern's
    // "cience.com" flagged every "…science.com", and "alphamaven" missed alpha-maven.com.
    const { isBroker, BLOCKED_DOMAINS } = await import('../../lib/enrich/schema');
    const cases: Array<[string, boolean]> = [
      ['https://www.zoominfo.com/p/x', true], ['https://zoominfo.co.uk/x', true], ['https://alpha-maven.com/x', true],
      ['https://app.apollo.io/x', true], ['https://me.sh/x', true], ['https://cience.com/x', true],
      ['https://www.healthscience.com/x', false], ['https://sciencedaily.com/x', false], ['https://apollo.com/x', false],
      ['https://home.sh/', false], ['https://sinclay.com/', false], ['https://www.crunchbase.com/x', false], ['not a url', false],
    ];
    const wrong = cases.filter(([u, want]) => isBroker(u) !== want);
    const unblocked = BLOCKED_DOMAINS.filter((d) => !isBroker(`https://${d}/`));
    check('A broker is caught on its whole domain, hyphens ignored, and nothing else is; every blocked domain is one',
      wrong.length === 0 && unblocked.length === 0,
      `${cases.length - wrong.length} of ${cases.length} addresses read right; ${BLOCKED_DOMAINS.length - unblocked.length} of ${BLOCKED_DOMAINS.length} blocked domains caught${wrong.length ? `; wrong: ${wrong.map((w) => w[0]).join(', ')}` : ''}${unblocked.length ? `; missed: ${unblocked.join(', ')}` : ''}`);
  }
}

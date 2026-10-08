import type { Check } from './harness';

export async function enrichmentStrategyProperties(check: Check) {
  {
    const { hasCapacityEvidence } = await import('../../lib/enrich/strategy');
    const evidence = ['990-PF assets of $40M (2024)', 'A 13F reporting $1.2B in holdings', 'A commitment of $2M to a venture fund, per the foundation’s 2024 990-PF'];
    const not = ['No LP commitment is on record', 'Company valuation of $2B; founder stake unknown', 'Raised $30M Series B for the company', 'No assets under management and no commitment sizes', 'Commits to venture funds as an LP'];
    const missed = evidence.filter((b) => !hasCapacityEvidence(b)).length, passed = not.filter((b) => hasCapacityEvidence(b)).length;
    check('A capacity band rests on evidence: not a denial, not a company’s valuation or round, not a figure called unknown',
      missed === 0 && passed === 0, `evidence missed: ${missed} of ${evidence.length}; non-evidence accepted: ${passed} of ${not.length}`);
  }

  // Capacity by rule (W1 1.49, W5 1.9; Juan, 24 Sep): an office's size sets the band the table
  // gives, and many angel checks a floor — each held to its rule, so a band that says "by size"
  // and isn't the table's is flagged, and a client-assets size no longer blocks the estimate.
  {
    const { gates } = await import('../../lib/enrich/strategy');
    const cap = await import('../../lib/enrich/capacity');
    const contact = { lastFromThem: null, meetings: 0, groupMeetings: 0 };
    const flags = (band: string, basis: string) => gates({ list: '2027', scores: { capacity: { band, basis } } as never, route: null }, { contact, money: null },
      { profile: { investorType: 'advisor', capacity: { band: 'unknown', basis: '' } } }, null);
    const table = cap.bandBySize('family_office', 800e6) === '$1–5M' && cap.bandBySize('individual', 20e6) === '$50–250K' && cap.bandBySize('nothing', 1e9) === null;
    // The kind named first, not the first in a fixed order; "angel/seed" is counted (N81's readers).
    const firstNamed = cap.sizeReading('By size: a multi-family office with $4.2B under advice')?.kind === 'wealth_manager'
      && cap.sizeReading('By size: an adviser to family foundations, $3B')?.kind === 'wealth_manager'
      && cap.floorHolds('Floor: 60 angel/seed investments on record');
    const bySize = flags('$1–5M', 'By size: a wealth manager with $4.2 billion under management, per its ADV');
    const offTable = flags('$5–25M', 'By size: a wealth manager with $4.2 billion under management, per its ADV');
    const floor = flags('$100K+ (floor)', 'Floor: 12 angel checks on record, sizes unknown');
    const thinFloor = flags('$100K+ (floor)', 'Floor: 3 angel checks on record');
    check('A band by size is the table’s, and a floor needs many angel checks: each held to its rule',
      table && firstNamed && bySize.length === 0 && offTable.includes('capacity off the size table (it gives $1–5M)') && floor.length === 0 &&
        thinFloor.includes('a floor without the angel checks behind it') && thinFloor.includes('capacity ahead of the evidence'),
      `table: ${table}; the kind named first, and angel/seed counted: ${firstNamed}; by size, the table's band: ${bySize.join(', ') || 'no flags'}; another band: ${offTable.join(', ')}; floor on 12 checks: ${floor.join(', ') || 'no flags'}; on 3: ${thinFloor.join(', ')}`);
  }

  // A protocol version is major and minor (N81): "1.10" comes after 1.9, not before 1.3.
  {
    const { versionBefore } = await import('../../lib/enrich/strategy');
    const right = versionBefore('1.10', '1.3') === false && versionBefore(1.9, '1.10') === true && versionBefore(1.2, '1.3') === true && versionBefore('2.0', '1.10') === false;
    check('A strategy’s version compares as major and minor: “1.10” is after 1.9', right, `1.10 before 1.3: ${versionBefore('1.10', '1.3')}; 1.9 before 1.10: ${versionBefore(1.9, '1.10')}`);
  }

  // W5 1.12 (0141, "far too wordy"): long fields are counted, not refused, and a client gets short bullets.
  {
    const { wordyParts, strategyBrief, checkStrategy } = await import('../../lib/enrich/strategy');
    const long = 'An invented angle that runs on and on, clause after clause, restating the route and the ask and the history of every touch we ever had with them before the point.';
    const tight = { angle: 'Backed two invented neuro companies; wrote about closed-loop devices.', route: { via: 'Invented Connector', tier: 'A' as const, why: 'Co-investors twice.' },
      next: { what: 'Ask Invented Connector for an intro', who: 'Invented Owner', when: '2026-10-12' }, risks: ['Raising a fund of their own'], openQuestions: [] };
    const brief = strategyBrief({ ...tight, ask: { vehicle: 'spv-invented', shape: 'SPV', range: null } });
    const wordy = wordyParts({ ...tight, angle: long, risks: ['a', 'b', 'c', 'd'] });
    const refused = checkStrategy({ key: 'k', fit: { x: { verdict: 'good', why: 'w' } }, scores: { capacity: { band: 'unknown', basis: 'b' }, affinity: { level: 'low', basis: 'b' }, propensity: { level: 'low', basis: 'b' }, timeToDecision: { band: 'unknown', basis: 'b' } },
      angle: long, next: tight.next, ask: { vehicle: 'spv-invented', shape: 'SPV' }, list: '2027', route: null, risks: [], openQuestions: [] }, 'k').length;
    check('A wordy strategy is counted, not refused, and reads as short bullets (W5 1.12)',
      wordyParts(tight).length === 0 && wordy.join() === 'angle,risks' && refused === 0 && brief.length === 5 && brief[0] === 'Ask: SPV' && brief[1] === 'Route: Invented Connector (A)',
      `tight: ${wordyParts(tight).join() || 'none'}; wordy: ${wordy.join()}; problems: ${refused}; brief: ${brief.length}`);
  }

  // "This year" rests on the pursuit's own contact (W5 1.10): a recent catch-up about something
  // else keeps the relationship warm, not the raise.
  {
    const { gates } = await import('../../lib/enrich/strategy');
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const s = { list: 'this year' as const, scores: { capacity: { band: 'unknown', basis: '' } } as never, route: null };
    const warmOnly = gates(s, { contact: { lastFromThem: recent, meetings: 0, groupMeetings: 0 }, money: null, pursuits: [{ contact: { lastFromThem: null, meetings: 0 } }] }, null, null);
    const counted = gates(s, { contact: { lastFromThem: recent, meetings: 0, groupMeetings: 0 }, money: null, pursuits: [{ contact: { lastFromThem: recent, meetings: 0 } }] }, null, null);
    const oldExport = gates(s, { contact: { lastFromThem: recent, meetings: 0, groupMeetings: 0 }, money: null }, null, null);
    check('“This year” needs the pursuit’s own evidence: a recent word about something else is not enough',
      warmOnly.includes('this year, without the evidence gate') && !counted.includes('this year, without the evidence gate') && !oldExport.includes('this year, without the evidence gate'),
      `a word from them about something else: ${warmOnly.join(', ') || 'passes'}; about this vehicle: ${counted.join(', ') || 'passes'}; an export without pursuit contact: ${oldExport.join(', ') || 'passes'}`);
  }

  // The loop's own measurements (N70): the critic's rounds from their files — a round in two
  // halves is one round — and the fact check's grades, counted as written.
  {
    const { mkdtemp, writeFile: wfq, rm: rmq } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join: jq } = await import('node:path');
    const { readQuality, roundOf, factRoundOf } = await import('../../lib/enrich/quality');
    const dq = await mkdtemp(jq(tmpdir(), 'quality-'));
    await wfq(jq(dq, 'strategy-review.jsonl'), ['{"key":"a","grade":"B","issues":[{"criterion":2,"what":"x"}]}', '{"key":"b","grade":"C","issues":[]}'].join('\n'));
    await wfq(jq(dq, 'strategy-review-3a.jsonl'), '{"key":"c","grade":"A","issues":[]}\n');
    await wfq(jq(dq, 'strategy-review-3b.jsonl'), '{"key":"d","grade":"A","issues":[]}\nnot json\n');
    await wfq(jq(dq, 'fact-review-01a.jsonl'), '{"key":"a","identity":"holds","facts":[{"i":0,"grade":"supported"},{"i":1,"grade":"partly"},{"i":2,"grade":"unavailable"}]}\n');
    await wfq(jq(dq, 'fact-review-02b.jsonl'), '{"key":"b","identity":"doubt","facts":[{"i":0,"grade":"supported"}]}\n');
    const q = await readQuality(dq);
    await rmq(dq, { recursive: true, force: true });
    const one = q.rounds.find((r) => r.round === 1), three = q.rounds.find((r) => r.round === 3);
    check('The loop’s measurements: a round in two halves is one round, for the critic and the fact check; grades and facts are counted as written; a broken line is skipped',
      roundOf('strategy-review.jsonl') === 1 && roundOf('strategy-review-2.jsonl') === 2 && roundOf('strategy-review-3b.jsonl') === 3 && roundOf('fact-review-01a.jsonl') === null
        && one?.graded === 2 && one.grades.C === 1 && one.byCriterion['2'] === 1 && three?.graded === 2 && three.grades.A === 2
        && factRoundOf('fact-review-02c.jsonl') === 2 && q.facts.length === 2
        && q.facts[0].facts.supported === 1 && q.facts[0].facts.partly === 1 && q.facts[0].facts.unavailable === 1 && q.facts[0].identities.holds === 1
        && q.facts[1].round === 2 && q.facts[1].identities.doubt === 1,
      `rounds ${JSON.stringify(q.rounds.map((r) => [r.round, r.graded]))}; fact rounds ${JSON.stringify(q.facts.map((f) => [f.round, f.findings]))}`);
  }

  // Outside the US, counsel first (W5 1.5, made a gate after the critic's third round): a
  // strategy for an LP placed abroad names counsel; one placed in the US, or placed nowhere,
  // needn't. Assets a firm holds under advice are its clients' money, not the LP's own.
  {
    const { gates } = await import('../../lib/enrich/strategy');
    const contact = { lastFromThem: null, meetings: 2, groupMeetings: 0 };
    const s = (said: string) => ({ list: '2027' as const, scores: { capacity: { band: 'unknown', basis: 'Not public.' } } as never, route: null, next: { what: said }, risks: [], openQuestions: [] });
    const flagged = (said: string, where: string | null) => gates(s(said), { contact, money: null, location: where }, null, null).includes('outside the US, no counsel gate');
    const abroad = flagged('Marc answers his 1 Sep email with the first-close date, by 30 Sep.', 'Berlin, Germany');
    const withCounsel = flagged('Marc asks counsel how a Berlin-based investor is admitted, then answers his email, by 2 Oct.', 'Berlin, Germany');
    const home = flagged('Marc answers his email, by 30 Sep.', 'Austin, Texas');
    const nowhere = flagged('Marc answers his email, by 30 Sep.', null);
    const territory = flagged('Marc answers his email, by 30 Sep.', 'San Juan, Puerto Rico') || flagged('Marc answers his email, by 30 Sep.', 'Boston, U.S.');
    // 7 Oct 2026: a Bay Area town alone, or a city with its state's postal code, is the US.
    const town = flagged('Marc answers his email, by 30 Sep.', 'Palo Alto') || flagged('Marc answers his email, by 30 Sep.', 'Woodside, CA')
      || flagged('Marc answers his email, by 30 Sep.', 'Menlo Park');
    const toronto = flagged('Marc answers his 1 Sep email with the first-close date, by 30 Sep.', 'Toronto, ON');
    // A finding's short place beside our record's full one: the record's "United States" wins.
    const shortPlace = gates(s('Marc answers his email, by 30 Sep.'), { contact, money: null, location: 'Palo Alto, California, United States' }, { identity: { canonical: { location: 'Palo Alto' } } }, null).includes('outside the US, no counsel gate');
    const advised = gates({ list: '2027', scores: { capacity: { band: '$1–5M', basis: '$900M of client assets under advice.' } } as never, route: null }, { contact, money: null }, { profile: { investorType: 'fo_staff', capacity: { band: '$1–5M', basis: '$900M of client assets under advice.' } } }, null).includes('capacity ahead of the evidence');
    // A net worth recorded as a capacity fact is evidence, though the summary only says "a billionaire" (v13a2).
    const billionaire = { profile: { investorType: 'fo_principal', capacity: { band: '$5–25M', basis: 'A billionaire.' } }, facts: [{ field: 'capacity', value: 'Net worth of $2.1B (2025 list).' }] };
    const factBacked = !gates({ list: '2027', scores: { capacity: { band: '$5–25M', basis: 'Net worth on file.' } } as never, route: null }, { contact, money: null }, billionaire, null).includes('capacity ahead of the evidence');
    // A park carries a date to look again (the critic, round four).
    const { parksWithoutDate } = await import('../../lib/enrich/strategy');
    const park = (what: string, lookAgain?: string) => parksWithoutDate({ next: { what, lookAgain } });
    const parks = park('Check sent mail; if nothing went, park him until the search pass.') && !park('Check sent mail; if nothing went, park him until the search pass.', 'Mon 4 Jan 2027')
      && !park('Park him; look again on 4 Jan.') && !park('Answer her email with the first-close date.');
    check('Outside the US, a strategy names counsel; in the US, its territories, or placed nowhere it needn’t; assets under advice are clients’ money; a capacity fact is evidence; a park carries a date',
      abroad && !withCounsel && !home && !nowhere && !territory && !shortPlace && !town && toronto && advised && factBacked && parks,
      `abroad without counsel flagged: ${abroad}; with counsel flagged: ${withCounsel}; in the US flagged: ${home}; a territory or "U.S." flagged: ${territory}; placed nowhere flagged: ${nowhere}; a band on assets under advice flagged: ${advised}; a band on a capacity fact accepted: ${factBacked}; parks read right: ${parks}`);
    // A lapsed park (7 Oct 2026: 1,502 steps overdue): a park whose look-again, or step date, has passed — not a step a person owes.
    const { lapsedPark } = await import('../../lib/enrich/strategy');
    const made = { at: '2026-09-28T10:00:00Z', by: 'claude', workflow: 'W5' as const, version: '1.10' };
    const today = new Date('2026-10-07');
    const lapsed = (what: string, when: string, lookAgain?: string) => lapsedPark({ next: { what, who: 'Juan', when, lookAgain }, made }, today);
    const lapses = lapsed('Park him until the search pass.', 'by Fri 3 Oct') && lapsed('Waits for the fund to close.', 'Mon 6 Jan 2027', 'Fri 3 Oct')
      && !lapsed('Park him until the search pass.', 'Mon 4 Jan 2027') && !lapsed('Answer her email with the first-close date.', 'by Fri 3 Oct')
      && !lapsed('Park him; look again later.', 'when the fund closes');
    check('A lapsed park is a park whose look-again or step date has passed; a person\'s overdue step is not one', lapses, `lapsed parks read right: ${lapses}`);
    // A re-pin to a newer finding (7 Oct 2026: 203 stale on thin refreshes) only when it adds nothing the strategy read.
    const { repinBlockers } = await import('../../lib/enrich/strategy');
    const fact = (value: string) => ({ field: 'role', value });
    const pinnedF = { facts: [fact('Partner at Invented Capital'), fact('Board of Invented Bio')], profile: { investorType: 'vc_partner', capacity: { band: '$1–5M' } } };
    const newerF = (over: object = {}) => ({ researched: { at: '2026-10-06T00:00:00Z' }, facts: [fact('partner at  Invented Capital')], profile: { investorType: 'vc_partner', capacity: { band: '$1–5M' } }, ...over });
    const thin = repinBlockers({ made }, pinnedF, newerF()).length === 0;
    const added = repinBlockers({ made }, pinnedF, newerF({ facts: [fact('Founded Invented Labs')] }));
    const band = repinBlockers({ made }, pinnedF, newerF({ profile: { investorType: 'vc_partner', capacity: { band: '$5–25M' } } }));
    const cut = repinBlockers({ made }, pinnedF, newerF({ researched: { at: '2026-10-06T00:00:00Z', corrected: [{ at: '2026-10-06T00:00:00Z', by: 'W1c', what: 'cut 2 facts' }] } }));
    const oddValue = repinBlockers({ made }, { facts: [{ field: 'capacity', value: 5 as never }] }, { researched: { at: '2026-10-06T00:00:00Z' }, facts: [{ field: 'capacity', value: 5 as never }] }).length === 0;
    const tieOnly = repinBlockers({ made }, pinnedF, newerF({ researched: { at: '2026-10-06T00:00:00Z', corrected: [{ at: '2026-10-06T00:00:00Z', by: 'cold1-04', what: 'connector evidence' }] } })).length === 0;
    check('A newer finding is re-pinned only when it adds no fact, type or band and no correction bears on the strategy',
      thin && added.join() === '1 new fact' && band.join() === 'a different capacity band' && cut.join() === 'a correction since it was written' && tieOnly && oddValue,
      `thin ${thin}; added ${added.join()}; band ${band.join()}; cut ${cut.join()}; tie only ${tieOnly}; a number value read ${oddValue}`);
  }
}

export async function strategyContextProperties(check: Check) {
  // Context from the team (issue 0016, real): a strategy written before the newest context is due a
  // re-think; one written after it is not; with no context, nothing changes.
  {
    const { isStale } = await import('../../lib/enrich/strategy');
    const s = { made: { at: '2026-09-24T10:00:00Z', by: 'claude', workflow: 'W5', version: 1.6 } } as never;
    const newer = isStale(s, null, undefined, undefined, '2026-09-24T13:40:00.123Z');
    const older = isStale(s, null, undefined, undefined, '2026-09-24T09:59:59.999Z');
    const none = isStale(s, null, undefined, undefined, null);
    check('A strategy written before the team’s newest context is due a re-think; one written after it, or with none, is not',
      newer && !older && !none, `context after it: ${newer}; context before it: ${older}; no context: ${none}`);
  }
  {
    // 7 Oct 2026: a note written from one vehicle's pursuit is that vehicle's. A line added for SPV -
    // Science had marked the LP's Neurotech strategy stale too; a note about the LP as a whole still does.
    const { contextAtFor, isStale } = await import('../../lib/enrich/strategy');
    const s = { made: { at: '2026-10-06T10:00:00Z', by: 'claude', workflow: 'W5', version: '1.18' } } as never;
    const spvOnly = [{ at: '2026-10-07T09:00:00Z', vehicle: 'spv-science' }, { at: '2026-10-01T09:00:00Z', vehicle: null }];
    const general = [{ at: '2026-10-07T09:00:00Z', vehicle: null }];
    const otherVehicle = isStale(s, null, undefined, undefined, contextAtFor(spvOnly, 'plc-neurotech-i'));
    const ownVehicle = isStale(s, null, undefined, undefined, contextAtFor(spvOnly, 'spv-science'));
    const wholeLp = isStale(s, null, undefined, undefined, contextAtFor(general, 'plc-neurotech-i'));
    const unknownVehicle = isStale(s, null, undefined, undefined, contextAtFor(spvOnly, null));
    check('Team context written from one vehicle makes only that vehicle’s strategy stale; context about the LP as a whole makes every one stale',
      !otherVehicle && ownVehicle && wholeLp && unknownVehicle,
      `other vehicle: ${otherVehicle}; own vehicle: ${ownVehicle}; whole LP: ${wholeLp}; vehicle unresolved: ${unknownVehicle}`);
    // 7 Oct 2026: the note an intake rule writes when it creates the pursuit stales nothing; a person's later note still does.
    const ruleOnly = isStale(s, null, undefined, undefined, contextAtFor([{ at: '2026-10-07T09:00:00Z', vehicle: 'spv-science', byRule: true }], 'spv-science'));
    const personAfter = isStale(s, null, undefined, undefined, contextAtFor([{ at: '2026-10-07T10:00:00Z', vehicle: null, byRule: true }, { at: '2026-10-07T09:00:00Z', vehicle: null }], 'spv-science'));
    check('An intake rule’s provenance note stales no strategy; a person’s context behind it still does', !ruleOnly && personAfter,
      `rule note alone: ${ruleOnly}; person's note behind a rule note: ${personAfter}`);
  }
}

export async function strategyRegressionProperties(check: Check) {
  {
    // W5 after the search pass: a correction to the finding after the strategy was written makes it
    // stale, though the finding's date — and so the pin — is unchanged.
    const { isStale } = await import('../../lib/enrich/strategy');
    const made = { at: '2026-09-24T12:00:00Z', by: 'claude', workflow: 'W5', version: 1.7, inputs: { finding: '2026-09-24T09:00:00Z' } } as never;
    const before = isStale({ made }, { researched: { at: '2026-09-24T09:00:00Z', corrected: [{ at: '2026-09-24T10:00:00Z' }] } });
    const after = isStale({ made }, { researched: { at: '2026-09-24T09:00:00Z', corrected: [{ at: '2026-09-24T13:00:00Z' }] } });
    check('A strategy written before a correction to its finding is stale; one written after it is not',
      after && !before, `correction before the strategy: ${before ? 'stale' : 'fresh'}; after it: ${after ? 'stale' : 'fresh'}`);
  }
  {
    // 7 Oct 2026: a step whose date had passed counted as fresh; the checker now counts and lists them.
    const { stepDue } = await import('../../lib/enrich/strategy');
    const d = (when: string, made = '2026-09-27T10:00:00Z') => stepDue(when, made)?.toISOString().slice(0, 10) ?? null;
    const r = { short: d('by Fri 3 Oct'), year: d('Mon 6 Oct 2026'), iso: d('2026-10-06'), us: d('Oct 6, 2026'), nextYear: d('Mon 4 Jan', '2026-12-20T00:00:00Z'), none: d('after the first close') };
    check('A next step’s date is read from its words, with the year it was written in unless that falls well before the writing',
      r.short === '2026-10-03' && r.year === '2026-10-06' && r.iso === '2026-10-06' && r.us === '2026-10-06' && r.nextYear === '2027-01-04' && r.none === null,
      JSON.stringify(r));
  }
  {
    // 7 Oct 2026: a new C tie between two LPs moved the best path from none to C and staled strategies whose route
    // nothing had changed. The pin holds when it matches the best over every path or over the paths from our side.
    const { bestTiers, isStale } = await import('../../lib/enrich/strategy');
    const pinned = (bestPath: 'A' | 'B' | 'C' | null) => ({ made: { at: '2026-10-06T12:00:00Z', by: 'claude', workflow: 'W5', version: '1.18', inputs: { finding: null, bestPath } } }) as never;
    const lpOnly = bestTiers([{ lp: 'x', tier: 'C', other: { type: 'lp' } }]);
    const fromTeam = bestTiers([{ lp: 'x', tier: 'C', other: { type: 'team' } }]);
    const upgraded = bestTiers([{ lp: 'x', tier: 'C', other: { type: 'lp' } }, { lp: 'x', tier: 'B', other: { type: 'ours' } }]);
    const r = {
      noneThenLpTie: isStale(pinned(null), null, undefined, lpOnly('x')),
      cFromLpTieStill: isStale(pinned('C'), null, undefined, lpOnly('x')),
      noneThenTeamTie: isStale(pinned(null), null, undefined, fromTeam('x')),
      cThenOursB: isStale(pinned('C'), null, undefined, upgraded('x')),
      noneThenUnresolvedPerson: isStale(pinned(null), null, undefined, bestTiers([{ lp: 'x', tier: 'C', other: { type: 'backer' } }])('x')),
    };
    check('A best-path pin moves only when a tier from our side changes: a new tie between two LPs leaves it standing',
      !r.noneThenLpTie && !r.cFromLpTieStill && r.noneThenTeamTie && r.cThenOursB && !r.noneThenUnresolvedPerson, JSON.stringify(r));
  }
  {
    // 7 Oct 2026: append-only SPV passes and appended ties marked most strategies stale with nothing to rewrite.
    const { isStale } = await import('../../lib/enrich/strategy');
    const made = { at: '2026-10-06T12:00:00Z', by: 'claude', workflow: 'W5', version: '1.18', inputs: { finding: '2026-09-24T09:00:00Z' } } as never;
    const after = (by: string, what: string) => ({ researched: { at: '2026-09-24T09:00:00Z', corrected: [{ at: '2026-10-07T01:00:00Z', by, what }] } });
    const spvFacts = after('Invented worker, SPV round a-1', 'Append-only SPV appetite pass spv-a-1: 2 facts and 3 public queries; prior facts preserved.');
    const spvNone = after('Invented worker, SPV round b-2', 'SPV-b-2 append-only review; 0 new facts; original facts/profile preserved.');
    const ties = after('Invented worker, cold1-04', 'cold1-04 appended connector evidence, exact search queries and coverage; existing facts preserved.');
    const tiesByRound = after('Invented worker, cold1 batch 07', 'Round seven: three sourced relationships recorded.');
    const w1c = after('claude (sub-agent), W1c', 'Append-only SPV note preserved, 2 facts moved to cautions.');
    const merge = after('rule (scripts/enrich-merge-findings.ts)', 'merged 4 facts and 0 connections from the older finding alias-x (2026-09-20) that this one no longer carried');
    const results = {
      spvOnFund: isStale({ made }, spvFacts, undefined, undefined, null, 'fund'),
      spvOnSpv: isStale({ made }, spvFacts, undefined, undefined, null, 'spv'),
      spvUnknownVehicle: isStale({ made }, spvFacts),
      spvNoFacts: isStale({ made }, spvNone, undefined, undefined, null, 'spv'),
      ties: isStale({ made }, ties, undefined, undefined, null, 'spv') || isStale({ made }, tiesByRound, undefined, undefined, null, 'fund'),
      w1cOnFund: isStale({ made }, w1c, undefined, undefined, null, 'fund'),
      merge: isStale({ made }, merge, undefined, undefined, null, 'fund'),
    };
    check('A correction stales only the strategies it bears on: SPV appends with facts the SPV ones, appends with no fact, only ties or a merge of older findings none, the W1c fact check all',
      !results.spvOnFund && results.spvOnSpv && results.spvUnknownVehicle && !results.spvNoFacts && !results.ties && results.w1cOnFund && !results.merge,
      JSON.stringify(results));
  }

  {
    // W5 after the search pass: "a parked page" is a dead domain, not a park; "Parker" is a name.
    const { parksWithoutDate } = await import('../../lib/enrich/strategy');
    const read = (what: string) => parksWithoutDate({ next: { what } });
    const cases: Array<[string, boolean]> = [
      ['Check the address first: the domain is a parked page.', false], ['Email Parker Lee this week.', false],
      ['Park him until the search pass.', true], ['Parked until the fund closes.', true], ['Park him to 4 Jan 2027.', false],
      ['Park him until the search pass; the Form D was filed 3 Jun 2026.', true], ['Park the pursuit until March 2027, then re-read.', false],
      ['Park ADIA to 4 Jan 2027; no fund material.', false],
      ['She waits for the search pass before any note.', true], ['Hold until 4 Jan 2027, then re-read.', false],
      ['Park him to Mon 4 Jan 2027.', false],
    ];
    const wrong = cases.filter(([w, want]) => read(w) !== want);
    check('A park with no date is caught, and a parked domain or a name is not one',
      wrong.length === 0, `${cases.length - wrong.length} of ${cases.length} read right${wrong.length ? `; wrong: ${wrong.map((w) => w[0]).join(' | ')}` : ''}`);
  }

  {
    // W5 after the search pass: a date in May is not a hedge. The hypothetical filter read "(May 2026)"
    // as "may", so a capacity fact dated in May never counted.
    const { hasCapacityEvidence } = await import('../../lib/enrich/strategy');
    const dated = hasCapacityEvidence('Its 13F reports about $5.2 billion in holdings (May 2026).', new Date('2026-09-24'));
    const hedged = hasCapacityEvidence('A first commitment may be $1 million.', new Date('2026-09-24'));
    // And a Form D's "date of first sale" is a date, not a sale.
    const formD = hasCapacityEvidence('Its Form D reports $2.5 million committed to the feeder, date of first sale 3 Jun 2026.', new Date('2026-09-24'));
    check('A capacity fact dated in May counts as evidence; a clause that says "may" does not; a Form D\u2019s first-sale date is no sale',
      dated && !hedged && formD, `dated in May: ${dated ? 'evidence' : 'not evidence'}; "may be": ${hedged ? 'evidence' : 'not evidence'}; a Form D with its first-sale date: ${formD ? 'evidence' : 'not evidence'}`);
  }
}

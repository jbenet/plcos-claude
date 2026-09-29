/** Execution order is part of the fixture contract: do not parallelize these checks. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { freshDb, SCRATCH } from './harness';
import type { Check } from './harness';

export async function runProperties(check: Check) {
  await (await import('../w3-portfolio-properties')).w3PortfolioProperties(check);
  (await import('../w3-routes-properties')).w3RoutesProperties(check);
  (await import('../visualization-scale-properties')).visualizationScaleProperties(check);
  await (await import('./availability')).availabilityProperties(check);
  (await import('../connection-target-properties')).connectionTargetProperties(check);
  (await import('./lp-unit-paths')).lpUnitPathProperties(check);
  (await import('../warehouse-investor-properties')).warehouseInvestorProperties(check);
  (await import('../route-presentation-properties')).routePresentationProperties(check);
  (await import('./routes-layout-0086')).routesLayout0086Properties(check);
  await (await import('../path-search-properties')).pathSearchProperties(check);
  const db = await freshDb();
  await (await import('../dakota-properties')).dakotaProperties(check, db);
  await (await import('../dakota-batched-properties')).dakotaBatchedProperties(check);
  await (await import('../prospects-properties')).prospectsProperties(check, db);
  await (await import('../prospect-keys-properties')).prospectKeysProperties(check, db);
  await (await import('../organization-lps-properties')).organizationLpsProperties(check, db);
  await prospectDispositionProperties(check, db);
  await (await import('../identity-resolution-properties')).identityResolutionProperties(check, db);
  await (await import('../team-identity-properties')).teamIdentityProperties(check, db);
  await (await import('../identity-route-properties')).identityRouteProperties(check, db);
  await (await import('../routes-policy-0084-properties')).routesPolicy0084Properties(check, db);
  await (await import('../import-robustness-properties')).importRobustnessProperties(check, db);
  await (await import('../entity-type-properties')).entityTypeProperties(check, db);
  await (await import('../pursuit-merge-properties')).pursuitMergeProperties(check, db);
  await (await import('../import-dupes-properties')).importDupesProperties(check, db);
  await (await import('../dedupe-rules-properties')).dedupeRulesProperties(check, db);
  await (await import('../person-dupes-properties')).personDupesProperties(check, db);
  await (await import('../identity-review-properties')).identityReviewProperties(check, db);
  await (await import('../path-search-properties')).edgeEvidenceCacheProperties(check, db);
  await (await import('../route-scoring-properties')).routeScoringProperties(check, db);
  await (await import('../issues4-properties')).issues4Properties(check, db);
  await (await import('../plrule-properties')).plRuleProperties(db, check);
  await (await import('../network-nodes-properties')).networkNodesProperties(check, db);
  await (await import('../routes-perf-properties')).routesPerfProperties(check, db);
  const { listEntities } = await import('../../modules/identity');
  const entities = await listEntities();
  const id = (name: string) => entities.find((e) => e.displayName === name)!.entityId;
  const seed = { check, db, id };
  await (await import('./research')).researchProperties(seed);
  await (await import('./network')).networkProperties(seed);
  await (await import('./network')).routeCacheProperties(seed);
  await (await import('../cache-overlay-properties')).cacheOverlayProperties(check, db);
  await (await import('../cache-source-properties')).cacheSourceProperties(check, db);
  await (await import('./network')).routeInputCacheProperties(seed);
  await (await import('./strategy')).strategyProperties(seed);
  await (await import('./vehicle-strategy')).vehicleStrategyProperties(check, db);
  await (await import('./strategy-per-vehicle')).strategyPerVehicleProperties(check, db);
  await (await import('./strategy-moves')).strategyMoveProperties(check, db);
  (await import('./strategy-table-pack')).strategyTablePackProperties(check);
  (await import('./strategy-advice')).strategyAdviceProperties(check);
  await (await import('./meeting-fit')).meetingFitProperties(check, db);
  await (await import('./coordination')).coordinationProperties(seed);
  await (await import('./pipeline')).pipelineProperties(seed);
  await (await import('./scoring')).scoringProperties(seed);
  await (await import('./content')).contentProperties(seed);
  await (await import('./compliance')).complianceProperties(seed);
  await (await import('./close')).closeProperties(seed);
  await (await import('./agents')).agentsProperties(seed);
  await (await import('./coordination')).restrictionProperties(seed);
  await (await import('./fit')).fitProperties(seed);
  await (await import('./tables')).tableProperties(check, db);
  await (await import('./selection-0104')).selection0104Properties(check, db);
  await (await import('./spv-stance')).spvStanceProperties(check, db);
  await (await import('./strategic')).strategicProperties(check, db);
  await (await import('./lp-stats')).lpStatsProperties(check, db);
  await (await import('./lp-unit-paths')).lpUnitPathDatabaseProperties(check, db);
  await (await import('./linear')).linearProperties(check, db);
  await (await import('./authz')).authzProperties(check, db);
  await (await import('./labos')).labosProperties(check, db);
  await (await import('./authz-read')).authzReadProperties(check, db);
  // Last on this database: it re-points every pursuit, then reverses every decision it made.
  await (await import('./lp-units')).lpUnitProperties(check, db);
  await (await import('./lp-unit-decisions')).lpUnitDecisionProperties(check, db);
  await (await import('./security-governance')).securityGovernanceProperties(check, db);
  await (await import('./security-mutations')).securityMutationProperties(check, db);
  await db.close();

  await (await import('./pipeline')).hardeningVariations(check);
  await (await import('./scoring')).scoringVariations(check);
  await (await import('./content')).contentVariations(check);
  await (await import('./compliance')).verificationVariations(check);
  await (await import('./agents')).agentVariations(check);
  await (await import('./coordination')).grantVariations(check);
  await (await import('./network')).networkVariations(check);

  const affinity = await (await import('./affinity-fixtures')).affinityFixtures(check);
  await (await import('./affinity')).affinityProperties(affinity);
  await rm(join(process.cwd(), SCRATCH), { recursive: true, force: true });

  await (await import('./deployment')).profileProperties(check);
  await (await import('./issues')).issueProperties(check);
  await (await import('./render')).renderProperties(check);
  await (await import('./deployment')).checkoutProperties(check);
  await (await import('./navigation')).proxyProperties(check);
  await (await import('./security-routing')).securityRoutingProperties(check);
  await (await import('./security-entrypoints')).securityEntrypointProperties(check);
  await (await import('./identity')).headingProperties(check);
  await (await import('./enrichment-strategy')).strategyContextProperties(check);
  await (await import('./scoring')).provisionalScoreProperties(check);
  await (await import('./theme')).themeProperties(check);
  await (await import('./navigation')).pathProperties(check);
  await (await import('./developer')).developerProperties(check);
  await (await import('./enrichment-strategy')).strategyRegressionProperties(check);
  await (await import('./enrichment')).brokerProperties(check);
  await (await import('./viewport')).viewportProperties(check);
  await (await import('./meetings')).directContactProperties(check);
  await (await import('./docs')).docsProperties(check);
  await (await import('./markdown')).markdownProperties(check);

  const { workflowProperties } = await import('../workflow-properties');
  await workflowProperties(check);
  const { workflowUsageProperties } = await import('../workflow-usage-properties');
  await workflowUsageProperties(check);
}

/** Dispositions are delegated planning decisions, tested only with invented records. */
export async function prospectDispositionProperties(check: Check, db: Awaited<ReturnType<typeof freshDb>>) {
  const { addProspects } = await import('../../lib/enrich/prospects');
  const { setStatus } = await import('../../modules/strategy');
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const vehicle = (await db.one<{ id: string; slug: string }>("select id::text, slug from platform.vehicle where phase <> 'historical' order by slug limit 1"))!;
  const ids: string[] = [];
  const rows: import('../../lib/enrich/prospects').Prospect[] = [];
  for (const suffix of ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir']) {
    const name = `Invented Disposition ${suffix}`;
    const { id } = (await db.one<{ id: string }>("insert into identity.entity (entity_type, display_name) values ('person', $1) returning entity_id::text id", [name]))!;
    ids.push(id);
    rows.push({ personKey: id, name, org: null, vehicle: vehicle.slug, status: 'new',
      capacity: { band: '$500K–$1M', basis: 'Invented estimate', guess: true },
      strategic: false, reason: 'Invented vehicle fit', route: null, sources: ['https://example.org/disposition'] });
  }
  const files = (...input: unknown[]) => [{ file: 'invented-disposition.jsonl', text: input.map(r => JSON.stringify(r)).join('\n') }];
  const count = async (table: string) => Number((await db.one<{ n: string }>(`select count(*)::text n from ${table}`))!.n);
  const ladder = await count('strategy.ladder_event'), tickets = await count('governance.approval_ticket');
  const snapshot = async () => JSON.stringify({
    pursuits: await db.query('select * from strategy.pursuit where entity_id = any($1::uuid[]) order by pursuit_id', [ids]),
    audits: await db.query('select * from platform.audit_log order by id'),
    notes: await db.query('select * from research.note where entity_id = any($1::uuid[]) order by note_id', [ids]),
  });
  try {
    await addProspects(db, actor, files(...rows));
    const pursuit = async (index: number) => (await db.one<{ id: string }>('select pursuit_id::text id from strategy.pursuit where entity_id=$1 and vehicle_id=$2', [ids[index], vehicle.id]))!.id;
    const sourcing = { ...rows[0]!, status: 'sourcing' as const, reason: 'Invented estimate meets the $500K check bar.' };
    const passed = { ...rows[1]!, status: 'passed' as const, reason: 'Invented check below $500K with no strategic value.' };
    const moved = await addProspects(db, actor, files(sourcing, sourcing, passed, passed));
    const a = await pursuit(0), b = await pursuit(1);
    const audits = await db.query<{ detail: Record<string, unknown> }>("select detail from platform.audit_log where subject_id = any($1::text[]) and action='pursuit.status_set'", [[a, b]]);
    const closed = await db.one<{ status_source: string; status_reason: string; passed_by: string; closed_at: unknown; status_set_at: unknown; status_set_by: string }>('select * from strategy.pursuit where pursuit_id=$1', [b]);
    check('DISPOSITION rule moves record the UI status history, rule, date and reason once per pursuit',
      moved.moved === 2 && moved.toSourcing === 1 && moved.toPassed === 1 && audits.length === 2
      && audits.every(r => r.detail.fromId === 'new' && r.detail.from === 'New' && r.detail.statusSource === 'rule'
        && r.detail.rule === 'juan-prospects-2026-09-26' && typeof r.detail.inputHash === 'string'
        && !!r.detail.entity && !!r.detail.vehicle && !!r.detail.to)
      && closed?.status_source === 'rule' && closed.status_reason === `juan-prospects-2026-09-26: ${passed.reason}`
      && closed.passed_by === 'us' && !!closed.closed_at && !!closed.status_set_at && closed.status_set_by === actor,
      `${moved.moved} moves, ${audits.length} status audits; pass closes with our reason.`);
    const beforeRetry = await snapshot();
    const retry = await addProspects(db, actor, files(sourcing, sourcing, passed, passed));
    const noChange = await addProspects(db, actor, files({ ...sourcing, reason: 'Edited evidence, same disposition' }));
    check('DISPOSITION duplicate rows and idempotent reruns leave rows, timestamps, notes and audits unchanged',
      retry.moved === 0 && retry.existing === 2 && noChange.moved === 0 && beforeRetry === await snapshot(),
      'Compared entire pursuit rows and audit history, including timestamps.');

    const beforeInvalid = await snapshot();
    const invalid = await addProspects(db, actor, files(...['', '  ', null, undefined].map(reason => ({ ...sourcing, status: 'passed', reason }))));
    check('DISPOSITION passed without a nonblank reason is refused before any writes',
      invalid.invalid.length === 4 && invalid.moved === 0 && invalid.added === 0 && beforeInvalid === await snapshot(),
      'Empty, whitespace, null and absent pass reasons refused.');

    // The actual UI command can reverse a rule, and even a later provenance reset cannot erase its history.
    await setStatus(actor, a, { status: 'new', reason: 'Invented person decision' }, { q: db });
    await setStatus(actor, b, { status: 'sourcing', reason: 'Invented person reopens it' }, { q: db });
    await db.query("update strategy.pursuit set status_source='rule' where pursuit_id=$1", [b]);
    const c = await pursuit(2), d = await pursuit(3);
    await db.query("update strategy.pursuit set source='affinity' where pursuit_id=$1", [c]);
    await db.query("update strategy.pursuit set status_source='us' where pursuit_id=$1", [d]);
    const beforeHuman = await snapshot();
    const kept = await addProspects(db, actor, files(sourcing, passed, { ...rows[3]!, status: 'passed' }));
    check('DISPOSITION a person-set status is never overwritten, including when provenance later says rule',
      kept.kept === 3 && kept.moved === 0 && beforeHuman === await snapshot(),
      'UI reversal, legacy unmarked status history and human provenance all protected.');
    const otherSource = await addProspects(db, actor, files({ ...rows[2]!, status: 'passed' }));
    check('DISPOSITION later rule dispositions apply independently of the pursuit source',
      otherSource.moved === 1 && otherSource.toPassed === 1,
      'A rule-set pursuit imported from Affinity is eligible; human decisions remain protected.');

    const reopen = await addProspects(db, actor, files({ ...rows[4]!, status: 'passed' }));
    const reopenNew = await addProspects(db, actor, files(rows[4]!));
    const reopened = await db.one<{ status: string; passed_by: string | null; closed_at: unknown; close_reason: unknown }>('select * from strategy.pursuit where entity_id=$1 and vehicle_id=$2', [ids[4], vehicle.id]);
    check('DISPOSITION rule history permits later rule movement in either direction and clears closure',
      reopen.toPassed === 1 && reopenNew.moved === 1 && reopened?.status === 'new'
      && reopened.passed_by === null && reopened.closed_at === null && reopened.close_reason === null,
      'Rule-only Passed → New is reversible without a ticket.');
    const conflicting = files({ ...rows[5]!, status: 'passed' }, { ...rows[5]!, status: 'sourcing' });
    const conflict = await addProspects(db, actor, conflicting);
    const afterConflict = await snapshot();
    const conflictRetry = await addProspects(db, actor, conflicting);
    check('DISPOSITION later line wins conflicting input statuses without oscillating on rerun',
      conflict.skipped.length === 0 && conflict.moved === 1 && conflictRetry.existing === 1 && afterConflict === await snapshot(),
      'Later line selects Sourcing and records its winning file; repeated inputs are silent.');
    const dated = [
      { file: '2026-09-27-z-invented.jsonl', mtimeMs: 1000, text: '\n\n' + JSON.stringify({ ...rows[5]!, status: 'sourcing' }) },
      { file: '2026-09-27-a-invented.jsonl', mtimeMs: 2000, text: JSON.stringify({ ...rows[5]!, status: 'passed' }) },
    ];
    await addProspects(db, actor, dated);
    const datedBefore = await snapshot();
    const datedRetry = await addProspects(db, actor, [...dated].reverse());
    const winner = await db.one<{ detail: Record<string, unknown> }>(`select detail from platform.audit_log
      where subject_id=$1 and action='pursuit.status_set' and detail->>'file'=$2`, [await pursuit(5), dated[1]!.file]);
    check('DISPOSITION same-date files use modification time before filename and line, independently of import order',
      datedRetry.existing === 1 && datedRetry.moved === 0 && datedBefore === await snapshot()
      && winner?.detail.toId === 'passed' && winner.detail.line === 1,
      'Later modification time beats the longer file and reverse lexical filenames; winning file/line audited.');
    check('DISPOSITION every superseded row is counted by file and linked to its winner even on unchanged reruns',
      datedRetry.losers.length === 1 && datedRetry.losers[0]?.file === dated[0]!.file
      && datedRetry.losers[0]?.line === 3 && datedRetry.losers[0]?.winner.file === dated[1]!.file
      && datedRetry.perFile.find(f => f.file === dated[0]!.file)?.lost === 1
      && datedRetry.perFile.find(f => f.file === dated[0]!.file)?.won === 0
      && datedRetry.perFile.find(f => f.file === dated[1]!.file)?.won === 1
      && datedRetry.perFile.find(f => f.file === dated[1]!.file)?.lost === 0,
      'One winner and one loser reported with source lines, including an unchanged winning status.');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { ProspectPrecedence } = await import('../../components/import-jobs/ProspectPrecedence');
    const many = await addProspects(db, actor, files(...Array.from({ length: 8 }, () => rows[5]!), { ...rows[5]!, status: 'passed' }));
    const report = { perFile: many.perFile, losers: many.losers, lost: many.losers.length };
    const directHtml = renderToStaticMarkup(createElement(ProspectPrecedence, { report }));
    const queuedHtml = renderToStaticMarkup(createElement(ProspectPrecedence, { report: { ...report, losers: report.losers.slice(0, 5) } }));
    check('DISPOSITION immediate and background receipts show file counts and the first five losers with the full count',
      many.perFile[0]?.won === 1 && many.perFile[0]?.lost === 8 && directHtml === queuedHtml
      && directHtml.includes('8 rows lost precedence') && directHtml.includes('showing 5 of 8')
      && directHtml.includes('1 won') && directHtml.includes('8 lost') && directHtml.includes('line 5')
      && !directHtml.includes('line 6'),
      'Both receipt paths share the same bounded rendering; every loser remains counted.');

    const selectedStatus = async () => (await db.one<{ status: string }>(
      'select status::text from strategy.pursuit where entity_id=$1 and vehicle_id=$2', [ids[5], vehicle.id]))!.status;
    const explicit = { file: 'a-explicit.jsonl', mtimeMs: 1, text: JSON.stringify({ ...rows[5]!, status: 'sourcing', decidedAt: '2026-09-27T12:00:00Z' }) };
    const laterFile = { file: 'z-recent.jsonl', mtimeMs: 9999999999999, text: JSON.stringify({ ...rows[5]!, status: 'passed' }) };
    await addProspects(db, actor, [laterFile, explicit]);
    const explicitWins = await selectedStatus() === 'sourcing';
    await addProspects(db, actor, [explicit, { ...laterFile, text: JSON.stringify({ ...rows[5]!, status: 'passed', decidedAt: '2026-09-27T12:30:00+01:00' }) }]);
    check('DISPOSITION explicit decidedAt wins over absent timestamps and earlier decisions despite later mtime',
      explicitWins && await selectedStatus() === 'sourcing', 'Timestamp priority uses actual instants, including timezone offsets.');

    const tie = [
      { file: 'a-tie.jsonl', mtimeMs: 3000, text: '\n\n' + JSON.stringify({ ...rows[5]!, status: 'sourcing' }) },
      { file: 'z-tie.jsonl', mtimeMs: 3000, text: JSON.stringify({ ...rows[5]!, status: 'passed' }) },
    ];
    await addProspects(db, actor, tie);
    check('DISPOSITION filename breaks equal-time ties before line number', await selectedStatus() === 'passed',
      'Line 1 in z-tie wins over line 3 in a-tie.');

    for (const status of ['sourcing', 'passed'] as const) {
      const research = { file: 'a-research.jsonl', mtimeMs: 1, text: JSON.stringify({ ...rows[5]!, status }) };
      const intake = { file: 'z-intake.jsonl', mtimeMs: 9000, text: '\n\n' + JSON.stringify({ ...rows[5]!, decidedAt: '2026-09-28T00:00:00Z' }) };
      const first = await addProspects(db, actor, [research, intake]);
      const second = await addProspects(db, actor, [intake, research]);
      check(`DISPOSITION researched ${status} beats New regardless of order, timestamp, mtime and line`,
        await selectedStatus() === status && first.losers[0]?.file === intake.file && second.losers[0]?.file === intake.file,
        'New intake cannot silently replace a supplied researched decision.');
    }
    const humanWithConflicts = await addProspects(db, actor, files(
      rows[0]!, { ...sourcing, decidedAt: '2026-09-29T00:00:00Z' }));
    check('DISPOSITION person-set status survives researched winners and still reports input losers',
      humanWithConflicts.kept === 1 && humanWithConflicts.moved === 0 && humanWithConflicts.losers.length === 1
      && (await db.one<{ status: string }>('select status::text from strategy.pursuit where pursuit_id=$1', [a]))?.status === 'new',
      'Input selection does not override a person.');
    const badTimes = await addProspects(db, actor, files(...['not-a-date', '2026-09-27', '2026-09-27T12:00:00', null].map(decidedAt => ({ ...rows[5]!, decidedAt }))));
    check('DISPOSITION invalid decidedAt is reported instead of silently changing precedence',
      badTimes.invalid.length === 4 && badTimes.moved === 0 && badTimes.perFile[0]?.won === 0,
      'Only ISO timestamps with a timezone are accepted.');
    // A newly inserted Passed row needs the same closing semantics as a moved one.
    await db.query('delete from research.note where entity_id=$1', [ids[5]]);
    await db.query('delete from strategy.pursuit where entity_id=$1', [ids[5]]);
    const addedPass = await addProspects(db, actor, files({ ...rows[5]!, status: 'passed' }));
    const inserted = await db.one<{ passed_by: string; closed_at: unknown; status_reason: string }>('select * from strategy.pursuit where entity_id=$1', [ids[5]]);
    check('DISPOSITION new Passed pursuits retain a traceable rule reason and close as our decision',
      addedPass.added === 1 && inserted?.passed_by === 'us' && !!inserted.closed_at
      && inserted.status_reason.startsWith('juan-prospects-2026-09-26: '), 'Initial pass recorded without implying an investor decline.');
    check('DISPOSITION no ladder rung or approval ticket is written',
      ladder === await count('strategy.ladder_event') && tickets === await count('governance.approval_ticket'),
      'All insertions, movements, refusals, human reversals and reruns leave ladder and ticket counts unchanged.');
  } finally {
    await db.query('delete from research.note where entity_id = any($1::uuid[])', [ids]);
    await db.query('delete from strategy.pursuit where entity_id = any($1::uuid[])', [ids]);
    await db.query('delete from identity.source_record where entity_id = any($1::uuid[])', [ids]);
    await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [ids]);
  }
}

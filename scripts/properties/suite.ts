/** Execution order is part of the fixture contract: do not parallelize these checks. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { freshDb, SCRATCH, step } from './harness';
import type { Check } from './harness';

export async function runProperties(check: Check) {
  await step('w3-portfolio-properties.w3PortfolioProperties', async () => (await import('../w3-portfolio-properties')).w3PortfolioProperties(check));
  await step('w3-routes-properties.w3RoutesProperties', async () => (await import('../w3-routes-properties')).w3RoutesProperties(check));
  await step('visualization-scale-properties.visualizationScaleProperties', async () => (await import('../visualization-scale-properties')).visualizationScaleProperties(check));
  await step('availability.availabilityProperties', async () => (await import('./availability')).availabilityProperties(check));
  await step('shared-memo.sharedMemoProperties', async () => (await import('./shared-memo')).sharedMemoProperties(check));
  await step('connection-target-properties.connectionTargetProperties', async () => (await import('../connection-target-properties')).connectionTargetProperties(check));
  await step('lp-unit-paths.lpUnitPathProperties', async () => (await import('./lp-unit-paths')).lpUnitPathProperties(check));
  await step('warehouse-investor-properties.warehouseInvestorProperties', async () => (await import('../warehouse-investor-properties')).warehouseInvestorProperties(check));
  await step('route-presentation-properties.routePresentationProperties', async () => (await import('../route-presentation-properties')).routePresentationProperties(check));
  await step('routes-layout-0086.routesLayout0086Properties', async () => (await import('./routes-layout-0086')).routesLayout0086Properties(check));
  await step('routes-through.routesThroughProperties', async () => (await import('./routes-through')).routesThroughProperties(check));
  await step('path-search-properties.pathSearchProperties', async () => (await import('../path-search-properties')).pathSearchProperties(check));
  await step('create-match.creationProperties', async () => (await import('./create-match')).creationProperties(check));
  const db = await freshDb();
  await step('identity-roots.identityRootProperties', async () => (await import('./identity-roots')).identityRootProperties(check, db));
  await step('create-match-connectors.connectorCreationProperties', async () => (await import('./create-match-connectors')).connectorCreationProperties(check, db));
  await step('create-match-network-properties.createMatchNetworkProperties', async () => (await import('../create-match-network-properties')).createMatchNetworkProperties(check));
  await step('dakota-properties.dakotaProperties', async () => (await import('../dakota-properties')).dakotaProperties(check, db));
  await step('dakota-batched-properties.dakotaBatchedProperties', async () => (await import('../dakota-batched-properties')).dakotaBatchedProperties(check));
  await step('prospects-properties.prospectsProperties', async () => (await import('../prospects-properties')).prospectsProperties(check, db));
  await step('prospect-keys-properties.prospectKeysProperties', async () => (await import('../prospect-keys-properties')).prospectKeysProperties(check, db));
  await step('organization-lps-properties.organizationLpsProperties', async () => (await import('../organization-lps-properties')).organizationLpsProperties(check, db));
  await prospectDispositionProperties(check, db);
  await step('identity-resolution-properties.identityResolutionProperties', async () => (await import('../identity-resolution-properties')).identityResolutionProperties(check, db));
  await step('team-identity-properties.teamIdentityProperties', async () => (await import('../team-identity-properties')).teamIdentityProperties(check, db));
  await step('identity-route-properties.identityRouteProperties', async () => (await import('../identity-route-properties')).identityRouteProperties(check, db));
  await step('routes-policy-0084-properties.routesPolicy0084Properties', async () => (await import('../routes-policy-0084-properties')).routesPolicy0084Properties(check, db));
  await step('import-robustness-properties.importRobustnessProperties', async () => (await import('../import-robustness-properties')).importRobustnessProperties(check, db));
  await step('entity-type-properties.entityTypeProperties', async () => (await import('../entity-type-properties')).entityTypeProperties(check, db));
  await step('pursuit-merge-properties.pursuitMergeProperties', async () => (await import('../pursuit-merge-properties')).pursuitMergeProperties(check, db));
  await step('import-dupes-properties.importDupesProperties', async () => (await import('../import-dupes-properties')).importDupesProperties(check, db));
  await step('dedupe-rules-properties.dedupeRulesProperties', async () => (await import('../dedupe-rules-properties')).dedupeRulesProperties(check, db));
  await step('separation-bulk-properties.separationBulkProperties', async () => (await import('../separation-bulk-properties')).separationBulkProperties(check, db));
  await step('separation-guards-properties.separationGuardsProperties', async () => (await import('../separation-guards-properties')).separationGuardsProperties(check, db));
  await step('person-dupes-properties.personDupesProperties', async () => (await import('../person-dupes-properties')).personDupesProperties(check, db));
  await step('identity-review-properties.identityReviewProperties', async () => (await import('../identity-review-properties')).identityReviewProperties(check, db));
  await step('path-search-properties.edgeEvidenceCacheProperties', async () => (await import('../path-search-properties')).edgeEvidenceCacheProperties(check, db));
  await step('route-scoring-properties.routeScoringProperties', async () => (await import('../route-scoring-properties')).routeScoringProperties(check, db));
  await step('issues4-properties.issues4Properties', async () => (await import('../issues4-properties')).issues4Properties(check, db));
  await step('plrule-properties.plRuleProperties', async () => (await import('../plrule-properties')).plRuleProperties(db, check));
  await db.transaction(async tx => (await import('../network-nodes-properties')).networkNodesProperties(check, tx));
  await step('routes-perf-properties.routesPerfProperties', async () => (await import('../routes-perf-properties')).routesPerfProperties(check, db));
  const { listEntities } = await import('../../modules/identity');
  const entities = await listEntities();
  const id = (name: string) => entities.find((e) => e.displayName === name)!.entityId;
  const seed = { check, db, id };
  await step('research.researchProperties', async () => (await import('./research')).researchProperties(seed));
  await step('network.networkProperties', async () => (await import('./network')).networkProperties(seed));
  await step('network.routeCacheProperties', async () => (await import('./network')).routeCacheProperties(seed));
  await step('cache-overlay-properties.cacheOverlayProperties', async () => (await import('../cache-overlay-properties')).cacheOverlayProperties(check, db));
  await step('cache-source-properties.cacheSourceProperties', async () => (await import('../cache-source-properties')).cacheSourceProperties(check, db));
  await step('network.routeInputCacheProperties', async () => (await import('./network')).routeInputCacheProperties(seed));
  await step('routes-through.routesThroughDatabaseProperties', async () => (await import('./routes-through')).routesThroughDatabaseProperties(seed));
  await step('strategy.strategyProperties', async () => (await import('./strategy')).strategyProperties(seed));
  await step('vehicle-strategy.vehicleStrategyProperties', async () => (await import('./vehicle-strategy')).vehicleStrategyProperties(check, db));
  await step('strategy-per-vehicle.strategyPerVehicleProperties', async () => (await import('./strategy-per-vehicle')).strategyPerVehicleProperties(check, db));
  await step('strategy-moves.strategyMoveProperties', async () => (await import('./strategy-moves')).strategyMoveProperties(check, db));
  await step('strategy-table-pack.strategyTablePackProperties', async () => (await import('./strategy-table-pack')).strategyTablePackProperties(check));
  await step('strategy-advice.strategyAdviceProperties', async () => (await import('./strategy-advice')).strategyAdviceProperties(check));
  await step('meeting-fit.meetingFitProperties', async () => (await import('./meeting-fit')).meetingFitProperties(check, db));
  await step('coordination.coordinationProperties', async () => (await import('./coordination')).coordinationProperties(seed));
  await step('pipeline.pipelineProperties', async () => (await import('./pipeline')).pipelineProperties(seed));
  await step('scoring.scoringProperties', async () => (await import('./scoring')).scoringProperties(seed));
  await step('content.contentProperties', async () => (await import('./content')).contentProperties(seed));
  await step('compliance.complianceProperties', async () => (await import('./compliance')).complianceProperties(seed));
  await step('close.closeProperties', async () => (await import('./close')).closeProperties(seed));
  await step('agents.agentsProperties', async () => (await import('./agents')).agentsProperties(seed));
  await step('coordination.restrictionProperties', async () => (await import('./coordination')).restrictionProperties(seed));
  await step('fit.fitProperties', async () => (await import('./fit')).fitProperties(seed));
  await step('tables.tableProperties', async () => (await import('./tables')).tableProperties(check, db));
  await step('selection-0104.selection0104Properties', async () => (await import('./selection-0104')).selection0104Properties(check, db));
  await step('spv-stance.spvStanceProperties', async () => (await import('./spv-stance')).spvStanceProperties(check, db));
  await step('strategic.strategicProperties', async () => (await import('./strategic')).strategicProperties(check, db));
  await step('lp-stats.lpStatsProperties', async () => (await import('./lp-stats')).lpStatsProperties(check, db));
  await step('lp-unit-paths.lpUnitPathDatabaseProperties', async () => (await import('./lp-unit-paths')).lpUnitPathDatabaseProperties(check, db));
  await step('linear.linearProperties', async () => (await import('./linear')).linearProperties(check, db));
  await step('email.emailProperties', async () => (await import('./email')).emailProperties(check, db));
  await step('email-guidelines.emailGuidelineProperties', async () => (await import('./email-guidelines')).emailGuidelineProperties(check, db));
  await step('authz.authzProperties', async () => (await import('./authz')).authzProperties(check, db));
  await step('labos.labosProperties', async () => (await import('./labos')).labosProperties(check, db));
  await step('authz-read.authzReadProperties', async () => (await import('./authz-read')).authzReadProperties(check, db));
  // Last on this database: it re-points every pursuit, then reverses every decision it made.
  await step('lp-units.lpUnitProperties', async () => (await import('./lp-units')).lpUnitProperties(check, db));
  await step('lp-unit-decisions.lpUnitDecisionProperties', async () => (await import('./lp-unit-decisions')).lpUnitDecisionProperties(check, db));
  await step('security-governance.securityGovernanceProperties', async () => (await import('./security-governance')).securityGovernanceProperties(check, db));
  await step('security-mutations.securityMutationProperties', async () => (await import('./security-mutations')).securityMutationProperties(check, db));
  // Last: it leaves invented users inactive and tokens revoked, since the audit log keeps them.
  await step('mcp.mcpProperties', async () => (await import('./mcp')).mcpProperties(check, db));
  // The mail desk's API (docs/27): indicated amounts, the outreach routes, tokens and redaction.
  await step('outreach.outreachProperties', async () => (await import('./outreach')).outreachProperties(check, db));
  await step('outreach-api.outreachReadProperties', async () => (await import('./outreach-api')).outreachReadProperties(check, db));
  await step('outreach-writes.outreachWriteProperties', async () => (await import('./outreach-writes')).outreachWriteProperties(check, db));
  await step('outreach-mcp.outreachMcpProperties', async () => (await import('./outreach-mcp')).outreachMcpProperties(check, db));
  // The comms trace and who needs a ticket (5 Oct 2026, docs/27 §5–§7).
  await step('comms.commsProperties', async () => (await import('./comms')).commsProperties(check, db));
  // The desk's second round (5 Oct 2026, docs/27 §4–§4b): hop ids and addresses, top connectors, REST routes, passed LPs, paging.
  await step('outreach-desk.outreachDeskProperties', async () => (await import('./outreach-desk')).outreachDeskProperties(check, db));
  // The desk's third round (5 Oct 2026, docs/27 §4a–§4c, §5): askFirst, first-hop connectors and their targets, ask history,
  // one message linked to several LPs, signedCount.
  await step('outreach-desk-v3.outreachDeskV3Properties', async () => (await import('./outreach-desk-v3')).outreachDeskV3Properties(check, db));
  // Cloud pull and push (docs/deploy/railway.md §6–§7): sync tokens, the push checks, and on Postgres the round trip.
  await step('sync.syncProperties', async () => (await import('./sync')).syncProperties(check, db));
  // Settings, /setup and Google sign-in (docs/deploy/railway.md §3). Last: it leaves two invented users inactive.
  // A person's addresses (migration 019): login, default-to and aliases.
  await step('team-addresses.teamAddressProperties', async () => (await import('./team-addresses')).teamAddressProperties(check, db));
  // The page warm-up behind Google sign-in (lib/auth/warm.ts).
  await step('warm-session.warmSessionProperties', async () => (await import('./warm-session')).warmSessionProperties(check, db));
  await step('railway-setup.railwaySetupProperties', async () => (await import('./railway-setup')).railwaySetupProperties(check, db));
  // A vehicle added in the app, and prospects pushed from the Mac into it (5 Oct 2026). After the rest: it adds vehicles.
  await step('cloud-vehicle-prospects.cloudVehicleProspectsProperties', async () => (await import('./cloud-vehicle-prospects')).cloudVehicleProspectsProperties(check, db));
  await db.close();

  await step('pipeline.hardeningVariations', async () => (await import('./pipeline')).hardeningVariations(check));
  await step('scoring.scoringVariations', async () => (await import('./scoring')).scoringVariations(check));
  await step('content.contentVariations', async () => (await import('./content')).contentVariations(check));
  await step('compliance.verificationVariations', async () => (await import('./compliance')).verificationVariations(check));
  await step('agents.agentVariations', async () => (await import('./agents')).agentVariations(check));
  await step('coordination.grantVariations', async () => (await import('./coordination')).grantVariations(check));
  await step('network.networkVariations', async () => (await import('./network')).networkVariations(check));

  const affinity = await (await import('./affinity-fixtures')).affinityFixtures(check);
  await step('affinity.affinityProperties', async () => (await import('./affinity')).affinityProperties(affinity));
  await rm(join(process.cwd(), SCRATCH), { recursive: true, force: true });

  await step('deployment.profileProperties', async () => (await import('./deployment')).profileProperties(check));
  await step('issues.issueProperties', async () => (await import('./issues')).issueProperties(check));
  await step('render.renderProperties', async () => (await import('./render')).renderProperties(check));
  await step('deployment.checkoutProperties', async () => (await import('./deployment')).checkoutProperties(check));
  await step('navigation.proxyProperties', async () => (await import('./navigation')).proxyProperties(check));
  await step('security-routing.securityRoutingProperties', async () => (await import('./security-routing')).securityRoutingProperties(check));
  await step('security-entrypoints.securityEntrypointProperties', async () => (await import('./security-entrypoints')).securityEntrypointProperties(check));
  await step('identity.headingProperties', async () => (await import('./identity')).headingProperties(check));
  await step('enrichment-strategy.strategyContextProperties', async () => (await import('./enrichment-strategy')).strategyContextProperties(check));
  await step('scoring.provisionalScoreProperties', async () => (await import('./scoring')).provisionalScoreProperties(check));
  await step('theme.themeProperties', async () => (await import('./theme')).themeProperties(check));
  await step('navigation.pathProperties', async () => (await import('./navigation')).pathProperties(check));
  await step('developer.developerProperties', async () => (await import('./developer')).developerProperties(check));
  await step('enrichment-strategy.strategyRegressionProperties', async () => (await import('./enrichment-strategy')).strategyRegressionProperties(check));
  await step('enrichment.brokerProperties', async () => (await import('./enrichment')).brokerProperties(check));
  await step('viewport.viewportProperties', async () => (await import('./viewport')).viewportProperties(check));
  await step('meetings.directContactProperties', async () => (await import('./meetings')).directContactProperties(check));
  await step('docs.docsProperties', async () => (await import('./docs')).docsProperties(check));
  await step('markdown.markdownProperties', async () => (await import('./markdown')).markdownProperties(check));

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

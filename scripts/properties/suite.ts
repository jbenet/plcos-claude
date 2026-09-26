/** Execution order is part of the fixture contract: do not parallelize these checks. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { freshDb, SCRATCH } from './harness';
import type { Check } from './harness';

export async function runProperties(check: Check) {
  (await import('../warehouse-investor-properties')).warehouseInvestorProperties(check);
  (await import('../route-presentation-properties')).routePresentationProperties(check);
  await (await import('../path-search-properties')).pathSearchProperties(check);
  const db = await freshDb();
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
  await (await import('./coordination')).coordinationProperties(seed);
  await (await import('./pipeline')).pipelineProperties(seed);
  await (await import('./scoring')).scoringProperties(seed);
  await (await import('./content')).contentProperties(seed);
  await (await import('./compliance')).complianceProperties(seed);
  await (await import('./close')).closeProperties(seed);
  await (await import('./agents')).agentsProperties(seed);
  await (await import('./coordination')).restrictionProperties(seed);
  await (await import('./fit')).fitProperties(seed);
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
  await (await import('./deployment')).checkoutProperties(check);
  await (await import('./navigation')).proxyProperties(check);
  await (await import('./identity')).headingProperties(check);
  await (await import('./enrichment-strategy')).strategyContextProperties(check);
  await (await import('./scoring')).provisionalScoreProperties(check);
  await (await import('./theme')).themeProperties(check);
  await (await import('./navigation')).pathProperties(check);
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

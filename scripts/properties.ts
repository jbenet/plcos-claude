/** Run the module properties, in their fixture-dependent order. npm run props */
// Route-handler properties import Next request APIs before the renderer does.
// Match Next's Node bootstrap so those modules capture real AsyncLocalStorage.
import 'next/dist/server/node-environment-baseline';
import { registerHooks } from 'node:module';

// Components keep their styles in CSS modules (issue 0066). Next compiles those; Node cannot,
// so for a property that renders a component, a stylesheet is a map from each class name to
// itself. Registered before the suite is imported, which is why the suite loads dynamically.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: "export default new Proxy({}, { get: (_, k) => (typeof k === 'string' ? k : undefined) });",
      };
    }
    return next(url, context);
  },
});

// The harness deletes its scratch database: always use fictional demo data.
process.env.DATA_PROFILE = 'demo';
process.env.PGLITE_DIR = './data/demo/props';
// DATABASE_URL selects the same complete suite on disposable local Postgres.

// The property groups still awaiting, outermost first, for the unfinished message below.
let running: () => string[] = () => [];
async function main() {
  const harness = await import('./properties/harness');
  const { step } = harness;
  running = () => [...harness.runningSteps];
  const { resetTestPostgres, cleanTestPostgres } = await import('./properties/database');
  await resetTestPostgres();
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok, detail });
  };
  await step('identity-review-components', async () => (await import('./properties/identity-review-components')).identityReviewComponentProperties(check));
  await step('build-traces', async () => (await import('./properties/build-traces')).buildTraceProperties(check));
  await step('deploy-tooling', async () => (await import('./properties/deploy-tooling')).deployToolingProperties(check));
  await step('enrich-batch', async () => (await import('./properties/enrich-batch')).enrichBatchProperties(check));
  await step('team-edges', async () => (await import('./properties/team-edges')).teamEdgesProperties(check));
  await step('alias-join', async () => (await import('./properties/alias-join')).aliasJoinProperties(check));
  await step('w3-alias-keys', async () => (await import('./properties/w3-alias-keys')).w3AliasKeyProperties(check));
  await step('strip-dakota', async () => (await import('./properties/strip-dakota')).stripDakotaProperties(check));
  await step('cutover-shell', async () => (await import('./properties/cutover-shell')).cutoverShellProperties(check));
  await step('service-prep', async () => (await import('./properties/service-prep')).serviceEnvProperties(check));
  await step('postgres', async () => (await import('./properties/postgres')).databaseProperties(check));
  await step('pglite-worker', async () => (await import('./properties/pglite-worker')).pgliteWorkerProperties(check));
  await step('postgres-preview', async () => (await import('./properties/postgres-preview')).postgresPreviewProperties(check));
  await step('pg-copy', async () => (await import('./properties/pg-copy')).pgCopyProperties(check));
  await step('import-jobs', async () => (await import('./properties/import-jobs')).importJobProperties(check));
  await step('workflow-api', async () => (await import('./properties/workflow-api')).workflowApiProperties(check));
  await step('cloud-w1c', async () => (await import('./properties/cloud-w1c')).cloudW1cProperties(check));
  await step('sync-runs', async () => (await import('./properties/sync-runs')).syncRunsProperties(check));
  await step('cloud-w1', async () => (await import('./properties/cloud-w1')).cloudW1Properties(check));
  await step('cloud-w5', async () => (await import('./properties/cloud-w5')).cloudW5Properties(check));
  await step('cloud-sourcing', async () => (await import('./properties/cloud-sourcing')).cloudSourcingProperties(check));
  await step('daily-timer', async () => (await import('./properties/daily-timer')).dailyTimerProperties(check));
  await step('cache-retries', async () => (await import('./properties/cache-retries')).cacheRetryProperties(check));
  await step('suite', async () => (await import('./properties/suite')).runProperties(check));
  await step('perf-viz', async () => (await import('./properties/perf-viz')).perfVizProperties(check));
  await step('perf4', async () => (await import('./properties/perf4')).perf4Properties(check));
  await step('activity', async () => (await import('./properties/activity')).activityProperties(check));
  await step('activity-data', async () => (await import('./properties/activity-data')).activityDataProperties(check));
  await step('activity-perf', async () => (await import('./properties/activity-perf')).activityPerfProperties(check));
  await step('responsiveness', async () => (await import('./properties/responsiveness')).responsivenessProperties(check));
  await step('activity-connectors', async () => (await import('./properties/activity-connectors')).activityConnectorProperties(check));
  await step('triage-accuracy', async () => (await import('./properties/triage-accuracy')).triageAccuracyProperties(check));
  await step('triage-export', async () => (await import('./properties/triage-export')).triageExportProperties(check));

  await step('feedback-journal', async () => (await import('./properties/feedback-journal')).feedbackJournalProperties(check));
  await step('findings-network', async () => (await import('./properties/findings-network')).findingsNetworkProperties(check));
  await step('findings-perf', async () => (await import('./properties/findings-perf')).findingsPerfProperties(check));
  await step('network-speed', async () => (await import('./properties/network-speed')).networkSpeedProperties(check));
  await step('page-speed', async () => (await import('./properties/page-speed')).pageSpeedProperties(check));

  await step('w3-email-tiers', async () => (await import('./properties/w3-email-tiers')).w3EmailTierProperties(check));
  await step('demo-names', async () => (await import('./properties/demo-names')).demoNameProperties(check));

  await step('cleanTestPostgres', cleanTestPostgres);

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length} of ${results.length} properties hold.`);
  if (failed.length > 0) process.exit(1);
}

// A run whose event loop drains before the summary (a promise nothing keeps alive) used to exit 0
// silently, and the gate counted it as a pass (2–4 Oct 2026). Unfinished is a failure.
let finished = false;
process.on('beforeExit', () => {
  if (finished) return;
  const open = running();
  console.error(`Property run ended before its summary: unfinished${open.length ? ` (still in ${open.join(' > ')})` : ''}.`);
  process.exit(1);
});
main().then(() => { finished = true; }, (err: unknown) => { finished = true; throw err; }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

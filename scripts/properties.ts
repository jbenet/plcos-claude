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

async function main() {
  const { resetTestPostgres, cleanTestPostgres } = await import('./properties/database');
  await resetTestPostgres();
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok, detail });
  };
  await (await import('./properties/build-traces')).buildTraceProperties(check);
  await (await import('./properties/deploy-tooling')).deployToolingProperties(check);
  await (await import('./properties/enrich-batch')).enrichBatchProperties(check);
  await (await import('./properties/team-edges')).teamEdgesProperties(check);
  await (await import('./properties/alias-join')).aliasJoinProperties(check);
  await (await import('./properties/strip-dakota')).stripDakotaProperties(check);
  await (await import('./properties/cutover-shell')).cutoverShellProperties(check);
  await (await import('./properties/postgres')).databaseProperties(check);
  await (await import('./properties/pglite-worker')).pgliteWorkerProperties(check);
  await (await import('./properties/postgres-preview')).postgresPreviewProperties(check);
  await (await import('./properties/pg-copy')).pgCopyProperties(check);
  await (await import('./properties/import-jobs')).importJobProperties(check);
  await (await import('./properties/workflow-api')).workflowApiProperties(check);
  await (await import('./properties/daily-timer')).dailyTimerProperties(check);
  await (await import('./properties/cache-retries')).cacheRetryProperties(check);
  const { runProperties } = await import('./properties/suite');
  await runProperties(check);
  await (await import('./properties/perf-viz')).perfVizProperties(check);
  await (await import('./properties/perf4')).perf4Properties(check);
  await (await import('./properties/activity')).activityProperties(check);
  await (await import('./properties/activity-data')).activityDataProperties(check);
  await (await import('./properties/activity-perf')).activityPerfProperties(check);
  await (await import('./properties/responsiveness')).responsivenessProperties(check);
  await (await import('./properties/activity-connectors')).activityConnectorProperties(check);
  await (await import('./properties/triage-accuracy')).triageAccuracyProperties(check);
  await (await import('./properties/triage-export')).triageExportProperties(check);

  await (await import('./properties/feedback-journal')).feedbackJournalProperties(check);
  await (await import('./properties/findings-network')).findingsNetworkProperties(check);
  await (await import('./properties/findings-perf')).findingsPerfProperties(check);
  await (await import('./properties/network-speed')).networkSpeedProperties(check);

  await cleanTestPostgres();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length} of ${results.length} properties hold.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

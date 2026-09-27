/** Run the module properties, in their fixture-dependent order. npm run props */
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
delete process.env.DATABASE_URL;

async function main() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok, detail });
  };
  const { runProperties } = await import('./properties/suite');
  await runProperties(check);
  await (await import('./properties/perf-viz')).perfVizProperties(check);
  await (await import('./properties/perf4')).perf4Properties(check);
  await (await import('./properties/activity')).activityProperties(check);
  await (await import('./properties/activity-data')).activityDataProperties(check);
  await (await import('./properties/activity-connectors')).activityConnectorProperties(check);

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

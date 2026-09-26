/** Run the module properties, in their fixture-dependent order. npm run props */
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

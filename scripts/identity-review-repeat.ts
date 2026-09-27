/** Repeat the complete identity-review fixture group; failures are never retried. */
process.env.DATA_PROFILE = 'demo';
process.env.PGLITE_DIR = './data/demo/props';

async function main() {
  const repeats = Number(process.argv[2] ?? 50);
  if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('Expected a positive repeat count');
  const { freshDb } = await import('./properties/harness');
  const { identityReviewProperties } = await import('./identity-review-properties');
  const db = await freshDb();
  let checks = 0;
  try {
    // Keep the export busy with 128 unrelated namesake pairs as well as the demo
    // seed. Both backends use exactly the same invented background population.
    await db.query(`insert into identity.entity(entity_type,display_name)
      select 'person','Invented repeat background ' || md5(n::text)
      from generate_series(1,128) n cross join generate_series(1,2) copy`);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
      select 'prospect_key',entity_id::text,entity_id,'rule:repeat-fixture'
      from identity.entity where display_name like 'Invented repeat background %'`);
    for (let run = 1; run <= repeats; run++) {
      await identityReviewProperties((name, ok, detail) => {
        checks++;
        if (!ok) throw new Error(`Run ${run}: ${name}\n${detail}`);
      }, db);
      console.log(`${db.kind}: identity review ${run}/${repeats} passed`);
    }
    console.log(`${db.kind}: ${repeats} runs, ${checks} checks, zero failures`);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

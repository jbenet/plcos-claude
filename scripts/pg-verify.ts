/**
 * Compare two Postgres databases for a cutover (scripts/cutover.sh; docs/deploy/rev2/image-and-cutover.md).
 *
 *   node --import tsx scripts/pg-verify.ts <source-url> <target-url> [--json <file>] [--tables]
 *
 * The checks live in lib/db/pg-verify.ts: per-table row counts and pg-copy's ordered-row checksums,
 * sequences, and object counts. Prints counts and table names only. Exits 1 on any mismatch, 2 when
 * it cannot read a database.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, snapshot, type Snapshot } from '../lib/db/pg-verify';

export { compare };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
  const positional = args.filter((arg, i) => !arg.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1));
  if (positional.length !== 2) {
    console.error('Usage: node --import tsx scripts/pg-verify.ts <source-url> <target-url> [--json <file>] [--tables]');
    process.exit(2);
  }
  let a: Snapshot, b: Snapshot;
  try {
    [a, b] = await Promise.all([snapshot(positional[0]!), snapshot(positional[1]!)]);
  } catch (err) {
    // Never print the URL or driver detail: either can carry a password.
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code).replace(/[^A-Za-z0-9_]/g, '').slice(0, 30) : 'unknown';
    console.error(`verify: cannot read one of the databases (code ${code}).`);
    process.exit(2);
  }
  const report = compare(a, b);
  if (jsonFile) await writeFile(jsonFile, JSON.stringify(report, null, 1) + '\n', { mode: 0o600 });
  if (args.includes('--tables')) for (const t of report.perTable) console.log(`${t.ok ? 'OK  ' : 'FAIL'} ${t.table} source=${t.sourceRows ?? '-'} target=${t.targetRows ?? '-'}`);
  const objects = Object.entries(report.objects).map(([k, v]) => `${k} ${v.source}/${v.target}`).join(', ');
  console.log(`verify: ${report.ok ? 'MATCH' : 'MISMATCH'} · ${report.tables} tables, ${report.rows} rows · `
    + `${report.mismatchedTables.length} differ, ${report.missingTables.length} missing, ${report.extraTables.length} extra · `
    + `${report.sequences} sequences, ${report.mismatchedSequences.length} differ · objects ${objects}`);
  process.exit(report.ok ? 0 : 1);
}

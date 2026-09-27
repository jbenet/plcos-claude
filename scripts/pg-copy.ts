/** Usage: npm run pg:copy -- /closed/pglite-snapshot postgres://... [--replace] */
import { copyPgliteToPostgres, PgCopyError } from '../lib/db/pg-copy';

const args = process.argv.slice(2);
const positional = args.filter(arg => !arg.startsWith('--'));
if (positional.length !== 2 || args.some(arg => arg.startsWith('--') && arg !== '--replace')) {
  console.error('Usage: npm run pg:copy -- <closed-pglite-snapshot-directory> <postgres-url> [--replace]');
  process.exitCode = 1;
} else {
  try {
    const reports = await copyPgliteToPostgres({ source: positional[0], targetUrl: positional[1], replace: args.includes('--replace'), onTable: r => {
      console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.table} source=${r.sourceRows} target=${r.targetRows} sha256=${r.sourceChecksum} target_sha256=${r.targetChecksum}`);
    } });
    console.log(`Verified ${reports.length} tables. Copy committed; source snapshot untouched.`);
  } catch (err) {
    console.error(err instanceof PgCopyError ? err.message : 'Copy refused before opening the source; check paths and permissions.');
    process.exitCode = 1;
  }
}

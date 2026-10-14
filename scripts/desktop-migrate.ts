/**
 * The desktop app's local copy (docs/31 §3): make its database's schema with this build's own migrations, and
 * nothing else (no init file, no seed, no jobs). The app runs it in the downloaded build before syncing rows down.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/<db> node --import tsx scripts/desktop-migrate.ts
 */
import { openPostgres } from '../lib/db/postgres';
import { migrate } from '../lib/db/migrate';

const url = process.env.DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  console.error('[desktop-migrate] DATABASE_URL must be a Postgres on this machine.');
  process.exit(1);
}
const db = await openPostgres(url, { max: 1 });
try {
  const { applied } = await migrate(db);
  console.log(`[desktop-migrate] ${applied.length} migration(s) applied`);
} finally {
  await db.close();
}

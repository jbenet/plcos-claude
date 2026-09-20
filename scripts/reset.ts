import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { openFresh } from '../lib/db';

/**
 * Drop the local database and rebuild it. Issues are files, so they survive this —
 * which is most of the reason they are files.
 */
async function main() {
  if (config.db.url) {
    console.error('DATABASE_URL is set. Refusing to reset a remote database from a script.');
    process.exit(1);
  }
  const dir = join(process.cwd(), config.db.localDir);
  await rm(dir, { recursive: true, force: true });
  console.log(`removed ${config.db.localDir}`);
  const db = await openFresh();
  const n = await db.one<{ n: string }>('select count(*)::text as n from platform.app_user');
  console.log(`rebuilt · ${db.kind} · ${n?.n ?? 0} users seeded`);
  await db.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

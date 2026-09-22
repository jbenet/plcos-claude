import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { openFresh } from '../lib/db';
import { lockFile, lockHolder } from '../lib/db/lock';

/**
 * Drop the local database and rebuild it. Issues are files, so they survive this —
 * which is most of the reason they are files.
 */
async function main() {
  if (config.db.url) {
    console.error('DATABASE_URL is set. Refusing to reset a remote database from a script.');
    process.exit(1);
  }
  // The real database is the replica of Affinity plus every judgement recorded against it —
  // reviews, adjudications, the evidence a person confirmed. A replica can be fetched again;
  // the judgements cannot. Nothing here deletes it (docs/15).
  if (config.data.profile === 'real') {
    console.error(
      'Refusing to reset the real profile. It holds judgements that exist nowhere else.\n' +
        `If you mean it, stop the real server and delete ${config.db.localDir} yourself.`,
    );
    process.exit(1);
  }
  const holder = await lockHolder(config.db.localDir);
  if (holder) {
    console.error(`${config.db.localDir} is open in pid ${holder} — stop the dev server first, then reset.`);
    process.exit(1);
  }
  const dir = join(process.cwd(), config.db.localDir);
  await rm(dir, { recursive: true, force: true });
  await rm(join(process.cwd(), lockFile(config.db.localDir)), { force: true });
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

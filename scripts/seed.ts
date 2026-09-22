import { config } from '../config/deployment';
import { openFresh } from '../lib/db';
import { seed } from '../lib/seed';

async function main() {
  if (config.data.profile === 'real') {
    console.error('Refusing to seed the real profile. It starts from data/real/init.jsonc, never from fixtures.');
    process.exit(1);
  }
  const db = await openFresh();
  const counts = await seed(db);
  console.log(`seeded · ${counts.users} users · ${counts.vehicles} vehicles · ${counts.sources} sources`);
  await db.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
